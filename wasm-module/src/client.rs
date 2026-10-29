//! HTTP client implementation with builder pattern
//!
//! This module provides a flexible HTTP client with support for
//! retries, timeouts, and various configuration options.

use crate::budget::{Budget, RetryBudget};
use crate::{
    error::{Error, Result},
    runtime,
    types::{
        is_json_content_type, is_redirect_status, is_text_content_type, Body, Headers, Method,
        Multipart, Progress, Redirect, RequestConfig, Response, ResponseBody, ResponseFormat,
        RetryConfig, DEFAULT_MAX_REDIRECTS,
    },
};
use futures_util::{Stream, StreamExt};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub use crate::wasm::WasmClient;

/// HTTP client for making requests
#[derive(Clone)]
pub struct Client {
    inner: reqwest::Client,
    pub(crate) config: Arc<ClientConfig>,
    /// Requests started and not yet settled, shared by clones (counted only
    /// with `max_pending_requests`)
    pending: Arc<AtomicUsize>,
    /// Clients for requests that override the redirect settings: reqwest
    /// sets the redirect policy per client (and connection pool)
    #[cfg(not(target_arch = "wasm32"))]
    redirect_clients: Arc<std::sync::Mutex<Vec<(RedirectKey, reqwest::Client)>>>,
}

/// Client configuration
#[derive(Clone)]
pub(crate) struct ClientConfig {
    pub(crate) default_headers: Headers,
    pub(crate) timeout: Option<Duration>,
    retry_config: Option<RetryConfig>,
    pub(crate) base_url: Option<String>,
    redirect: Redirect,
    max_redirects: u32,
    pub(crate) allow_absolute_urls: bool,
    max_response_bytes: Option<u64>,
    /// Header names (lowercase) dropped on cross-origin redirects, besides
    /// `Authorization`, `Cookie` and `Proxy-Authorization`
    sensitive_headers: Vec<String>,
    allow_insecure_redirects: bool,
    max_pending_requests: Option<usize>,
    /// Shared by the client's clones through the `Arc<ClientConfig>`
    retry_budget: Option<Arc<Budget>>,
    limiter: Option<Arc<crate::limiter::Limiter>>,
    /// JavaScript: `maxLineBytes`, for NDJSON responses and event streams
    pub(crate) max_line_bytes: Option<usize>,
    /// JavaScript: `maxEventBytes`, for event streams
    pub(crate) max_event_bytes: Option<usize>,
    /// Browser `fetch()` options (`credentials`, `mode`, …), already validated
    #[cfg(target_arch = "wasm32")]
    pub(crate) fetch_options: Option<js_sys::Object>,
    /// Node.js: `'env'` or a proxy URL, already validated
    #[cfg(target_arch = "wasm32")]
    pub(crate) proxy: Option<String>,
    /// Node.js: `allowPrivateNetwork`
    #[cfg(target_arch = "wasm32")]
    pub(crate) allow_private_network: bool,
    #[cfg(target_arch = "wasm32")]
    pub(crate) idempotency: crate::wasm::idempotency::Defaults,
}

/// A download progress callback. Must be `Send + Sync` on native targets so
/// request futures stay `Send`; on WebAssembly any closure works.
#[cfg(not(target_arch = "wasm32"))]
pub trait ProgressCallback: Fn(Progress) + Send + Sync {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Fn(Progress) + Send + Sync> ProgressCallback for T {}

/// A download progress callback. Must be `Send + Sync` on native targets so
/// request futures stay `Send`; on WebAssembly any closure works.
#[cfg(target_arch = "wasm32")]
pub trait ProgressCallback: Fn(Progress) {}
#[cfg(target_arch = "wasm32")]
impl<T: Fn(Progress)> ProgressCallback for T {}

type ProgressFn = Arc<dyn ProgressCallback>;

/// The request's retry settings and whether its method/key allow replay.
#[derive(Clone, Copy)]
struct RetryPolicy<'a> {
    config: Option<&'a RetryConfig>,
    replay_safe: bool,
}

/// A response from one attempt: either fully read, or (for successful
/// streaming requests) with the body left unread in `stream`
struct RawResponse {
    status: u16,
    status_text: String,
    url: String,
    headers: Headers,
    body: Vec<u8>,
    permit: Option<crate::limiter::Ticket>,
    // In JavaScript runtimes, streamed requests are sent with fetch() instead
    #[cfg_attr(target_arch = "wasm32", allow(dead_code))]
    stream: Option<reqwest::Response>,
}

/// An attempt either succeeds or supplies an HTTP error with retry timing.
pub(crate) enum Attempt<T> {
    Success(T),
    HttpError(Error, Option<Duration>),
}

/// A successful response whose body is read incrementally
pub struct StreamingResponse {
    /// HTTP status code
    pub status: u16,
    /// Status text
    pub status_text: String,
    /// Response headers
    pub headers: Headers,
    /// Request URL (after redirects)
    pub url: String,
    inner: StreamBody,
    progress: Option<ProgressFn>,
    limit: Option<u64>,
    permit: Option<crate::limiter::Ticket>,
}

/// The unread body of a streamed response: reqwest's on native targets,
/// `fetch()`'s in JavaScript runtimes
#[cfg(not(target_arch = "wasm32"))]
type StreamBody = reqwest::Response;
#[cfg(target_arch = "wasm32")]
type StreamBody = crate::wasm::transport::FetchBody;

#[cfg(not(target_arch = "wasm32"))]
fn body_chunks(body: StreamBody) -> impl Stream<Item = Result<Vec<u8>>> {
    body.bytes_stream().map(|chunk| {
        chunk
            .map(|chunk| chunk.to_vec())
            .map_err(|e| Error::network("Failed to read response body", e))
    })
}

#[cfg(target_arch = "wasm32")]
fn body_chunks(body: StreamBody) -> impl Stream<Item = Result<Vec<u8>>> {
    body.chunks()
}

impl StreamingResponse {
    /// The expected body size from `Content-Length`, if known
    pub fn content_length(&self) -> Option<u64> {
        self.inner.content_length()
    }

    /// Stream the body chunk by chunk, reporting progress if a callback was set
    pub fn into_stream(self) -> impl Stream<Item = Result<Vec<u8>>> {
        let total = self.inner.content_length();
        let progress = self.progress;
        let limit = self.limit;
        let mut loaded = 0u64;
        // A Content-Length over the limit fails on the first read
        let declared_too_large =
            matches!((limit, total), (Some(limit), Some(total)) if total > limit);
        let chunks = body_chunks(self.inner).map(move |chunk| {
            if let (true, Some(limit)) = (declared_too_large, limit) {
                return Err(Error::too_large(limit));
            }
            let chunk = chunk?;
            loaded += chunk.len() as u64;
            if let Some(limit) = limit.filter(|limit| loaded > *limit) {
                return Err(Error::too_large(limit));
            }
            if let Some(progress) = &progress {
                progress(Progress { loaded, total });
            }
            Ok(chunk)
        });
        crate::limiter::PermitStream::new(chunks, self.permit)
    }

    /// The transport's stream as it is, when nothing needs to see the bytes
    /// on their way (no download progress, no size limit); otherwise the
    /// response back, to read through [`StreamingResponse::into_stream`]
    #[cfg(target_arch = "wasm32")]
    pub(crate) fn into_raw(self) -> std::result::Result<Option<web_sys::ReadableStream>, Self> {
        if self.progress.is_some() || self.limit.is_some() || self.permit.is_some() {
            return Err(self);
        }
        Ok(self.inner.into_raw())
    }

    /// Read the remaining body into memory
    pub async fn bytes(self) -> Result<Vec<u8>> {
        let mut body = Vec::new();
        let mut stream = std::pin::pin!(self.into_stream());
        while let Some(chunk) = stream.next().await {
            body.extend_from_slice(&chunk?);
        }
        Ok(body)
    }
}

impl std::fmt::Debug for StreamingResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamingResponse")
            .field("status", &self.status)
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

impl Client {
    /// Create a new client builder
    pub fn builder() -> ClientBuilder {
        ClientBuilder::new()
    }

    /// Create a new client with default configuration
    pub fn new() -> Result<Self> {
        Self::builder().build()
    }

    /// Make a GET request
    pub async fn get(&self, url: impl AsRef<str>) -> Result<Response> {
        self.request(Method::Get, url).send().await
    }

    /// Make a GET request and stream the response body
    pub async fn get_streaming(&self, url: impl AsRef<str>) -> Result<StreamingResponse> {
        self.request(Method::Get, url).send_streaming().await
    }

    /// Make a POST request
    pub fn post(&self, url: impl AsRef<str>) -> RequestBuilder {
        self.request(Method::Post, url)
    }

