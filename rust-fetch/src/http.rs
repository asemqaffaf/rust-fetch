//! HTTP module providing simple fetch APIs for WebAssembly
//!
//! This module provides convenient functions for making HTTP requests
//! from WebAssembly, with support for JSON, text, and binary responses.

use crate::{
    client::{Client, WasmClient},
    error::Result,
    types::{Headers, Method, ResponseFormat},
};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

/// Simple fetch function for JSON data
#[wasm_bindgen]
pub async fn fetch_json(url: String) -> Result<JsValue> {
    let client = Client::new()?;
    let response = client
        .get(&url)
        .await?;
    
    match response.body {
        crate::types::ResponseBody::Json(json) => {
            serde_wasm_bindgen::to_value(&json)
                .map_err(|e| crate::error::Error::from(e))
        }
        _ => Err(crate::error::Error::Parse {
            message: "Expected JSON response".to_string(),
            source: None,
        }),
    }
}

/// Fetch JSON data and return as a Promise
#[wasm_bindgen]
pub fn fetch_json_promise(url: String) -> js_sys::Promise {
    future_to_promise(async move {
        fetch_json(url).await
            .map_err(|e| JsValue::from(e))
    })
}

/// Simple fetch function for text/HTML data
#[wasm_bindgen]
pub async fn fetch_text(url: String) -> Result<String> {
    let client = Client::new()?;
    let response = client
        .request(Method::Get, &url)
        .response_format(ResponseFormat::Text)
        .send()
        .await?;
    
    match response.body {
        crate::types::ResponseBody::Text(text) => Ok(text),
        _ => Err(crate::error::Error::Parse {
            message: "Expected text response".to_string(),
            source: None,
        }),
    }
}

/// Advanced fetch function with full options
#[wasm_bindgen]
pub async fn fetch_with_options(
    url: String,
    method: String,
    headers: JsValue,
    body: Option<String>,
) -> Result<JsValue> {
    let client = Client::new()?;
    
    // Parse method
    let method = Method::from_str(&method)
        .ok_or_else(|| crate::error::Error::InvalidInput {
            parameter: "method".to_string(),
            reason: format!("Invalid HTTP method: {}", method),
        })?;
    
    // Create request builder
    let mut request = client.request(method, &url);
    
    // Parse headers if provided
    if !headers.is_null() && !headers.is_undefined() {
        if headers.is_object() {
            let obj = js_sys::Object::from(headers);
            let headers = Headers::from_js_object(&obj)
                .map_err(|_| crate::error::Error::JsInterop {
                    message: "Failed to parse headers object".to_string(),
                })?;
            request = request.headers(headers);
        }
    }
    
    // Add body if provided
    if let Some(body_content) = body {
        request = request.text(body_content);
    }
    
    // Execute request
    let response = request.send().await?;
    
    // Convert response to JS object
    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &"status".into(), &(response.status as f64).into())?;
    js_sys::Reflect::set(&obj, &"statusText".into(), &response.status_text.into())?;
    
    // Convert body based on type
    match response.body {
        crate::types::ResponseBody::Json(json) => {
            let body = serde_wasm_bindgen::to_value(&json)?;
            js_sys::Reflect::set(&obj, &"body".into(), &body)?;
        }
        crate::types::ResponseBody::Text(text) => {
            js_sys::Reflect::set(&obj, &"body".into(), &text.into())?;
        }
        crate::types::ResponseBody::Binary(bytes) => {
            let array = js_sys::Uint8Array::from(bytes.as_slice());
            js_sys::Reflect::set(&obj, &"body".into(), &array)?;
        }
        crate::types::ResponseBody::Empty => {
            js_sys::Reflect::set(&obj, &"body".into(), &JsValue::NULL)?;
        }
    }
    
    Ok(obj.into())
}

/// Create a configured HTTP client (exported for advanced use)
#[wasm_bindgen]
pub fn create_client() -> Result<WasmClient> {
    WasmClient::new()
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

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn test_fetch_json_valid_url() {
        let result = fetch_json("https://jsonplaceholder.typicode.com/posts/1".to_string()).await;
        
        assert!(result.is_ok());
        let value = result.unwrap();
        assert!(!value.is_null());
        assert!(!value.is_undefined());
    }

    #[wasm_bindgen_test]
    async fn test_fetch_text_valid_url() {
        let result = fetch_text("https://httpbin.org/html".to_string()).await;
        
        assert!(result.is_ok());
        let text = result.unwrap();
        assert!(text.contains("<html>"));
    }

    #[wasm_bindgen_test]
    async fn test_fetch_json_invalid_url() {
        let result = fetch_json("https://invalid-domain-that-does-not-exist.com".to_string()).await;
        
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    async fn test_fetch_with_options_post() {
        let result = fetch_with_options(
            "https://jsonplaceholder.typicode.com/posts".to_string(),
            "POST".to_string(),
            JsValue::NULL,
            Some(r#"{"title": "Test Post", "body": "Test Body", "userId": 1}"#.to_string()),
        ).await;
        
        assert!(result.is_ok());
        let response = result.unwrap();
        
        // Check response structure
        assert!(js_sys::Reflect::has(&response, &"status".into()).unwrap());
        assert!(js_sys::Reflect::has(&response, &"statusText".into()).unwrap());
        assert!(js_sys::Reflect::has(&response, &"body".into()).unwrap());
        
        let status = js_sys::Reflect::get(&response, &"status".into()).unwrap();
        assert_eq!(status.as_f64().unwrap(), 201.0);
    }

    #[wasm_bindgen_test]
    fn test_fetch_json_promise() {
        let promise = fetch_json_promise("https://jsonplaceholder.typicode.com/posts/1".to_string());
        
        // Verify it returns a Promise
        assert!(promise.is_instance_of::<js_sys::Promise>());
    }

    #[wasm_bindgen_test]
    async fn test_backward_compatibility() {
        #[allow(deprecated)]
        {
            let result = fetch_wasm_json("https://jsonplaceholder.typicode.com/posts/1".to_string()).await;
            assert!(result.is_ok());
            
            let result = fetch_wasm_html("https://httpbin.org/html".to_string()).await;
            assert!(result.is_ok());
        }
    }

    #[wasm_bindgen_test]
    async fn test_create_client() {
        let client_result = create_client();
        assert!(client_result.is_ok());
        
        let client = client_result.unwrap();
        let promise = client.get("https://jsonplaceholder.typicode.com/posts/1".to_string());
        assert!(promise.is_instance_of::<js_sys::Promise>());
    }
}
