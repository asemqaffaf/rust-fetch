//! Common types and data structures for the library
//!
//! This module provides type-safe wrappers and builders for HTTP operations.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

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

    /// Whether repeating the request has the same effect as sending it once
    /// (RFC 9110 §9.2.2). Only idempotent requests are retried by default.
    pub fn is_idempotent(&self) -> bool {
        !matches!(self, Method::Post | Method::Patch | Method::Connect)
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
}

/// Whether a `Content-Type` denotes JSON (`application/json`, `application/problem+json`, ...)
pub(crate) fn is_json_content_type(content_type: &str) -> bool {
    let essence = mime_essence(content_type);
    essence == "application/json" || essence.ends_with("+json")
}

/// Whether a `Content-Type` denotes human-readable text
pub(crate) fn is_text_content_type(content_type: &str) -> bool {
    let essence = mime_essence(content_type);
    essence.starts_with("text/")
        || essence.ends_with("+xml")
        || matches!(
            essence.as_str(),
            "application/xml" | "application/javascript" | "application/x-www-form-urlencoded"
        )
}

fn mime_essence(content_type: &str) -> String {
    content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
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
            // A `Value` has only string keys and writing to a Vec can't fail
            Body::Json(v) => {
                Ok(serde_json::to_vec(v).expect("serde_json::Value always serializes"))
            }
            Body::Binary(b) => Ok(b.clone()),
            // serde_urlencoded only fails for nested values; string pairs always encode
            Body::Form(map) => Ok(serde_urlencoded::to_string(map)
                .expect("string key/value pairs are always form-encodable")
                .into_bytes()),
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

/// Download progress, reported after each received chunk
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    /// Bytes received so far
    pub loaded: u64,
    /// Expected size from `Content-Length`, if the server sent one. With
    /// compressed responses in a browser this is the compressed size, so
    /// `loaded` can exceed it.
    pub total: Option<u64>,
}

/// A `multipart/form-data` body, for forms with file uploads
#[derive(Debug, Clone)]
pub struct Multipart {
    boundary: String,
    parts: Vec<Part>,
}

/// One field of a [`Multipart`] body
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Part {
    /// Field name
    pub name: String,
    /// File name, for file fields
    pub filename: Option<String>,
    /// Content type, for file fields
    pub content_type: Option<String>,
    /// Field contents
    pub data: Vec<u8>,
}

impl Multipart {
    /// Create an empty form with a random boundary
    pub fn new() -> Self {
        let mut boundary = String::from("----rust-fetch-");
        for _ in 0..24 {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let digit = (crate::runtime::random() * 16.0) as u32;
            boundary.push(char::from_digit(digit.min(15), 16).unwrap_or('0'));
        }
        Self {
            boundary,
            parts: Vec::new(),
        }
    }

    /// Add a text field
    #[must_use]
    pub fn text(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.parts.push(Part {
            name: name.into(),
            filename: None,
            content_type: None,
            data: value.into().into_bytes(),
        });
        self
    }

    /// Add a file field. `content_type` defaults to `application/octet-stream`.
    #[must_use]
    pub fn file(
        mut self,
        name: impl Into<String>,
        filename: impl Into<String>,
        content_type: Option<String>,
        data: Vec<u8>,
    ) -> Self {
        self.parts.push(Part {
            name: name.into(),
            filename: Some(filename.into()),
            content_type: Some(
                content_type.unwrap_or_else(|| "application/octet-stream".to_string()),
            ),
            data,
        });
        self
    }

    /// The fields added so far
    pub fn parts(&self) -> &[Part] {
        &self.parts
    }

    /// The boundary separating the fields
    pub fn boundary(&self) -> &str {
        &self.boundary
    }

    /// The `Content-Type` header value, including the boundary
    pub fn content_type(&self) -> String {
        format!("multipart/form-data; boundary={}", self.boundary)
    }

