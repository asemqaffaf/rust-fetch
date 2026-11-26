//! JavaScript transport bridge for both buffered and streamed requests.
//!
//! Rust resolves URLs, validates headers/options, and runs the shared retry,
//! timeout, circuit-breaker, rate-limiter, concurrency-limiter, and retry-budget
//! policies. The actual wire I/O is delegated to a single JS transport function:
//! - Custom `options.transport` (e.g. `createMockTransport()`) when provided
//! - Node.js: bound by `js/node.js` (`node:http`/`node:https` or the native addon)
//! - Browsers / edge runtimes: bound by `js/browser-transport.js` (`fetch()` / `XMLHttpRequest`)

use super::{concat2, invalid, js_error_message, put, put_bool, put_f64, put_str, BodyType};
use crate::{
    client::{parse_retry_after, Attempt},
    error::{Error, Result},
    types::{
        is_redirect_status, Headers, Redirect, WasmBody, WasmRequestConfig, DEFAULT_MAX_REDIRECTS,
    },
};
use std::cell::OnceCell;
use std::pin::Pin;
use std::task::{Context, Poll};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    // js_sys::JSON::parse takes &str, which would copy a JS string into wasm
    // and then back out. Keep the decoded text in JS instead.
    #[wasm_bindgen(catch, js_namespace = JSON, js_name = parse)]
    pub(crate) fn parse_native_json(text: &JsValue) -> std::result::Result<JsValue, JsValue>;
}

struct NodeBindings {
    transport: js_sys::Function,
    websocket_guard: js_sys::Function,
}

struct BrowserRuntime {
    transport: js_sys::Function,
    finalize_stream: js_sys::Function,
    encode_body: js_sys::Function,
}

thread_local! {
    /// Owned by this Wasm instance, never discovered through another copy's globals.
    static NODE_BINDINGS: OnceCell<NodeBindings> = const { OnceCell::new() };
    static BROWSER_RUNTIME: OnceCell<BrowserRuntime> = const { OnceCell::new() };
}

/// Private adapter handshake, called synchronously by the Node entry point.
#[wasm_bindgen(js_name = __bindNodeTransport, skip_typescript)]
pub fn bind_node_transport(
    transport: js_sys::Function,
    websocket_guard: js_sys::Function,
) -> std::result::Result<(), JsValue> {
    NODE_BINDINGS
        .with(|bindings| {
            bindings.set(NodeBindings {
                transport,
                websocket_guard,
            })
        })
        .map_err(|_| JsValue::from_str("The Node.js transport is already bound"))
}

/// Private adapter handshake, called synchronously during browser glue init.
#[wasm_bindgen(js_name = __bindBrowserTransport, skip_typescript)]
pub fn bind_browser_transport(
    transport: js_sys::Function,
    finalize_stream: js_sys::Function,
    encode_body: js_sys::Function,
) {
    BROWSER_RUNTIME.with(|slot| {
        let _ = slot.set(BrowserRuntime {
            transport,
            finalize_stream,
            encode_body,
        });
    });
}

fn node_transport() -> Option<js_sys::Function> {
    NODE_BINDINGS.with(|bindings| bindings.get().map(|node| node.transport.clone()))
}

fn browser_transport() -> Option<js_sys::Function> {
    BROWSER_RUNTIME.with(|slot| slot.get().map(|rt| rt.transport.clone()))
}

pub(crate) fn finalize_stream_fn() -> Option<js_sys::Function> {
    BROWSER_RUNTIME.with(|slot| slot.get().map(|rt| rt.finalize_stream.clone()))
}

pub(crate) fn encode_body_fn() -> Option<js_sys::Function> {
    BROWSER_RUNTIME.with(|slot| slot.get().map(|rt| rt.encode_body.clone()))
}

