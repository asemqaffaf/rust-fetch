//! Validation shared by the Rust API and JavaScript bindings.

use crate::error::{Error, Result};

pub(crate) fn validate_key(key: &str) -> Result<()> {
    if key.is_empty() || !key.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(Error::InvalidInput {
            parameter: "idempotencyKey".to_string(),
            reason: "must be a non-empty string of visible ASCII characters (no whitespace)"
                .to_string(),
        });
    }
    Ok(())
}

pub(crate) fn validate_header(name: &str) -> Result<()> {
    reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
        Error::InvalidInput {
            parameter: "idempotencyHeader".to_string(),
            reason: error.to_string(),
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_and_headers_are_validated_before_sending() {
        validate_key("order-42/+==").unwrap();
        validate_header("X-Request-Key").unwrap();
        for key in ["", " ", "a b", "a\r\nb", "a\0", "é"] {
            assert!(
                matches!(validate_key(key), Err(Error::InvalidInput { parameter, .. }) if parameter == "idempotencyKey")
            );
        }
        for header in ["", "a b", "x:key", "x\r\n"] {
            assert!(
                matches!(validate_header(header), Err(Error::InvalidInput { parameter, .. }) if parameter == "idempotencyHeader")
            );
        }
    }
}
