//! HTTP client implementation with builder pattern
//!
//! This module provides a flexible HTTP client with support for
//! retries, interceptors, and various configuration options.

use crate::{
    error::{Error, Result},
    types::{Body, Headers, Method, RequestConfig, Response, ResponseBody, ResponseFormat, RetryConfig},
};
use std::sync::Arc;
use std::time::Duration;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

/// HTTP client for making requests
#[derive(Clone)]
pub struct Client {
    inner: reqwest::Client,
    config: Arc<ClientConfig>,
}

/// Client configuration
#[derive(Clone)]
struct ClientConfig {
    default_headers: Headers,
    timeout: Duration,
    retry_config: Option<RetryConfig>,
    base_url: Option<String>,
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
    pub fn request(&self, method: Method, url: impl AsRef<str>) -> RequestBuilder {
        let url = if let Some(base) = &self.config.base_url {
            format!("{}{}", base.trim_end_matches('/'), url.as_ref())
        } else {
            url.as_ref().to_string()
        };
        
        RequestBuilder {
            client: self.clone(),
            config: RequestConfig {
                method,
                headers: self.config.default_headers.clone(),
                body: None,
                timeout: Some(self.config.timeout),
                follow_redirects: true,
                max_redirects: 10,
                response_format: ResponseFormat::Auto,
            },
            url,
        }
    }
    
    /// Execute a request with the given configuration
    async fn execute(&self, url: String, config: RequestConfig) -> Result<Response> {
        let retry_config = self.config.retry_config.clone();
        
        let mut attempt = 0;
        let mut last_error;
        
        loop {
            match self.execute_once(url.clone(), config.clone()).await {
                Ok(response) => return Ok(response),
                Err(err) => {
                    last_error = err;
                    
                    if let Some(retry) = &retry_config {
                        if attempt >= retry.max_retries {
                            break;
                        }
                        
                        if !last_error.is_retryable() {
                            break;
                        }
                        
                        attempt += 1;
                        let delay = calculate_retry_delay(attempt, retry);
                        
                        #[cfg(not(target_arch = "wasm32"))]
                        {
                            tokio::time::sleep(delay).await;
                        }
                        
                        #[cfg(target_arch = "wasm32")]
                        {
                            let delay_ms = delay.as_millis() as i32;
                            wasm_bindgen_futures::JsFuture::from(
                                js_sys::Promise::new(&mut |resolve, _| {
                                    web_sys::window()
                                        .unwrap()
                                        .set_timeout_with_callback_and_timeout_and_arguments_0(
                                            &resolve,
                                            delay_ms,
                                        )
                                        .unwrap();
                                }),
                            )
                            .await
                            .unwrap();
                        }
                    } else {
                        break;
                    }
                }
            }
        }
        
        Err(last_error)
    }
    
    /// Execute a single request attempt
    async fn execute_once(&self, url: String, config: RequestConfig) -> Result<Response> {
        let mut request = self.inner.request(config.method.to_reqwest(), &url);
        
        // Set headers
        for (name, values) in config.headers.iter() {
            for value in values {
                request = request.header(name.as_str(), value.as_str());
            }
        }
        
        // Set body
        if let Some(body) = config.body {
            let content_type = body.content_type();
            request = request.header("content-type", content_type);
            request = request.body(body.to_bytes()?);
        }
        
        // Set timeout
        #[cfg(not(target_arch = "wasm32"))]
        if let Some(timeout) = config.timeout {
            request = request.timeout(timeout);
        }
        
        // Execute request
        let response = request.send().await?;
        
        // Parse response
        let status = response.status().as_u16();
        let status_text = response.status().canonical_reason().unwrap_or("Unknown").to_string();
        let url = response.url().to_string();
        
        // Parse headers
        let mut headers = Headers::new();
        for (name, value) in response.headers() {
            if let Ok(value_str) = value.to_str() {
                headers.insert(name.to_string(), value_str);
            }
        }
        
        // Parse body based on format preference and content type
        let content_type = headers.get_first("content-type").unwrap_or("");
        let body = match config.response_format {
            ResponseFormat::Json => {
                let json: serde_json::Value = response.json().await
                    .map_err(|e| Error::parse("Failed to parse JSON response", e))?;
                ResponseBody::Json(json)
            }
            ResponseFormat::Text => {
                let text = response.text().await
                    .map_err(|e| Error::parse("Failed to read text response", e))?;
                ResponseBody::Text(text)
            }
            ResponseFormat::Binary => {
                let bytes = response.bytes().await
                    .map_err(|e| Error::parse("Failed to read binary response", e))?;
                ResponseBody::Binary(bytes.to_vec())
            }
            ResponseFormat::Auto => {
                if content_type.contains("application/json") {
                    let bytes = response.bytes().await
                        .map_err(|e| Error::parse("Failed to read response bytes", e))?;
                    match serde_json::from_slice::<serde_json::Value>(&bytes) {
                        Ok(json) => ResponseBody::Json(json),
                        Err(_) => {
                            // Fallback to text if JSON parsing fails
                            match String::from_utf8(bytes.to_vec()) {
                                Ok(text) => ResponseBody::Text(text),
                                Err(_) => ResponseBody::Binary(bytes.to_vec()),
                            }
                        }
                    }
                } else if content_type.contains("text/") || content_type.contains("xml") {
                    let text = response.text().await
                        .map_err(|e| Error::parse("Failed to read text response", e))?;
                    ResponseBody::Text(text)
                } else {
                    let bytes = response.bytes().await
                        .map_err(|e| Error::parse("Failed to read binary response", e))?;
                    ResponseBody::Binary(bytes.to_vec())
                }
            }
        };
        
        let response = Response {
            status,
            status_text,
            headers,
            body,
            url,
        };
        
        // Check for HTTP errors
        if !response.is_success() {
            return Err(Error::Http {
                status: response.status,
                status_text: response.status_text.clone(),
                body: response.text().map(|s| s.to_string()),
            });
        }
        
        Ok(response)
    }
}

