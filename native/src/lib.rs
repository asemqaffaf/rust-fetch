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

mod pool;

use std::collections::HashMap;
use std::io::Read;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use bytes::Bytes;
use futures_util::future::{AbortHandle, Abortable};
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_ENCODING, HOST, LOCATION};
use hyper::Method;
use napi::bindgen_prelude::{Buffer, Uint8Array};
use napi_derive::napi;
use url::{Position, Url};

use pool::{lock, Connection, Pool};

const MAX_REDIRECTS: u32 = 20;
/// Compressed bodies larger than this are decompressed off the runtime's thread
const BLOCKING_DECOMPRESS: usize = 16 * 1024;

struct Transport {
    pool: Pool,
    zstd: bool,
    pending: Mutex<HashMap<u32, AbortHandle>>,
}

static TRANSPORT: OnceLock<Transport> = OnceLock::new();

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
pub fn configure(options: Options) -> napi::Result<()> {
    let tls = pool::tls_config(
        options.reject_unauthorized,
        options.extra_ca_certs.as_deref(),
    )
    .map_err(napi::Error::from_reason)?;
    // A second call (another copy of the module) keeps the first configuration
    let _ = TRANSPORT.set(Transport {
        pool: Pool::new(tls),
        zstd: options.zstd,
        pending: Mutex::default(),
    });
    Ok(())
}

#[napi(object)]
pub struct Request {
    /// Identifies the request for `cancel`
    pub id: u32,
    pub method: String,
    pub url: String,
    /// Header names and values, alternating; repeated names are sent once each
    pub headers: Vec<String>,
    pub body: Option<Uint8Array>,
    /// Timeout for the whole attempt, in ms
    pub timeout: Option<f64>,
    /// Return redirects instead of following them (`redirect: 'manual'`)
    pub manual: Option<bool>,
    /// Redirects to follow before failing (default 20); `0` fails on any redirect
    pub max_redirects: Option<u32>,
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
}

/// Send one attempt. Failures resolve with `error` set rather than rejecting.
#[napi]
pub async fn send(request: Request) -> Response {
    let Some(transport) = TRANSPORT.get() else {
        return Response::failed("rust-fetch native transport is not configured".into(), None);
    };
    let id = request.id;
    let timeout = request.timeout.filter(|ms| *ms > 0.0);
    let (handle, registration) = AbortHandle::new_pair();
    lock(&transport.pending).insert(id, handle);

    let attempt = Abortable::new(transport.send(request), registration);
    let outcome = match timeout {
        Some(ms) => tokio::time::timeout(Duration::from_secs_f64(ms / 1000.0), attempt)
            .await
            .map_err(|_| ms),
        None => Ok(attempt.await),
    };
    lock(&transport.pending).remove(&id);

    match outcome {
        Ok(Ok(Ok(response))) => response,
        Ok(Ok(Err(message))) => Response::failed(message, None),
        Ok(Err(_aborted)) => {
            Response::failed("The request was cancelled".into(), Some("ABORT_ERR"))
        }
        Err(ms) => Response::failed(
            format!("Request timeout after {ms}ms"),
            Some("RUST_FETCH_TIMEOUT"),
        ),
    }
}

/// Abandon an attempt (the core does this on abort); its `send` resolves with an error
#[napi]
pub fn cancel(id: u32) {
    if let Some(transport) = TRANSPORT.get() {
        if let Some(handle) = lock(&transport.pending).remove(&id) {
            handle.abort();
        }
    }
}

impl Response {
    fn failed(error: String, code: Option<&str>) -> Self {
        Self {
            status: 0,
            url: String::new(),
            headers: Vec::new(),
            body: None,
            error: Some(error),
            code: code.map(str::to_owned),
        }
    }
}

