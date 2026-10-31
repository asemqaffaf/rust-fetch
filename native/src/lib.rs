//! Native Node.js transport for rust-fetch, loaded through Node-API.
//!
//! The wasm core keeps the policy (retries, validation, errors, decoding);
//! like the node:http transport in `wasm-module/js/node.js`, this only moves
//! bytes, with the same rules: HTTP/1.1, `fetch()` redirects, the same
//! decompression, a timeout covering the whole attempt, cancellation and at
//! most 256 connections per origin (see `pool`). Requests run on Tokio
//! threads, so the JS thread only builds the request and decodes the body.

#![warn(clippy::pedantic)]
// napi-rs functions take their arguments by value and report errors to JS
#![allow(clippy::needless_pass_by_value, clippy::missing_errors_doc)]

mod pending;
mod pool;
mod timeouts;
mod upload;

use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::future::{AbortHandle, Abortable};
use http_body_util::BodyExt;
use hyper::body::Incoming;
use hyper::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_ENCODING, HOST, LOCATION};
use hyper::Method;
use napi::bindgen_prelude::{Buffer, External, Uint8Array};
use napi_derive::napi;
use url::{Position, Url};

use pool::{Connection, Pool};

const MAX_REDIRECTS: u32 = 20;
/// Private wire protocol understood by the JavaScript adapter.
#[napi]
pub const TRANSPORT_VERSION: u32 = 4;

/// How errors for bodies over `max_response_bytes` start; `send` reports them
/// with the code `RUST_FETCH_TOO_LARGE`
const TOO_LARGE: &str = "Response body larger than maxResponseBytes";
/// A compressed body may be this much larger than the decompressed limit
const COMPRESSED_SLACK: u64 = 1024 * 1024;
/// A redirect's body is drained up to this so its connection can be reused;
/// a longer (or endless) one closes the connection instead
const REDIRECT_DRAIN: usize = 64 * 1024;
/// Compressed bodies larger than this are decompressed off the runtime's thread
const BLOCKING_DECOMPRESS: usize = 16 * 1024;

struct Transport {
    pool: Pool,
    zstd: bool,
    pending: pending::Pending,
}

/// Opaque configuration and cancellation scope for one JavaScript module.
/// Its pool and TLS policy are never shared with another worker's scope.
pub struct Scope(Arc<Transport>);

/// One Tokio worker thread. Each request is a short burst of work between
/// waits, so a second worker mostly adds cross-thread wake-ups: measured
/// against the default (one worker per core), one worker is 10-16% faster
/// for small requests, sequential or concurrent, and 9% under overload.
/// Large compressed bodies are decoded on the blocking pool instead (`decode`).
#[napi_derive::module_init]
fn init_runtime() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .thread_name("rust-fetch")
        .enable_all()
        .build()
        .expect("the Tokio runtime starts");
    napi::bindgen_prelude::create_custom_tokio_runtime(runtime);
}

#[napi(object)]
pub struct Options {
    /// Decode zstd (only where Node's zlib can, so both transports agree)
    pub zstd: bool,
    /// `false` when `NODE_TLS_REJECT_UNAUTHORIZED=0`
    pub reject_unauthorized: bool,
    /// The PEM bundle from `NODE_EXTRA_CA_CERTS`
    pub extra_ca_certs: Option<Buffer>,
}

/// Configure the transport; called once when `node.js` loads the addon
#[napi]
pub fn configure(env: &napi::Env, options: Options) -> napi::Result<External<Scope>> {
    let tls = pool::tls_config(
        options.reject_unauthorized,
        options.extra_ca_certs.as_deref(),
    )
    .map_err(napi::Error::from_reason)?;
    let transport = Arc::new(Transport {
        pool: Pool::new(tls),
        zstd: options.zstd,
        pending: pending::Pending::default(),
    });
    env.add_env_cleanup_hook(Arc::downgrade(&transport), |scope| {
        if let Some(transport) = scope.upgrade() {
            transport.pending.close();
        }
    })?;
    Ok(External::new(Scope(transport)))
}

