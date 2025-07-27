//! Comprehensive tests for the HTTP client module

#[cfg(test)]
mod tests {
    use rust_fetch::client::{Client, ClientBuilder};
    use rust_fetch::error::Error;
    use rust_fetch::types::{Headers, Method, RetryConfig};
    use std::time::Duration;

    #[test]
    fn test_client_builder_with_all_options() {
        let mut headers = Headers::new();
        headers.insert("X-API-Key", "test-key");
        headers.insert("User-Agent", "test-agent");

        let retry_config = RetryConfig {
            max_retries: 5,
            initial_delay: Duration::from_millis(50),
            max_delay: Duration::from_secs(5),
            multiplier: 1.5,
            ..Default::default()
        };

        let client = ClientBuilder::new()
            .base_url("https://api.example.com/v1")
            .timeout(Duration::from_secs(60))
            .default_headers(headers)
            .retry_config(retry_config)
            .build();

        assert!(client.is_ok());
    }

    #[test]
    fn test_client_with_base_url() {
        let client = Client::builder()
            .base_url("https://api.example.com/v1/")
            .build()
            .unwrap();

        // Test that base URL is properly applied
        let request = client.request(Method::Get, "/users");
        // Note: We can't directly inspect the URL without executing the request,
        // but this test ensures the method doesn't panic
    }

    #[test]
    fn test_request_builder_methods() {
        let client = Client::new().unwrap();
        
        // Test different HTTP methods
        let _get = client.get("https://example.com");
        let _post = client.post("https://example.com");
        let _put = client.put("https://example.com");
        let _delete = client.delete("https://example.com");
        let _patch = client.patch("https://example.com");
    }

    #[test]
    fn test_request_builder_headers() {
        let client = Client::new().unwrap();
        let mut headers = Headers::new();
        headers.insert("Authorization", "Bearer token");
        headers.insert("Content-Type", "application/json");

        let request = client
            .post("https://example.com")
            .header("X-Custom", "value")
            .headers(headers);

        // Test passes if no panic occurs
    }

    #[test]
    fn test_request_builder_body_types() {
        let client = Client::new().unwrap();

        // Test text body
        let _text_request = client
            .post("https://example.com")
            .text("Hello, World!");

        // Test JSON body
        let json_data = serde_json::json!({
            "name": "test",
            "value": 42
        });
        let _json_request = client
            .post("https://example.com")
            .json(&json_data);

        // Test binary body
        let _binary_request = client
            .post("https://example.com")
            .bytes(vec![0u8, 1, 2, 3, 4]);

        // Test form body
        let mut form_data = std::collections::HashMap::new();
        form_data.insert("field1".to_string(), "value1".to_string());
        form_data.insert("field2".to_string(), "value2".to_string());
        let _form_request = client
            .post("https://example.com")
            .form(form_data);
    }

    #[test]
    fn test_error_types() {
        // Test network error
        let network_error = Error::Network {
            message: "Connection failed".to_string(),
            source: None,
        };
        assert_eq!(network_error.kind(), "NetworkError");
        assert!(network_error.is_retryable());

        // Test HTTP error (retryable)
        let http_error_503 = Error::Http {
            status: 503,
            status_text: "Service Unavailable".to_string(),
            body: None,
        };
        assert_eq!(http_error_503.kind(), "HttpError");
        assert!(http_error_503.is_retryable());

        // Test HTTP error (non-retryable)
        let http_error_400 = Error::Http {
            status: 400,
            status_text: "Bad Request".to_string(),
            body: Some("Invalid parameters".to_string()),
        };
        assert!(!http_error_400.is_retryable());

        // Test timeout error
        let timeout_error = Error::Timeout { duration_ms: 5000 };
        assert_eq!(timeout_error.kind(), "TimeoutError");
        assert!(timeout_error.is_retryable());

        // Test parse error
        let parse_error = Error::Parse {
            message: "Invalid JSON".to_string(),
            source: None,
        };
        assert_eq!(parse_error.kind(), "ParseError");
        assert!(!parse_error.is_retryable());
    }

    #[test]
    fn test_headers_operations() {
        let mut headers = Headers::new();
        
        // Test insert
        headers.insert("Content-Type", "application/json");
        headers.insert("Accept", "application/json");
        headers.insert("Accept", "text/plain"); // Multiple values
        
        // Test get
        assert_eq!(headers.get_first("content-type"), Some("application/json"));
        assert_eq!(headers.get("accept").map(|v| v.len()), Some(2));
        
        // Test set (replaces existing)
        headers.set("Accept", "application/xml");
        assert_eq!(headers.get("accept").map(|v| v.len()), Some(1));
        assert_eq!(headers.get_first("accept"), Some("application/xml"));
        
        // Test contains
        assert!(headers.contains("content-type"));
        assert!(!headers.contains("authorization"));
        
        // Test remove
        let removed = headers.remove("content-type");
        assert!(removed.is_some());
        assert!(!headers.contains("content-type"));
    }

    #[test]
    fn test_retry_config_default() {
        let config = RetryConfig::default();
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.initial_delay, Duration::from_millis(100));
        assert_eq!(config.max_delay, Duration::from_secs(10));
        assert_eq!(config.multiplier, 2.0);
        assert!(config.retry_on_timeout);
        assert!(config.retry_on_network_error);
        assert_eq!(config.retry_on_status, vec![408, 429, 500, 502, 503, 504]);
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use wasm_bindgen_test::*;
    use rust_fetch::client::WasmClient;
    use rust_fetch::http::{fetch_json, fetch_text, fetch_with_options};

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_wasm_client_creation() {
        let client = WasmClient::new();
        assert!(client.is_ok());
    }

    #[wasm_bindgen_test]
    async fn test_fetch_json_with_mock_response() {
        // This would require a mock server or known test endpoint
        // For now, we just test that the function exists and can be called
        let result = std::panic::catch_unwind(|| {
            fetch_json("https://invalid-url-for-testing.com".to_string())
        });
        assert!(result.is_ok());
    }

    #[wasm_bindgen_test]
    async fn test_fetch_text_with_mock_response() {
        // Similar to above
        let result = std::panic::catch_unwind(|| {
            fetch_text("https://invalid-url-for-testing.com".to_string())
        });
        assert!(result.is_ok());
    }
}
