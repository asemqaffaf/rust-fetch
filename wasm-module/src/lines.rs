//! Splits a byte stream into lines for newline-delimited formats (NDJSON /
//! JSON Lines). Lines end with `\n` (an optional `\r` before it is removed);
//! empty lines are skipped. Splitting happens on bytes, so a multi-byte
//! UTF-8 character split between chunks is never broken.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

/// An incremental line splitter
#[derive(Debug, Default)]
pub(crate) struct Lines {
    /// Bytes of the current, incomplete line
    partial: Vec<u8>,
    /// Lines returned so far, for error messages
    count: usize,
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

    /// Feed a chunk; returns the non-empty lines it completes
    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Vec<Line> {
        let mut lines = Vec::new();
        let mut rest = chunk;
        while let Some(end) = rest.iter().position(|&b| b == b'\n') {
            self.partial.extend_from_slice(&rest[..end]);
            rest = &rest[end + 1..];
            let line = std::mem::take(&mut self.partial);
            if let Some(line) = self.complete(&line) {
                lines.push(line);
            }
        }
        self.partial.extend_from_slice(rest);
        lines
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
        let mut out = lines.feed(b"{\"a\":1}\r\n\n{\"b\"");
        out.extend(lines.feed(b":2}\n  \n"));
        out.extend(lines.finish());
        assert_eq!(out, vec![line(1, "{\"a\":1}"), line(3, "{\"b\":2}")]);
    }

    #[test]
    fn returns_a_final_line_without_a_newline() {
        let mut lines = Lines::new();
        assert_eq!(lines.feed(b"1\n2"), vec![line(1, "1")]);
        assert_eq!(lines.finish(), Some(line(2, "2")));
        assert_eq!(lines.finish(), None);
    }

    #[test]
    fn keeps_multibyte_characters_split_across_chunks() {
        let bytes = "\"Zoë 🦀\"\n".as_bytes();
        let mut lines = Lines::new();
        let mut out = Vec::new();
        for byte in bytes.chunks(1) {
            out.extend(lines.feed(byte));
        }
        assert_eq!(out, vec![line(1, "\"Zoë 🦀\"")]);
    }
}