/// Wrap a raw streamed transport response in the JS stream finalizer
/// (`maxResponseBytes`, `idleTimeoutMs`, `deadlineMs`, `signal`,
/// `onDownloadProgress`, `ndjson`, and deterministic `Permit` release).
#[inline(never)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn finalize_stream_response(
    response: JsValue,
    ndjson: bool,
    max_line_bytes: Option<usize>,
    max_response_bytes: Option<u64>,
    idle: Option<std::time::Duration>,
    deadline: Option<crate::timeouts::Deadline>,
    signal: Option<web_sys::AbortSignal>,
    on_download_progress: Option<js_sys::Function>,
    permit: Option<crate::limiter::Ticket>,
) -> Result<JsValue> {
    let finalize = finalize_stream_fn().ok_or_else(|| Error::JsInterop {
        message: "Stream runtime is not bound".to_string(),
    })?;
    let cfg: js_sys::Object = js_sys::Object::create(JsValue::NULL.unchecked_ref());
    if ndjson {
        put_bool(&cfg, "ndjson", true);
    }
    #[allow(clippy::cast_precision_loss)]
    if let Some(n) = max_line_bytes {
        put_f64(&cfg, "maxLineBytes", n as f64);
    }
    #[allow(clippy::cast_precision_loss)]
    if let Some(n) = max_response_bytes {
        put_f64(&cfg, "maxResponseBytes", n as f64);
    }
    if let Some(d) = idle {
        put_f64(&cfg, "idleMs", d.as_secs_f64() * 1000.0);
    }
    if let Some(dl) = deadline {
        put_f64(&cfg, "deadlineMs", dl.remaining().as_secs_f64() * 1000.0);
        #[allow(clippy::cast_precision_loss)]
        put_f64(&cfg, "totalDeadlineMs", dl.duration.as_millis() as f64);
    }
    if let Some(sig) = signal {
        put(&cfg, "signal", sig.as_ref());
    }
    if let Some(cb) = on_download_progress {
        put(&cfg, "onDownloadProgress", cb.as_ref());
    }
    if let Some(permit) = permit {
        let on_done = Closure::once_into_js(move || drop(permit));
        put(&cfg, "onDone", &on_done);
    }
    Ok(finalize.call2(&JsValue::UNDEFINED, &response, &cfg)?)
}

pub(crate) fn node_websocket_guard() -> Option<js_sys::Function> {
    NODE_BINDINGS.with(|bindings| bindings.get().map(|node| node.websocket_guard.clone()))
}

/// `onUploadProgress` and `onDownloadProgress` for a request sent here
#[derive(Default)]
pub(crate) struct ProgressCallbacks {
    pub(crate) upload: Option<js_sys::Function>,
    pub(crate) download: Option<js_sys::Function>,
}

/// Per-request settings for the transports, beyond the `RequestConfig`
#[derive(Clone, Copy)]
pub(crate) struct TransportOptions<'a> {
    /// Browser `fetch()` options, validated
    pub(crate) fetch_options: Option<&'a js_sys::Object>,
    /// Node.js: `'env'` or a proxy URL
    pub(crate) proxy: Option<&'a str>,
    /// `maxResponseBytes`
    pub(crate) limit: Option<u64>,
    /// Node.js: `allowPrivateNetwork: false` blocks private and reserved addresses
    pub(crate) block_private_network: bool,
    /// Node.js: header names (lowercase) dropped on cross-origin redirects
    pub(crate) sensitive_headers: &'a [String],
    /// Node.js: `allowInsecureRedirects`
    pub(crate) allow_insecure_redirects: bool,
    pub(crate) phases: &'a crate::PhaseTimeouts,
    pub(crate) upload: Option<&'a super::upload::Upload>,
    pub(crate) observer: Option<&'a js_sys::Function>,
    /// The client's `transport` option, used instead of the runtime's own
    pub(crate) transport: Option<&'a js_sys::Function>,
    pub(crate) request_state: Option<&'a std::sync::Arc<super::RequestState>>,
}

pub(crate) struct PreparedRequest {
    transport: js_sys::Function,
    request_state: Option<std::sync::Arc<super::RequestState>>,
    /// `{ method, url, headers, body?, timeout?, bodyType?, stream?, redirect?,
    /// maxRedirects?, proxy?, fetchOptions?, ... }`, reused for every attempt
    request: js_sys::Object,
    timeout_ms: u64,
    /// Whether the transport enforces the per-attempt timeout itself
    enforces_timeout: bool,
    /// Whether redirect responses resolve (`redirect: 'manual'`)
    manual: bool,
    /// Whether `status: 0` (browser opaque / opaqueredirect) resolves as success
    allow_opaque: bool,
}

