//! Buffered JavaScript responses stay in JS memory. Rust still resolves URLs,
//! validates requests, and applies the same retry and timeout policy as the
//! native client. Streaming/progress use the existing incremental reader.

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
}

pub(crate) struct PreparedRequest {
    url: String,
    init: web_sys::RequestInit,
}

impl PreparedRequest {
    pub(crate) fn new(url: &str, config: &RequestConfig) -> Result<Self> {
        let headers = web_sys::Headers::new().map_err(invalid_request)?;
        for (name, values) in config.headers.iter() {
            // Match the reqwest-backed path's validation before sending.
            reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|e| invalid("request", &e.to_string()))?;
            for value in values {
                let value = reqwest::header::HeaderValue::from_str(value)
                    .map_err(|e| invalid("request", &e.to_string()))?;
                let value = value
                    .to_str()
                    .map_err(|e| invalid("request", &e.to_string()))?;
                headers.append(name, value).map_err(invalid_request)?;
            }
        }

        let init = web_sys::RequestInit::new();
        init.set_method(config.method.to_reqwest().as_str());
        init.set_headers(headers.as_ref());
        if let Some(body) = &config.body {
            if !config.headers.contains("content-type") {
                headers
                    .set("content-type", body.content_type())
                    .map_err(invalid_request)?;
            }
            let bytes = body.to_bytes()?;
            if !bytes.is_empty() {
                init.set_body(&js_sys::Uint8Array::from(bytes.as_slice()));
            }
        }
        Ok(Self {
            url: url.to_string(),
            init,
        })
    }

    pub(crate) async fn send(&self, body_type: BodyType) -> Result<Attempt<JsValue>> {
        // Dropping an attempt on timeout/cancellation must abort both fetch
        // and the pending body reader, not merely stop awaiting their promise.
        let guard = AbortGuard(web_sys::AbortController::new().map_err(network_error)?);
        self.init.set_signal(Some(&guard.0.signal()));
        let request = web_sys::Request::new_with_str_and_init(&self.url, &self.init)
            .map_err(invalid_request)?;
        let response: web_sys::Response =
            JsFuture::from(fetch_native(&request).map_err(network_error)?)
                .await
                .map_err(network_error)?
                .unchecked_into();
        let status = response.status();
        let status_text = reqwest::StatusCode::from_u16(status)
            .ok()
            .and_then(|status| status.canonical_reason())
            .unwrap_or("");
        let headers = response.headers();

        if !(200..300).contains(&status) {
            let body = read_text(&response).await?;
            let retry_after = headers
                .get("retry-after")?
                .as_deref()
                .and_then(parse_retry_after);
            return Ok(Attempt::HttpError(
                Error::Http {
                    status,
                    status_text: status_text.to_string(),
                    body: body.as_string(),
                },
                retry_after,
            ));
        }

        let content_type = headers.get("content-type")?.unwrap_or_default();
        let body = decode_body(&response, &content_type, body_type).await?;
        let result = js_sys::Object::new();
        set(&result, "status", &f64::from(status).into())?;
        set(&result, "statusText", &status_text.into())?;
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
}

struct AbortGuard(web_sys::AbortController);

impl Drop for AbortGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn read_text(response: &web_sys::Response) -> Result<JsValue> {
    JsFuture::from(response.text().map_err(network_error)?)
        .await
        .map_err(network_error)
}

async fn decode_body(
    response: &web_sys::Response,
    content_type: &str,
    body_type: BodyType,
) -> Result<JsValue> {
    let buffer = JsFuture::from(response.array_buffer().map_err(network_error)?)
        .await
        .map_err(network_error)?;
    if buffer.unchecked_ref::<js_sys::ArrayBuffer>().byte_length() == 0 {
        return Ok(match body_type {
            BodyType::Text => JsValue::from_str(""),
            BodyType::Binary | BodyType::Stream => js_sys::Uint8Array::new(&buffer).into(),
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
        // decoder. Check byte length first: a BOM-only body is not empty JSON.
        let body = TEXT_DECODER.with(|decoder| decoder.decode(&buffer))?;
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

    Ok(js_sys::Uint8Array::new(&buffer).into())
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
