//! HTTP module providing simple fetch APIs for WebAssembly
//!
//! This module provides convenient functions for making HTTP requests
//! from WebAssembly, with support for JSON, text, and binary responses.

use crate::{
    client::{Client, WasmClient},
    error::Result,
    types::Method,
    wasm::{parse_method, send, BodyMode, JsRequest},
};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

/// Fetch a URL and parse the body as JSON (whatever its Content-Type).
/// An empty body resolves to `null`.
#[wasm_bindgen]
pub async fn fetch_json(url: String) -> Result<JsValue> {
    fetch_body(url, "json").await
}

/// Fetch JSON data and return as a Promise
#[wasm_bindgen]
pub fn fetch_json_promise(url: String) -> js_sys::Promise {
    future_to_promise(async move { fetch_json(url).await.map_err(|e| JsValue::from(e)) })
}

/// Fetch a URL and return the body as text
#[wasm_bindgen]
pub async fn fetch_text(url: String) -> Result<String> {
    Ok(fetch_body(url, "text")
        .await?
        .as_string()
        .unwrap_or_default())
}

/// GET `url` with a default client and return the body as `responseType`
async fn fetch_body(url: String, response_type: &str) -> Result<JsValue> {
    let client = Client::new()?;
    let body = BodyMode::Auto(JsValue::UNDEFINED);
    let request = JsRequest::new(
        Method::Get,
        url,
        &JsValue::UNDEFINED,
        body,
        &JsValue::UNDEFINED,
    )?;
    let options = js_sys::Object::new();
    js_sys::Reflect::set(&options, &"responseType".into(), &response_type.into())?;
    let response = send(&client, request, &options).await?;
    Ok(js_sys::Reflect::get(&response, &"body".into())?)
}

/// Fetch with a method, headers and an optional string body.
///
/// Resolves to `{ status, statusText, ok, url, headers, body }`.
#[wasm_bindgen]
pub async fn fetch_with_options(
    url: String,
    method: String,
    headers: JsValue,
    body: Option<String>,
) -> Result<JsValue> {
    let client = Client::new()?;

    let method = parse_method(&method)?;

    let body = BodyMode::Auto(body.map_or(JsValue::UNDEFINED, JsValue::from));
    let request = JsRequest::new(method, url, &headers, body, &JsValue::UNDEFINED)?;
    send(&client, request, &JsValue::UNDEFINED).await
}

/// Create a configured HTTP client (exported for advanced use)
#[wasm_bindgen]
pub fn create_client() -> Result<WasmClient> {
    WasmClient::new(None)
}

// Backward compatibility functions (deprecated)

/// Fetch JSON data (deprecated, use fetch_json instead)
#[wasm_bindgen]
#[deprecated(note = "Use fetch_json instead")]
pub async fn fetch_wasm_json(url: String) -> Result<JsValue> {
    fetch_json(url).await
}

/// Fetch HTML data (deprecated, use fetch_text instead)
#[wasm_bindgen]
#[deprecated(note = "Use fetch_text instead")]
pub async fn fetch_wasm_html(url: String) -> Result<String> {
    fetch_text(url).await
}

/// Fetch data and return as map (deprecated, use fetch_json instead)
#[wasm_bindgen]
#[deprecated(note = "Use fetch_json instead")]
pub async fn fetch_wasm_map(url: String) -> Result<JsValue> {
    fetch_json(url).await
}

/// Fetch API data (deprecated, use fetch_json instead)
#[wasm_bindgen]
#[deprecated(note = "Use fetch_json instead")]
pub async fn fetch_wasm_api(url: String) -> Result<JsValue> {
    fetch_json(url).await
}
