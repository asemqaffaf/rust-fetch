//! Harnesses for the actual parsers. No networking is performed.
#![allow(clippy::missing_panics_doc)]

fn sse(bytes: &[u8], chunk: usize) -> (Vec<crate::sse::Event>, Option<u64>, bool) {
    let mut parser = crate::sse::Parser::with_limit(Some(4096)).event_limit(Some(16384));
    let mut events = Vec::new();
    for part in bytes.chunks(chunk) {
        let (ready, error) = parser.feed(part);
        events.extend(ready);
        if error.is_some() {
            return (events, parser.take_retry(), true);
        }
    }
    (events, parser.take_retry(), false)
}

/// Chunk boundaries must not change events, retry fields or limit failures.
pub fn fuzz_sse(input: &[u8]) {
    let Some((&control, bytes)) = input.split_first() else {
        return;
    };
    assert_eq!(
        sse(bytes, bytes.len().max(1)),
        sse(bytes, usize::from(control) + 1)
    );
}

fn lines(bytes: &[u8], chunk: usize) -> (Vec<crate::lines::Line>, bool) {
    let mut parser = crate::lines::Lines::with_limit(Some(4096));
    let mut lines = Vec::new();
    for part in bytes.chunks(chunk) {
        let (ready, error) = parser.feed(part);
        lines.extend(ready);
        if error.is_some() {
            return (lines, true);
        }
    }
    lines.extend(parser.finish());
    (lines, false)
}

/// UTF-8, CRLF and long-line handling must be independent of chunking.
pub fn fuzz_lines(input: &[u8]) {
    let Some((&control, bytes)) = input.split_first() else {
        return;
    };
    assert_eq!(
        lines(bytes, bytes.len().max(1)),
        lines(bytes, usize::from(control) + 1)
    );
}

/// Retry-After must reject invalid and overflowing numbers without panicking.
pub fn fuzz_retry_after(bytes: &[u8]) {
    if let Ok(value) = std::str::from_utf8(bytes) {
        if let Some(delay) = crate::client::parse_retry_after(value) {
            assert_eq!(value.trim().parse::<u64>().ok(), Some(delay.as_secs()));
        }
    }
}

/// URL resolution and redirect references must preserve destination guards.
pub fn fuzz_urls(bytes: &[u8]) {
    let Ok(value) = std::str::from_utf8(bytes) else {
        return;
    };
    let (base, path) = value
        .split_once('\n')
        .unwrap_or(("https://example.test/base", value));
    let query = [("q".to_string(), value.to_string())];
    if let Ok(url) = crate::client::resolve_url(Some(base), None, path, &query) {
        assert!(matches!(url.scheme(), "http" | "https"));
        assert!(crate::url::Url::parse(url.as_str()).is_ok());
    }
    if crate::url::Url::parse(path).is_ok() {
        assert!(crate::client::check_absolute_url(Some(base), path, false).is_err());
    }
    if let Ok(base) = crate::url::Url::parse(base) {
        let _ = base.join(path);
    }
}

/// Header parsers used by both Rust and Wasm must reject line injection.
pub fn fuzz_headers(bytes: &[u8]) {
    let split = bytes.len() / 2;
    let name = reqwest::header::HeaderName::from_bytes(&bytes[..split]);
    let value = reqwest::header::HeaderValue::from_bytes(&bytes[split..]);
    if let Ok(name) = name {
        assert!(!name.as_str().contains(['\r', '\n', ':', ' ']));
    }
    if let Ok(value) = value {
        assert!(!value
            .as_bytes()
            .iter()
            .any(|b| matches!(*b, 0 | b'\r' | b'\n')));
    }
    if let Ok(value) = std::str::from_utf8(bytes) {
        let _ = crate::types::Method::from_str(value);
    }
}

/// Multipart serialization must preserve bytes and escape disposition metadata.
pub fn fuzz_multipart(bytes: &[u8]) {
    let split = bytes.len() / 2;
    let name = String::from_utf8_lossy(&bytes[..split]);
    let form = crate::Multipart::new().file(
        name.to_string(),
        name.to_string(),
        None,
        bytes[split..].to_vec(),
    );
    let encoded = form.to_bytes();
    let header_end = encoded.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let start = header_end + 4;
    assert_eq!(
        &encoded[start..start + bytes.len() - split],
        &bytes[split..]
    );
    assert_eq!(
        String::from_utf8_lossy(&encoded[..header_end])
            .lines()
            .count(),
        3
    );
    assert!(encoded.ends_with(format!("\r\n--{}--\r\n", form.boundary()).as_bytes()));
}

#[cfg(test)]
mod tests {
    #[test]
    fn corpus() {
        for input in [
            b"\0data: hello\r\n\r\nretry: 100\r\n".as_slice(),
            b"\x01\xef\xbb\xbfdata: \xf0\x9f\x8c\x8d\n\n",
            b"\0\xff\r\n{}\n",
            &[42; 8192],
        ] {
            super::fuzz_sse(input);
            super::fuzz_lines(input);
            super::fuzz_retry_after(input);
            super::fuzz_urls(input);
            super::fuzz_headers(input);
            super::fuzz_multipart(input);
        }
    }
}
