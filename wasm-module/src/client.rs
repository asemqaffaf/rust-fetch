//! HTTP client implementation with builder pattern
//!
//! This module provides a flexible HTTP client with support for
//! retries, timeouts, and various configuration options.

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
use std::sync::Arc;
use std::time::Duration;

pub use crate::wasm::WasmClient;

/// HTTP client for making requests
#[derive(Clone)]
pub struct Client {
    inner: reqwest::Client,
    pub(crate) config: Arc<ClientConfig>,
    /// Clients for requests that override the redirect settings: reqwest
    /// sets the redirect policy per client (and connection pool)
    #[cfg(not(target_arch = "wasm32"))]
    redirect_clients: Arc<std::sync::Mutex<Vec<((bool, u32), reqwest::Client)>>>,
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
    /// Browser `fetch()` options (`credentials`, `mode`, …), already validated
    #[cfg(target_arch = "wasm32")]
    pub(crate) fetch_options: Option<js_sys::Object>,
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

/// A response from one attempt: either fully read, or (for successful
/// streaming requests) with the body left unread in `stream`
struct RawResponse {
    status: u16,
    status_text: String,
    url: String,
    headers: Headers,
    body: Vec<u8>,
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
        let mut loaded = 0u64;
        body_chunks(self.inner).map(move |chunk| {
            let chunk = chunk?;
            loaded += chunk.len() as u64;
            if let Some(progress) = &progress {
                progress(Progress { loaded, total });
            }
            Ok(chunk)
        })
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
            redirect,
            max_redirects,
            #[cfg(target_arch = "wasm32")]
            fetch_options: self.config.fetch_options.clone(),
        }
    }

    /// The reqwest client for a request's redirect settings
    #[cfg(not(target_arch = "wasm32"))]
    fn http_client(&self, config: &RequestConfig) -> Result<reqwest::Client> {
        let key = (config.follow_redirects, config.max_redirects);
        if key == self.config.redirect.config(self.config.max_redirects) {
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
    fn http_client(&self, _config: &RequestConfig) -> Result<reqwest::Client> {
        Ok(self.inner.clone())
    }

    /// Execute a request, retrying according to the client's retry configuration.
    ///
    /// With `stream`, a successful response's body is left unread.
    async fn execute(
        &self,
        url: &str,
        query: &[(String, String)],
        config: &RequestConfig,
        stream: bool,
        progress: Option<&ProgressFn>,
    ) -> Result<RawResponse> {
        let url = resolve_url(self.config.base_url.as_deref(), page_url(), url, query)?;
        self.execute_retrying(config.method, config.timeout, || async {
            let raw = self.execute_once(&url, config, stream, progress).await?;
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
    }

    /// Shared retry/timeout policy for Rust responses and JS-native bodies.
    async fn execute_retrying<T, F, Fut>(
        &self,
        method: Method,
        timeout: Option<Duration>,
        mut send: F,
    ) -> Result<T>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<Attempt<T>>>,
    {
        let mut attempt = 0;

        loop {
            let once = send();
            let outcome = match timeout {
                Some(timeout) => runtime::timeout(timeout, once).await,
                None => once.await,
            };

            let (error, retry_after) = match outcome {
                Ok(Attempt::Success(response)) => return Ok(response),
                Ok(Attempt::HttpError(error, retry_after)) => (error, retry_after),
                Err(error) => (error, None),
            };

            match self.retry_delay(attempt, method, &error, retry_after) {
                Some(delay) => {
                    attempt += 1;
                    runtime::sleep(delay).await;
                }
                None => return Err(error),
            }
        }
    }

    /// Decide whether a failed attempt should be retried, and after how long
    fn retry_delay(
        &self,
        attempt: u32,
        method: Method,
        error: &Error,
        retry_after: Option<Duration>,
    ) -> Option<Duration> {
        let retry = self.config.retry_config.as_ref()?;
        if attempt >= retry.max_retries {
            return None;
        }
        // The server may have acted on a non-idempotent request before failing.
        if !method.is_idempotent() && !retry.retry_non_idempotent {
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
    ) -> Result<RawResponse> {
        let mut request = self
            .http_client(config)?
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
            (read_body(response, progress).await?, None)
        };

        Ok(RawResponse {
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
fn http_client((follow, max_redirects): (bool, u32)) -> Result<reqwest::Client> {
    let builder = reqwest::Client::builder();
    #[cfg(not(target_arch = "wasm32"))]
    let builder = builder.redirect(redirect_policy(follow, max_redirects));
    #[cfg(target_arch = "wasm32")]
    let _ = (follow, max_redirects);
    builder.build().map_err(client_init_error)
}

#[cfg(not(target_arch = "wasm32"))]
fn redirect_policy(follow: bool, max_redirects: u32) -> reqwest::redirect::Policy {
    if !follow {
        return reqwest::redirect::Policy::none();
    }
    reqwest::redirect::Policy::custom(move |attempt| {
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

/// Resolve a request URL and append query parameters.
///
/// Absolute URLs are used as-is; relative ones are appended to `base`, or
/// else resolved against `page` (the browser page URL, when there is one).
pub(crate) fn resolve_url(
    base: Option<&str>,
    page: Option<reqwest::Url>,
    url: &str,
    query: &[(String, String)],
) -> Result<reqwest::Url> {
    let invalid = |reason: String| Error::InvalidInput {
        parameter: "url".to_string(),
        reason,
    };

    let mut resolved = match (reqwest::Url::parse(url), base, page) {
        (Ok(absolute), _, _) => absolute,
        (Err(_), Some(base), _) => {
            let joined = join_base_url(base, url);
            reqwest::Url::parse(&joined).map_err(|e| invalid(format!("'{joined}': {e}")))?
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
async fn read_body(response: reqwest::Response, progress: Option<&ProgressFn>) -> Result<Vec<u8>> {
    const MAX_PREALLOCATION: u64 = 64 * 1024 * 1024;
    let total = response.content_length();
    let capacity = usize::try_from(total.unwrap_or(0).min(MAX_PREALLOCATION)).unwrap_or(0);
    let mut body = Vec::with_capacity(capacity);

    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|e| Error::network("Failed to read response body", e))?;
        body.extend_from_slice(&chunk);
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
pub(crate) fn page_url() -> Option<reqwest::Url> {
    #[cfg(target_arch = "wasm32")]
    {
        let location = js_sys::Reflect::get(&js_sys::global(), &"location".into()).ok()?;
        if location.is_undefined() || location.is_null() {
            return None;
        }
        let href = js_sys::Reflect::get(&location, &"href".into())
            .ok()?
            .as_string()?;
        reqwest::Url::parse(&href).ok()
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

/// Builder for creating HTTP clients
pub struct ClientBuilder {
    headers: Headers,
    timeout: Option<Duration>,
    retry_config: Option<RetryConfig>,
    base_url: Option<String>,
    redirect: Redirect,
    max_redirects: u32,
    #[cfg(target_arch = "wasm32")]
    fetch_options: Option<js_sys::Object>,
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
            #[cfg(target_arch = "wasm32")]
            fetch_options: None,
        }
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

    /// Build the client
    pub fn build(self) -> Result<Client> {
        if let Some(base) = &self.base_url {
            let parsed = reqwest::Url::parse(base).map_err(|e| Error::InvalidInput {
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

        let inner = http_client(self.redirect.config(self.max_redirects))?;

        Ok(Client {
            inner,
            config: Arc::new(ClientConfig {
                default_headers: self.headers,
                timeout: self.timeout,
                retry_config: self.retry_config,
                base_url: self.base_url,
                redirect: self.redirect,
                max_redirects: self.max_redirects,
                #[cfg(target_arch = "wasm32")]
                fetch_options: self.fetch_options,
            }),
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
    redirect: Redirect,
    max_redirects: u32,
    /// Browser `fetch()` options: the client's, with this request's overrides
    #[cfg(target_arch = "wasm32")]
    pub(crate) fetch_options: Option<js_sys::Object>,
}

impl RequestBuilder {
    /// Keep JS response bodies outside wasm memory, retaining the shared policy.
    #[cfg(target_arch = "wasm32")]
    pub(crate) async fn send_js(
        self,
        body_type: crate::wasm::BodyType,
        progress: crate::wasm::transport::ProgressCallbacks,
    ) -> Result<wasm_bindgen::JsValue> {
        let url = resolve_url(
            self.client.config.base_url.as_deref(),
            page_url(),
            &self.url,
            &self.query,
        )?;
        let request = crate::wasm::transport::PreparedRequest::new(
            url.as_str(),
            &self.config,
            self.fetch_options.as_ref(),
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
            .execute_retrying(self.config.method, timeout, || request.send())
            .await
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

    /// Set response format preference
    pub fn response_format(mut self, format: ResponseFormat) -> Self {
        self.config.response_format = format;
        self
    }

    /// Execute the request and read the whole response
    pub async fn send(self) -> Result<Response> {
        let raw = self
            .client
            .execute(
                &self.url,
                &self.query,
                &self.config,
                false,
                self.progress.as_ref(),
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
        let url = resolve_url(
            self.client.config.base_url.as_deref(),
            page_url(),
            &self.url,
            &self.query,
        )?;
        let request = crate::wasm::transport::StreamingRequest::new(
            url.as_str(),
            &self.config,
            self.fetch_options.as_ref(),
        )?;
        let response = self
            .client
            .execute_retrying(self.config.method, self.config.timeout, || request.send())
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
        })
    }

    /// Execute the request and return as soon as a successful response's
    /// headers arrive; read the body with [`StreamingResponse::into_stream`].
    ///
    /// Retries and the timeout apply until the headers arrive. Error
    /// responses are read fully and returned as [`Error::Http`] as usual.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn send_streaming(self) -> Result<StreamingResponse> {
        let raw = self
            .client
            .execute(&self.url, &self.query, &self.config, true, None)
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

    fn client_with_retries(config: RetryConfig) -> Client {
        Client::builder().retry_config(config).build().unwrap()
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
        let page = reqwest::Url::parse("https://app.example.com/dashboard/index.html").ok();
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
                Some(reqwest::Url::parse("data:text/plain,hi").unwrap()),
                "x",
            ),
        ] {
            let error = resolve_url(base, page, url, none).expect_err(url);
            assert_eq!(invalid_parameter(&error), Some("url"));
        }
    }

    #[test]
    fn test_retry_delay_policy() {
        let client = client_with_retries(no_jitter_config());
        let get = Method::Get;

        // Retryable errors on idempotent methods
        for error in [
            network_error(),
            Error::Timeout { duration_ms: 1 },
            http_error(503),
            http_error(429),
        ] {
            let delay = client.retry_delay(0, get, &error, None).unwrap();
            assert!((50..=100).contains(&delay.as_millis()));
        }

        // Not retryable: other statuses, non-transport errors, POST, exhausted retries
        assert!(client.retry_delay(0, get, &http_error(501), None).is_none());
        assert!(client.retry_delay(0, get, &http_error(404), None).is_none());
        assert!(client
            .retry_delay(0, get, &Error::Cancelled, None)
            .is_none());
        assert!(client
            .retry_delay(
                0,
                get,
                &Error::InvalidInput {
                    parameter: String::new(),
                    reason: String::new()
                },
                None
            )
            .is_none());
        assert!(client
            .retry_delay(0, Method::Post, &http_error(503), None)
            .is_none());
        assert!(client
            .retry_delay(0, Method::Patch, &network_error(), None)
            .is_none());
        assert!(client.retry_delay(3, get, &http_error(503), None).is_none());

        // Retry-After wins over backoff, capped at max_delay
        assert_eq!(
            client.retry_delay(0, get, &http_error(429), Some(Duration::from_millis(700))),
            Some(Duration::from_millis(700))
        );
        assert_eq!(
            client.retry_delay(0, get, &http_error(429), Some(Duration::from_secs(60))),
            Some(Duration::from_secs(1))
        );

        // Flags turn individual causes off, and non-idempotent retries on
        let client = client_with_retries(RetryConfig {
            retry_on_network_error: false,
            retry_on_timeout: false,
            retry_non_idempotent: true,
            ..no_jitter_config()
        });
        assert!(client.retry_delay(0, get, &network_error(), None).is_none());
        assert!(client
            .retry_delay(0, get, &Error::Timeout { duration_ms: 1 }, None)
            .is_none());
        assert!(client
            .retry_delay(0, Method::Post, &http_error(503), None)
            .is_some());

        // No retry configuration at all
        assert!(Client::new()
            .unwrap()
            .retry_delay(0, get, &http_error(503), None)
            .is_none());
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
