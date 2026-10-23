//! Buffered JavaScript responses stay in JS memory. Rust still resolves URLs,
//! validates requests, and applies the same retry and timeout policy as the
//! native client. Streaming/progress use the existing incremental reader.
//!
//! Two transports carry the bytes:
//! - Node.js: the transport registered by the package's Node entry
//!   (`node:http`/`node:https` with keep-alive), which avoids the overhead of
//!   Node's WHATWG `fetch()` implementation. To keep JS/wasm round trips per
//!   request to a minimum, it also enforces the per-attempt timeout and
//!   decodes the body (with the same rules as `decode_body` below), handing
//!   back the finished response object.
//! - Everywhere else: the runtime's `fetch()`, or `XMLHttpRequest` for
//!   requests with an `onUploadProgress` callback, since `fetch()` can't
//!   report upload progress.

use super::{invalid, js_error_message, set, BodyType};
use crate::{
    client::{parse_retry_after, Attempt},
    error::{Error, Result},
    types::{
        is_json_content_type, is_redirect_status, is_text_content_type, Headers, Redirect,
        RequestConfig, DEFAULT_MAX_REDIRECTS,
    },
};
use futures_util::StreamExt;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch, js_name = fetch)]
    fn fetch_native(request: &web_sys::Request) -> std::result::Result<js_sys::Promise, JsValue>;

    // js_sys::JSON::parse takes &str, which would copy a JS string into wasm
    // and then back out. Keep the decoded text in JS instead.
    #[wasm_bindgen(catch, js_namespace = JSON, js_name = parse)]
    pub(crate) fn parse_native_json(text: &JsValue) -> std::result::Result<JsValue, JsValue>;

    #[wasm_bindgen(js_name = TextDecoder)]
    type NativeTextDecoder;

    #[wasm_bindgen(constructor, js_class = TextDecoder)]
    fn new() -> NativeTextDecoder;

    #[wasm_bindgen(method, catch, js_name = decode)]
    fn decode(this: &NativeTextDecoder, bytes: &JsValue) -> std::result::Result<JsValue, JsValue>;
}

thread_local! {
    static TEXT_DECODER: NativeTextDecoder = NativeTextDecoder::new();
    /// The Node.js transport, registered by the Node entry point before any
    /// request is made. See `nodeTransport` in `js/node.js` for its contract.
    static NODE_TRANSPORT: Option<js_sys::Function> = js_sys::Reflect::get(
        &js_sys::global(),
        &js_sys::Symbol::for_("rust-fetch.transport"),
    )
    .ok()
    .and_then(|transport| transport.dyn_into().ok());
}

/// `onUploadProgress` and `onDownloadProgress` for a request sent here
/// (requests with only `onDownloadProgress` take the reqwest path instead)
#[derive(Default)]
pub(crate) struct ProgressCallbacks {
    pub(crate) upload: Option<js_sys::Function>,
    pub(crate) download: Option<js_sys::Function>,
}

pub(crate) enum PreparedRequest {
    Fetch {
        url: String,
        init: web_sys::RequestInit,
        body_type: BodyType,
        /// Without `XMLHttpRequest` (e.g. in a service worker), progress is
        /// reported once each way: when the response arrives and when its
        /// body has been read
        progress: ProgressCallbacks,
        body_length: u32,
        /// `manual` and `error` are applied by requesting `redirect: 'manual'`
        redirect: Redirect,
    },
    Xhr {
        method: String,
        url: String,
        headers: Vec<(String, String)>,
        body: Option<js_sys::Uint8Array>,
        body_type: BodyType,
        progress: ProgressCallbacks,
    },
    Node {
        transport: js_sys::Function,
        /// `{ method, url, headers, body?, timeout?, bodyType, redirect?,
        /// maxRedirects? }`, reused for every attempt
        request: js_sys::Object,
        timeout_ms: u64,
        /// Whether redirect responses resolve (`redirect: 'manual'`)
        manual: bool,
    },
}