#[napi(object, object_to_js = false)]
pub struct Request {
    /// Identifies the request for `cancel`
    pub id: u32,
    pub method: String,
    pub url: String,
    /// Header names and values, alternating; repeated names are sent once each
    pub headers: Vec<String>,
    pub body: Option<Uint8Array>,
    /// Optional pull callbacks, used only by streaming uploads.
    pub upload_next: Option<upload::Next>,
    pub upload_cancel: Option<upload::Control>,
    pub upload_restart: Option<upload::Control>,
    /// Timeout for the whole attempt, in ms
    pub timeout: Option<f64>,
    /// Time to acquire/establish a connection, including TLS, in ms.
    pub connect_timeout: Option<f64>,
    /// Remaining first-connection allowance after the JavaScript queue wait.
    pub connect_timeout_remaining: Option<f64>,
    /// Time until final response headers, in ms.
    pub response_timeout: Option<f64>,
    /// Maximum gap between incoming body chunks, in ms.
    pub idle_timeout: Option<f64>,
    /// Return redirects instead of following them (`redirect: 'manual'`)
    pub manual: Option<bool>,
    /// Redirects to follow before failing (default 20); `0` fails on any redirect
    pub max_redirects: Option<u32>,
    /// Fail when the decompressed body is larger than this (`maxResponseBytes`)
    pub max_response_bytes: Option<f64>,
    /// Header names (lowercase) also dropped on cross-origin redirects
    pub sensitive_headers: Option<Vec<String>>,
    /// `false` refuses redirects from `https:` to `http:`
    pub allow_insecure_redirects: Option<bool>,
}

/// The finished response, or `error` (with `code` for timeouts)
#[napi(object)]
pub struct Response {
    pub status: u32,
    pub url: String,
    /// Header names and values, alternating
    pub headers: Vec<String>,
    pub body: Option<Buffer>,
    pub error: Option<String>,
    pub code: Option<String>,
    /// Timeout phase, when code is `RUST_FETCH_TIMEOUT`.
    pub phase: Option<String>,
    /// Configured phase duration (the JS adapter restores pre-queue values).
    pub timeout_ms: Option<f64>,
}

/// Send one attempt. Failures resolve with `error` set rather than rejecting.
#[napi]
pub fn send<'env>(
    env: &'env napi::Env,
    request: Request,
    scope: &External<Scope>,
) -> napi::Result<napi::bindgen_prelude::PromiseRaw<'env, Response>> {
    let transport = Arc::clone(&scope.0);
    let id = request.id;
    let (handle, registration) = AbortHandle::new_pair();
    // Register synchronously before JS can cancel, and reject an occupied ID.
    let generation = match transport.pending.register(id, handle) {
        Ok(generation) => generation,
        Err(error) => {
            return env
                .spawn_future(async { Ok(Response::failed(error, Some("RUST_FETCH_REQUEST_ID"))) })
        }
    };
    let active = Arc::clone(&transport);
    let promise = env.spawn_future(async move {
        Ok(send_attempt(&active, request, registration, generation).await)
    });
    if promise.is_err() {
        transport.pending.finish(id, generation);
    }
    promise
}

async fn send_attempt(
    transport: &Transport,
    request: Request,
    registration: futures_util::future::AbortRegistration,
    generation: u64,
) -> Response {
    let id = request.id;
    let timeout = timeouts::duration(request.timeout);
    let attempt = Abortable::new(transport.send(request), registration);
    let outcome = match timeout {
        Some(duration) => tokio::time::timeout(duration, attempt)
            .await
            .map_err(|_| duration),
        None => Ok(attempt.await),
    };
    transport.pending.finish(id, generation);

    match outcome {
        Ok(Ok(Ok(response))) => response,
        Ok(Ok(Err(message))) => {
            if let Some((phase, ms)) = timeouts::details(&message) {
                return Response::timed_out(phase, ms);
            }
            let code = message
                .starts_with(TOO_LARGE)
                .then_some("RUST_FETCH_TOO_LARGE")
                .or_else(|| {
                    message
                        .contains(upload::INVALID)
                        .then_some("RUST_FETCH_UPLOAD_INPUT")
                });
            Response::failed(message, code)
        }
        Ok(Err(_aborted)) => {
            Response::failed("The request was cancelled".into(), Some("ABORT_ERR"))
        }
        Err(duration) => Response::timed_out("total", duration.as_secs_f64() * 1000.0),
    }
}