/// Builder for creating HTTP clients
pub struct ClientBuilder {
    headers: Headers,
    timeout: Duration,
    retry_config: Option<RetryConfig>,
    base_url: Option<String>,
}

impl ClientBuilder {
    /// Create a new client builder
    pub fn new() -> Self {
        Self {
            headers: Headers::new(),
            timeout: Duration::from_secs(30),
            retry_config: None,
            base_url: None,
        }
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
    
    /// Set request timeout
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
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
        let inner = build_reqwest_client()?;
        
        Ok(Client {
            inner,
            config: Arc::new(ClientConfig {
                default_headers: self.headers,
                timeout: self.timeout,
                retry_config: self.retry_config,
                base_url: self.base_url,
            }),
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
    config: RequestConfig,
    url: String,
}

impl RequestBuilder {
    /// Set request header
    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.config.headers.insert(name, value);
        self
    }
    
    /// Set multiple headers
    pub fn headers(mut self, headers: Headers) -> Self {
        for (name, values) in headers.iter() {
            for value in values {
                self.config.headers.insert(name.clone(), value.clone());
            }
        }
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
    
    /// Set request timeout
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.config.timeout = Some(timeout);
        self
    }
    
    /// Set response format preference
    pub fn response_format(mut self, format: ResponseFormat) -> Self {
        self.config.response_format = format;
        self
    }
    
    /// Execute the request
    pub async fn send(self) -> Result<Response> {
        self.client.execute(self.url, self.config).await
    }
}

/// Build a reqwest client with platform-specific configuration
fn build_reqwest_client() -> Result<reqwest::Client> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        reqwest::Client::builder()
            .build()
            .map_err(|e| Error::network("Failed to create HTTP client", e))
    }
    
    #[cfg(target_arch = "wasm32")]
    {
        reqwest::Client::builder()
            .build()
            .map_err(|e| Error::network("Failed to create HTTP client", e))
    }
}

/// Calculate retry delay with exponential backoff
fn calculate_retry_delay(attempt: u32, config: &RetryConfig) -> Duration {
    let delay = config.initial_delay.as_millis() as f64 * config.multiplier.powi(attempt as i32 - 1);
    let delay = delay.min(config.max_delay.as_millis() as f64) as u64;
    Duration::from_millis(delay)
}

/// WASM bindings for the client
#[wasm_bindgen]
pub struct WasmClient {
    inner: Client,
}

#[wasm_bindgen]
impl WasmClient {
    /// Create a new client
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<WasmClient> {
        Ok(WasmClient {
            inner: Client::new()?,
        })
    }
    
    /// Make a GET request
    #[wasm_bindgen]
    pub fn get(&self, url: String) -> js_sys::Promise {
        let client = self.inner.clone();
        future_to_promise(async move {
            let response = client.get(&url).await
                .map_err(|e| JsValue::from(e))?;
            response_to_js(&response)
                .map_err(|e| JsValue::from(e))
        })
    }
    
    /// Make a POST request with JSON body
    #[wasm_bindgen]
    pub fn post_json(&self, url: String, body: JsValue) -> js_sys::Promise {
        let client = self.inner.clone();
        future_to_promise(async move {
            let json: serde_json::Value = serde_wasm_bindgen::from_value(body)
                .map_err(|e| Error::from(e))?;
            let response = client.post(&url).json(&json)?.send().await
                .map_err(|e| Error::from(e))?;
            response_to_js(&response)
                .map_err(|e| JsValue::from(e))
        })
    }
}

/// Convert Response to JavaScript object
fn response_to_js(response: &Response) -> Result<JsValue> {
    let obj = js_sys::Object::new();
    
    js_sys::Reflect::set(&obj, &"status".into(), &(response.status as f64).into())?;
    js_sys::Reflect::set(&obj, &"statusText".into(), &response.status_text.clone().into())?;
    js_sys::Reflect::set(&obj, &"url".into(), &response.url.clone().into())?;
    
    // Convert headers
    let headers_obj = js_sys::Object::new();
    for (name, values) in response.headers.iter() {
        let value = values.join(", ");
        js_sys::Reflect::set(&headers_obj, &name.clone().into(), &value.into())?;
    }
    js_sys::Reflect::set(&obj, &"headers".into(), &headers_obj)?;
    
    // Convert body
    match &response.body {
        ResponseBody::Json(json) => {
            let body = serde_wasm_bindgen::to_value(json)?;
            js_sys::Reflect::set(&obj, &"body".into(), &body)?;
        }
        ResponseBody::Text(text) => {
            js_sys::Reflect::set(&obj, &"body".into(), &text.clone().into())?;
        }
        ResponseBody::Binary(bytes) => {
            let array = js_sys::Uint8Array::from(bytes.as_slice());
            js_sys::Reflect::set(&obj, &"body".into(), &array)?;
        }
        ResponseBody::Empty => {
            js_sys::Reflect::set(&obj, &"body".into(), &JsValue::NULL)?;
        }
    }
    
    Ok(obj.into())
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
        
        assert_eq!(calculate_retry_delay(1, &config), Duration::from_millis(100));
        assert_eq!(calculate_retry_delay(2, &config), Duration::from_millis(200));
        assert_eq!(calculate_retry_delay(3, &config), Duration::from_millis(400));
    }
}