impl PreparedRequest {
    pub(crate) fn new(
        url: &str,
        config: &RequestConfig,
        body_type: BodyType,
        progress: ProgressCallbacks,
    ) -> Result<Self> {
        let headers = validated_headers(config)?;
        let body = match &config.body {
            Some(body) => Some((body.content_type(), body.to_bytes()?)),
            None => None,
        };
        // A Content-Type the caller chose wins over the body's default
        let default_content_type = body
            .as_ref()
            .filter(|_| !config.headers.contains("content-type"))
            .map(|(content_type, _)| *content_type);
        let body = body
            .map(|(_, bytes)| bytes)
            .filter(|bytes| !bytes.is_empty())
            .map(|bytes| js_sys::Uint8Array::from(bytes.as_slice()));
        let method = config.method.to_reqwest();
        let redirect = redirect_mode(config);

        if let Some(transport) = NODE_TRANSPORT.with(Clone::clone) {
            let js_headers = js_sys::Object::new();
            for &(name, value) in &headers {
                // Repeated headers are sent as an array, one line each
                let existing = js_sys::Reflect::get(&js_headers, &name.into())?;
                let value = if existing.is_undefined() {
                    JsValue::from_str(value)
                } else if js_sys::Array::is_array(&existing) {
                    js_sys::Array::from(&existing).push(&value.into());
                    existing
                } else {
                    js_sys::Array::of2(&existing, &value.into()).into()
                };
                set(&js_headers, name, &value)?;
            }
            if let Some(content_type) = default_content_type {
                set(&js_headers, "content-type", &content_type.into())?;
            }
            let timeout_ms = config
                .timeout
                .map_or(0, |t| u64::try_from(t.as_millis()).unwrap_or(u64::MAX));
            let request = js_sys::Object::new();
            set(&request, "method", &method.as_str().into())?;
            set(&request, "url", &url.into())?;
            set(&request, "headers", &js_headers)?;
            if let Some(body) = &body {
                set(&request, "body", body)?;
            }
            if timeout_ms > 0 {
                #[allow(clippy::cast_precision_loss)]
                set(&request, "timeout", &JsValue::from_f64(timeout_ms as f64))?;
            }
            set(&request, "bodyType", &JsValue::from(body_type as u8))?;
            if let Some(callback) = &progress.upload {
                set(&request, "onUploadProgress", callback)?;
            }
            if let Some(callback) = &progress.download {
                set(&request, "onDownloadProgress", callback)?;
            }
            if redirect == Redirect::Manual {
                set(&request, "redirect", &"manual".into())?;
            }
            if config.max_redirects != DEFAULT_MAX_REDIRECTS {
                set(&request, "maxRedirects", &config.max_redirects.into())?;
            }
            return Ok(Self::Node {
                transport,
                request,
                timeout_ms,
                manual: redirect == Redirect::Manual,
            });
        }

        // XMLHttpRequest always follows redirects; fetch() reports progress less often
        if progress.upload.is_some() && redirect == Redirect::Follow && has_global("XMLHttpRequest")
        {
            let mut headers: Vec<(String, String)> = headers
                .iter()
                .map(|&(name, value)| (name.to_string(), value.to_string()))
                .collect();
            if let Some(content_type) = default_content_type {
                headers.push(("content-type".to_string(), content_type.to_string()));
            }
            return Ok(Self::Xhr {
                method: method.as_str().to_string(),
                url: url.to_string(),
                headers,
                body,
                body_type,
                progress,
            });
        }

        let body_length = body.as_ref().map_or(0, js_sys::Uint8Array::length);
        let init = fetch_init(
            method.as_str(),
            &headers,
            default_content_type,
            body.as_ref(),
            redirect,
        )?;
        Ok(Self::Fetch {
            url: url.to_string(),
            init,
            body_type,
            progress,
            body_length,
            redirect,
        })
    }

    /// Whether the transport enforces the per-attempt timeout itself
    pub(crate) fn enforces_timeout(&self) -> bool {
        matches!(self, Self::Node { .. })
    }

    pub(crate) async fn send(&self) -> Result<Attempt<JsValue>> {
        match self {
            Self::Fetch {
                url,
                init,
                body_type,
                progress,
                body_length,
                redirect,
            } => send_fetch(url, init, *body_type, progress, *body_length, *redirect).await,
            Self::Xhr {
                method,
                url,
                headers,
                body,
                body_type,
                progress,
            } => send_xhr(method, url, headers, body.as_ref(), *body_type, progress).await,
            Self::Node {
                transport,
                request,
                timeout_ms,
                manual,
            } => send_node(transport, request, *timeout_ms, *manual).await,
        }
    }
}