    /// Make a PUT request
    pub fn put(&self, url: impl AsRef<str>) -> RequestBuilder {
        self.request(Method::Put, url)
    }

    /// Make a DELETE request
    pub fn delete(&self, url: impl AsRef<str>) -> RequestBuilder {
        self.request(Method::Delete, url)
    }

    /// Make a PATCH request
    pub fn patch(&self, url: impl AsRef<str>) -> RequestBuilder {
        self.request(Method::Patch, url)
    }

    /// Create a request builder
    ///
    /// Relative URLs are resolved against the client's base URL (or, in a
    /// browser, against the page URL). Absolute URLs are used as-is.
    pub fn request(&self, method: Method, url: impl AsRef<str>) -> RequestBuilder {
        let (redirect, max_redirects) = (self.config.redirect, self.config.max_redirects);
        let (follow_redirects, limit) = redirect.config(max_redirects);
        RequestBuilder {
            client: self.clone(),
            config: RequestConfig {
                method,
                headers: self.config.default_headers.clone(),
                body: None,
                timeout: self.config.timeout,
                follow_redirects,
                max_redirects: limit,
                response_format: ResponseFormat::Auto,
            },
            url: url.as_ref().to_string(),
            query: Vec::new(),
            progress: None,
            retry_config: None,
            idempotency_header: None,
            redirect,
            max_redirects,
            allow_absolute_urls: self.config.allow_absolute_urls,
            max_response_bytes: self.config.max_response_bytes,
            sensitive_headers: self.config.sensitive_headers.clone(),
            allow_insecure_redirects: self.config.allow_insecure_redirects,
            #[cfg(target_arch = "wasm32")]
            allow_private_network: self.config.allow_private_network,
            #[cfg(target_arch = "wasm32")]
            fetch_options: self.config.fetch_options.clone(),
            #[cfg(target_arch = "wasm32")]
            retry_refused: None,
        }
    }

    /// The reqwest client for a request's redirect settings
    #[cfg(not(target_arch = "wasm32"))]
    fn http_client(
        &self,
        config: &RequestConfig,
        guards: RedirectGuards,
    ) -> Result<reqwest::Client> {
        let key = (config.follow_redirects, config.max_redirects, guards);
        let (follow, max) = self.config.redirect.config(self.config.max_redirects);
        if key == (follow, max, RedirectGuards::default()) {
            return Ok(self.inner.clone());
        }
        let mut clients = self
            .redirect_clients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((_, client)) = clients.iter().find(|(settings, _)| *settings == key) {
            return Ok(client.clone());
        }
        let client = http_client(key)?;
        clients.push((key, client.clone()));
        Ok(client)
    }

    /// In browsers `fetch()` follows redirects; the bindings send requests
    /// with other redirect settings through their own transports
    #[cfg(target_arch = "wasm32")]
    #[allow(clippy::unnecessary_wraps)]
    fn http_client(
        &self,
        _config: &RequestConfig,
        _guards: RedirectGuards,
    ) -> Result<reqwest::Client> {
        Ok(self.inner.clone())
    }

    /// Execute a request with its retry policy, falling back to the client's.
    ///
    /// With `stream`, a successful response's body is left unread.
    async fn execute(
        &self,
        url: &str,
        query: &[(String, String)],
        config: &RequestConfig,
        stream: bool,
        progress: Option<&ProgressFn>,
        limit: Option<u64>,
        guards: RedirectGuards,
        retry: RetryPolicy<'_>,
    ) -> Result<RawResponse> {
        let url = resolve_url(self.config.base_url.as_deref(), page_url(), url, query)?;
        // reqwest takes its own URL type; in WebAssembly the bindings' URLs are
        // the runtime's (crate::url), and this reqwest path isn't reached from JS
        #[cfg(target_arch = "wasm32")]
        let url = reqwest::Url::parse(url.as_str())
            .map_err(|e| Error::network("Invalid URL for reqwest", e))?;
        self.execute_retrying(url.as_str(), config.timeout, retry, None, || async {
            let raw = self
                .execute_once(&url, config, stream, progress, limit, guards)
                .await?;
            if is_success(raw.status, config) {
                Ok(Attempt::Success(raw))
            } else {
                let retry_after = raw
                    .headers
                    .get_first("retry-after")
                    .and_then(parse_retry_after);
                Ok(Attempt::HttpError(
                    Error::Http {
                        status: raw.status,
                        status_text: raw.status_text,
                        body: Some(bytes_to_text(raw.body)),
                    },
                    retry_after,
                ))
            }
        })
        .await
        .map(|(mut raw, permit)| {
            if stream {
                raw.permit = permit;
            }
            raw
        })
    }

    /// Shared retry/timeout policy for Rust responses and JS-native bodies.
    /// `refused` is set when the retry budget refused a retry.
    async fn execute_retrying<T, F, Fut>(
        &self,
        url: &str,
        timeout: Option<Duration>,
        retry: RetryPolicy<'_>,
        refused: Option<&AtomicBool>,
        mut send: F,
    ) -> Result<(T, Option<crate::limiter::Ticket>)>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<Attempt<T>>>,
    {
        let _pending = self.admit()?;
        let budget = self.config.retry_budget.as_deref();
        if let Some(budget) = budget {
            budget.request(runtime::now_ms());
        }
        // The budget is checked before waiting to retry and spent once the
        // retry is sent; either way, a refusal returns the attempt's error
        let refuse = |error| {
            if let Some(refused) = refused {
                refused.store(true, Ordering::Relaxed);
            }
            Err(error)
        };
        let gate = self
            .config
            .limiter
            .as_ref()
            .map(|limiter| limiter.gate(url));
        let mut attempt = 0;
        let mut retry_error = None;

        loop {
            let permit = match &gate {
                // Keep the optional admission future out of the ordinary
                // request's inline state: none of its queue/timer state is
                // needed when limits are disabled.
                Some(gate) => Some(Box::pin(gate.acquire()).await),
                None => None,
            };
            if let Some(error) = retry_error.take() {
                if budget.is_some_and(|budget| !budget.spend(runtime::now_ms())) {
                    return refuse(error);
                }
            }
            let once = send();
            let outcome = match timeout {
                Some(timeout) => runtime::timeout(timeout, once).await,
                None => once.await,
            };

            let (error, retry_after) = match outcome {
                Ok(Attempt::Success(response)) => return Ok((response, permit)),
                Ok(Attempt::HttpError(error, retry_after)) => (error, retry_after),
                Err(error) => (error, None),
            };

            drop(permit);
            if matches!(error, Error::Http { status: 429, .. }) {
                if let (Some(gate), Some(delay)) = (&gate, retry_after) {
                    gate.pause(delay);
                }
            }
            match Self::retry_delay(
                retry.config,
                attempt,
                retry.replay_safe,
                &error,
                retry_after,
            ) {
                Some(delay) => {
                    if budget.is_some_and(|budget| !budget.can_retry(runtime::now_ms())) {
                        return refuse(error);
                    }
                    attempt += 1;
                    runtime::sleep(delay).await;
                    retry_error = Some(error);
                }
                None => return Err(error),
            }
        }
    }

    /// Retries the retry budget has refused so far (0 without a budget)
    pub fn retries_refused(&self) -> u64 {
        self.config
            .retry_budget
            .as_deref()
            .map_or(0, Budget::refused)
    }

    /// Count a request as pending until it settles or is dropped, or refuse
    /// it at once when the client already has `max_pending_requests`
    fn admit(&self) -> Result<Option<Pending>> {
        let Some(limit) = self.config.max_pending_requests else {
            return Ok(None);
        };
        let pending = Pending(Arc::clone(&self.pending));
        if self.pending.fetch_add(1, Ordering::Relaxed) >= limit {
            return Err(Error::too_many_pending(limit));
        }
        Ok(Some(pending))
    }

    /// Decide whether a failed attempt should be retried, and after how long
    fn retry_delay(
        retry: Option<&RetryConfig>,
        attempt: u32,
        replay_safe: bool,
        error: &Error,
        retry_after: Option<Duration>,
    ) -> Option<Duration> {
        let retry = retry?;
        if attempt >= retry.max_retries {
            return None;
        }
        // The server may have acted on a non-idempotent request before failing.
        if !replay_safe && !retry.retry_non_idempotent {
            return None;
        }
        let retryable = match error {
            Error::Network { .. } => retry.retry_on_network_error,
            Error::Timeout { .. } => retry.retry_on_timeout,
            Error::Http { status, .. } => retry.retry_on_status.contains(status),
            _ => false,
        };
        if !retryable {
            return None;
        }

        Some(match retry_after {
            Some(delay) => delay.min(retry.max_delay),
            None => with_jitter(calculate_retry_delay(attempt + 1, retry)),
        })
    }

