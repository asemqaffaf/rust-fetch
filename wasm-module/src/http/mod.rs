use wasm_bindgen::prelude::*;
use wasm_bindgen::JsValue;
// use wasm_bindgen_futures::JsFuture;
use reqwest::get;
use serde_json::Value;
use serde_wasm_bindgen::to_value;
// use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;
// use serde_json::Value;
// use web_sys::Response;
use js_sys::Promise;
use wasm_bindgen_futures::js_sys;

#[wasm_bindgen]
pub async fn fetch_wasm_json_new(url: String) -> Promise {
    future_to_promise(async move {
        let response = get(url)
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let json: Value = response
            .json()
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        serde_wasm_bindgen::to_value(&json).map_err(|e| JsValue::from_str(&e.to_string()))
    })
}

#[wasm_bindgen]
pub async fn fetch_wasm_json(url: String) -> Result<JsValue, JsValue> {
    let response = get(url)
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let json: Value = response
        .json()
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Convert the Value directly to JsValue instead of converting to string
    Ok(JsValue::from_serde(&json).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[wasm_bindgen]
pub async fn fetch_wasm_map(url: String) -> Result<JsValue, JsValue> {
    let response = get(url)
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let json: Value = response
        .json()
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Use serde_wasm_bindgen::to_value instead of JsValue::from_serde
    Ok(to_value(&json)?)
}

#[wasm_bindgen]
pub async fn fetch_wasm_html(url: String) -> Result<String, JsValue> {
    let content = get(url)
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?
        .text()
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(content)
}

#[wasm_bindgen]
pub async fn fetch_wasm_api() -> Result<JsValue, JsValue> {
    let response = get("https://jsonplaceholder.typicode.com/todos/1")
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let content = response
        .json()
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Ok(content)
    // Ok(to_value(&content)?)
    Ok(to_value::<serde_json::Value>(&content)?)
}