/// A request whose response is returned as soon as its headers arrive
/// (`responseType: 'stream' | 'ndjson'` and `events()`), sent with `fetch()`
/// in every runtime
pub(crate) struct StreamingRequest {
    url: String,
    init: web_sys::RequestInit,
    redirect: Redirect,
}

/// The head of a streamed response, and its unread body
pub(crate) struct StreamedResponse {
    pub(crate) status: u16,
    pub(crate) url: String,
    pub(crate) headers: Headers,
    pub(crate) body: FetchBody,
}

impl StreamingRequest {
    pub(crate) fn new(url: &str, config: &RequestConfig) -> Result<Self> {
        let headers = validated_headers(config)?;
        let body = match &config.body {
            Some(body) => Some((body.content_type(), body.to_bytes()?)),
            None => None,
        };
        let default_content_type = body
            .as_ref()
            .filter(|_| !config.headers.contains("content-type"))
            .map(|(content_type, _)| *content_type);
        let body = body
            .map(|(_, bytes)| bytes)
            .filter(|bytes| !bytes.is_empty())
            .map(|bytes| js_sys::Uint8Array::from(bytes.as_slice()));
        let redirect = redirect_mode(config);
        let init = fetch_init(
            config.method.to_reqwest().as_str(),
            &headers,
            default_content_type,
            body.as_ref(),
            redirect,
        )?;
        Ok(Self {
            url: url.to_string(),
            init,
            redirect,
        })
    }

    /// One attempt, until the response headers arrive. Error statuses are
    /// read in full, as for other requests.
    pub(crate) async fn send(&self) -> Result<Attempt<StreamedResponse>> {
        let controller = web_sys::AbortController::new().map_err(network_error)?;
        self.init.set_signal(Some(&controller.signal()));
        let guard = CancelGuard::new(move || controller.abort());
        let request = web_sys::Request::new_with_str_and_init(&self.url, &self.init)
            .map_err(invalid_request)?;
        let response: web_sys::Response =
            JsFuture::from(fetch_native(&request).map_err(network_error)?)
                .await
                .map_err(network_error)?
                .unchecked_into();
        let status = response.status();
        let headers = response.headers();
        let redirected = check_redirect(&response, &headers, self.redirect)?;
        if !(200..300).contains(&status) && !redirected {
            let buffer = JsFuture::from(response.array_buffer().map_err(network_error)?)
                .await
                .map_err(network_error)?;
            guard.disarm();
            let text = TEXT_DECODER.with(|decoder| decoder.decode(&buffer))?;
            let retry_after = headers.get("retry-after")?;
            return Ok(http_error(status, text.as_string(), retry_after.as_deref()));
        }
        // From here on, the body is cancelled when it's dropped
        guard.disarm();
        let length = headers
            .get("content-length")?
            .and_then(|length| length.trim().parse::<u64>().ok());
        let url = match response.url() {
            response_url if response_url.is_empty() => self.url.clone(),
            response_url => response_url,
        };
        Ok(Attempt::Success(StreamedResponse {
            status,
            url,
            headers: rust_headers(&headers)?,
            body: FetchBody {
                body: response.body(),
                length,
            },
        }))
    }
}

/// A streamed response body; cancelled if dropped unread
pub(crate) struct FetchBody {
    body: Option<web_sys::ReadableStream>,
    length: Option<u64>,
}

impl FetchBody {
    /// The expected body size from `Content-Length`, if known
    pub(crate) fn content_length(&self) -> Option<u64> {
        self.length
    }

    /// The body, chunk by chunk; dropping the stream cancels the body
    pub(crate) fn chunks(mut self) -> impl futures_util::Stream<Item = Result<Vec<u8>>> {
        let chunks = match self.body.take() {
            Some(body) => wasm_streams::ReadableStream::from_raw(body)
                .into_stream()
                .left_stream(),
            None => futures_util::stream::empty().right_stream(),
        };
        chunks.map(|chunk| {
            chunk
                .map(|chunk| js_sys::Uint8Array::new(&chunk).to_vec())
                .map_err(|error| Error::Network {
                    message: format!("Failed to read response body: {}", js_error_message(&error)),
                    source: None,
                })
        })
    }
}

impl Drop for FetchBody {
    fn drop(&mut self) {
        if let Some(body) = self.body.take() {
            let _ = body.cancel();
        }
    }
}