    /// Send a single request attempt and read its body (unless streaming a success)
    async fn execute_once(
        &self,
        url: &reqwest::Url,
        config: &RequestConfig,
        stream: bool,
        progress: Option<&ProgressFn>,
        limit: Option<u64>,
        guards: RedirectGuards,
    ) -> Result<RawResponse> {
        let mut request = self
            .http_client(config, guards)?
            .request(config.method.to_reqwest(), url.clone());

        // Set headers
        for (name, values) in config.headers.iter() {
            for value in values {
                request = request.header(name.as_str(), value.as_str());
            }
        }

        // Set body, keeping any Content-Type the caller chose
        if let Some(body) = &config.body {
            if !config.headers.contains("content-type") {
                request = request.header("content-type", body.content_type());
            }
            request = request.body(body.to_bytes()?);
        }

        let response = request.send().await?;

        let status = response.status();
        let url = response.url().to_string();
        let mut headers = Headers::new();
        for (name, value) in response.headers() {
            headers.insert(name.as_str(), String::from_utf8_lossy(value.as_bytes()));
        }

        let success = is_success(status.as_u16(), config);
        let (body, stream) = if stream && success {
            (Vec::new(), Some(response))
        } else {
            // Only report progress for the body the caller asked for
            let progress = progress.filter(|_| success);
            (read_body(response, progress, limit).await?, None)
        };

        Ok(RawResponse {
            permit: None,
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").to_string(),
            url,
            headers,
            body,
            stream,
        })
    }
}

/// Whether a response is returned rather than rejected: a 2xx, or with
/// `follow_redirects: false`, a redirect
fn is_success(status: u16, config: &RequestConfig) -> bool {
    (200..300).contains(&status) || !config.follow_redirects && is_redirect_status(status)
}

/// A reqwest client following redirects as configured
/// Errors for refused redirects, the same on every transport
pub(crate) const INSECURE_REDIRECT: &str =
    "Insecure redirect refused (allowInsecureRedirects is false): https: to";
#[cfg(not(target_arch = "wasm32"))]
const CROSS_ORIGIN_REDIRECT: &str = "Redirect to another origin refused: the request has a header listed in sensitiveHeaders, which this transport can't drop";

/// The settings a reqwest client's redirect policy is built from
type RedirectKey = (bool, u32, RedirectGuards);

fn http_client((follow, max_redirects, guards): RedirectKey) -> Result<reqwest::Client> {
    let builder = reqwest::Client::builder();
    #[cfg(not(target_arch = "wasm32"))]
    let builder = builder.redirect(redirect_policy(follow, max_redirects, guards));
    #[cfg(target_arch = "wasm32")]
    let _ = (follow, max_redirects, guards);
    builder.build().map_err(client_init_error)
}

#[cfg(not(target_arch = "wasm32"))]
fn redirect_policy(
    follow: bool,
    max_redirects: u32,
    guards: RedirectGuards,
) -> reqwest::redirect::Policy {
    if !follow {
        return reqwest::redirect::Policy::none();
    }
    reqwest::redirect::Policy::custom(move |attempt| {
        // `previous` ends with the URL that answered with this redirect
        let refused = attempt
            .previous()
            .last()
            .and_then(|from| guards.refuse(from, attempt.url()));
        if let Some(message) = refused {
            return attempt.error(message);
        }
        // `previous` includes the original URL
        let redirects = attempt.previous().len();
        if redirects <= max_redirects as usize {
            return attempt.follow();
        }
        let message = if max_redirects == 0 {
            format!(
                "Redirect not allowed: {} to {}",
                attempt.status().as_u16(),
                attempt.url()
            )
        } else {
            format!("Too many redirects (more than {max_redirects})")
        };
        attempt.error(message)
    })
}

/// With a base URL and `allow` off, an absolute URL is an error: it would
/// replace the base URL and receive the client's default headers
pub(crate) fn check_absolute_url(base: Option<&str>, url: &str, allow: bool) -> Result<()> {
    if allow || base.is_none() || crate::url::Url::parse(url).is_err() {
        return Ok(());
    }
    Err(Error::InvalidInput {
        parameter: "url".to_string(),
        reason: format!(
            "'{url}' is an absolute URL, and allowAbsoluteUrls is off; use a path relative to the base URL"
        ),
    })
}

/// Resolve a request URL and append query parameters.
///
/// Absolute URLs are used as-is; relative ones are appended to `base`, or
/// else resolved against `page` (the browser page URL, when there is one).
pub(crate) fn resolve_url(
    base: Option<&str>,
    page: Option<crate::url::Url>,
    url: &str,
    query: &[(String, String)],
) -> Result<crate::url::Url> {
    let invalid = |reason: String| Error::InvalidInput {
        parameter: "url".to_string(),
        reason,
    };

    let mut resolved = match (crate::url::Url::parse(url), base, page) {
        (Ok(absolute), _, _) => absolute,
        (Err(_), Some(base), _) => {
            let joined = join_base_url(base, url);
            crate::url::Url::parse(&joined).map_err(|e| invalid(format!("'{joined}': {e}")))?
        }
        (Err(_), None, Some(page)) => page
            .join(url)
            .map_err(|e| invalid(format!("'{url}': {e}")))?,
        (Err(_), None, None) => {
            return Err(invalid(format!(
                "'{url}' is not an absolute URL; use an absolute URL or set a base URL"
            )))
        }
    };

    if !matches!(resolved.scheme(), "http" | "https") {
        return Err(invalid(format!(
            "unsupported scheme '{}' in '{resolved}'; only http and https are supported",
            resolved.scheme()
        )));
    }

    if !query.is_empty() {
        resolved.query_pairs_mut().extend_pairs(query);
    }
    Ok(resolved)
}

/// Read a whole body chunk by chunk, reporting progress after each chunk
async fn read_body(
    response: reqwest::Response,
    progress: Option<&ProgressFn>,
    limit: Option<u64>,
) -> Result<Vec<u8>> {
    const MAX_PREALLOCATION: u64 = 64 * 1024 * 1024;
    let total = response.content_length();
    // Fail before reading when the server says the body is too large
    if let (Some(limit), Some(total)) = (limit, total) {
        if total > limit {
            return Err(Error::too_large(limit));
        }
    }
    let capacity = usize::try_from(total.unwrap_or(0).min(MAX_PREALLOCATION)).unwrap_or(0);
    let mut body = Vec::with_capacity(capacity);

    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|e| Error::network("Failed to read response body", e))?;
        body.extend_from_slice(&chunk);
        if let Some(limit) = limit.filter(|limit| body.len() as u64 > *limit) {
            return Err(Error::too_large(limit));
        }
        if let Some(progress) = progress {
            progress(Progress {
                loaded: body.len() as u64,
                total,
            });
        }
    }
    Ok(body)
}

/// Join a base URL and a relative path with exactly one slash between them
fn join_base_url(base: &str, path: &str) -> String {
    if path.is_empty() || path.starts_with('?') || path.starts_with('#') {
        format!("{base}{path}")
    } else {
        format!(
            "{}/{}",
            base.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }
}

/// The current page URL, used to resolve relative URLs in browsers
pub(crate) fn page_url() -> Option<crate::url::Url> {
    #[cfg(target_arch = "wasm32")]
    {
        let location = js_sys::Reflect::get(&js_sys::global(), &"location".into()).ok()?;
        if location.is_undefined() || location.is_null() {
            return None;
        }
        let href = js_sys::Reflect::get(&location, &"href".into())
            .ok()?
            .as_string()?;
        crate::url::Url::parse(&href).ok()
    }

    #[cfg(not(target_arch = "wasm32"))]
    None
}

/// Parse a `Retry-After` header given in seconds
pub(crate) fn parse_retry_after(value: &str) -> Option<Duration> {
    value.trim().parse::<u64>().ok().map(Duration::from_secs)
}

/// Decode a response body according to the requested format
fn decode_body(bytes: Vec<u8>, content_type: &str, format: ResponseFormat) -> Result<ResponseBody> {
    if bytes.is_empty() {
        return Ok(match format {
            ResponseFormat::Text => ResponseBody::Text(String::new()),
            ResponseFormat::Binary => ResponseBody::Binary(Vec::new()),
            ResponseFormat::Json | ResponseFormat::Auto => ResponseBody::Empty,
        });
    }

    Ok(match format {
        ResponseFormat::Json => ResponseBody::Json(
            serde_json::from_slice(strip_bom(&bytes))
                .map_err(|e| Error::parse("Failed to parse JSON response", e))?,
        ),
        ResponseFormat::Text => ResponseBody::Text(bytes_to_text(bytes)),
        ResponseFormat::Binary => ResponseBody::Binary(bytes),
        ResponseFormat::Auto if is_json_content_type(content_type) => {
            match serde_json::from_slice(strip_bom(&bytes)) {
                Ok(json) => ResponseBody::Json(json),
                // Mislabelled responses fall back to text, or bytes if not UTF-8
                Err(_) => match String::from_utf8(bytes) {
                    Ok(text) => ResponseBody::Text(text),
                    Err(e) => ResponseBody::Binary(e.into_bytes()),
                },
            }
        }
        ResponseFormat::Auto if is_text_content_type(content_type) => {
            ResponseBody::Text(bytes_to_text(bytes))
        }
        ResponseFormat::Auto => ResponseBody::Binary(bytes),
    })
}

fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes)
}