/// The head of a streamed response, and its unread body
pub(crate) struct StreamedResponse {
    pub(crate) status: u16,
    pub(crate) url: String,
    pub(crate) headers: Headers,
    pub(crate) body: FetchBody,
}

/// Encode `WasmRequestConfig::body` for JS transports without pulling
/// `Body::to_bytes` (`serde_json::Value`, `BTreeMap`, `hashbrown`) into Wasm.
fn prepare_body(
    config: &WasmRequestConfig,
) -> Result<(Option<&'static str>, Option<js_sys::Uint8Array>)> {
    let Some(body) = &config.body else {
        return Ok((None, None));
    };
    let (content_type, view) = match body {
        WasmBody::Text(s) => (
            "text/plain",
            (!s.is_empty()).then(|| js_sys::Uint8Array::from(s.as_bytes())),
        ),
        WasmBody::Binary(b) => (
            "application/octet-stream",
            (!b.is_empty()).then(|| js_sys::Uint8Array::from(b.as_slice())),
        ),
        WasmBody::JsBytes(arr) => (
            "application/octet-stream",
            (arr.byte_length() > 0).then(|| arr.clone()),
        ),
    };
    // A Content-Type the caller chose wins over the body's default
    let default_content_type = (!config.headers.contains("content-type")).then_some(content_type);
    Ok((default_content_type, view))
}

impl PreparedRequest {
    pub(crate) fn new(
        url: &str,
        config: &WasmRequestConfig,
        options: &TransportOptions,
        body_type: BodyType,
        progress: ProgressCallbacks,
    ) -> Result<Self> {
        Self::build(url, config, options, Some((body_type, progress)))
    }

    pub(crate) fn new_streaming(
        url: &str,
        config: &WasmRequestConfig,
        options: &TransportOptions,
    ) -> Result<Self> {
        Self::build(url, config, options, None)
    }

    #[inline(never)]
    fn build(
        url: &str,
        config: &WasmRequestConfig,
        options: &TransportOptions,
        buffered: Option<(BodyType, ProgressCallbacks)>,
    ) -> Result<Self> {
        let headers = validated_headers(config)?;
        let (default_content_type, body) = prepare_body(config)?;
        let method = config.method.as_str();
        let redirect = redirect_mode(config);

        let (transport, is_browser) =
            if let Some(transport) = options.transport.cloned().or_else(node_transport) {
                (transport, false)
            } else if let Some(transport) = browser_transport() {
                (transport, true)
            } else {
                return Err(Error::JsInterop {
                    message: "No transport is bound".to_string(),
                });
            };

        let request = transport_request(
            url,
            method,
            &headers,
            default_content_type,
            body.as_ref(),
            config,
            options,
            is_browser,
        );

        let (timeout_ms, enforces_timeout) = if let Some((body_type, progress)) = buffered {
            let timeout_ms = config
                .timeout
                .map_or(0, |t| u64::try_from(t.as_millis()).unwrap_or(u64::MAX));
            if !is_browser && timeout_ms > 0 {
                #[allow(clippy::cast_precision_loss)]
                put_f64(&request, "timeout", timeout_ms as f64);
            }
            put_f64(&request, "bodyType", f64::from(body_type as u8));
            if let Some(callback) = &progress.upload {
                put(&request, "onUploadProgress", callback);
            }
            if let Some(callback) = &progress.download {
                put(&request, "onDownloadProgress", callback);
            }
            (timeout_ms, !is_browser)
        } else {
            put_bool(&request, "stream", true);
            (0, false)
        };

        Ok(Self {
            transport,
            request_state: options.request_state.cloned(),
            request,
            timeout_ms,
            enforces_timeout,
            manual: redirect == Redirect::Manual,
            allow_opaque: is_browser,
        })
    }

    /// Whether the transport enforces the per-attempt timeout itself
    pub(crate) fn enforces_timeout(&self) -> bool {
        self.enforces_timeout
    }