/// Abandon an attempt (the core does this on abort); its `send` resolves with an error
#[napi]
pub fn cancel(id: u32, scope: &External<Scope>) {
    scope.0.pending.cancel(id);
}

impl Response {
    fn received(response: &hyper::Response<Incoming>, url: Url) -> Self {
        let mut headers = Vec::with_capacity(response.headers().len() * 2);
        for (name, value) in response.headers() {
            headers.push(name.as_str().to_owned());
            headers.push(String::from_utf8_lossy(value.as_bytes()).into_owned());
        }
        Self {
            status: u32::from(response.status().as_u16()),
            url: url.into(),
            headers,
            body: None,
            error: None,
            code: None,
            phase: None,
            timeout_ms: None,
        }
    }
    fn timed_out(phase: &str, ms: f64) -> Self {
        let label = if phase == "total" {
            String::new()
        } else {
            format!("{phase} ")
        };
        let mut response = Self::failed(
            format!("Request {label}timeout after {ms}ms"),
            Some("RUST_FETCH_TIMEOUT"),
        );
        response.phase = Some(phase.to_string());
        response.timeout_ms = Some(ms);
        response
    }

    fn failed(error: String, code: Option<&str>) -> Self {
        Self {
            status: 0,
            url: String::new(),
            headers: Vec::new(),
            body: None,
            error: Some(error),
            code: code.map(str::to_owned),
            phase: None,
            timeout_ms: None,
        }
    }
}

impl Request {
    fn take_upload(&mut self) -> Option<upload::Upload> {
        self.upload_next
            .take()
            .zip(self.upload_cancel.take())
            .map(|(next, cancel)| upload::Upload::new(next, cancel, self.upload_restart.take()))
    }
}

