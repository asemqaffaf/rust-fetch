//! Error types for the rust-fetch library
//!
//! This module provides comprehensive error handling with detailed context
//! and proper error chaining for better debugging experience.

use std::fmt;

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
                if let Some(body) = body.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
                    // Keep messages readable when the server returns a full HTML page;
                    // the complete body stays available on the error itself.
                    const MAX_CHARS: usize = 200;
                    match body.char_indices().nth(MAX_CHARS) {
                        Some((end, _)) => write!(f, " - {}…", &body[..end])?,
                        None => write!(f, " - {}", body)?,
                    }
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

/// Convert from reqwest errors
impl From<reqwest::Error> for Error {
    fn from(err: reqwest::Error) -> Self {
        if err.is_builder() {
            Error::InvalidInput {
                parameter: "request".to_string(),
                reason: error_chain(&err),
            }
        } else if err.is_timeout() {
            // Timeouts are enforced by the client itself, which reports the
            // configured duration; this only covers reqwest-internal ones.
            Error::Timeout { duration_ms: 0 }
        } else if err.is_decode() {
            Error::Parse {
                message: "Failed to decode response".to_string(),
                source: Some(Box::new(err)),
            }
        } else if err.is_redirect() {
            // A redirect that isn't allowed, with the reason from the policy
            Error::Network {
                message: error_chain(&err),
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

/// An error's message followed by its causes, e.g. "builder error: invalid header name"
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let cause_message = cause.to_string();
        if !message.contains(&cause_message) {
            message = format!("{message}: {cause_message}");
        }
        source = cause.source();
    }
    message
}

/// Convert from serde_json errors
impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Error::Parse {
            message: "JSON parsing error".to_string(),
            source: Some(Box::new(err)),
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

    fn io_error() -> std::io::Error {
        std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "refused")
    }

    fn all_variants() -> Vec<Error> {
        vec![
            Error::network("connect failed", io_error()),
            Error::Http {
                status: 404,
                status_text: "Not Found".into(),
                body: None,
            },
            Error::parse("bad json", io_error()),
            Error::Timeout { duration_ms: 1500 },
            Error::InvalidInput {
                parameter: "url".into(),
                reason: "missing scheme".into(),
            },
            Error::JsInterop {
                message: "boom".into(),
            },
            Error::Cancelled,
        ]
    }

    #[test]
    fn test_display_and_kind_for_every_variant() {
        let expected = [
            (
                "NetworkError",
                "Network error: connect failed (caused by: refused)",
            ),
            ("HttpError", "HTTP error 404: Not Found"),
            ("ParseError", "Parse error: bad json (caused by: refused)"),
            ("TimeoutError", "Request timeout after 1500ms"),
            (
                "InvalidInputError",
                "Invalid input for 'url': missing scheme",
            ),
            ("JsInteropError", "JavaScript interop error: boom"),
            ("CancelledError", "Request was cancelled"),
        ];
        for (error, (kind, message)) in all_variants().iter().zip(expected) {
            assert_eq!(error.kind(), kind);
            assert_eq!(error.to_string(), message);
        }

        let parse = Error::Parse {
            message: "no source".into(),
            source: None,
        };
        assert_eq!(parse.to_string(), "Parse error: no source");
    }

    #[test]
    fn test_http_error_display_body() {
        let with_body = |body: Option<&str>| {
            Error::Http {
                status: 400,
                status_text: "Bad Request".into(),
                body: body.map(String::from),
            }
            .to_string()
        };
        assert_eq!(
            with_body(Some("  missing field  ")),
            "HTTP error 400: Bad Request - missing field"
        );
        assert_eq!(with_body(Some("   ")), "HTTP error 400: Bad Request");
        assert_eq!(with_body(None), "HTTP error 400: Bad Request");
    }

    #[test]
    fn test_error_source() {
        use std::error::Error as _;
        for error in all_variants() {
            let has_source = matches!(error, Error::Network { .. } | Error::Parse { .. });
            assert_eq!(error.source().is_some(), has_source, "{error}");
        }
        let no_source = Error::Network {
            message: String::new(),
            source: None,
        };
        assert!(no_source.source().is_none());
    }

    #[test]
    fn test_retryable_kinds() {
        let retryable: Vec<_> = all_variants().iter().map(Error::is_retryable).collect();
        assert_eq!(
            retryable,
            vec![true, false, false, true, false, false, false]
        );
        for status in [408, 429, 500, 599] {
            assert!(Error::Http {
                status,
                status_text: String::new(),
                body: None
            }
            .is_retryable());
        }
    }

    #[test]
    fn test_error_chain() {
        // reqwest's Display omits the cause; the chain appends it
        let builder = reqwest::Client::new()
            .get("http://exa mple.com")
            .build()
            .unwrap_err();
        assert_eq!(builder.to_string(), "builder error");
        assert_eq!(
            error_chain(&builder),
            "builder error: invalid international domain name"
        );
        let error = Error::from(builder);
        let expected = "builder error: invalid international domain name";
        assert!(matches!(&error, Error::InvalidInput { reason, .. } if reason == expected));

        // Causes already included in the message aren't repeated
        let network = Error::network("outer", io_error());
        assert_eq!(
            error_chain(&network),
            "Network error: outer (caused by: refused)"
        );
    }

    #[test]
    fn test_from_serde_json() {
        let error: Error = serde_json::from_str::<serde_json::Value>("{")
            .unwrap_err()
            .into();
        assert!(matches!(
            error,
            Error::Parse {
                source: Some(_),
                ..
            }
        ));
        assert!(error
            .to_string()
            .starts_with("Parse error: JSON parsing error"));
    }

    #[test]
    fn test_http_error_display_truncates_body() {
        let error = Error::Http {
            status: 500,
            status_text: "Internal Server Error".to_string(),
            body: Some("é".repeat(500)),
        };
        let message = error.to_string();
        assert!(message.starts_with("HTTP error 500: Internal Server Error - éé"));
        assert!(message.ends_with('…'));
        assert!(message.chars().count() < 260);
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