    pub(crate) async fn send(&self) -> Result<Attempt<JsValue>> {
        let pending = self
            .transport
            .call1(&JsValue::UNDEFINED, &self.request)
            .map_err(network_error)?;
        let cancel: js_sys::Function =
            js_sys::Reflect::get(&pending, &"cancel".into())?.unchecked_into();
        let guard = CancelGuard::new(move || {
            let _ = cancel.call0(&JsValue::UNDEFINED);
        });
        let response = JsFuture::from(js_sys::Promise::from(pending))
            .await
            .map_err(|error| {
                destination(self.request_state.as_deref(), &error);
                if let Some(state) = self.request_state.as_deref() {
                    state.remember_cause(&error);
                }
                transport_error(&error, self.timeout_ms)
            })?;
        guard.disarm();

        let status = super::get_f64(&response, "status").unwrap_or(0.0);
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let status = status as u16;
        let ok = (200..300).contains(&status)
            || (self.allow_opaque && status == 0)
            || (self.manual && is_redirect_status(status));
        if !ok {
            destination(self.request_state.as_deref(), &response);
            let body = super::get_str(&response, "body");
            let js_headers = super::get_prop(&response, "headers");
            let retry_after =
                own_prop(&js_headers, "retry-after").and_then(|value| value.as_string());
            return Ok(http_error(status, body, retry_after.as_deref()));
        }
        // Same status text table across every transport
        put_str(&response, "statusText", status_text(status));
        Ok(Attempt::Success(response))
    }
}

/// Unpack a streamed transport response `{ status, url, headers, body, cancelBody? }`.
#[inline(never)]
pub(crate) fn into_streamed_response(response: JsValue) -> Result<StreamedResponse> {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let status = super::get_f64(&response, "status").unwrap_or(0.0) as u16;
    let js_headers = super::get_prop(&response, "headers");
    let body = super::get_prop(&response, "body");
    let cancel = super::get_prop(&response, "cancelBody").dyn_into().ok();
    let mut headers = Headers::new();
    let entries = if js_sys::Array::is_array(&js_headers) {
        js_sys::Array::from(&js_headers)
    } else {
        js_sys::Object::entries(js_headers.unchecked_ref())
    };
    for entry in entries.iter() {
        let entry: js_sys::Array = entry.unchecked_into();
        headers.insert(
            entry.get(0).as_string().unwrap_or_default(),
            entry.get(1).as_string().unwrap_or_default(),
        );
    }
    let length = headers
        .get_first("content-length")
        .and_then(|length| length.trim_ascii().parse::<u64>().ok());
    Ok(StreamedResponse {
        status,
        url: super::get_str(&response, "url").unwrap_or_default(),
        headers,
        body: FetchBody {
            body: body.dyn_into().ok(),
            cancel,
            length,
        },
    })
}

/// The transport's request object, without per-attempt settings
#[allow(clippy::too_many_arguments)]
fn transport_request(
    url: &str,
    method: &str,
    headers: &[(&str, &str)],
    default_content_type: Option<&str>,
    body: Option<&js_sys::Uint8Array>,
    config: &WasmRequestConfig,
    options: &TransportOptions,
    is_browser: bool,
) -> js_sys::Object {
    let js_headers: js_sys::Object = js_sys::Object::create(JsValue::NULL.unchecked_ref());
    for &(name, value) in headers {
        // Repeated headers are sent as an array, one line each
        let existing = super::get_prop(&js_headers, name);
        let value = if existing.is_undefined() {
            JsValue::from_str(value)
        } else if js_sys::Array::is_array(&existing) {
            js_sys::Array::from(&existing).push(&value.into());
            existing
        } else {
            let pair = js_sys::Array::new();
            pair.push(&existing);
            pair.push(&value.into());
            pair.into()
        };
        put(&js_headers, name, &value);
    }
    if let Some(content_type) = default_content_type {
        put_str(&js_headers, "content-type", content_type);
    }
    // No prototype: Object.prototype must not supply fields the transport reads
    let request = js_sys::Object::create(JsValue::NULL.unchecked_ref());
    put_str(&request, "method", method);
    put_str(&request, "url", url);
    put(&request, "headers", &js_headers);
    if let Some(body) = body {
        put(&request, "body", body);
    }
    for (name, duration) in [
        ("connectTimeout", options.phases.connect),
        ("responseTimeout", options.phases.response),
        ("idleTimeout", options.phases.idle),
    ] {
        if let Some(duration) = duration {
            put_f64(&request, name, duration.as_secs_f64() * 1000.0);
        }
    }
    if !config.follow_redirects {
        put_str(&request, "redirect", "manual");
    }
    if config.max_redirects != DEFAULT_MAX_REDIRECTS {
        put_f64(&request, "maxRedirects", f64::from(config.max_redirects));
    }
    if is_browser {
        if let Some(fetch_options) = options.fetch_options {
            put(&request, "fetchOptions", fetch_options);
        }
    } else {
        if let Some(proxy) = options.proxy {
            put_str(&request, "proxy", proxy);
        }
        if options.block_private_network {
            put_bool(&request, "blockPrivateNetwork", true);
        }
        if !options.sensitive_headers.is_empty() {
            let names = js_sys::Array::new();
            for s in options.sensitive_headers {
                names.push(&JsValue::from_str(s));
            }
            put(&request, "sensitiveHeaders", &names);
        }
        if !options.allow_insecure_redirects {
            put_bool(&request, "allowInsecureRedirects", false);
        }
    }
    if let Some(limit) = options.limit {
        #[allow(clippy::cast_precision_loss)]
        put_f64(&request, "maxResponseBytes", limit as f64);
    }
    if let Some(upload) = options.upload {
        put(&request, "upload", upload.value());
    }
    if let Some(observer) = options.observer {
        put(&request, "__observe", observer);
    }
    request
}