/// Decode UTF-8 text, replacing invalid sequences instead of failing
pub(crate) fn bytes_to_text(bytes: Vec<u8>) -> String {
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
    };
    match text.strip_prefix('\u{FEFF}') {
        Some(stripped) => stripped.to_string(),
        None => text,
    }
}

/// Header names, lowercased
fn lowercase<I, S>(names: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    names
        .into_iter()
        .map(|name| name.into().to_ascii_lowercase())
        .collect()
}

/// Redirect rules beyond following and counting, for transports that can
/// only refuse a redirect (reqwest's policy can't change the headers)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RedirectGuards {
    /// Follow `https:` → `http:` redirects (`allowInsecureRedirects`)
    pub(crate) allow_insecure: bool,
    /// Refuse redirects to another origin: the request has a header from
    /// `sensitiveHeaders`, which this transport can't drop
    pub(crate) same_origin_only: bool,
}

impl RedirectGuards {
    /// Why a redirect from `from` to `to` is refused, if it is
    #[cfg(not(target_arch = "wasm32"))]
    fn refuse(self, from: &reqwest::Url, to: &reqwest::Url) -> Option<String> {
        if !self.allow_insecure && from.scheme() == "https" && to.scheme() == "http" {
            return Some(format!(
                "{INSECURE_REDIRECT} {}",
                to.origin().ascii_serialization()
            ));
        }
        if self.same_origin_only && from.origin() != to.origin() {
            return Some(CROSS_ORIGIN_REDIRECT.to_string());
        }
        None
    }
}

impl Default for RedirectGuards {
    fn default() -> Self {
        Self {
            allow_insecure: true,
            same_origin_only: false,
        }
    }
}

/// A request counted as pending; dropping it (when the request settles, or
/// its future is dropped) frees its place
struct Pending(Arc<AtomicUsize>);

impl Drop for Pending {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Builder for creating HTTP clients
pub struct ClientBuilder {
    headers: Headers,
    timeout: Option<Duration>,
    retry_config: Option<RetryConfig>,
    base_url: Option<String>,
    redirect: Redirect,
    max_redirects: u32,
    allow_absolute_urls: bool,
    max_response_bytes: Option<u64>,
    sensitive_headers: Vec<String>,
    allow_insecure_redirects: bool,
    max_pending_requests: Option<usize>,
    retry_budget: Option<RetryBudget>,
    limits: crate::limiter::Config,
    max_line_bytes: Option<usize>,
    max_event_bytes: Option<usize>,
    #[cfg(target_arch = "wasm32")]
    fetch_options: Option<js_sys::Object>,
    #[cfg(target_arch = "wasm32")]
    proxy: Option<String>,
    #[cfg(target_arch = "wasm32")]
    allow_private_network: bool,
    #[cfg(target_arch = "wasm32")]
    idempotency: crate::wasm::idempotency::Defaults,
}

impl ClientBuilder {
    /// Create a new client builder
    pub fn new() -> Self {
        Self {
            headers: Headers::new(),
            timeout: Some(Duration::from_secs(30)),
            retry_config: None,
            base_url: None,
            redirect: Redirect::Follow,
            max_redirects: DEFAULT_MAX_REDIRECTS,
            allow_absolute_urls: true,
            max_response_bytes: None,
            sensitive_headers: Vec::new(),
            allow_insecure_redirects: true,
            max_pending_requests: None,
            retry_budget: None,
            limits: crate::limiter::Config::default(),
            max_line_bytes: None,
            max_event_bytes: None,
            #[cfg(target_arch = "wasm32")]
            fetch_options: None,
            #[cfg(target_arch = "wasm32")]
            proxy: None,
            #[cfg(target_arch = "wasm32")]
            allow_private_network: true,
            #[cfg(target_arch = "wasm32")]
            idempotency: crate::wasm::idempotency::Defaults::default(),
        }
    }

    #[cfg(target_arch = "wasm32")]
    pub(crate) fn idempotency(mut self, defaults: crate::wasm::idempotency::Defaults) -> Self {
        self.idempotency = defaults;
        self
    }

    /// Node.js: whether requests may reach private and reserved addresses
    #[cfg(target_arch = "wasm32")]
    pub(crate) fn allow_private_network(mut self, allow: bool) -> Self {
        self.allow_private_network = allow;
        self
    }

    /// Node.js: send requests through a proxy (`'env'` or a URL), validated by the bindings
    #[cfg(target_arch = "wasm32")]
    pub(crate) fn proxy(mut self, proxy: Option<String>) -> Self {
        self.proxy = proxy;
        self
    }

    /// Browser `fetch()` options for every request, validated by the bindings
    #[cfg(target_arch = "wasm32")]
    pub(crate) fn fetch_options(mut self, options: Option<js_sys::Object>) -> Self {
        self.fetch_options = options;
        self
    }

    /// What to do when the server redirects (default: [`Redirect::Follow`])
    pub fn redirect(mut self, redirect: Redirect) -> Self {
        self.redirect = redirect;
        self
    }

    /// Maximum number of redirects to follow (default: 20)
    pub fn max_redirects(mut self, max_redirects: u32) -> Self {
        self.max_redirects = max_redirects;
        self
    }

    /// With `false` and a base URL, reject absolute request URLs instead of
    /// letting them replace the base URL, along with the client's default
    /// headers (default: `true`). Use it when paths come from input.
    pub fn allow_absolute_urls(mut self, allow: bool) -> Self {
        self.allow_absolute_urls = allow;
        self
    }

    /// Fail requests whose (decompressed) response body is larger than this
    /// many bytes, reading no more than that (default: no limit). The error
    /// is a network error; see [`Error::response_too_large`].
    pub fn max_response_bytes(mut self, limit: u64) -> Self {
        self.max_response_bytes = Some(limit);
        self
    }

    /// Header names that carry credentials, dropped on a redirect to another
    /// origin along with `Authorization`, `Cookie` and `Proxy-Authorization`
    /// (case-insensitive), e.g. `["x-api-key"]`. reqwest can't drop headers
    /// on a redirect, so in the Rust client a request that has one of these
    /// headers refuses cross-origin redirects instead.
    pub fn sensitive_headers<I, S>(mut self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.sensitive_headers = lowercase(names);
        self
    }

    /// Whether to follow a redirect from `https:` to `http:` (default:
    /// `true`). With `false`, such a redirect fails with a network error.
    pub fn allow_insecure_redirects(mut self, allow: bool) -> Self {
        self.allow_insecure_redirects = allow;
        self
    }

    /// Limit retries across the client and its clones, for all origins, so a
    /// failing upstream doesn't get every request retried at once (a retry
    /// storm). First attempts are always sent; see [`RetryBudget`] for the
    /// accounting. A refused retry returns the attempt's error, and
    /// [`Client::retries_refused`] counts refusals. Default: no budget.
    pub fn retry_budget(mut self, budget: RetryBudget) -> Self {
        self.retry_budget = Some(budget);
        self
    }

    /// JavaScript: the longest line allowed in NDJSON responses and event streams
    pub(crate) fn max_line_bytes(mut self, limit: usize) -> Self {
        self.max_line_bytes = Some(limit);
        self
    }

    /// JavaScript: the most data one Server-Sent Event can hold
    pub(crate) fn max_event_bytes(mut self, limit: usize) -> Self {
        self.max_event_bytes = Some(limit);
        self
    }

    /// Refuse a request at once while the client (and its clones) already
    /// has this many started and not yet settled, retries included, so a
    /// caller that can't keep up sheds load instead of queuing without bound
    /// (default: no limit). A streamed response counts until its headers
    /// arrive. The error is a network error; see
    /// [`Error::too_many_pending_requests`]. Must be at least 1.
    pub fn max_pending_requests(mut self, limit: usize) -> Self {
        self.max_pending_requests = Some(limit);
        self
    }

    /// Set default header
    pub fn default_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.insert(name, value);
        self
    }

    /// Set default headers
    pub fn default_headers(mut self, headers: Headers) -> Self {
        self.headers = headers;
        self
    }

