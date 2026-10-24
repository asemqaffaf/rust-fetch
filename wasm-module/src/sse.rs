//! Server-Sent Events parsing, as specified by the WHATWG HTML standard
//! ("Server-sent events", *Parsing an event stream*).
//!
//! Bytes are fed in chunks as they arrive; lines are split on `\r\n`, `\n`
//! or `\r` (also across chunk boundaries) and decoded as UTF-8 only once
//! complete, so a multi-byte character split between chunks is never broken.
//! With a limit, a line (a field or a comment) longer than that many bytes is
//! an error before it's buffered; with an event limit, so is a `data:` line
//! that would take the event's data over it.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use crate::error::{Error, Result};

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// One dispatched event
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Event {
    /// The `event:` field, or `"message"`
    pub(crate) event: String,
    /// The `data:` lines, joined with `\n`
    pub(crate) data: String,
    /// The last event ID in effect when the event was dispatched
    pub(crate) id: String,
}

/// An incremental event stream parser
#[derive(Debug, Default)]
pub(crate) struct Parser {
    /// Bytes of the current, incomplete line
    line: Vec<u8>,
    /// The previous chunk ended with `\r`, so a leading `\n` belongs to it
    after_cr: bool,
    /// Whether the start of the stream has been checked for a BOM
    started: bool,
    event: String,
    data: String,
    has_data: bool,
    last_event_id: String,
    retry: Option<u64>,
    /// `maxLineBytes`
    limit: Option<usize>,
    /// `maxEventBytes`: the most bytes of data one event can hold
    event_limit: Option<usize>,
}

impl Parser {
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

    /// With a limit on an event's data: its `data:` lines, joined with `\n`
    pub(crate) fn event_limit(mut self, limit: Option<usize>) -> Self {
        self.event_limit = limit;
        self
    }

    /// The last event ID seen; the client reads it from each event instead
    #[cfg(test)]
    pub(crate) fn last_event_id(&self) -> &str {
        &self.last_event_id
    }

    /// The reconnection time from the latest `retry:` field, once
    pub(crate) fn take_retry(&mut self) -> Option<u64> {
        self.retry.take()
    }

    /// Feed a chunk of the stream; returns the events it completes, and an
    /// error for a line over the limit (after the events before it)
    pub(crate) fn feed(&mut self, mut chunk: &[u8]) -> (Vec<Event>, Option<Error>) {
        if !self.started && !chunk.is_empty() {
            // A UTF-8 BOM at the very start of the stream is skipped. Until
            // it's clear whether there is one, its first bytes wait in `line`.
            let mut start = std::mem::take(&mut self.line);
            let head = &chunk[..chunk.len().min(BOM.len() - start.len())];
            start.extend_from_slice(head);
            if start.len() < BOM.len() && BOM.starts_with(&start) {
                self.line = start;
                return (Vec::new(), None);
            }
            self.started = true;
            if start == BOM {
                return self.feed_lines(&chunk[head.len()..]);
            }
            // Not a BOM: the bytes held back start the first line (they
            // hold no line break, and `feed_lines` checks the limit)
            start.truncate(start.len() - head.len());
            self.line = start;
            return self.feed_lines(chunk);
        }
        if self.after_cr {
            if let Some(rest) = chunk.strip_prefix(b"\n") {
                chunk = rest;
            }
            self.after_cr = false;
        }
        self.feed_lines(chunk)
    }

    /// Fail if `more` would take the current line over the limit
    fn check(&self, more: usize) -> Result<()> {
        match self.limit {
            Some(limit) if self.line.len() + more > limit => Err(Error::too_long(limit)),
            _ => Ok(()),
        }
    }

    fn feed_lines(&mut self, chunk: &[u8]) -> (Vec<Event>, Option<Error>) {
        let mut events = Vec::new();
        let mut rest = chunk;
        while let Some(end) = rest.iter().position(|&b| b == b'\n' || b == b'\r') {
            if let Err(error) = self.check(end) {
                return (events, Some(error));
            }
            self.line.extend_from_slice(&rest[..end]);
            let line = std::mem::take(&mut self.line);
            match self.process_line(&line) {
                Ok(Some(event)) => events.push(event),
                Ok(None) => {}
                Err(error) => return (events, Some(error)),
            }
            if rest[end] == b'\r' {
                match rest.get(end + 1) {
                    Some(b'\n') => rest = &rest[end + 2..],
                    Some(_) => rest = &rest[end + 1..],
                    None => {
                        self.after_cr = true;
                        rest = &[];
                    }
                }
            } else {
                rest = &rest[end + 1..];
            }
        }
        if let Err(error) = self.check(rest.len()) {
            return (events, Some(error));
        }
        self.line.extend_from_slice(rest);
        (events, None)
    }

