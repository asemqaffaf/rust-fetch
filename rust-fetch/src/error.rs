//! Error types for the rust-fetch library
//!
//! This module provides comprehensive error handling with detailed context
//! and proper error chaining for better debugging experience.

use std::fmt;
use wasm_bindgen::prelude::*;

/// Result type alias for the library
pub type Result<T> = std::result::Result<T, Error>;

/// Main error type for the library
#[derive(Debug)]
pub enum Error {
    /// Network-related errors (connection failures, timeouts, etc.)
    Network {
        message: String,
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// HTTP errors with status codes
    Http {
        status: u16,
        status_text: String,
        body: Option<String>,
    },

    /// Parsing errors (JSON, headers, etc.)
    Parse {
        message: String,
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// Request timeout
    Timeout { duration_ms: u64 },

    /// Invalid input parameters
    InvalidInput { parameter: String, reason: String },

    /// JavaScript interop errors
    JsInterop { message: String },

    /// Request was cancelled
    Cancelled,
}

impl Error {
    /// Create a network error with a source
    pub fn network<E: std::error::Error + Send + Sync + 'static>(
        message: impl Into<String>,
        source: E,
    ) -> Self {
        Error::Network {
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }

    /// Create a parse error with a source
    pub fn parse<E: std::error::Error + Send + Sync + 'static>(
        message: impl Into<String>,
        source: E,
    ) -> Self {
        Error::Parse {
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }

    /// Get the error kind as a string (useful for JS interop)
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Network { .. } => "NetworkError",
            Error::Http { .. } => "HttpError",
            Error::Parse { .. } => "ParseError",
            Error::Timeout { .. } => "TimeoutError",
            Error::InvalidInput { .. } => "InvalidInputError",
            Error::JsInterop { .. } => "JsInteropError",
            Error::Cancelled => "CancelledError",
        }
    }

    /// Check if this is a retryable error
    pub fn is_retryable(&self) -> bool {
        match self {
            Error::Network { .. } => true,
            Error::Timeout { .. } => true,
            Error::Http { status, .. } => {
                // Retry on 5xx errors and specific 4xx errors
                matches!(status, 500..=599 | 408 | 429)
            }
            _ => false,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Network { message, source } => {
                write!(f, "Network error: {}", message)?;
                if let Some(src) = source {
                    write!(f, " (caused by: {})", src)?;
                }
                Ok(())
            }
            Error::Http {
                status,
                status_text,
                body,
            } => {
                write!(f, "HTTP error {}: {}", status, status_text)?;
                if let Some(body) = body {
                    write!(f, " - {}", body)?;
                }
                Ok(())
            }
            Error::Parse { message, source } => {
                write!(f, "Parse error: {}", message)?;
                if let Some(src) = source {
                    write!(f, " (caused by: {})", src)?;
                }
                Ok(())
            }
            Error::Timeout { duration_ms } => {
                write!(f, "Request timeout after {}ms", duration_ms)
            }
            Error::InvalidInput { parameter, reason } => {
                write!(f, "Invalid input for '{}': {}", parameter, reason)
            }
            Error::JsInterop { message } => {
                write!(f, "JavaScript interop error: {}", message)
            }
            Error::Cancelled => {
                write!(f, "Request was cancelled")
            }
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Network { source, .. } | Error::Parse { source, .. } => source
                .as_ref()
                .map(|s| s.as_ref() as &(dyn std::error::Error + 'static)),
            _ => None,
        }
    }
}

/// Convert Error to JsValue for WASM boundary
impl From<Error> for JsValue {
    fn from(error: Error) -> Self {
        // Create a JavaScript error object with detailed information
        let obj = js_sys::Object::new();

        // Set error properties
        let _ = js_sys::Reflect::set(&obj, &"kind".into(), &error.kind().into());
        let _ = js_sys::Reflect::set(&obj, &"message".into(), &error.to_string().into());

        // Add additional context based on error type
        match &error {
            Error::Http {
                status,
                status_text,
                body,
            } => {
                let _ = js_sys::Reflect::set(&obj, &"status".into(), &(*status as f64).into());
                let _ = js_sys::Reflect::set(&obj, &"statusText".into(), &status_text.into());
                if let Some(body) = body {
                    let _ = js_sys::Reflect::set(&obj, &"body".into(), &body.into());
                }
            }
            Error::Timeout { duration_ms } => {
                let _ =
                    js_sys::Reflect::set(&obj, &"timeoutMs".into(), &(*duration_ms as f64).into());
            }
            Error::InvalidInput { parameter, .. } => {
                let _ = js_sys::Reflect::set(&obj, &"parameter".into(), &parameter.into());
            }
            _ => {}
        }

        obj.into()
    }
}

/// Convert from reqwest errors
impl From<reqwest::Error> for Error {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Error::Timeout { duration_ms: 30000 } // Default timeout
        } else if err.is_decode() {
            Error::Parse {
                message: "Failed to decode response".to_string(),
                source: Some(Box::new(err)),
            }
        } else if let Some(status) = err.status() {
            Error::Http {
                status: status.as_u16(),
                status_text: status.canonical_reason().unwrap_or("Unknown").to_string(),
                body: None,
            }
        } else {
            Error::Network {
                message: "Request failed".to_string(),
                source: Some(Box::new(err)),
            }
        }
    }
}

/// Convert from serde_json errors
impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Error::Parse {
            message: "JSON parsing failed".to_string(),
            source: Some(Box::new(err)),
        }
    }
}

/// Convert from serde_wasm_bindgen errors
impl From<serde_wasm_bindgen::Error> for Error {
    fn from(err: serde_wasm_bindgen::Error) -> Self {
        Error::Parse {
            message: format!("WASM binding serialization failed: {}", err),
            source: None, // serde_wasm_bindgen::Error doesn't implement Send + Sync
        }
    }
}

/// Convert from JsValue for error propagation
impl From<JsValue> for Error {
    fn from(value: JsValue) -> Self {
        Error::JsInterop {
            message: format!("JavaScript error: {:?}", value),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let error = Error::Network {
            message: "Connection refused".to_string(),
            source: None,
        };
        assert_eq!(error.to_string(), "Network error: Connection refused");
    }

    #[test]
    fn test_error_kind() {
        let error = Error::Timeout { duration_ms: 5000 };
        assert_eq!(error.kind(), "TimeoutError");
    }

    #[test]
    fn test_is_retryable() {
        assert!(Error::Network {
            message: "".to_string(),
            source: None
        }
        .is_retryable());
        assert!(Error::Http {
            status: 503,
            status_text: "".to_string(),
            body: None
        }
        .is_retryable());
        assert!(!Error::Http {
            status: 400,
            status_text: "".to_string(),
            body: None
        }
        .is_retryable());
    }
}