/// `fetch()` response headers as [`Headers`]; repeated ones (`Set-Cookie`
/// in Node.js) are kept as separate values
fn rust_headers(headers: &web_sys::Headers) -> Result<Headers> {
    let mut result = Headers::new();
    if let Some(entries) = js_sys::try_iter(headers.as_ref())? {
        for entry in entries {
            let entry: js_sys::Array = entry?.unchecked_into();
            result.insert(
                entry.get(0).as_string().unwrap_or_default(),
                entry.get(1).as_string().unwrap_or_default(),
            );
        }
    }
    Ok(result)
}

/// `redirect: 'manual' | 'error'` as the transports apply it
fn redirect_mode(config: &RequestConfig) -> Redirect {
    match (config.follow_redirects, config.max_redirects) {
        (false, _) => Redirect::Manual,
        (true, 0) => Redirect::Error,
        (true, _) => Redirect::Follow,
    }
}

/// The `RequestInit` for a `fetch()` call
fn fetch_init(
    method: &str,
    headers: &[(&str, &str)],
    default_content_type: Option<&str>,
    body: Option<&js_sys::Uint8Array>,
    redirect: Redirect,
) -> Result<web_sys::RequestInit> {
    let js_headers = web_sys::Headers::new().map_err(invalid_request)?;
    for (name, value) in headers {
        js_headers.append(name, value).map_err(invalid_request)?;
    }
    if let Some(content_type) = default_content_type {
        js_headers
            .set("content-type", content_type)
            .map_err(invalid_request)?;
    }
    let init = web_sys::RequestInit::new();
    init.set_method(method);
    init.set_headers(js_headers.as_ref());
    if let Some(body) = body {
        init.set_body(body);
    }
    if redirect != Redirect::Follow {
        init.set_redirect(web_sys::RequestRedirect::Manual);
    }
    Ok(init)
}

/// Whether a `fetch()` response sent with `redirect: 'manual'` is a redirect
/// to return; fails for `redirect: 'error'`. Browsers hide a redirect behind
/// an opaque response with status 0; other runtimes (e.g. Deno) return the
/// redirect itself.
fn check_redirect(
    response: &web_sys::Response,
    headers: &web_sys::Headers,
    redirect: Redirect,
) -> Result<bool> {
    let redirected = redirect != Redirect::Follow
        && (response.type_() == web_sys::ResponseType::Opaqueredirect
            || is_redirect_status(response.status()));
    if redirected && redirect == Redirect::Error {
        let message = match headers.get("location")? {
            Some(location) => format!("Redirect not allowed: {} to {location}", response.status()),
            None => "Redirect not allowed".to_string(),
        };
        return Err(Error::Network {
            message,
            source: None,
        });
    }
    Ok(redirected)
}

/// Read a body chunk by chunk, reporting download progress after each one,
/// into one `ArrayBuffer`
async fn read_with_progress(
    body: web_sys::ReadableStream,
    callback: &js_sys::Function,
    total: Option<f64>,
) -> Result<JsValue> {
    let mut chunks = wasm_streams::ReadableStream::from_raw(body).into_stream();
    let mut parts = Vec::new();
    let mut loaded = 0u32;
    while let Some(chunk) = chunks.next().await {
        let chunk: js_sys::Uint8Array = chunk.map_err(network_error)?.unchecked_into();
        loaded += chunk.length();
        report_progress(callback, f64::from(loaded), total);
        parts.push(chunk);
    }
    let buffer = js_sys::Uint8Array::new_with_length(loaded);
    let mut offset = 0;
    for part in parts {
        buffer.set(&part, offset);
        offset += part.length();
    }
    Ok(buffer.buffer().into())
}

/// Header pairs, validated the same way as the reqwest-backed path
fn validated_headers(config: &RequestConfig) -> Result<Vec<(&str, &str)>> {
    let mut pairs = Vec::new();
    for (name, values) in config.headers.iter() {
        reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| invalid("request", &e.to_string()))?;
        for value in values {
            reqwest::header::HeaderValue::from_str(value)
                .map_err(|e| invalid("request", &e.to_string()))?;
            pairs.push((name.as_str(), value.as_str()));
        }
    }
    Ok(pairs)
}