    fn process_line(&mut self, line: &[u8]) -> Result<Option<Event>> {
        if line.is_empty() {
            return Ok(self.dispatch());
        }
        if line[0] == b':' {
            return Ok(None); // comment
        }
        let line = String::from_utf8_lossy(line);
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line.as_ref(), ""),
        };
        match field {
            "event" => self.event = value.to_string(),
            "data" => {
                let size = self.data.len() + usize::from(self.has_data) + value.len();
                if let Some(limit) = self.event_limit.filter(|limit| size > *limit) {
                    return Err(Error::event_too_large(limit));
                }
                if self.has_data {
                    self.data.push('\n');
                }
                self.data.push_str(value);
                self.has_data = true;
            }
            "id" if !value.contains('\0') => self.last_event_id = value.to_string(),
            "retry" if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) => {
                self.retry = value.parse().ok();
            }
            _ => {}
        }
        Ok(None)
    }

    fn dispatch(&mut self) -> Option<Event> {
        let event = std::mem::take(&mut self.event);
        if !self.has_data {
            return None;
        }
        self.has_data = false;
        Some(Event {
            event: if event.is_empty() {
                "message".to_string()
            } else {
                event
            },
            data: std::mem::take(&mut self.data),
            id: self.last_event_id.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_all(chunks: &[&[u8]]) -> (Vec<Event>, Parser) {
        let mut parser = Parser::new();
        let mut events = Vec::new();
        for chunk in chunks {
            events.extend(parser.feed(chunk).0);
        }
        (events, parser)
    }

    fn event(event: &str, data: &str, id: &str) -> Event {
        Event {
            event: event.to_string(),
            data: data.to_string(),
            id: id.to_string(),
        }
    }

    #[test]
    fn parses_events_with_types_ids_and_multiline_data() {
        let (events, parser) =
            parse_all(&[b"data: first\n\nevent: update\ndata: line 1\ndata: line 2\nid: 7\n\n"]);
        assert_eq!(
            events,
            vec![
                event("message", "first", ""),
                event("update", "line 1\nline 2", "7")
            ]
        );
        assert_eq!(parser.last_event_id(), "7");
    }

    #[test]
    fn splits_lines_on_lf_cr_and_crlf_even_across_chunks() {
        let (events, _) = parse_all(&[b"data: a\r\n\r", b"\ndata: b\r\rdata: c\n", b"\n"]);
        assert_eq!(
            events,
            vec![
                event("message", "a", ""),
                event("message", "b", ""),
                event("message", "c", "")
            ]
        );
        // A chunk ending in \r followed by one that doesn't start with \n
        let (events, _) = parse_all(&[b"data: d\r", b"\r"]);
        assert_eq!(events, vec![event("message", "d", "")]);
    }

    #[test]
    fn keeps_multibyte_characters_split_across_chunks() {
        let bytes = "data: Zoë 🦀\n\n".as_bytes();
        let chunks: Vec<&[u8]> = bytes.chunks(1).collect();
        let (events, _) = parse_all(&chunks);
        assert_eq!(events, vec![event("message", "Zoë 🦀", "")]);
    }

    #[test]
    fn skips_a_leading_bom_only_once() {
        let (events, _) = parse_all(&[b"\xEF\xBB", b"\xBFdata: x\n\n"]);
        assert_eq!(events, vec![event("message", "x", "")]);
        let (events, _) = parse_all(&[b"\xEF\xBB\xBFdata: y\n\n"]);
        assert_eq!(events, vec![event("message", "y", "")]);
        // Not a BOM: the bytes are kept as the start of the stream
        let (events, _) = parse_all(&[b"\xEF", b"data: z\n\n"]);
        assert!(events.is_empty());
        let (events, _) = parse_all(&[b"", b"data: w\n\n"]);
        assert_eq!(events, vec![event("message", "w", "")]);
    }

    #[test]
    fn handles_comments_fields_without_values_and_unknown_fields() {
        let (events, _) = parse_all(&[b": keep-alive\ndata\nfoo: bar\ndata:no space\n\n"]);
        assert_eq!(events, vec![event("message", "\nno space", "")]);
    }

    #[test]
    fn ignores_empty_events_and_resets_the_type() {
        let (events, _) = parse_all(&[b"event: ignored\n\ndata: x\n\n"]);
        assert_eq!(events, vec![event("message", "x", "")]);
    }

    #[test]
    fn tracks_ids_and_retry() {
        let (events, mut parser) = parse_all(&[
            b"id: 1\ndata: a\n\nid\ndata: b\n\nid: bad\0id\nretry: 2500\nretry: soon\nretry:\ndata: c\n\n",
        ]);
        assert_eq!(
            events,
            vec![
                event("message", "a", "1"),
                event("message", "b", ""),
                event("message", "c", "")
            ]
        );
        assert_eq!(parser.take_retry(), Some(2500));
        assert_eq!(parser.take_retry(), None);
    }

    #[test]
    fn discards_an_incomplete_event_at_the_end() {
        let (events, _) = parse_all(&[b"data: complete\n\ndata: partial"]);
        assert_eq!(events, vec![event("message", "complete", "")]);
    }

    #[test]
    fn limits_lines_comments_included_without_counting_the_line_break() {
        // Exactly at the limit: a field, a comment, and \r\n split across chunks
        let mut parser = Parser::with_limit(Some(8));
        let mut events = parser.feed(b"data: ab\r").0;
        events.extend(parser.feed(b"\n:comment\r\n\n").0);
        assert_eq!(events, vec![event("message", "ab", "")]);
        // One byte over: a field, a comment, across chunks, and an endless line
        for chunks in [
            &[&b"data: abc\n"[..]][..],
            &[b":comment!\n"],
            &[b"data", b": a", b"bc"],
        ] {
            let mut parser = Parser::with_limit(Some(8));
            let error = chunks
                .iter()
                .find_map(|chunk| parser.feed(chunk).1)
                .unwrap();
            assert_eq!(error.line_too_long(), Some(8));
        }
        let mut parser = Parser::with_limit(Some(1024));
        while parser.feed(&[b'x'; 100]).1.is_none() {
            assert!(parser.line.len() <= 1024);
        }
        // Each data line is checked, not the event's total
        let mut parser = Parser::with_limit(Some(8));
        let events = parser.feed(b"data: 12\ndata: 34\n\n").0;
        assert_eq!(events, vec![event("message", "12\n34", "")]);
        // Events before the long line in the same chunk are still returned
        let (events, error) = Parser::with_limit(Some(8)).feed(b"data: a\n\ndata: abcdef\n\n");
        assert_eq!(events, vec![event("message", "a", "")]);
        assert_eq!(error.unwrap().line_too_long(), Some(8));
    }

    #[test]
    fn a_bom_is_skipped_without_counting_towards_the_limit() {
        let mut parser = Parser::with_limit(Some(8));
        assert_eq!(parser.feed(b"\xEF").0, vec![]);
        assert_eq!(
            parser.feed(b"\xBB\xBFdata: ab\n\n").0,
            vec![event("message", "ab", "")]
        );
        // Bytes that only looked like the start of a BOM are part of the first line
        let mut parser = Parser::with_limit(Some(8));
        assert_eq!(parser.feed(b"\xEF").0, vec![]);
        assert!(
            parser.feed(b"data: ab\n").1.is_some(),
            "the \\xEF counts: 9 bytes"
        );
    }

    #[test]
    fn limits_an_events_data_across_its_lines() {
        // 4 + 1 (the joining \n) + 3 = 8 bytes: exactly at the limit
        let mut parser = Parser::new().event_limit(Some(8));
        let (events, error) = parser.feed(b"data: abcd\ndata: efg\n\n");
        assert_eq!(
            (events, error.is_none()),
            (vec![event("message", "abcd\nefg", "")], true)
        );
        // One byte over, in the third line: the event before it is still delivered
        let mut parser = Parser::new().event_limit(Some(8));
        let (events, error) = parser.feed(b"data: ok\n\ndata: abcd\ndata: e\ndata: fg\n\n");
        assert_eq!(events, vec![event("message", "ok", "")]);
        assert_eq!(error.unwrap().event_too_large_limit(), Some(8));
        // Events are counted on their own: many small ones are fine
        let mut parser = Parser::new().event_limit(Some(2));
        let (events, error) = parser.feed(&b"data: ab\n\n".repeat(50));
        assert_eq!((events.len(), error.is_none()), (50, true));
        // With a line limit too, either can stop the stream
        let mut parser = Parser::with_limit(Some(16)).event_limit(Some(8));
        assert!(parser
            .feed(b"data: 1234567890\n")
            .1
            .unwrap()
            .event_too_large_limit()
            .is_some());
    }
}