impl Transport {
    async fn send(&self, mut request: Request) -> Result<Response, String> {
        let connect_timeout = timeouts::duration(request.connect_timeout);
        let mut first_connect_timeout = timeouts::duration(request.connect_timeout_remaining);
        let response_timeout = timeouts::duration(request.response_timeout);
        let idle_timeout = timeouts::duration(request.idle_timeout);
        let response_deadline =
            response_timeout.and_then(|duration| tokio::time::Instant::now().checked_add(duration));
        let mut url = Url::parse(&request.url).map_err(|e| e.to_string())?;
        let mut method =
            Method::from_bytes(request.method.as_bytes()).map_err(|e| e.to_string())?;
        let mut headers = header_map(&request.headers)?;
        let mut upload = request.take_upload();
        let mut body = request.body.map(|body| Bytes::copy_from_slice(&body));
        let mut redirects = 0;
        let manual = request.manual.unwrap_or(false);
        let max_redirects = request.max_redirects.unwrap_or(MAX_REDIRECTS);
        let allow_insecure = request.allow_insecure_redirects.unwrap_or(true);
        let sensitive = request.sensitive_headers.unwrap_or_default();
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let limit = request.max_response_bytes.map(|limit| limit as u64);

        loop {
            let (connection, response) = timeouts::until(
                response_deadline,
                response_timeout,
                self.exchange(
                    &url,
                    http_request(
                        &method,
                        &url,
                        &headers,
                        upload::Outgoing::new(body.as_ref(), upload.as_mut()),
                    )?,
                    first_connect_timeout.take().or(connect_timeout),
                ),
            )
            .await?;
            let status = response.status().as_u16();

            if let (true, Some(location)) = (
                !manual && matches!(status, 301 | 302 | 303 | 307 | 308),
                response.headers().get(LOCATION),
            ) {
                let location = String::from_utf8_lossy(location.as_bytes()).into_owned();
                let drained = http_body_util::Limited::new(response.into_body(), REDIRECT_DRAIN);
                if upload.is_none()
                    && timeouts::until(response_deadline, response_timeout, async {
                        drained.collect().await.map_err(|error| error.to_string())
                    })
                    .await
                    .is_ok()
                {
                    connection.release();
                }
                let next = redirect_url(
                    &url,
                    &location,
                    redirects,
                    max_redirects,
                    allow_insecure,
                    status,
                )?;
                rewrite_redirect(status, &mut method, &mut body, &mut headers);
                if method == Method::GET || method == Method::HEAD {
                    upload = None;
                } else if let Some(upload) = &mut upload {
                    upload.replay().await?;
                }
                if next.origin() != url.origin() {
                    drop_credentials(&mut headers, &sensitive);
                }
                url = next;
                redirects += 1;
                continue;
            }

            let mut finished = Response::received(&response, url);
            let encoding = response
                .headers()
                .get(CONTENT_ENCODING)
                .map(|e| String::from_utf8_lossy(e.as_bytes()).to_ascii_lowercase());
            let raw =
                read_body(response, encoding.as_deref(), limit, &method, idle_timeout).await?;
            if (200..300).contains(&status) {
                if let Some(upload) = &upload {
                    upload.finished().await?;
                }
                connection.release();
            } else if upload.is_none() {
                connection.release();
            }
            let body = match encoding {
                Some(encoding) if method != Method::HEAD => {
                    decode(raw, encoding, self.zstd, limit).await?
                }
                _ => Vec::from(raw),
            };
            finished.body = Some(body.into());
            return Ok(finished);
        }
    }

    /// Send a request on a pooled connection. A reused connection may have
    /// been closed by the server just before the request was written; then
    /// the request is sent again on a new connection.
    async fn exchange(
        &self,
        url: &Url,
        request: hyper::Request<upload::Outgoing>,
        connect_timeout: Option<Duration>,
    ) -> Result<(Connection, hyper::Response<Incoming>), String> {
        let mut connection =
            timeouts::wait(connect_timeout, "connect", self.pool.checkout(url)).await?;
        let mut error = match connection.sender.try_send_request(request).await {
            Ok(response) => return Ok((connection, response)),
            Err(error) => error,
        };
        let Some(request) = error.take_message() else {
            return Err(error_message(&error.into_error()));
        };
        let mut connection = timeouts::wait(
            connect_timeout,
            "connect",
            self.pool.reconnect(url, connection),
        )
        .await?;
        let response = connection
            .sender
            .send_request(request)
            .await
            .map_err(|e| error_message(&e))?;
        Ok((connection, response))
    }
}