    /// Set the timeout for each request attempt (default: 30 seconds).
    ///
    /// The timeout covers sending the request and reading the whole response body.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Disable the default request timeout
    pub fn no_timeout(mut self) -> Self {
        self.timeout = None;
        self
    }

    /// Enable retries with default configuration
    pub fn with_retries(mut self) -> Self {
        self.retry_config = Some(RetryConfig::default());
        self
    }

    /// Set retry configuration
    pub fn retry_config(mut self, config: RetryConfig) -> Self {
        self.retry_config = Some(config);
        self
    }

    /// Set base URL for all requests
    pub fn base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = Some(url.into());
        self
    }

    /// Maximum attempts in flight; streaming responses hold a slot until EOF or drop.
    pub fn max_concurrent(mut self, limit: usize) -> Self {
        self.limits.concurrent = Some(limit);
        self
    }

    /// Limit attempt rate with a token bucket, including retries.
    pub fn rate_limit(mut self, limit: crate::RateLimit) -> Self {
        self.limits.rate = Some(limit);
        self
    }

    /// Apply concurrency/rate limits independently to each origin, rather than globally.
    pub fn limits_per_origin(mut self, per_origin: bool) -> Self {
        self.limits.per_origin = per_origin;
        self
    }

    /// Build the client
    pub fn build(self) -> Result<Client> {
        self.limits.validate()?;
        if let Some(name) = self.retry_budget.as_ref().and_then(RetryBudget::invalid) {
            return Err(Error::InvalidInput {
                parameter: name.to_string(),
                reason: "must be a finite, non-negative number (windowMs: positive)".to_string(),
            });
        }
        if self.max_pending_requests == Some(0) {
            return Err(Error::InvalidInput {
                parameter: "maxPendingRequests".to_string(),
                reason: "must be at least 1".to_string(),
            });
        }
        if let Some(base) = &self.base_url {
            let parsed = crate::url::Url::parse(base).map_err(|e| Error::InvalidInput {
                parameter: "baseUrl".to_string(),
                reason: format!("'{base}' is not a valid absolute URL: {e}"),
            })?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err(Error::InvalidInput {
                    parameter: "baseUrl".to_string(),
                    reason: format!(
                        "unsupported scheme '{}'; only http and https are supported",
                        parsed.scheme()
                    ),
                });
            }
        }

        let (follow, max) = self.redirect.config(self.max_redirects);
        let inner = http_client((follow, max, RedirectGuards::default()))?;

        Ok(Client {
            inner,
            config: Arc::new(ClientConfig {
                default_headers: self.headers,
                timeout: self.timeout,
                retry_config: self.retry_config,
                base_url: self.base_url,
                redirect: self.redirect,
                max_redirects: self.max_redirects,
                allow_absolute_urls: self.allow_absolute_urls,
                max_response_bytes: self.max_response_bytes,
                sensitive_headers: self.sensitive_headers,
                allow_insecure_redirects: self.allow_insecure_redirects,
                max_pending_requests: self.max_pending_requests,
                retry_budget: self
                    .retry_budget
                    .map(|budget| Arc::new(Budget::new(budget))),
                max_line_bytes: self.max_line_bytes,
                limiter: self
                    .limits
                    .enabled()
                    .then(|| Arc::new(crate::limiter::Limiter::new(self.limits))),
                max_event_bytes: self.max_event_bytes,
                #[cfg(target_arch = "wasm32")]
                fetch_options: self.fetch_options,
                #[cfg(target_arch = "wasm32")]
                proxy: self.proxy,
                #[cfg(target_arch = "wasm32")]
                allow_private_network: self.allow_private_network,
                #[cfg(target_arch = "wasm32")]
                idempotency: self.idempotency,
            }),
            pending: Arc::default(),
            #[cfg(not(target_arch = "wasm32"))]
            redirect_clients: Arc::default(),
        })
    }
}

impl Default for ClientBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Request builder for configuring individual requests
pub struct RequestBuilder {
    client: Client,
    pub(crate) config: RequestConfig,
    url: String,
    query: Vec<(String, String)>,
    progress: Option<ProgressFn>,
    /// None inherits the client policy; a zero-retry config disables it.
    retry_config: Option<RetryConfig>,
    idempotency_header: Option<String>,
    redirect: Redirect,
    max_redirects: u32,
    allow_absolute_urls: bool,
    pub(crate) max_response_bytes: Option<u64>,
    sensitive_headers: Vec<String>,
    allow_insecure_redirects: bool,
    /// Node.js: `allowPrivateNetwork`
    #[cfg(target_arch = "wasm32")]
    pub(crate) allow_private_network: bool,
    /// Browser `fetch()` options: the client's, with this request's overrides
    #[cfg(target_arch = "wasm32")]
    pub(crate) fetch_options: Option<js_sys::Object>,
    /// JavaScript: set when the retry budget refused a retry, so the error
    /// can say so (`retryBudgetExhausted`)
    #[cfg(target_arch = "wasm32")]
    pub(crate) retry_refused: Option<Arc<AtomicBool>>,
}

impl RequestBuilder {
    /// Keep JS response bodies outside wasm memory, retaining the shared policy.
    #[cfg(target_arch = "wasm32")]
    pub(crate) async fn send_js(
        self,
        body_type: crate::wasm::BodyType,
        progress: crate::wasm::transport::ProgressCallbacks,
    ) -> Result<wasm_bindgen::JsValue> {
        self.check_absolute_url()?;
        let url = resolve_url(
            self.client.config.base_url.as_deref(),
            page_url(),
            &self.url,
            &self.query,
        )?;
        let request = crate::wasm::transport::PreparedRequest::new(
            url.as_str(),
            &self.config,
            &self.transport_options(),
            body_type,
            progress,
        )?;
        // The Node transport runs its own timer per attempt (cheaper than a
        // wasm-side timer); the policy and error are the same.
        let timeout = if request.enforces_timeout() {
            None
        } else {
            self.config.timeout
        };
        self.client
            .execute_retrying(
                url.as_str(),
                timeout,
                self.retry_policy(),
                self.retry_refused.as_deref(),
                || request.send(),
            )
            .await
            .map(|(response, _permit)| response)
    }

    /// Send an idempotency key, allowing POST/PATCH retries when configured.
    /// The server must support deduplication using `Idempotency-Key`.
    pub fn idempotency_key(self, key: impl Into<String>) -> Result<Self> {
        self.idempotency_key_header("Idempotency-Key", key)
    }

    /// Use an API's own header name for its idempotency key.
    pub fn idempotency_key_header(
        mut self,
        name: impl Into<String>,
        key: impl Into<String>,
    ) -> Result<Self> {
        let (name, key) = (name.into(), key.into());
        crate::idempotency::validate_header(&name)?;
        crate::idempotency::validate_key(&key)?;
        self.config.headers.set(&name, key);
        self.idempotency_header = Some(name);
        Ok(self)
    }