/// A streamed response body; cancelled if dropped unread
pub(crate) struct FetchBody {
    body: Option<web_sys::ReadableStream>,
    cancel: Option<js_sys::Function>,
    length: Option<u64>,
}

impl FetchBody {
    /// The expected body size from `Content-Length`, if known
    pub(crate) fn content_length(&self) -> Option<u64> {
        self.length
    }

    /// The body, chunk by chunk; dropping the stream cancels the body
    pub(crate) fn chunks(mut self) -> impl futures_util::Stream<Item = Result<Vec<u8>>> {
        let reader = match self.body.take() {
            Some(body) => super::stream::read_stream(body),
            None => super::stream::empty_reader(),
        };
        BytesChunkStream {
            reader,
            abort: BodyAbort(self.cancel.take()),
        }
    }
}

struct BodyAbort(Option<js_sys::Function>);
impl Drop for BodyAbort {
    fn drop(&mut self) {
        if let Some(cancel) = self.0.take() {
            let _ = cancel.call0(&JsValue::UNDEFINED);
        }
    }
}

struct BytesChunkStream {
    reader: super::stream::ReadableStreamReader,
    abort: BodyAbort,
}

impl futures_util::Stream for BytesChunkStream {
    type Item = Result<Vec<u8>>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = &mut *self;
        match Pin::new(&mut this.reader).poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(None) => {
                this.abort.0.take();
                Poll::Ready(None)
            }
            Poll::Ready(Some(Ok(chunk))) => {
                Poll::Ready(Some(Ok(js_sys::Uint8Array::new(&chunk).to_vec())))
            }
            Poll::Ready(Some(Err(error))) => Poll::Ready(Some(Err(body_error(&error)))),
        }
    }
}

/// A transport stream that failed while its body was read
pub(crate) fn body_error(error: &JsValue) -> Error {
    Error::Network {
        message: concat2("Failed to read response body: ", &js_error_message(error)),
        source: None,
    }
}

impl Drop for FetchBody {
    fn drop(&mut self) {
        if let Some(cancel) = self.cancel.take() {
            let _ = cancel.call0(&JsValue::UNDEFINED);
        } else if let Some(body) = self.body.take() {
            let _ = body.cancel();
        }
    }
}

/// `redirect: 'manual' | 'error'` as the transports apply it
fn redirect_mode(config: &WasmRequestConfig) -> Redirect {
    match (config.follow_redirects, config.max_redirects) {
        (false, _) => Redirect::Manual,
        (true, 0) => Redirect::Error,
        (true, _) => Redirect::Follow,
    }
}