/// Read a whole body. With a limit (on the decompressed size), a declared
/// `Content-Length` over it fails before reading, and reading stops past it;
/// a compressed body gets some slack, since its decompression is bounded too.
async fn read_body(
    response: hyper::Response<Incoming>,
    encoding: Option<&str>,
    limit: Option<u64>,
    method: &Method,
    idle: Option<Duration>,
) -> Result<Bytes, String> {
    let incomplete = |e: &dyn std::error::Error| {
        format!(
            "The connection closed before the response body was complete: {}",
            error_message(e)
        )
    };
    if let Some(idle) = idle {
        let limit = limit.filter(|_| method != Method::HEAD);
        let encoded = encoding.is_some_and(|e| e.trim() != "identity");
        let raw_limit = limit.map(|limit| {
            if encoded {
                limit.saturating_add(COMPRESSED_SLACK)
            } else {
                limit
            }
        });
        let declared = response
            .headers()
            .get(hyper::header::CONTENT_LENGTH)
            .and_then(|length| length.to_str().ok()?.trim().parse::<u64>().ok());
        if let (Some(declared), Some(raw_limit), Some(limit)) = (declared, raw_limit, limit) {
            if declared > raw_limit {
                return Err(too_large(limit));
            }
        }
        let mut incoming = response.into_body();
        let mut bytes = Vec::new();
        loop {
            let frame = timeouts::wait(Some(idle), "idle", async {
                incoming
                    .frame()
                    .await
                    .transpose()
                    .map_err(|error| incomplete(&error))
            })
            .await?;
            let Some(frame) = frame else {
                break;
            };
            if let Ok(chunk) = frame.into_data() {
                if raw_limit.is_some_and(|raw_limit| {
                    (bytes.len() as u64).saturating_add(chunk.len() as u64) > raw_limit
                }) {
                    return Err(too_large(limit.unwrap()));
                }
                bytes.extend_from_slice(&chunk);
            }
        }
        return Ok(bytes.into());
    }
    let Some(limit) = limit.filter(|_| method != Method::HEAD) else {
        let body = response.into_body().collect().await;
        return Ok(body.map_err(|e| incomplete(&e))?.to_bytes());
    };
    let encoded = encoding.is_some_and(|e| e.trim() != "identity");
    let raw_limit = if encoded {
        limit.saturating_add(COMPRESSED_SLACK)
    } else {
        limit
    };
    let declared = response
        .headers()
        .get(hyper::header::CONTENT_LENGTH)
        .and_then(|length| length.to_str().ok()?.trim().parse::<u64>().ok());
    if declared.is_some_and(|declared| declared > raw_limit) {
        return Err(too_large(limit));
    }
    let limited = http_body_util::Limited::new(
        response.into_body(),
        usize::try_from(raw_limit).unwrap_or(usize::MAX),
    );
    match limited.collect().await {
        Ok(body) => Ok(body.to_bytes()),
        Err(e) if e.is::<http_body_util::LengthLimitError>() => Err(too_large(limit)),
        Err(e) => Err(incomplete(&*e)),
    }
}

fn too_large(limit: u64) -> String {
    format!("{TOO_LARGE} ({limit} bytes)")
}

/// Decompress a body; large ones on the blocking pool, so the runtime's
/// thread keeps serving other connections
async fn decode(
    raw: Bytes,
    encoding: String,
    zstd: bool,
    limit: Option<u64>,
) -> Result<Vec<u8>, String> {
    if raw.len() <= BLOCKING_DECOMPRESS {
        return decompress(raw, &encoding, zstd, limit);
    }
    tokio::task::spawn_blocking(move || decompress(raw, &encoding, zstd, limit))
        .await
        .map_err(|e| e.to_string())?
}

/// Undo the Content-Encodings in reverse order, like `decompress` in `node.js`;
/// unknown encodings are passed through, like `fetch()`
fn decompress(
    raw: Bytes,
    content_encoding: &str,
    zstd: bool,
    limit: Option<u64>,
) -> Result<Vec<u8>, String> {
    let mut body = Vec::from(raw);
    if body.is_empty() {
        return Ok(body);
    }
    let encodings = content_encoding
        .split(',')
        .map(str::trim)
        .filter(|e| !e.is_empty() && *e != "identity");
    for encoding in encodings.collect::<Vec<_>>().into_iter().rev() {
        body = match encoding {
            "gzip" | "x-gzip" => read_all(flate2::read::MultiGzDecoder::new(&body[..]), limit)?,
            // Servers send both zlib-wrapped and raw deflate under this name
            "deflate" if body[0] == 0x78 => {
                read_all(flate2::read::ZlibDecoder::new(&body[..]), limit)?
            }
            "deflate" => read_all(flate2::read::DeflateDecoder::new(&body[..]), limit)?,
            "br" => read_all(brotli::Decompressor::new(&body[..], 4096), limit)?,
            "zstd" if zstd => read_all(
                zstd::stream::read::Decoder::new(&body[..]).map_err(|e| e.to_string())?,
                limit,
            )?,
            _ => body,
        };
    }
    Ok(body)
}

