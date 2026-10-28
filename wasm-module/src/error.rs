//! Error types for the rust-fetch library
//!
//! This module provides comprehensive error handling with detailed context
//! and proper error chaining for better debugging experience.

use std::fmt;

/// Result type alias for the library
pub type Result<T> = std::result::Result<T, Error>;

/// The source of an [`Error::Network`] when a response body is larger than
/// the request allows (`max_response_bytes`, `maxResponseBytes` in JavaScript)
#[derive(Debug)]
pub struct ResponseTooLarge {
    /// The limit, in bytes, of the decompressed body
    pub limit: u64,
}

impl fmt::Display for ResponseTooLarge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "the response body is larger than {} bytes", self.limit)
    }
}

impl std::error::Error for ResponseTooLarge {}

/// The source of an [`Error::Network`] when a line of a streamed format
/// (NDJSON, Server-Sent Events) is longer than `maxLineBytes` allows
#[derive(Debug)]
pub(crate) struct LineTooLong {
    /// The limit, in bytes, of one line without its line break
    pub(crate) limit: usize,
}

impl fmt::Display for LineTooLong {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "a line is longer than {} bytes", self.limit)
    }
}

impl std::error::Error for LineTooLong {}

/// The source of an [`Error::Network`] when a Server-Sent Event's data is
/// larger than `maxEventBytes` allows
#[derive(Debug)]
pub(crate) struct EventTooLarge {
    /// The limit, in bytes, of an event's data (its `data:` lines joined)
    pub(crate) limit: usize,
}

impl fmt::Display for EventTooLarge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "an event's data is larger than {} bytes", self.limit)
    }
}

impl std::error::Error for EventTooLarge {}

/// The source of an [`Error::Network`] when a WebSocket's queue of messages
/// sent before it opened is full (`maxQueuedMessages` or `maxQueuedBytes`)
#[derive(Debug)]
pub(crate) struct QueueFull {
    /// The option that was reached
    pub(crate) option: &'static str,
    pub(crate) limit: usize,
}

impl fmt::Display for QueueFull {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "the queue is full ({} is {})", self.option, self.limit)
    }
}

impl std::error::Error for QueueFull {}

/// The source of an [`Error::Network`] when a client already has as many
/// requests pending as it allows (`max_pending_requests`,
/// `maxPendingRequests` in JavaScript)
#[derive(Debug)]
pub struct TooManyPendingRequests {
    /// The client's limit
    pub limit: usize,
}

impl fmt::Display for TooManyPendingRequests {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "the client already has {} requests pending", self.limit)
    }
}

impl std::error::Error for TooManyPendingRequests {}

impl Error {
    /// A response body larger than `limit` bytes
    pub(crate) fn too_large(limit: u64) -> Self {
        Error::Network {
            message: format!("Response body larger than maxResponseBytes ({limit} bytes)"),
            source: Some(Box::new(ResponseTooLarge { limit })),
        }
    }

    /// The limit, when this is a response that was too large
    pub fn response_too_large(&self) -> Option<u64> {
        match self {
            Error::Network {
                source: Some(source),
                ..
            } => source.downcast_ref::<ResponseTooLarge>().map(|e| e.limit),
            _ => None,
        }
    }

    /// A streamed line longer than `limit` bytes
    pub(crate) fn too_long(limit: usize) -> Self {
        Error::Network {
            message: format!("Line longer than maxLineBytes ({limit} bytes)"),
            source: Some(Box::new(LineTooLong { limit })),
        }
    }

    /// The limit, when a streamed line was longer than `maxLineBytes`
    pub(crate) fn line_too_long(&self) -> Option<usize> {
        match self {
            Error::Network {
                source: Some(source),
                ..
            } => source.downcast_ref::<LineTooLong>().map(|e| e.limit),
            _ => None,
        }
    }

    /// A Server-Sent Event whose data would be larger than `limit` bytes
    pub(crate) fn event_too_large(limit: usize) -> Self {
        Error::Network {
            message: format!("Event larger than maxEventBytes ({limit} bytes)"),
            source: Some(Box::new(EventTooLarge { limit })),
        }
    }

    /// The limit, when a Server-Sent Event's data was larger than `maxEventBytes`
    pub(crate) fn event_too_large_limit(&self) -> Option<usize> {
        match self {
            Error::Network {
                source: Some(source),
                ..
            } => source.downcast_ref::<EventTooLarge>().map(|e| e.limit),
            _ => None,
        }
    }

    /// A WebSocket message refused because `option` (`limit`) was reached
    pub(crate) fn queue_full(option: &'static str, limit: usize) -> Self {
        Error::Network {
            message: format!(
                "The WebSocket isn't open and its send queue is full ({option} is {limit})"
            ),
            source: Some(Box::new(QueueFull { option, limit })),
        }
    }