async fn send_fetch(
    url: &str,
    init: &web_sys::RequestInit,
    body_type: BodyType,
    progress: &ProgressCallbacks,
    body_length: u32,
    redirect: Redirect,
) -> Result<Attempt<JsValue>> {
    let controller = web_sys::AbortController::new().map_err(network_error)?;
    init.set_signal(Some(&controller.signal()));
    let guard = CancelGuard::new(move || controller.abort());
    let request = web_sys::Request::new_with_str_and_init(url, init).map_err(invalid_request)?;
    let response: web_sys::Response =
        JsFuture::from(fetch_native(&request).map_err(network_error)?)
            .await
            .map_err(network_error)?
            .unchecked_into();
    let status = response.status();
    let headers = response.headers();
    if let (Some(callback), true) = (&progress.upload, body_length > 0) {
        let length = f64::from(body_length);
        report_progress(callback, length, Some(length));
    }
    let redirected = check_redirect(&response, &headers, redirect)?;
    let total = headers
        .get("content-length")?
        // Parsed as an integer: parsing floats would add ~13 kB to the module
        .and_then(|length| length.trim().parse::<u32>().ok())
        .map(f64::from);
    // A successful response's body is read chunk by chunk to report progress
    let download = progress
        .download
        .as_ref()
        .filter(|_| (200..300).contains(&status));
    let (buffer, reported) = match (download, response.body()) {
        (Some(callback), Some(body)) => (read_with_progress(body, callback, total).await?, true),
        _ => {
            let buffer = JsFuture::from(response.array_buffer().map_err(network_error)?)
                .await
                .map_err(network_error)?;
            (buffer, false)
        }
    };
    guard.disarm();
    let length = buffer.unchecked_ref::<js_sys::ArrayBuffer>().byte_length();

    if !(200..300).contains(&status) && !redirected {
        let text = TEXT_DECODER.with(|decoder| decoder.decode(&buffer))?;
        let retry_after = headers.get("retry-after")?;
        return Ok(http_error(status, text.as_string(), retry_after.as_deref()));
    }

    // A body-less response (e.g. 204) is reported once
    if let (Some(callback), false) = (download, reported) {
        report_progress(callback, f64::from(length), total);
    }
    let content_type = headers.get("content-type")?.unwrap_or_default();
    let body = decode_body(&buffer, length, &content_type, body_type)?;
    let response_headers = js_sys::Object::from_entries(headers.as_ref())?;
    // Node's Headers iterator can yield separate Set-Cookie entries.
    // Preserve the existing API's comma-joined repeated header values.
    if let Some(cookies) = headers.get("set-cookie")? {
        set(&response_headers, "set-cookie", &cookies.into())?;
    }
    // An opaque redirect has no URL of its own
    let response_url = match response.url() {
        response_url if response_url.is_empty() => url.to_string(),
        response_url => response_url,
    };
    success_response(status, &response_url, &response_headers, &body)
}

/// The finished `{ status, statusText, ok, url, headers, body }` of a 2xx
/// response, or of a redirect returned with `redirect: 'manual'`
fn success_response(
    status: u16,
    url: &str,
    headers: &js_sys::Object,
    body: &JsValue,
) -> Result<Attempt<JsValue>> {
    let result = js_sys::Object::new();
    set(&result, "status", &f64::from(status).into())?;
    set(&result, "statusText", &status_text(status).into())?;
    set(&result, "ok", &(200..300).contains(&status).into())?;
    set(&result, "url", &url.into())?;
    set(&result, "headers", headers)?;
    set(&result, "body", body)?;
    Ok(Attempt::Success(result.into()))
}