    fn retry_policy(&self) -> RetryPolicy<'_> {
        let keyed = self.idempotency_header.as_ref().is_some_and(|name| {
            self.config
                .headers
                .get_first(name)
                .is_some_and(|key| !key.trim().is_empty())
        });
        RetryPolicy {
            config: self
                .retry_config
                .as_ref()
                .or(self.client.config.retry_config.as_ref()),
            replay_safe: self.config.method.is_idempotent()
                || keyed && matches!(self.config.method, Method::Post | Method::Patch),
        }
    }

    /// Replace the client's retry policy for this request.
    pub fn retry_config(mut self, config: RetryConfig) -> Self {
        self.retry_config = Some(config);
        self
    }

    /// Disable retries for this request, regardless of the client's policy.
    pub fn no_retries(self) -> Self {
        self.retry_config(RetryConfig {
            max_retries: 0,
            ..RetryConfig::default()
        })
    }

    /// Set a request header, replacing any default value for that header
    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.config.headers.set(name, value);
        self
    }

    /// Set multiple headers, replacing any default values for those headers
    pub fn headers(mut self, headers: Headers) -> Self {
        for (name, values) in headers.iter() {
            self.config.headers.remove(name);
            for value in values {
                self.config.headers.insert(name.clone(), value.clone());
            }
        }
        self
    }

    /// Append query parameters to the URL
    pub fn query<K: Into<String>, V: Into<String>>(
        mut self,
        params: impl IntoIterator<Item = (K, V)>,
    ) -> Self {
        self.query
            .extend(params.into_iter().map(|(k, v)| (k.into(), v.into())));
        self
    }

    /// Set request body as JSON
    pub fn json<T: serde::Serialize>(mut self, json: &T) -> Result<Self> {
        let value = serde_json::to_value(json)?;
        self.config.body = Some(Body::Json(value));
        Ok(self)
    }

    /// Set request body as text
    pub fn text(mut self, text: impl Into<String>) -> Self {
        self.config.body = Some(Body::Text(text.into()));
        self
    }

    /// Set request body as bytes
    pub fn bytes(mut self, bytes: Vec<u8>) -> Self {
        self.config.body = Some(Body::Binary(bytes));
        self
    }

    /// Set request body as form data
    pub fn form(mut self, data: std::collections::HashMap<String, String>) -> Self {
        self.config.body = Some(Body::Form(data));
        self
    }

    /// Set request body as `multipart/form-data` (replaces any Content-Type header)
    pub fn multipart(mut self, form: &Multipart) -> Self {
        self.config.headers.set("content-type", form.content_type());
        self.config.body = Some(Body::Binary(form.to_bytes()));
        self
    }

    /// Report download progress after each received chunk of a successful response
    pub fn on_download_progress(mut self, callback: impl ProgressCallback + 'static) -> Self {
        self.progress = Some(Arc::new(callback));
        self
    }

    /// Set the timeout for each attempt of this request
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.config.timeout = Some(timeout);
        self
    }

    /// Disable the timeout for this request
    pub fn no_timeout(mut self) -> Self {
        self.config.timeout = None;
        self
    }

    /// What to do when the server redirects, overriding the client's setting
    pub fn redirect(mut self, redirect: Redirect) -> Self {
        self.redirect = redirect;
        (self.config.follow_redirects, self.config.max_redirects) =
            redirect.config(self.max_redirects);
        self
    }

    /// Maximum number of redirects to follow, overriding the client's setting
    pub fn max_redirects(mut self, max_redirects: u32) -> Self {
        self.max_redirects = max_redirects;
        let redirect = self.redirect;
        self.redirect(redirect)
    }

    /// Whether an absolute URL may replace the client's base URL, overriding
    /// the client's setting (see [`ClientBuilder::allow_absolute_urls`])
    pub fn allow_absolute_urls(mut self, allow: bool) -> Self {
        self.allow_absolute_urls = allow;
        self
    }

    /// Limit the (decompressed) response body to this many bytes, overriding
    /// the client's setting; `None` for no limit
    pub fn max_response_bytes(mut self, limit: Option<u64>) -> Self {
        self.max_response_bytes = limit;
        self
    }

    /// Header names dropped on a redirect to another origin, replacing the
    /// client's list (see [`ClientBuilder::sensitive_headers`])
    pub fn sensitive_headers<I, S>(mut self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.sensitive_headers = lowercase(names);
        self
    }

    /// Whether to follow a redirect from `https:` to `http:`, overriding the
    /// client's setting
    pub fn allow_insecure_redirects(mut self, allow: bool) -> Self {
        self.allow_insecure_redirects = allow;
        self
    }

    /// The redirect rules reqwest's policy enforces for this request
    #[cfg(not(target_arch = "wasm32"))]
    fn redirect_guards(&self) -> RedirectGuards {
        RedirectGuards {
            allow_insecure: self.allow_insecure_redirects,
            same_origin_only: self
                .sensitive_headers
                .iter()
                .any(|name| self.config.headers.contains(name)),
        }
    }

    /// In WebAssembly, the transports apply the rules themselves
    #[cfg(target_arch = "wasm32")]
    fn redirect_guards(&self) -> RedirectGuards {
        RedirectGuards::default()
    }

    #[cfg(target_arch = "wasm32")]
    fn transport_options(&self) -> crate::wasm::transport::TransportOptions<'_> {
        crate::wasm::transport::TransportOptions {
            fetch_options: self.fetch_options.as_ref(),
            proxy: self.client.config.proxy.as_deref(),
            limit: self.max_response_bytes,
            block_private_network: !self.allow_private_network,
            sensitive_headers: &self.sensitive_headers,
            allow_insecure_redirects: self.allow_insecure_redirects,
        }
    }

    fn check_absolute_url(&self) -> Result<()> {
        check_absolute_url(
            self.client.config.base_url.as_deref(),
            &self.url,
            self.allow_absolute_urls,
        )
    }

    /// Set response format preference
    pub fn response_format(mut self, format: ResponseFormat) -> Self {
        self.config.response_format = format;
        self
    }

    /// Execute the request and read the whole response
    pub async fn send(self) -> Result<Response> {
        self.check_absolute_url()?;
        let raw = self
            .client
            .execute(
                &self.url,
                &self.query,
                &self.config,
                false,
                self.progress.as_ref(),
                self.max_response_bytes,
                self.redirect_guards(),
                self.retry_policy(),
            )
            .await?;
        let content_type = raw.headers.get_first("content-type").unwrap_or("");
        let body = decode_body(raw.body, content_type, self.config.response_format)?;
        Ok(Response {
            status: raw.status,
            status_text: raw.status_text,
            headers: raw.headers,
            body,
            url: raw.url,
        })
    }

    /// Execute the request and return as soon as a successful response's
    /// headers arrive; read the body with [`StreamingResponse::into_stream`].
    ///
    /// Retries and the timeout apply until the headers arrive. Error
    /// responses are read fully and returned as [`Error::Http`] as usual.
    #[cfg(target_arch = "wasm32")]
    pub async fn send_streaming(self) -> Result<StreamingResponse> {
        self.check_absolute_url()?;
        let url = resolve_url(
            self.client.config.base_url.as_deref(),
            page_url(),
            &self.url,
            &self.query,
        )?;
        let request = crate::wasm::transport::StreamingRequest::new(
            url.as_str(),
            &self.config,
            &self.transport_options(),
        )?;
        let (response, permit) = self
            .client
            .execute_retrying(
                url.as_str(),
                self.config.timeout,
                self.retry_policy(),
                self.retry_refused.as_deref(),
                || request.send(),
            )
            .await?;
        Ok(StreamingResponse {
            status: response.status,
            status_text: reqwest::StatusCode::from_u16(response.status)
                .ok()
                .and_then(|status| status.canonical_reason())
                .unwrap_or("")
                .to_string(),
            headers: response.headers,
            url: response.url,
            inner: response.body,
            progress: self.progress,
            limit: self.max_response_bytes,
            permit,
        })
    }

    /// Execute the request and return as soon as a successful response's
    /// headers arrive; read the body with [`StreamingResponse::into_stream`].
    ///
    /// Retries and the timeout apply until the headers arrive. Error
    /// responses are read fully and returned as [`Error::Http`] as usual.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn send_streaming(self) -> Result<StreamingResponse> {
        self.check_absolute_url()?;
        let raw = self
            .client
            .execute(
                &self.url,
                &self.query,
                &self.config,
                true,
                None,
                self.max_response_bytes,
                self.redirect_guards(),
                self.retry_policy(),
            )
            .await?;
        Ok(StreamingResponse {
            status: raw.status,
            status_text: raw.status_text,
            headers: raw.headers,
            url: raw.url,
            inner: raw
                .stream
                .expect("successful streaming attempts keep their body unread"),
            progress: self.progress,
            limit: self.max_response_bytes,
            permit: raw.permit,
        })
    }
}

/// Building the underlying client only fails if TLS can't be initialized
fn client_init_error(error: reqwest::Error) -> Error {
    Error::network("Failed to create HTTP client", error)
}

/// Calculate retry delay with exponential backoff
pub(crate) fn calculate_retry_delay(attempt: u32, config: &RetryConfig) -> Duration {
    let exponent = i32::try_from(attempt.saturating_sub(1)).unwrap_or(i32::MAX);
    let delay = config.initial_delay.as_secs_f64() * config.multiplier.powi(exponent);
    let delay = delay.min(config.max_delay.as_secs_f64());
    if delay > 0.0 {
        // Float rounding near Duration::MAX can overflow; cap instead of panicking
        Duration::try_from_secs_f64(delay).unwrap_or(config.max_delay)
    } else {
        Duration::ZERO
    }
}

