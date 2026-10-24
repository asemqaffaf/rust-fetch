//! Splits a byte stream into lines for newline-delimited formats (NDJSON /
//! JSON Lines). Lines end with `\n` (an optional `\r` before it is removed);
//! empty lines are skipped. Splitting happens on bytes, so a multi-byte
//! UTF-8 character split between chunks is never broken. With a limit, a
//! line longer than that many bytes (without its line break) is an error
//! before it's buffered, so a line can't grow without bound.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use crate::error::{Error, Result};

/// An incremental line splitter
#[derive(Debug, Default)]
pub(crate) struct Lines {
    /// Bytes of the current, incomplete line
    partial: Vec<u8>,
    /// Lines returned so far, for error messages
    count: usize,
    /// `maxLineBytes`
    limit: Option<usize>,
}

/// One complete line and its 1-based number
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Line {
    pub(crate) number: usize,
    pub(crate) text: String,
}

impl Lines {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// With a limit on the bytes in one line, line break excluded
    pub(crate) fn with_limit(limit: Option<usize>) -> Self {
        Self {
            limit,
            ..Self::default()
        }
    }

    /// Feed a chunk; returns the non-empty lines it completes, and an error
    /// for a line over the limit (after the lines before it)
    pub(crate) fn feed(&mut self, chunk: &[u8]) -> (Vec<Line>, Option<Error>) {
        let mut lines = Vec::new();
        let mut rest = chunk;
        while let Some(end) = rest.iter().position(|&b| b == b'\n') {
            if let Err(error) = self.check(&rest[..end]) {
                return (lines, Some(error));
            }
            self.partial.extend_from_slice(&rest[..end]);
            rest = &rest[end + 1..];
            let line = std::mem::take(&mut self.partial);
            if let Some(line) = self.complete(&line) {
                lines.push(line);
            }
        }
        if let Err(error) = self.check(rest) {
            return (lines, Some(error));
        }
        self.partial.extend_from_slice(rest);
        (lines, None)
    }

    /// Fail if `more` would take the current line over the limit. A `\r` at
    /// the end may belong to a `\r\n` line break, so it isn't counted.
    fn check(&self, more: &[u8]) -> Result<()> {
        let Some(limit) = self.limit else {
            return Ok(());
        };
        let last = more.last().or(self.partial.last());
        let length = self.partial.len() + more.len() - usize::from(last == Some(&b'\r'));
        if length > limit {
            return Err(Error::too_long(limit));
        }
        Ok(())
    }

    /// The last line, if the stream didn't end with a newline
    pub(crate) fn finish(&mut self) -> Option<Line> {
        let line = std::mem::take(&mut self.partial);
        self.complete(&line)
    }

    fn complete(&mut self, line: &[u8]) -> Option<Line> {
        self.count += 1;
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let text = String::from_utf8_lossy(line);
        if text.trim().is_empty() {
            return None;
        }
        Some(Line {
            number: self.count,
            text: text.into_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(number: usize, text: &str) -> Line {
        Line {
            number,
            text: text.to_string(),
        }
    }

    #[test]
    fn splits_lines_across_chunks_and_skips_empty_ones() {
        let mut lines = Lines::new();
        let mut out = lines.feed(b"{\"a\":1}\r\n\n{\"b\"").0;
        out.extend(lines.feed(b":2}\n  \n").0);
        out.extend(lines.finish());
        assert_eq!(out, vec![line(1, "{\"a\":1}"), line(3, "{\"b\":2}")]);
    }

    #[test]
    fn returns_a_final_line_without_a_newline() {
        let mut lines = Lines::new();
        assert_eq!(lines.feed(b"1\n2").0, vec![line(1, "1")]);
        assert_eq!(lines.finish(), Some(line(2, "2")));
        assert_eq!(lines.finish(), None);
    }

    #[test]
    fn keeps_multibyte_characters_split_across_chunks() {
        let bytes = "\"Zoë 🦀\"\n".as_bytes();
        let mut lines = Lines::new();
        let mut out = Vec::new();
        for byte in bytes.chunks(1) {
            out.extend(lines.feed(byte).0);
        }
        assert_eq!(out, vec![line(1, "\"Zoë 🦀\"")]);
    }

    #[test]
    fn limits_lines_without_counting_the_line_break() {
        // Exactly at the limit, with \n or \r\n (even split across chunks), or unterminated
        let mut lines = Lines::with_limit(Some(4));
        assert_eq!(lines.feed(b"1234\n12").0, vec![line(1, "1234")]);
        assert_eq!(lines.feed(b"34\r").0, vec![]);
        assert_eq!(lines.feed(b"\n1234").0, vec![line(2, "1234")]);
        assert_eq!(lines.finish(), Some(line(3, "1234")));
        // One byte over: in one chunk, across chunks, or with a \r that turned out not to end the line
        for chunks in [
            &[&b"12345\n"[..]][..],
            &[b"12", b"34", b"5"],
            &[b"1234\r", b"5"],
        ] {
            let mut lines = Lines::with_limit(Some(4));
            let error = chunks.iter().find_map(|chunk| lines.feed(chunk).1).unwrap();
            assert_eq!(error.line_too_long(), Some(4));
        }
        // Multi-byte characters count as their UTF-8 bytes
        assert!(Lines::with_limit(Some(4))
            .feed("ë🦀".as_bytes())
            .1
            .is_some());
        assert!(Lines::with_limit(Some(6))
            .feed("ë🦀\n".as_bytes())
            .1
            .is_none());
        // Lines before the long one in the same chunk are still returned
        let (lines, error) = Lines::with_limit(Some(4)).feed(b"1\n2\n12345\n3\n");
        assert_eq!(
            (lines, error.unwrap().line_too_long()),
            (vec![line(1, "1"), line(2, "2")], Some(4))
        );
    }

    #[test]
    fn an_endless_line_never_buffers_past_the_limit() {
        let mut lines = Lines::with_limit(Some(1024));
        let mut fed = 0;
        let error = loop {
            match lines.feed(&[b'x'; 100]) {
                (_, None) => fed += 100,
                (_, Some(error)) => break error,
            }
            assert!(lines.partial.len() <= 1024);
        };
        assert_eq!((fed, error.line_too_long()), (1000, Some(1024)));
    }
}