    /// Encode the form (RFC 7578)
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for part in &self.parts {
            out.extend_from_slice(format!("--{}\r\n", self.boundary).as_bytes());
            let mut disposition = format!(
                "Content-Disposition: form-data; name=\"{}\"",
                escape_field(&part.name)
            );
            if let Some(filename) = &part.filename {
                disposition.push_str(&format!("; filename=\"{}\"", escape_field(filename)));
            }
            out.extend_from_slice(disposition.as_bytes());
            out.extend_from_slice(b"\r\n");
            if let Some(content_type) = &part.content_type {
                out.extend_from_slice(format!("Content-Type: {content_type}\r\n").as_bytes());
            }
            out.extend_from_slice(b"\r\n");
            out.extend_from_slice(&part.data);
            out.extend_from_slice(b"\r\n");
        }
        out.extend_from_slice(format!("--{}--\r\n", self.boundary).as_bytes());
        out
    }
}

impl Default for Multipart {
    fn default() -> Self {
        Self::new()
    }
}

/// Escape a field or file name the way browsers do for `multipart/form-data`
fn escape_field(value: &str) -> String {
    value
        .replace('"', "%22")
        .replace('\r', "%0D")
        .replace('\n', "%0A")
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
    /// Also retry non-idempotent requests (POST, PATCH). Off by default,
    /// because the server may already have processed the failed attempt.
    pub retry_non_idempotent: bool,
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
            retry_non_idempotent: false,
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

    const ALL_METHODS: [(&str, Method); 9] = [
        ("GET", Method::Get),
        ("POST", Method::Post),
        ("PUT", Method::Put),
        ("DELETE", Method::Delete),
        ("PATCH", Method::Patch),
        ("HEAD", Method::Head),
        ("OPTIONS", Method::Options),
        ("CONNECT", Method::Connect),
        ("TRACE", Method::Trace),
    ];

    #[test]
    fn test_every_method_round_trips() {
        for (name, method) in ALL_METHODS {
            assert_eq!(Method::from_str(name), Some(method));
            assert_eq!(Method::from_str(&name.to_lowercase()), Some(method));
            assert_eq!(method.to_reqwest().as_str(), name);
            assert_eq!(
                serde_json::to_string(&method).unwrap(),
                format!("\"{name}\"")
            );
        }
        assert_eq!(Method::default(), Method::Get);
        assert_eq!(Method::from_str(""), None);
    }

    #[test]
    fn test_request_config_default() {
        let config = RequestConfig::default();
        assert_eq!(config.method, Method::Get);
        assert!(config.body.is_none());
        assert_eq!(config.timeout, Some(Duration::from_secs(30)));
        assert!(config.follow_redirects);
        assert_eq!(config.max_redirects, 10);
        assert_eq!(config.response_format, ResponseFormat::Auto);
        assert!(config.headers.iter().next().is_none());
    }

    #[test]
    fn test_body_encoding_and_content_type() {
        let json = Body::Json(serde_json::json!({"a": [1, "b"]}));
        assert_eq!(json.to_bytes().unwrap(), br#"{"a":[1,"b"]}"#);
        assert_eq!(json.content_type(), "application/json");

        let text = Body::Text("héllo".into());
        assert_eq!(text.to_bytes().unwrap(), "héllo".as_bytes());
        assert_eq!(text.content_type(), "text/plain");

        let binary = Body::Binary(vec![0, 255]);
        assert_eq!(binary.to_bytes().unwrap(), vec![0, 255]);
        assert_eq!(binary.content_type(), "application/octet-stream");

        let form = Body::Form(HashMap::from([("q".to_string(), "a b&c".to_string())]));
        assert_eq!(form.to_bytes().unwrap(), b"q=a+b%26c");
        assert_eq!(form.content_type(), "application/x-www-form-urlencoded");
    }

    #[test]
    fn test_response_body_accessors() {
        let response = |body| Response {
            status: 200,
            status_text: String::new(),
            headers: Headers::new(),
            body,
            url: String::new(),
        };

        let text = response(ResponseBody::Text("hi".into()));
        assert_eq!(text.text(), Some("hi"));
        assert_eq!(text.bytes(), Some(&b"hi"[..]));
        assert!(text.json().is_none());

        let json = response(ResponseBody::Json(serde_json::json!(1)));
        assert_eq!(json.json(), Some(&serde_json::json!(1)));
        assert!(json.text().is_none());
        assert!(json.bytes().is_none());

        let binary = response(ResponseBody::Binary(vec![7]));
        assert_eq!(binary.bytes(), Some(&[7u8][..]));
        assert!(binary.text().is_none());

        let empty = response(ResponseBody::Empty);
        assert!(empty.text().is_none() && empty.json().is_none() && empty.bytes().is_none());
    }

    #[test]
    fn test_response_status_classes() {
        let with_status = |status| Response {
            status,
            status_text: String::new(),
            headers: Headers::new(),
            body: ResponseBody::Empty,
            url: String::new(),
        };
        let classes = |status| {
            let r = with_status(status);
            (
                r.is_success(),
                r.is_redirect(),
                r.is_client_error(),
                r.is_server_error(),
            )
        };
        assert_eq!(classes(204), (true, false, false, false));
        assert_eq!(classes(301), (false, true, false, false));
        assert_eq!(classes(404), (false, false, true, false));
        assert_eq!(classes(503), (false, false, false, true));
        assert_eq!(classes(100), (false, false, false, false));
    }

    #[test]
    fn test_headers_are_case_insensitive() {
        let mut headers = Headers::new();
        headers.insert("X-Token", "a");
        assert!(headers.contains("x-token"));
        assert_eq!(headers.get_first("X-TOKEN"), Some("a"));
        assert_eq!(headers.remove("X-Token"), Some(vec!["a".to_string()]));
        assert_eq!(headers.get_first("x-token"), None);
        assert_eq!(headers.remove("x-token"), None);
    }

    #[test]
    fn test_multipart_encoding() {
        let form = Multipart::new()
            .text("title", "Hello \"world\"")
            .file(
                "upload",
                "a\r\nb.txt",
                Some("text/plain".into()),
                b"file contents".to_vec(),
            )
            .file("raw", "data.bin", None, vec![0, 255]);
        let boundary = form.boundary().to_string();
        assert!(boundary.starts_with("----rust-fetch-") && boundary.len() == 39);
        assert_eq!(
            form.content_type(),
            format!("multipart/form-data; boundary={boundary}")
        );
        assert_eq!(form.parts().len(), 3);

        let mut expected = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\nHello \"world\"\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"upload\"; filename=\"a%0D%0Ab.txt\"\r\nContent-Type: text/plain\r\n\r\nfile contents\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"raw\"; filename=\"data.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .into_bytes();
        expected.extend_from_slice(&[0, 255]);
        expected.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        assert_eq!(form.to_bytes(), expected);

        let quoted = Multipart::default().text("a\"b", "");
        assert!(String::from_utf8(quoted.to_bytes())
            .unwrap()
            .contains("name=\"a%22b\""));
        assert_ne!(Multipart::new().boundary(), Multipart::new().boundary());
        assert_eq!(Multipart::new().to_bytes().len(), 39 + 6);
    }

    #[test]
    fn test_content_type_detection() {
        assert!(is_json_content_type("application/json"));
        assert!(is_json_content_type("Application/JSON; charset=utf-8"));
        assert!(is_json_content_type("application/problem+json"));
        assert!(!is_json_content_type("text/json-ish"));
        assert!(is_text_content_type("text/html; charset=utf-8"));
        assert!(is_text_content_type("application/atom+xml"));
        assert!(!is_text_content_type("application/octet-stream"));
        assert!(!is_text_content_type(""));
        for text in [
            "application/xml",
            "application/javascript",
            "application/x-www-form-urlencoded",
        ] {
            assert!(is_text_content_type(text), "{text}");
        }
    }

    #[test]
    fn test_method_idempotency() {
        assert!(Method::Get.is_idempotent());
        assert!(Method::Put.is_idempotent());
        assert!(Method::Delete.is_idempotent());
        assert!(!Method::Post.is_idempotent());
        assert!(!Method::Patch.is_idempotent());
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