/// One attempt through `XMLHttpRequest`, which, unlike `fetch()`, reports
/// upload progress. Redirects, credentials and CORS work as with `fetch()`'s
/// defaults, except that a cross-origin request with an upload listener is
/// always preflighted.
async fn send_xhr(
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: Option<&js_sys::Uint8Array>,
    body_type: BodyType,
    progress: &ProgressCallbacks,
) -> Result<Attempt<JsValue>> {
    let xhr = web_sys::XmlHttpRequest::new().map_err(network_error)?;
    xhr.open_with_async(method, url, true)
        .map_err(invalid_request)?;
    for (name, value) in headers {
        xhr.set_request_header(name, value)
            .map_err(invalid_request)?;
    }
    xhr.set_response_type(web_sys::XmlHttpRequestResponseType::Arraybuffer);

    // Declared before the guard, so the guard detaches them before they're dropped
    let total = body.map_or(0.0, |body| f64::from(body.length()));
    let on_upload = progress.upload.clone().map(|callback| {
        Closure::<dyn FnMut(web_sys::ProgressEvent)>::new(move |event: web_sys::ProgressEvent| {
            report_progress(&callback, event.loaded(), Some(total));
        })
    });
    let on_download = progress.download.clone().map(|callback| {
        let xhr = xhr.clone();
        Closure::<dyn FnMut(web_sys::ProgressEvent)>::new(move |event: web_sys::ProgressEvent| {
            // Like the other transports, only a successful response's body
            if (200..300).contains(&xhr.status().unwrap_or(0)) {
                let total = event.length_computable().then(|| event.total());
                report_progress(&callback, event.loaded(), total);
            }
        })
    });
    let upload = xhr.upload().map_err(network_error)?;
    if let Some(listener) = &on_upload {
        upload.set_onprogress(Some(listener.as_ref().unchecked_ref()));
    }
    if let Some(listener) = &on_download {
        xhr.set_onprogress(Some(listener.as_ref().unchecked_ref()));
    }
    let done = js_sys::Promise::new(&mut |resolve, reject| {
        xhr.set_onload(Some(&resolve));
        xhr.set_onerror(Some(&reject));
    });
    let guard = XhrGuard {
        xhr: xhr.clone(),
        upload,
        finished: false,
    };
    match body {
        Some(body) => xhr.send_with_opt_buffer_source(Some(body)),
        None => xhr.send(),
    }
    .map_err(network_error)?;
    JsFuture::from(done)
        .await
        .map_err(|_| network_error(JsValue::from_str("XMLHttpRequest failed")))?;
    let mut guard = guard;
    guard.finished = true;
    drop(guard);

    let status = xhr.status().map_err(network_error)?;
    let buffer = xhr.response().map_err(network_error)?;
    let length = buffer
        .dyn_ref::<js_sys::ArrayBuffer>()
        .map_or(0, js_sys::ArrayBuffer::byte_length);
    let headers = parse_header_block(&xhr.get_all_response_headers().map_err(network_error)?)?;
    let header = |name: &str| {
        js_sys::Reflect::get(&headers, &name.into())
            .ok()
            .and_then(|value| value.as_string())
    };

    if !(200..300).contains(&status) {
        let text = TEXT_DECODER.with(|decoder| decoder.decode(&buffer))?;
        return Ok(http_error(
            status,
            text.as_string(),
            header("retry-after").as_deref(),
        ));
    }
    let content_type = header("content-type").unwrap_or_default();
    let body = decode_body(&buffer, length, &content_type, body_type)?;
    success_response(status, &xhr.response_url(), &headers, &body)
}

/// Detaches an `XMLHttpRequest`'s listeners, and aborts it if it was
/// abandoned (timeout or cancellation) before finishing
struct XhrGuard {
    xhr: web_sys::XmlHttpRequest,
    upload: web_sys::XmlHttpRequestUpload,
    finished: bool,
}

impl Drop for XhrGuard {
    fn drop(&mut self) {
        self.xhr.set_onload(None);
        self.xhr.set_onerror(None);
        self.xhr.set_onprogress(None);
        self.upload.set_onprogress(None);
        if !self.finished {
            let _ = self.xhr.abort();
        }
    }
}

/// `getAllResponseHeaders()` as an object with lower-cased names
fn parse_header_block(block: &str) -> Result<js_sys::Object> {
    let headers = js_sys::Object::new();
    for line in block.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        let value = match js_sys::Reflect::get(&headers, &name.as_str().into())?.as_string() {
            Some(existing) => format!("{existing}, {value}"),
            None => value.to_string(),
        };
        set(&headers, &name, &value.into())?;
    }
    Ok(headers)
}

/// Call a progress callback with `{ loaded, total }`, ignoring its exceptions
fn report_progress(callback: &js_sys::Function, loaded: f64, total: Option<f64>) {
    let event = js_sys::Object::new();
    let _ = set(&event, "loaded", &loaded.into());
    let _ = set(
        &event,
        "total",
        &total.map_or(JsValue::NULL, JsValue::from_f64),
    );
    let _ = callback.call1(&JsValue::UNDEFINED, &event);
}

/// Whether this is the Node.js entry, which registers its own transport
pub(crate) fn is_node() -> bool {
    NODE_TRANSPORT.with(Option::is_some)
}