    /// The option and its limit, when a WebSocket's send queue was full
    pub(crate) fn full_queue(&self) -> Option<(&'static str, usize)> {
        match self {
            Error::Network {
                source: Some(source),
                ..
            } => source
                .downcast_ref::<QueueFull>()
                .map(|e| (e.option, e.limit)),
            _ => None,
        }
    }

    /// A request refused because the client already has `limit` pending
    pub(crate) fn too_many_pending(limit: usize) -> Self {
        Error::Network {
            message: format!("Too many pending requests (maxPendingRequests is {limit})"),
            source: Some(Box::new(TooManyPendingRequests { limit })),
        }
    }

    /// The client's limit, when this request was refused because the client
    /// already had that many pending (see `max_pending_requests`)
    pub fn too_many_pending_requests(&self) -> Option<usize> {
        match self {
            Error::Network {
                source: Some(source),
                ..
            } => source
                .downcast_ref::<TooManyPendingRequests>()
                .map(|e| e.limit),
            _ => None,
        }
    }
}

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

    /// Details when an opt-in circuit breaker refused this request.
    pub fn circuit_open(&self) -> Option<&crate::CircuitOpenError> {
        match self {
            Self::Network {
                source: Some(source),
                ..
            } => source.downcast_ref(),
            _ => None,
        }
    }

    /// Get the error kind as a string (useful for JS interop)
    pub fn kind(&self) -> &'static str {
        if self.circuit_open().is_some() {
            return "CircuitOpenError";
        }
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
        if self.circuit_open().is_some() {
            return false;
        }
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
                // These limits' messages already say everything
                if let Some(src) = source.as_ref().filter(|s| {
                    !s.is::<ResponseTooLarge>()
                        && !s.is::<TooManyPendingRequests>()
                        && !s.is::<LineTooLong>()
                        && !s.is::<QueueFull>()
                        && !s.is::<EventTooLarge>()
                }) {
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
    fn response_too_large_reads_on_its_own_and_in_the_error() {
        assert_eq!(
            ResponseTooLarge { limit: 5 }.to_string(),
            "the response body is larger than 5 bytes"
        );
        let error = Error::too_large(5);
        assert_eq!(
            error.to_string(),
            "Network error: Response body larger than maxResponseBytes (5 bytes)"
        );
        assert_eq!(error.response_too_large(), Some(5));
        assert_eq!(error.too_many_pending_requests(), None);
    }

    #[test]
    fn line_too_long_reads_on_its_own_and_in_the_error() {
        assert_eq!(
            LineTooLong { limit: 8 }.to_string(),
            "a line is longer than 8 bytes"
        );
        let error = Error::too_long(8);
        assert_eq!(
            error.to_string(),
            "Network error: Line longer than maxLineBytes (8 bytes)"
        );
        assert_eq!(error.line_too_long(), Some(8));
        assert_eq!(error.response_too_large(), None);
        assert_eq!(Error::Timeout { duration_ms: 1 }.line_too_long(), None);
    }

    #[test]
    fn event_too_large_reads_on_its_own_and_in_the_error() {
        assert_eq!(
            EventTooLarge { limit: 4 }.to_string(),
            "an event's data is larger than 4 bytes"
        );
        let error = Error::event_too_large(4);
        assert_eq!(
            error.to_string(),
            "Network error: Event larger than maxEventBytes (4 bytes)"
        );
        assert_eq!(error.event_too_large_limit(), Some(4));
        assert_eq!(error.line_too_long(), None);
        assert_eq!(Error::Cancelled.event_too_large_limit(), None);
    }

    #[test]
    fn queue_full_reads_on_its_own_and_in_the_error() {
        let full = QueueFull {
            option: "maxQueuedBytes",
            limit: 10,
        };
        assert_eq!(full.to_string(), "the queue is full (maxQueuedBytes is 10)");
        let error = Error::queue_full("maxQueuedMessages", 2);
        assert_eq!(
            error.to_string(),
            "Network error: The WebSocket isn't open and its send queue is full (maxQueuedMessages is 2)"
        );
        assert_eq!(error.full_queue(), Some(("maxQueuedMessages", 2)));
        assert_eq!(error.line_too_long(), None);
        assert_eq!(Error::Timeout { duration_ms: 1 }.full_queue(), None);
    }

    #[test]
    fn too_many_pending_reads_on_its_own_and_in_the_error() {
        assert_eq!(
            TooManyPendingRequests { limit: 2 }.to_string(),
            "the client already has 2 requests pending"
        );
        let error = Error::too_many_pending(2);
        assert_eq!(
            error.to_string(),
            "Network error: Too many pending requests (maxPendingRequests is 2)"
        );
        assert_eq!(error.too_many_pending_requests(), Some(2));
        assert_eq!(error.response_too_large(), None);
        assert_eq!(
            Error::Timeout { duration_ms: 1 }.too_many_pending_requests(),
            None
        );
    }

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