/// Randomize a delay to between 50% and 100% of its value, so many clients
/// retrying at once don't hit a recovering server in lockstep
pub(crate) fn with_jitter(delay: Duration) -> Duration {
    Duration::try_from_secs_f64(delay.as_secs_f64() * (0.5 + runtime::random() * 0.5))
        .unwrap_or(delay)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_arch = "wasm32"))]
    #[tokio::test]
    async fn a_refused_retry_returns_the_attempts_error_and_sets_the_flag() {
        let client = Client::builder()
            .retry_config(RetryConfig::default())
            .retry_budget(RetryBudget::new().ratio(0.0).min_per_second(0.0))
            .build()
            .unwrap();
        let refused = AtomicBool::new(false);
        let failed = || async {
            Ok::<Attempt<()>, Error>(Attempt::HttpError(
                Error::Http {
                    status: 503,
                    status_text: "Service Unavailable".to_string(),
                    body: None,
                },
                None,
            ))
        };
        let error = client
            .execute_retrying(
                "http://test/",
                None,
                client.request(Method::Get, "").retry_policy(),
                Some(&refused),
                failed,
            )
            .await
            .unwrap_err();
        assert!(matches!(error, Error::Http { status: 503, .. }));
        assert!(refused.load(Ordering::Relaxed));
        assert_eq!(client.retries_refused(), 1);
        for (budget, name) in [
            (RetryBudget::new().ratio(-1.0), "retryBudget.ratio"),
            (
                RetryBudget::new().window(Duration::ZERO),
                "retryBudget.windowMs",
            ),
        ] {
            let error = Client::builder()
                .retry_budget(budget)
                .build()
                .err()
                .unwrap();
            assert!(error.to_string().contains(name), "{error}");
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn redirect_guards_refuse_downgrades_and_cross_origin_redirects() {
        let url = |s: &str| reqwest::Url::parse(s).unwrap();
        let (https, http) = (url("https://api.example/a"), url("http://api.example/b"));
        let other = url("https://other.example/c");
        let open = RedirectGuards::default();
        assert_eq!(open.refuse(&https, &http), None);
        assert_eq!(open.refuse(&https, &other), None);
        let strict = RedirectGuards {
            allow_insecure: false,
            same_origin_only: true,
        };
        let downgrade = strict.refuse(&https, &http).unwrap();
        assert_eq!(
            downgrade,
            "Insecure redirect refused (allowInsecureRedirects is false): https: to http://api.example"
        );
        assert_eq!(strict.refuse(&http, &url("http://api.example/c")), None);
        assert!(strict
            .refuse(&https, &other)
            .unwrap()
            .contains("sensitiveHeaders"));
        assert_eq!(strict.refuse(&https, &url("https://api.example/d")), None);
    }

    #[test]
    fn max_line_bytes_is_kept_for_the_javascript_streams() {
        let client = Client::builder()
            .max_line_bytes(8)
            .max_event_bytes(16)
            .build()
            .unwrap();
        assert_eq!(client.config.max_line_bytes, Some(8));
        assert_eq!(client.config.max_event_bytes, Some(16));
        assert_eq!(Client::new().unwrap().config.max_line_bytes, None);
    }

    #[test]
    fn pending_requests_are_counted_until_dropped_and_shared_by_clones() {
        assert!(
            Client::new().unwrap().admit().unwrap().is_none(),
            "no limit, no count"
        );
        assert!(Client::builder().max_pending_requests(0).build().is_err());

        let client = Client::builder().max_pending_requests(2).build().unwrap();
        let clone = client.clone();
        let first = client.admit().unwrap();
        let second = clone.admit().unwrap();
        let refused = client.admit().err().unwrap();
        assert_eq!(refused.too_many_pending_requests(), Some(2));
        assert_eq!(
            client.pending.load(Ordering::Relaxed),
            2,
            "a refusal isn't counted"
        );
        drop(first);
        let third = clone.admit().unwrap();
        drop((second, third));
        assert_eq!(client.pending.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn test_client_builder() {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .base_url("https://api.example.com")
            .default_header("User-Agent", "test-client")
            .build();

        assert!(client.is_ok());
    }

    #[test]
    fn test_retry_delay_calculation() {
        let config = RetryConfig {
            initial_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(10),
            multiplier: 2.0,
            ..Default::default()
        };

        assert_eq!(
            calculate_retry_delay(1, &config),
            Duration::from_millis(100)
        );
        assert_eq!(
            calculate_retry_delay(2, &config),
            Duration::from_millis(200)
        );
        assert_eq!(
            calculate_retry_delay(3, &config),
            Duration::from_millis(400)
        );
        assert_eq!(calculate_retry_delay(30, &config), Duration::from_secs(10));
    }

    #[test]
    fn test_jitter_stays_in_range() {
        for _ in 0..100 {
            let delay = with_jitter(Duration::from_millis(1000));
            assert!(delay >= Duration::from_millis(500) && delay <= Duration::from_millis(1000));
        }
    }

    /// The `parameter` of an `InvalidInput` error
    fn invalid_parameter(error: &Error) -> Option<&str> {
        match error {
            Error::InvalidInput { parameter, .. } => Some(parameter),
            _ => None,
        }
    }

    #[test]
    fn test_invalid_parameter_helper() {
        assert_eq!(invalid_parameter(&Error::Cancelled), None);
    }

    fn http_error(status: u16) -> Error {
        Error::Http {
            status,
            status_text: String::new(),
            body: None,
        }
    }

    fn network_error() -> Error {
        Error::Network {
            message: String::new(),
            source: None,
        }
    }

    fn no_jitter_config() -> RetryConfig {
        RetryConfig {
            initial_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(1),
            ..Default::default()
        }
    }

    #[test]
    fn test_builder_defaults() {
        let client = ClientBuilder::default().build().unwrap();
        assert_eq!(client.config.timeout, Some(Duration::from_secs(30)));
        assert!(client.config.retry_config.is_none());
        assert!(client.config.base_url.is_none());

        let client = Client::builder()
            .no_timeout()
            .with_retries()
            .build()
            .unwrap();
        assert_eq!(client.config.timeout, None);
        assert_eq!(client.config.retry_config.as_ref().unwrap().max_retries, 3);
    }

    #[test]
    fn test_client_init_error() {
        let source = reqwest::Client::new().get("not a url").build().unwrap_err();
        let error = client_init_error(source);
        assert!(error
            .to_string()
            .starts_with("Network error: Failed to create HTTP client (caused by:"));
    }

    #[test]
    fn test_builder_rejects_invalid_base_url() {
        for base in ["example.com", "not a url", "ftp://example.com"] {
            let error = Client::builder().base_url(base).build().err().expect(base);
            assert_eq!(invalid_parameter(&error), Some("baseUrl"));
        }
    }

    #[test]
    fn test_request_builder_configuration() {
        let client = Client::builder()
            .default_header("Accept", "text/plain")
            .default_header("X-Default", "1")
            .build()
            .unwrap();

        let mut extra = Headers::new();
        extra.insert("X-Multi", "a");
        extra.insert("X-Multi", "b");
        let request = client
            .request(Method::Get, "https://example.com")
            .header("accept", "application/json")
            .headers(extra)
            .query([("a", "1")])
            .query(vec![("b".to_string(), "2".to_string())])
            .timeout(Duration::from_secs(5))
            .response_format(ResponseFormat::Text);

        assert_eq!(
            request.config.headers.get("accept").unwrap(),
            &vec!["application/json".to_string()]
        );
        assert_eq!(request.config.headers.get_first("x-default"), Some("1"));
        assert_eq!(request.config.headers.get("x-multi").unwrap().len(), 2);
        assert_eq!(
            request.query,
            vec![("a".into(), "1".into()), ("b".into(), "2".into())]
        );
        assert_eq!(request.config.timeout, Some(Duration::from_secs(5)));
        assert_eq!(request.config.response_format, ResponseFormat::Text);
        assert_eq!(request.no_timeout().config.timeout, None);
    }

    #[test]
    fn test_request_builder_bodies() {
        let client = Client::new().unwrap();
        let body = |builder: RequestBuilder| builder.config.body.unwrap();

        assert!(matches!(body(client.post("https://x.dev").text("t")), Body::Text(t) if t == "t"));
        assert!(
            matches!(body(client.post("https://x.dev").bytes(vec![1])), Body::Binary(b) if b == vec![1])
        );
        assert!(matches!(
            body(client.post("https://x.dev").json(&[1, 2]).unwrap()),
            Body::Json(_)
        ));
        let form = std::collections::HashMap::from([("k".to_string(), "v".to_string())]);
        assert!(matches!(
            body(client.post("https://x.dev").form(form)),
            Body::Form(_)
        ));
        for builder in [
            client.put("https://x.dev"),
            client.patch("https://x.dev"),
            client.delete("https://x.dev"),
        ] {
            assert!(builder.config.body.is_none());
        }
    }

    #[test]
    fn test_resolve_url() {
        let page = crate::url::Url::parse("https://app.example.com/dashboard/index.html").ok();
        let none: &[(String, String)] = &[];

        let resolve = |base, page, url| resolve_url(base, page, url, none).map(|u| u.to_string());
        assert_eq!(
            resolve(None, None, "https://a.com/x").unwrap(),
            "https://a.com/x"
        );
        assert_eq!(
            resolve(Some("https://api.com/v1"), page.clone(), "https://a.com/x").unwrap(),
            "https://a.com/x"
        );
        assert_eq!(
            resolve(Some("https://api.com/v1"), page.clone(), "users").unwrap(),
            "https://api.com/v1/users"
        );
        assert_eq!(
            resolve(None, page.clone(), "api/items").unwrap(),
            "https://app.example.com/dashboard/api/items"
        );
        assert_eq!(
            resolve(None, page.clone(), "/api/items").unwrap(),
            "https://app.example.com/api/items"
        );
        // The same results as the runtime's URL in WebAssembly (wasm tests)
        assert_eq!(
            resolve(None, None, "https://bücher.example/ä?q=ü").unwrap(),
            "https://xn--bcher-kva.example/%C3%A4?q=%C3%BC"
        );
        assert_eq!(
            resolve(Some("https://api.com/v1"), None, "//evil.example/x").unwrap(),
            "https://api.com/v1/evil.example/x"
        );

        let query = [
            ("q".to_string(), "a&b".to_string()),
            ("n".to_string(), "1".to_string()),
        ];
        let url = resolve_url(None, None, "https://a.com/s?x=0", &query).unwrap();
        assert_eq!(url.as_str(), "https://a.com/s?x=0&q=a%26b&n=1");

        for (base, page, url) in [
            (None, None, "/no/base"),
            (Some("https://api.com"), None, "ftp://a.com/x"),
            (Some("not a base"), None, "users"),
            (
                None,
                Some(crate::url::Url::parse("data:text/plain,hi").unwrap()),
                "x",
            ),
        ] {
            let error = resolve_url(base, page, url, none).expect_err(url);
            assert_eq!(invalid_parameter(&error), Some("url"));
        }
    }

    #[test]
    fn test_retry_delay_policy() {
        let retry = Some(&no_jitter_config());
        let get = true;

        // Retryable errors on idempotent methods
        for error in [
            network_error(),
            Error::Timeout { duration_ms: 1 },
            http_error(503),
            http_error(429),
        ] {
            let delay = Client::retry_delay(retry, 0, get, &error, None).unwrap();
            assert!((50..=100).contains(&delay.as_millis()));
        }

        // Not retryable: other statuses, non-transport errors, POST, exhausted retries
        assert!(Client::retry_delay(retry, 0, get, &http_error(501), None).is_none());
        assert!(Client::retry_delay(retry, 0, get, &http_error(404), None).is_none());
        assert!(Client::retry_delay(retry, 0, get, &Error::Cancelled, None).is_none());
        assert!(Client::retry_delay(
            retry,
            0,
            get,
            &Error::InvalidInput {
                parameter: String::new(),
                reason: String::new()
            },
            None
        )
        .is_none());
        assert!(Client::retry_delay(retry, 0, false, &http_error(503), None).is_none());
        assert!(Client::retry_delay(retry, 0, false, &network_error(), None).is_none());
        assert!(Client::retry_delay(retry, 3, get, &http_error(503), None).is_none());

        // Retry-After wins over backoff, capped at max_delay
        assert_eq!(
            Client::retry_delay(
                retry,
                0,
                get,
                &http_error(429),
                Some(Duration::from_millis(700))
            ),
            Some(Duration::from_millis(700))
        );
        assert_eq!(
            Client::retry_delay(
                retry,
                0,
                get,
                &http_error(429),
                Some(Duration::from_secs(60))
            ),
            Some(Duration::from_secs(1))
        );

        // Flags turn individual causes off, and non-idempotent retries on
        let retry = Some(&RetryConfig {
            retry_on_network_error: false,
            retry_on_timeout: false,
            retry_non_idempotent: true,
            ..no_jitter_config()
        });
        assert!(Client::retry_delay(retry, 0, get, &network_error(), None).is_none());
        assert!(
            Client::retry_delay(retry, 0, get, &Error::Timeout { duration_ms: 1 }, None).is_none()
        );
        assert!(Client::retry_delay(retry, 0, false, &http_error(503), None).is_some());

        // No retry configuration at all
        assert!(Client::retry_delay(None, 0, get, &http_error(503), None).is_none());
    }

    #[test]
    fn test_retry_delay_edge_cases() {
        let zero = RetryConfig {
            initial_delay: Duration::ZERO,
            ..Default::default()
        };
        assert_eq!(calculate_retry_delay(1, &zero), Duration::ZERO);
        assert_eq!(
            calculate_retry_delay(0, &RetryConfig::default()),
            Duration::from_millis(100)
        );
        let huge = RetryConfig {
            multiplier: f64::MAX,
            max_delay: Duration::MAX,
            ..Default::default()
        };
        assert_eq!(calculate_retry_delay(5, &huge), Duration::MAX);
        assert!(with_jitter(Duration::MAX) <= Duration::MAX);
        let nan = RetryConfig {
            multiplier: f64::NAN,
            ..Default::default()
        };
        assert_eq!(calculate_retry_delay(3, &nan), Duration::from_secs(10));
    }

    #[test]
    fn test_parse_retry_after() {
        assert_eq!(parse_retry_after("120"), Some(Duration::from_secs(120)));
        assert_eq!(parse_retry_after(" 3 "), Some(Duration::from_secs(3)));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT"), None);
        assert_eq!(parse_retry_after("-1"), None);
    }

    #[test]
    fn test_bytes_to_text() {
        assert_eq!(bytes_to_text(b"plain".to_vec()), "plain");
        assert_eq!(bytes_to_text("\u{FEFF}bom".as_bytes().to_vec()), "bom");
        assert_eq!(bytes_to_text(vec![b'a', 0xff, b'b']), "a\u{FFFD}b");
    }

    #[test]
    fn test_decode_body_formats() {
        let decode = |bytes: &[u8], content_type, format| {
            decode_body(bytes.to_vec(), content_type, format).unwrap()
        };

        assert!(
            matches!(decode(b"", "", ResponseFormat::Text), ResponseBody::Text(t) if t.is_empty())
        );
        assert!(
            matches!(decode(b"", "", ResponseFormat::Binary), ResponseBody::Binary(b) if b.is_empty())
        );
        assert!(matches!(
            decode(b"", "", ResponseFormat::Auto),
            ResponseBody::Empty
        ));
        assert!(matches!(
            decode(b"{}", "image/png", ResponseFormat::Json),
            ResponseBody::Json(_)
        ));
        assert!(
            matches!(decode(b"{}", "application/json", ResponseFormat::Text), ResponseBody::Text(t) if t == "{}")
        );
        assert!(matches!(
            decode(b"{}", "application/json", ResponseFormat::Binary),
            ResponseBody::Binary(_)
        ));
        assert!(
            matches!(decode(b"<p>", "text/html", ResponseFormat::Auto), ResponseBody::Text(t) if t == "<p>")
        );
        assert!(matches!(
            decode(b"<a/>", "application/xml", ResponseFormat::Auto),
            ResponseBody::Text(_)
        ));
        // Invalid JSON that isn't UTF-8 either falls back to bytes
        assert!(
            matches!(decode(&[0xff, 0xfe], "application/json", ResponseFormat::Auto), ResponseBody::Binary(b) if b == vec![0xff, 0xfe])
        );
        assert!(matches!(
            decode_body(b"{".to_vec(), "", ResponseFormat::Json),
            Err(Error::Parse { .. })
        ));
    }

    #[test]
    fn test_join_base_url() {
        assert_eq!(
            join_base_url("https://a.com/v1", "users"),
            "https://a.com/v1/users"
        );
        assert_eq!(
            join_base_url("https://a.com/v1/", "/users"),
            "https://a.com/v1/users"
        );
        assert_eq!(
            join_base_url("https://a.com/v1", "?q=1"),
            "https://a.com/v1?q=1"
        );
        assert_eq!(join_base_url("https://a.com/v1", ""), "https://a.com/v1");
    }

    #[test]
    fn test_decode_body() {
        let json = decode_body(
            b"\xEF\xBB\xBF{\"a\":1}".to_vec(),
            "application/problem+json",
            ResponseFormat::Auto,
        )
        .unwrap();
        assert!(matches!(json, ResponseBody::Json(_)));
        let text = decode_body(
            b"not json".to_vec(),
            "application/json",
            ResponseFormat::Auto,
        )
        .unwrap();
        assert!(matches!(text, ResponseBody::Text(t) if t == "not json"));
        let empty = decode_body(Vec::new(), "application/json", ResponseFormat::Json).unwrap();
        assert!(matches!(empty, ResponseBody::Empty));
        let bin = decode_body(vec![0xff, 0x00], "", ResponseFormat::Auto).unwrap();
        assert!(matches!(bin, ResponseBody::Binary(_)));
        assert!(decode_body(b"oops".to_vec(), "", ResponseFormat::Json).is_err());
    }
}