/// Header pairs, validated the same way as the reqwest-backed path
fn validated_headers(config: &WasmRequestConfig) -> Result<Vec<(&str, &str)>> {
    let mut pairs = Vec::new();
    for (name, values) in config.headers.iter() {
        crate::types::validate_header_name(name).map_err(|e| invalid("request", e))?;
        for value in values {
            crate::types::validate_header_value(value).map_err(|e| invalid("request", e))?;
            pairs.push((name.as_str(), value.as_str()));
        }
    }
    Ok(pairs)
}

/// Whether this Wasm instance has been bound to its Node.js entry's transport.
pub(crate) fn is_node() -> bool {
    NODE_BINDINGS.with(|bindings| bindings.get().is_some())
}

/// A property the object itself has: the prototype chain is never consulted,
/// so a polluted `Object.prototype` can't supply error details or headers
fn own_prop(target: &JsValue, name: &str) -> Option<JsValue> {
    if !target.is_object()
        || !js_sys::Object::has_own(target.unchecked_ref::<js_sys::Object>(), &name.into())
    {
        return None;
    }
    js_sys::Reflect::get(target, &name.into()).ok()
}

/// Map a transport rejection to an error kind
fn transport_error(error: &JsValue, timeout_ms: u64) -> Error {
    let code = own_prop(error, "code").and_then(|code| code.as_string());
    match code.as_deref() {
        Some("RUST_FETCH_TIMEOUT") => {
            let phase = own_prop(error, "phase")
                .and_then(|value| value.as_string())
                .map_or(crate::TimeoutPhase::Total, |phase| {
                    crate::TimeoutPhase::parse(&phase)
                });
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let duration = own_prop(error, "timeoutMs")
                .and_then(|value| value.as_f64())
                .filter(|value| value.is_finite() && *value >= 0.0)
                .map_or(timeout_ms, |value| value as u64);
            Error::phase_timeout(phase, std::time::Duration::from_millis(duration))
        }
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        Some("RUST_FETCH_TOO_LARGE") => Error::too_large(
            own_prop(error, "maxResponseBytes")
                .and_then(|limit| limit.as_f64())
                .unwrap_or(0.0) as u64,
        ),
        Some("RUST_FETCH_UPLOAD_INPUT") => super::invalid("body", &js_error_message(error)),
        Some("RUST_FETCH_INVALID_REQUEST") => super::invalid("request", &js_error_message(error)),
        Some("RUST_FETCH_PARSE") => Error::Parse {
            message: concat2("Failed to parse JSON response: ", &js_error_message(error)),
            source: None,
        },
        _ => network_error(error.clone()),
    }
}

/// A non-2xx response, as an HTTP error that may be retried
fn http_error<T>(status: u16, body: Option<String>, retry_after: Option<&str>) -> Attempt<T> {
    Attempt::HttpError(
        Error::Http {
            status,
            status_text: status_text(status).to_string(),
            body,
        },
        retry_after.and_then(parse_retry_after),
    )
}

fn status_text(status: u16) -> &'static str {
    crate::types::status_text(status)
}

/// Cancels an in-flight attempt if it's dropped before completing (timeout or
/// cancellation). Completed attempts are disarmed: aborting them would be a
/// no-op that still costs, e.g. constructing an `AbortError` per request.
struct CancelGuard<F: FnOnce()>(Option<F>);

impl<F: FnOnce()> CancelGuard<F> {
    fn new(cancel: F) -> Self {
        Self(Some(cancel))
    }

    fn disarm(mut self) {
        self.0 = None;
    }
}

impl<F: FnOnce()> Drop for CancelGuard<F> {
    fn drop(&mut self) {
        if let Some(cancel) = self.0.take() {
            cancel();
        }
    }
}

fn network_error(error: JsValue) -> Error {
    Error::Network {
        message: js_error_message(&error),
        source: None,
    }
}

fn destination(state: Option<&super::RequestState>, value: &JsValue) {
    if let Some(state) = state {
        if !value.is_object()
            || !js_sys::Object::has_own(value.unchecked_ref::<js_sys::Object>(), &"url".into())
        {
            return;
        }
        if let Ok(url) = js_sys::Reflect::get(value, &"url".into()) {
            if let Some(url) = url.as_string().filter(|url| !url.is_empty()) {
                *state.url.borrow_mut() = Some(url);
            }
        }
    }
}
