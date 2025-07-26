//! Common types and data structures for the library
//!
//! This module provides type-safe wrappers and builders for HTTP operations.

use std::collections::HashMap;
use std::time::Duration;
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

/// HTTP method enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Method {
    Get,
    Post,
    Put,
    Delete,
    Patch,
    Head,
    Options,
    Connect,
    Trace,
}

impl Method {
    /// Convert from string representation
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "GET" => Some(Method::Get),
            "POST" => Some(Method::Post),
            "PUT" => Some(Method::Put),
            "DELETE" => Some(Method::Delete),
            "PATCH" => Some(Method::Patch),
            "HEAD" => Some(Method::Head),
            "OPTIONS" => Some(Method::Options),
            "CONNECT" => Some(Method::Connect),
            "TRACE" => Some(Method::Trace),
            _ => None,
        }
    }
    
    /// Convert to reqwest Method
    pub fn to_reqwest(&self) -> reqwest::Method {
        match self {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
            Method::Put => reqwest::Method::PUT,
            Method::Delete => reqwest::Method::DELETE,
            Method::Patch => reqwest::Method::PATCH,
            Method::Head => reqwest::Method::HEAD,
            Method::Options => reqwest::Method::OPTIONS,
            Method::Connect => reqwest::Method::CONNECT,
            Method::Trace => reqwest::Method::TRACE,
        }
    }
}

impl Default for Method {
    fn default() -> Self {
        Method::Get
    }
}

/// Response format preference
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResponseFormat {
    /// Automatically detect based on Content-Type
    Auto,
    /// Force JSON parsing
    Json,
    /// Return as text
    Text,
    /// Return as binary (Vec<u8>)
    Binary,
}

/// HTTP headers collection
#[derive(Debug, Clone, Default)]
pub struct Headers {
    inner: HashMap<String, Vec<String>>,
}

impl Headers {
    /// Create a new empty headers collection
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Add a header value
    pub fn insert(&mut self, name: impl Into<String>, value: impl Into<String>) {
        let name = name.into().to_lowercase();
        let value = value.into();
        self.inner.entry(name).or_insert_with(Vec::new).push(value);
    }
    
    /// Set a header value (replaces existing)
    pub fn set(&mut self, name: impl Into<String>, value: impl Into<String>) {
        let name = name.into().to_lowercase();
        let value = value.into();
        self.inner.insert(name, vec![value]);
    }
    
    /// Get header values
    pub fn get(&self, name: &str) -> Option<&Vec<String>> {
        self.inner.get(&name.to_lowercase())
    }
    
    /// Get the first header value
    pub fn get_first(&self, name: &str) -> Option<&str> {
        self.get(name).and_then(|v| v.first().map(|s| s.as_str()))
    }
    
    /// Remove a header
    pub fn remove(&mut self, name: &str) -> Option<Vec<String>> {
        self.inner.remove(&name.to_lowercase())
    }
    
    /// Check if header exists
    pub fn contains(&self, name: &str) -> bool {
        self.inner.contains_key(&name.to_lowercase())
    }
    
    /// Iterate over all headers
    pub fn iter(&self) -> impl Iterator<Item = (&String, &Vec<String>)> {
        self.inner.iter()
    }
    
    /// Create from JavaScript object
    pub fn from_js_object(obj: &js_sys::Object) -> Result<Self, JsValue> {
        let mut headers = Headers::new();
        
        let entries = js_sys::Object::entries(obj);
        for i in 0..entries.length() {
            let entry = entries.get(i);
            let array = js_sys::Array::from(&entry);
            if array.length() == 2 {
                let key = array.get(0);
                let value = array.get(1);
                if let (Some(key_str), Some(value_str)) = (key.as_string(), value.as_string()) {
                    headers.insert(key_str, value_str);
                }
            }
        }
        
        Ok(headers)
    }
}

/// Request configuration
#[derive(Debug, Clone)]
pub struct RequestConfig {
    /// HTTP method
    pub method: Method,
    /// Request headers
    pub headers: Headers,
    /// Request body
    pub body: Option<Body>,
    /// Request timeout
    pub timeout: Option<Duration>,
    /// Follow redirects
    pub follow_redirects: bool,
    /// Maximum number of redirects
    pub max_redirects: u32,
    /// Response format preference
    pub response_format: ResponseFormat,
}

impl Default for RequestConfig {
    fn default() -> Self {
        Self {
            method: Method::Get,
            headers: Headers::new(),
            body: None,
            timeout: Some(Duration::from_secs(30)),
            follow_redirects: true,
            max_redirects: 10,
            response_format: ResponseFormat::Auto,
        }
    }
}

/// Request body variants
#[derive(Debug, Clone)]
pub enum Body {
    /// Text body
    Text(String),
    /// JSON body (will be serialized)
    Json(serde_json::Value),
    /// Binary body
    Binary(Vec<u8>),
    /// Form data
    Form(HashMap<String, String>),
}

