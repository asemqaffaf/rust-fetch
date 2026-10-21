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
//! - Everywhere else: the runtime's `fetch()`.

use super::{invalid, js_error_message, set, BodyType};
use crate::{
    client::{parse_retry_after, Attempt},
    error::{Error, Result},
    types::{is_json_content_type, is_text_content_type, RequestConfig},
};
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
    fn parse_native_json(text: &JsValue) -> std::result::Result<JsValue, JsValue>;

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

pub(crate) enum PreparedRequest {
    Fetch {
        url: String,
        init: web_sys::RequestInit,
        body_type: BodyType,
    },
    Node {
        transport: js_sys::Function,
        /// `{ method, url, headers, body?, timeout?, bodyType }`, reused for
        /// every attempt
        request: js_sys::Object,
        timeout_ms: u64,
    },
}

impl PreparedRequest {
    pub(crate) fn new(url: &str, config: &RequestConfig, body_type: BodyType) -> Result<Self> {
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
            return Ok(Self::Node {
                transport,
                request,
                timeout_ms,
            });
        }

        let js_headers = web_sys::Headers::new().map_err(invalid_request)?;
        for (name, value) in &headers {
            js_headers.append(name, value).map_err(invalid_request)?;
        }
        if let Some(content_type) = default_content_type {
            js_headers
                .set("content-type", content_type)
                .map_err(invalid_request)?;
        }
        let init = web_sys::RequestInit::new();
        init.set_method(method.as_str());
        init.set_headers(js_headers.as_ref());
        if let Some(body) = &body {
            init.set_body(body);
        }
        Ok(Self::Fetch {
            url: url.to_string(),
            init,
            body_type,
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
            } => send_fetch(url, init, *body_type).await,
            Self::Node {
                transport,
                request,
                timeout_ms,
            } => send_node(transport, request, *timeout_ms).await,
        }
    }
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
    let buffer = JsFuture::from(response.array_buffer().map_err(network_error)?)
        .await
        .map_err(network_error)?;
    guard.disarm();
    let length = buffer.unchecked_ref::<js_sys::ArrayBuffer>().byte_length();

    if !(200..300).contains(&status) {
        let text = TEXT_DECODER.with(|decoder| decoder.decode(&buffer))?;
        let retry_after = headers.get("retry-after")?;
        return Ok(http_error(status, text.as_string(), retry_after.as_deref()));
    }

    let content_type = headers.get("content-type")?.unwrap_or_default();
    let body = decode_body(&buffer, length, &content_type, body_type)?;
    let result = js_sys::Object::new();
    set(&result, "status", &f64::from(status).into())?;
    set(&result, "statusText", &status_text(status).into())?;
    set(&result, "ok", &JsValue::TRUE)?;
    set(&result, "url", &response.url().into())?;
    let response_headers = js_sys::Object::from_entries(headers.as_ref())?;
    // Node's Headers iterator can yield separate Set-Cookie entries.
    // Preserve the existing API's comma-joined repeated header values.
    if let Some(cookies) = headers.get("set-cookie")? {
        set(&response_headers, "set-cookie", &cookies.into())?;
    }
    set(&result, "headers", &response_headers)?;
    set(&result, "body", &body)?;
    Ok(Attempt::Success(result.into()))
}

async fn send_node(
    transport: &js_sys::Function,
    request: &js_sys::Object,
    timeout_ms: u64,
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
    if !(200..300).contains(&status) {
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
fn http_error(status: u16, body: Option<String>, retry_after: Option<&str>) -> Attempt<JsValue> {
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
fn decode_body(
    buffer: &JsValue,
    length: u32,
    content_type: &str,
    body_type: BodyType,
) -> Result<JsValue> {
    if length == 0 {
        return Ok(match body_type {
            BodyType::Text => JsValue::from_str(""),
            BodyType::Binary | BodyType::Stream => js_sys::Uint8Array::new_with_length(0).into(),
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