/// An HTTP/1.1 request in origin form, with a Host header unless one was given
fn http_request(
    method: &Method,
    url: &Url,
    headers: &HeaderMap,
    body: upload::Outgoing,
) -> Result<hyper::Request<upload::Outgoing>, String> {
    let mut request = hyper::Request::new(body);
    *request.method_mut() = method.clone();
    *request.uri_mut() = url[Position::BeforePath..Position::AfterQuery]
        .parse()
        .map_err(|e| format!("{e}"))?;
    *request.headers_mut() = headers.clone();
    if !headers.contains_key(HOST) {
        let host = HeaderValue::from_str(&url[Position::BeforeHost..Position::AfterPort])
            .map_err(|e| e.to_string())?;
        request.headers_mut().insert(HOST, host);
    }
    Ok(request)
}

/// Decompress everything, or stop one byte past `limit` (so a decompression
/// bomb never expands in memory)
fn read_all(reader: impl Read, limit: Option<u64>) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    reader
        .take(limit.map_or(u64::MAX, |limit| limit.saturating_add(1)))
        .read_to_end(&mut out)
        .map_err(|e| format!("Decompression failed: {e}"))?;
    match limit {
        Some(limit) if out.len() as u64 > limit => Err(too_large(limit)),
        _ => Ok(out),
    }
}

/// Never forward credentials to another origin: the standard headers and the
/// request's `sensitiveHeaders`
fn drop_credentials(headers: &mut HeaderMap, sensitive: &[String]) {
    for name in ["authorization", "cookie", "proxy-authorization"] {
        headers.remove(name);
    }
    for name in sensitive {
        headers.remove(name.as_str());
    }
}

fn rewrite_redirect(
    status: u16,
    method: &mut Method,
    body: &mut Option<Bytes>,
    headers: &mut HeaderMap,
) {
    // Same rules as fetch(): 303, and 301/302 after POST, become a bodiless GET
    if (status == 303 && *method != Method::GET && *method != Method::HEAD)
        || (matches!(status, 301 | 302) && *method == Method::POST)
    {
        *method = Method::GET;
        *body = None;
        for name in [
            "content-type",
            "content-length",
            "content-encoding",
            "content-language",
            "content-location",
        ] {
            headers.remove(name);
        }
    }
}

fn redirect_url(
    current: &Url,
    location: &str,
    redirects: u32,
    max_redirects: u32,
    allow_insecure: bool,
    status: u16,
) -> Result<Url, String> {
    if redirects >= max_redirects {
        return Err(if max_redirects == 0 {
            format!("Redirect not allowed: {status} to {location}")
        } else {
            format!("Too many redirects (more than {max_redirects})")
        });
    }
    let next = current
        .join(location)
        .map_err(|_| format!("Invalid redirect location: {location}"))?;
    if !matches!(next.scheme(), "http" | "https") {
        return Err(format!("Unsupported redirect to {}:", next.scheme()));
    }
    if !allow_insecure && current.scheme() == "https" && next.scheme() == "http" {
        return Err(format!(
            "Insecure redirect refused (allowInsecureRedirects is false): https: to {}",
            next.origin().ascii_serialization()
        ));
    }
    Ok(next)
}

fn header_map(pairs: &[String]) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::with_capacity(pairs.len() / 2);
    for [name, value] in pairs.as_chunks::<2>().0 {
        let value = HeaderValue::from_str(value)
            .map_err(|e| format!("Invalid value for header '{name}': {e}"))?;
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| format!("Invalid header name '{name}': {e}"))?;
        headers.append(name, value);
    }
    Ok(headers)
}

/// An error's message plus its causes, e.g. "connection error: Connection reset by peer"
fn error_message(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    message
}