impl Body {
    /// Convert to bytes
    pub fn to_bytes(&self) -> Result<Vec<u8>, crate::error::Error> {
        match self {
            Body::Text(s) => Ok(s.as_bytes().to_vec()),
            Body::Json(v) => serde_json::to_vec(v)
                .map_err(|e| crate::error::Error::parse("Failed to serialize JSON", e)),
            Body::Binary(b) => Ok(b.clone()),
            Body::Form(map) => {
                let encoded = serde_urlencoded::to_string(map)
                    .map_err(|e| crate::error::Error::Parse {
                        message: "Failed to encode form data".to_string(),
                        source: Some(Box::new(e)),
                    })?;
                Ok(encoded.into_bytes())
            }
        }
    }
    
    /// Get appropriate Content-Type header
    pub fn content_type(&self) -> &'static str {
        match self {
            Body::Text(_) => "text/plain",
            Body::Json(_) => "application/json",
            Body::Binary(_) => "application/octet-stream",
            Body::Form(_) => "application/x-www-form-urlencoded",
        }
    }
}

/// HTTP response wrapper
#[derive(Debug)]
pub struct Response {
    /// HTTP status code
    pub status: u16,
    /// Status text
    pub status_text: String,
    /// Response headers
    pub headers: Headers,
    /// Response body
    pub body: ResponseBody,
    /// Request URL (after redirects)
    pub url: String,
}

/// Response body variants
#[derive(Debug)]
pub enum ResponseBody {
    /// Text response
    Text(String),
    /// JSON response
    Json(serde_json::Value),
    /// Binary response
    Binary(Vec<u8>),
    /// Empty response
    Empty,
}

impl Response {
    /// Get body as text
    pub fn text(&self) -> Option<&str> {
        match &self.body {
            ResponseBody::Text(s) => Some(s.as_str()),
            _ => None,
        }
    }
    
    /// Get body as JSON
    pub fn json(&self) -> Option<&serde_json::Value> {
        match &self.body {
            ResponseBody::Json(v) => Some(v),
            _ => None,
        }
    }
    
    /// Get body as bytes
    pub fn bytes(&self) -> Option<&[u8]> {
        match &self.body {
            ResponseBody::Binary(b) => Some(b.as_slice()),
            ResponseBody::Text(s) => Some(s.as_bytes()),
            _ => None,
        }
    }
    
    /// Check if response is successful (2xx)
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }
    
    /// Check if response is redirect (3xx)
    pub fn is_redirect(&self) -> bool {
        (300..400).contains(&self.status)
    }
    
    /// Check if response is client error (4xx)
    pub fn is_client_error(&self) -> bool {
        (400..500).contains(&self.status)
    }
    
    /// Check if response is server error (5xx)
    pub fn is_server_error(&self) -> bool {
        (500..600).contains(&self.status)
    }
}

/// Retry configuration
#[derive(Debug, Clone)]
pub struct RetryConfig {
    /// Maximum number of retries
    pub max_retries: u32,
    /// Initial retry delay
    pub initial_delay: Duration,
    /// Maximum retry delay
    pub max_delay: Duration,
    /// Exponential backoff multiplier
    pub multiplier: f64,
    /// Retry on timeout
    pub retry_on_timeout: bool,
    /// Retry on network errors
    pub retry_on_network_error: bool,
    /// Retry on specific status codes
    pub retry_on_status: Vec<u16>,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(10),
            multiplier: 2.0,
            retry_on_timeout: true,
            retry_on_network_error: true,
            retry_on_status: vec![408, 429, 500, 502, 503, 504],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_method_conversion() {
        assert_eq!(Method::from_str("GET"), Some(Method::Get));
        assert_eq!(Method::from_str("post"), Some(Method::Post));
        assert_eq!(Method::from_str("INVALID"), None);
    }
    
    #[test]
    fn test_headers_operations() {
        let mut headers = Headers::new();
        headers.insert("Content-Type", "application/json");
        headers.insert("Accept", "application/json");
        headers.insert("Accept", "text/plain");
        
        assert_eq!(headers.get_first("content-type"), Some("application/json"));
        assert_eq!(headers.get("accept").map(|v| v.len()), Some(2));
        
        headers.set("Accept", "application/xml");
        assert_eq!(headers.get("accept").map(|v| v.len()), Some(1));
    }
    
    #[test]
    fn test_response_status_checks() {
        let response = Response {
            status: 200,
            status_text: "OK".to_string(),
            headers: Headers::new(),
            body: ResponseBody::Empty,
            url: "https://example.com".to_string(),
        };
        
        assert!(response.is_success());
        assert!(!response.is_redirect());
        assert!(!response.is_client_error());
        assert!(!response.is_server_error());
    }
}