/// Whether `globalThis[name]` exists
pub(crate) fn has_global(name: &str) -> bool {
    js_sys::Reflect::get(&js_sys::global(), &name.into()).is_ok_and(|value| value.is_function())
}

async fn send_node(
    transport: &js_sys::Function,
    request: &js_sys::Object,
    timeout_ms: u64,
    manual: bool,
) -> Result<Attempt<JsValue>> {
    let pending = transport
        .call1(&JsValue::UNDEFINED, request)
        .map_err(network_error)?;
    let cancel: js_sys::Function =
        js_sys::Reflect::get(&pending, &"cancel".into())?.unchecked_into();
    let guard = CancelGuard::new(move || {
        let _ = cancel.call0(&JsValue::UNDEFINED);
    });
    // Resolves to the finished `{ status, statusText, ok, url, headers, body }`
    let response = JsFuture::from(js_sys::Promise::from(pending))
        .await
        .map_err(|error| node_error(&error, timeout_ms))?;
    guard.disarm();

    let get = |target: &JsValue, name: &str| js_sys::Reflect::get(target, &name.into());
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let status = get(&response, "status")?.as_f64().unwrap_or(0.0) as u16;
    if !(200..300).contains(&status) && !(manual && is_redirect_status(status)) {
        // For error statuses the transport decodes the body as text
        let body = get(&response, "body")?.as_string();
        let retry_after = get(&get(&response, "headers")?, "retry-after")?.as_string();
        return Ok(http_error(status, body, retry_after.as_deref()));
    }
    // Same status text table as the fetch() path
    set(
        response.unchecked_ref(),
        "statusText",
        &status_text(status).into(),
    )?;
    Ok(Attempt::Success(response))
}

/// Map a Node transport rejection to an error kind
fn node_error(error: &JsValue, timeout_ms: u64) -> Error {
    let code = js_sys::Reflect::get(error, &"code".into())
        .ok()
        .and_then(|code| code.as_string());
    match code.as_deref() {
        Some("RUST_FETCH_TIMEOUT") => Error::Timeout {
            duration_ms: timeout_ms,
        },
        Some("RUST_FETCH_PARSE") => Error::Parse {
            message: format!("Failed to parse JSON response: {}", js_error_message(error)),
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
    reqwest::StatusCode::from_u16(status)
        .ok()
        .and_then(|status| status.canonical_reason())
        .unwrap_or("")
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

/// Decode a `fetch()` body (an `ArrayBuffer`) without copying it into wasm
/// memory. The Node transport applies the same rules in JS (`decodeBody` in
/// `js/node.js`); the JS tests check that both paths agree.
pub(crate) fn decode_body(
    buffer: &JsValue,
    length: u32,
    content_type: &str,
    body_type: BodyType,
) -> Result<JsValue> {
    if length == 0 {
        return Ok(match body_type {
            BodyType::Text => JsValue::from_str(""),
            BodyType::Binary | BodyType::Stream | BodyType::Ndjson => {
                js_sys::Uint8Array::new_with_length(0).into()
            }
            BodyType::Auto | BodyType::Json => JsValue::NULL,
        });
    }
    let json = matches!(body_type, BodyType::Json)
        || matches!(body_type, BodyType::Auto) && is_json_content_type(content_type);
    let text = json
        || matches!(body_type, BodyType::Text)
        || matches!(body_type, BodyType::Auto) && is_text_content_type(content_type);

    if text {
        // Decode UTF-8 with replacement and strip the BOM, matching the Rust
        // decoder. Length is checked first: a BOM-only body is not empty JSON.
        let body = TEXT_DECODER.with(|decoder| decoder.decode(buffer))?;
        return if json {
            match parse_native_json(&body) {
                Ok(value) => Ok(value),
                Err(_) if matches!(body_type, BodyType::Auto) => Ok(body),
                Err(error) => Err(Error::Parse {
                    message: format!(
                        "Failed to parse JSON response: {}",
                        js_error_message(&error)
                    ),
                    source: None,
                }),
            }
        } else {
            Ok(body)
        };
    }

    Ok(js_sys::Uint8Array::new(buffer).into())
}

fn invalid_request(error: JsValue) -> Error {
    invalid("request", &js_error_message(&error))
}

fn network_error(error: JsValue) -> Error {
    Error::Network {
        message: js_error_message(&error),
        source: None,
    }
}