impl Transport {
    async fn send(&self, request: Request) -> Result<Response, String> {
        let mut url = Url::parse(&request.url).map_err(|e| e.to_string())?;
        let mut method =
            Method::from_bytes(request.method.as_bytes()).map_err(|e| e.to_string())?;
        let mut headers = header_map(&request.headers)?;
        let mut body = request.body.map(|body| Bytes::copy_from_slice(&body));
        let mut redirects = 0;
        let manual = request.manual.unwrap_or(false);
        let max_redirects = request.max_redirects.unwrap_or(MAX_REDIRECTS);

        loop {
            let (connection, response) = self
                .exchange(&url, http_request(&method, &url, &headers, body.as_ref())?)
                .await?;
            let status = response.status().as_u16();

            let location = response
                .headers()
                .get(LOCATION)
                .map(|l| String::from_utf8_lossy(l.as_bytes()).into_owned());
            if let (true, Some(location)) = (
                !manual && matches!(status, 301 | 302 | 303 | 307 | 308),
                location,
            ) {
                // Read the (small) body so the connection can be reused
                if response.into_body().collect().await.is_ok() {
                    connection.release();
                }
                if redirects >= max_redirects {
                    return Err(if max_redirects == 0 {
                        format!("Redirect not allowed: {status} to {location}")
                    } else {
                        format!("Too many redirects (more than {max_redirects})")
                    });
                }
                let next = url
                    .join(&location)
                    .map_err(|_| format!("Invalid redirect location: {location}"))?;
                if !matches!(next.scheme(), "http" | "https") {
                    return Err(format!("Unsupported redirect to {}:", next.scheme()));
                }
                // Same rules as fetch(): 303, and 301/302 after POST, become a bodiless GET
                if (status == 303 && method != Method::GET && method != Method::HEAD)
                    || (matches!(status, 301 | 302) && method == Method::POST)
                {
                    method = Method::GET;
                    body = None;
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
                // Never forward credentials to another origin
                if next.origin() != url.origin() {
                    for name in ["authorization", "cookie", "proxy-authorization"] {
                        headers.remove(name);
                    }
                }
                url = next;
                redirects += 1;
                continue;
            }

            let mut response_headers = Vec::with_capacity(response.headers().len() * 2);
            for (name, value) in response.headers() {
                response_headers.push(name.as_str().to_owned());
                response_headers.push(String::from_utf8_lossy(value.as_bytes()).into_owned());
            }
            let encoding = response
                .headers()
                .get(CONTENT_ENCODING)
                .map(|e| String::from_utf8_lossy(e.as_bytes()).to_ascii_lowercase());
            let raw = response
                .into_body()
                .collect()
                .await
                .map_err(|e| {
                    format!(
                        "The connection closed before the response body was complete: {}",
                        error_message(&e)
                    )
                })?
                .to_bytes();
            connection.release();
            let body = match encoding {
                Some(encoding) if method != Method::HEAD => {
                    decode(raw, encoding, self.zstd).await?
                }
                _ => Vec::from(raw),
            };
            return Ok(Response {
                status: u32::from(status),
                url: url.into(),
                headers: response_headers,
                body: Some(body.into()),
                error: None,
                code: None,
            });
        }
    }

    /// Send a request on a pooled connection. A reused connection may have
    /// been closed by the server just before the request was written; then
    /// the request is sent again on a new connection.
    async fn exchange(
        &self,
        url: &Url,
        request: hyper::Request<Full<Bytes>>,
    ) -> Result<(Connection, hyper::Response<Incoming>), String> {
        let mut connection = self.pool.checkout(url).await?;
        let mut error = match connection.sender.try_send_request(request).await {
            Ok(response) => return Ok((connection, response)),
            Err(error) => error,
        };
        let Some(request) = error.take_message() else {
            return Err(error_message(&error.into_error()));
        };
        let mut connection = self.pool.reconnect(url, connection).await?;
        let response = connection
            .sender
            .send_request(request)
            .await
            .map_err(|e| error_message(&e))?;
        Ok((connection, response))
    }
}

/// Decompress a body; large ones on the blocking pool, so the runtime's
/// thread keeps serving other connections
async fn decode(raw: Bytes, encoding: String, zstd: bool) -> Result<Vec<u8>, String> {
    if raw.len() <= BLOCKING_DECOMPRESS {
        return decompress(raw, &encoding, zstd);
    }
    tokio::task::spawn_blocking(move || decompress(raw, &encoding, zstd))
        .await
        .map_err(|e| e.to_string())?
}

/// Undo the Content-Encodings in reverse order, like `decompress` in `node.js`;
/// unknown encodings are passed through, like `fetch()`
fn decompress(raw: Bytes, content_encoding: &str, zstd: bool) -> Result<Vec<u8>, String> {
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
            "gzip" | "x-gzip" => read_all(flate2::read::MultiGzDecoder::new(&body[..]))?,
            // Servers send both zlib-wrapped and raw deflate under this name
            "deflate" if body[0] == 0x78 => read_all(flate2::read::ZlibDecoder::new(&body[..]))?,
            "deflate" => read_all(flate2::read::DeflateDecoder::new(&body[..]))?,
            "br" => read_all(brotli::Decompressor::new(&body[..], 4096))?,
            "zstd" if zstd => zstd::stream::decode_all(&body[..]).map_err(|e| e.to_string())?,
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
    body: Option<&Bytes>,
) -> Result<hyper::Request<Full<Bytes>>, String> {
    let mut request = hyper::Request::new(Full::new(body.cloned().unwrap_or_default()));
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

fn read_all(mut reader: impl Read) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    reader
        .read_to_end(&mut out)
        .map_err(|e| format!("Decompression failed: {e}"))?;
    Ok(out)
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
