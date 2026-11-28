//! Minimal Web Streams reader (for the Rust crate's `send_streaming` API)
//! and the Wasm bridge over the fuzzed Rust SSE parser (`__SseParser`).
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use futures_util::Stream;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    type StreamReader;

    #[wasm_bindgen(method)]
    fn read(this: &StreamReader) -> js_sys::Promise;

    #[wasm_bindgen(method)]
    fn cancel(this: &StreamReader) -> js_sys::Promise;

    #[wasm_bindgen(method, catch, js_name = releaseLock)]
    fn release_lock(this: &StreamReader) -> std::result::Result<(), JsValue>;
}

/// Reads chunks from a JS `ReadableStream` via its default reader; dropping the
/// stream cancels any remaining body and releases the reader lock.
pub(crate) struct ReadableStreamReader {
    reader: Option<StreamReader>,
    pending: Option<JsFuture>,
}

pub(crate) fn read_stream(stream: web_sys::ReadableStream) -> ReadableStreamReader {
    let reader: StreamReader = stream.get_reader().unchecked_into();
    ReadableStreamReader {
        reader: Some(reader),
        pending: None,
    }
}

pub(crate) fn empty_reader() -> ReadableStreamReader {
    ReadableStreamReader {
        reader: None,
        pending: None,
    }
}

impl Stream for ReadableStreamReader {
    type Item = std::result::Result<JsValue, JsValue>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = &mut *self;
        let Some(reader) = this.reader.as_ref() else {
            return Poll::Ready(None);
        };
        let fut = this
            .pending
            .get_or_insert_with(|| JsFuture::from(reader.read()));
        match Pin::new(fut).poll(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(result) => {
                this.pending = None;
                match result {
                    Ok(chunk) => {
                        let done = super::get_prop(&chunk, "done").is_truthy();
                        if done {
                            if let Some(reader) = this.reader.take() {
                                let _ = reader.release_lock();
                            }
                            Poll::Ready(None)
                        } else {
                            let value = super::get_prop(&chunk, "value");
                            Poll::Ready(Some(Ok(value)))
                        }
                    }
                    Err(err) => {
                        if let Some(reader) = this.reader.take() {
                            let _ = reader.release_lock();
                        }
                        Poll::Ready(Some(Err(err)))
                    }
                }
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
thread_local! {
    /// Shared no-op rejection handler so cancelled reader promises never become
    /// unhandled rejections.
    pub(crate) static IGNORE: Closure<dyn FnMut(JsValue)> = Closure::new(|_| {});
}

impl Drop for ReadableStreamReader {
    fn drop(&mut self) {
        if let Some(reader) = self.reader.take() {
            let _promise = reader.cancel();
            #[cfg(target_arch = "wasm32")]
            IGNORE.with(|ignore| {
                let _ = _promise.catch(ignore);
            });
            let _ = reader.release_lock();
        }
    }
}

/// Thin Wasm bridge over the fuzzed Rust [`crate::sse::Parser`], used internally
/// by `js/connections.js`'s `EventStream`.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(skip_typescript)]
pub struct __SseParser {
    inner: crate::sse::Parser,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl __SseParser {
    #[wasm_bindgen(constructor)]
    pub fn new(max_line: Option<u32>, max_event: Option<u32>) -> Self {
        Self {
            inner: crate::sse::Parser::with_limit(max_line.map(|n| n as usize))
                .event_limit(max_event.map(|n| n as usize)),
        }
    }

    pub fn feed(&mut self, chunk: &[u8]) -> JsValue {
        let (events, error) = self.inner.feed(chunk);
        let js_events = js_sys::Array::new();
        for event in events {
            let tuple = js_sys::Array::new();
            tuple.push(&JsValue::from_str(&event.event));
            tuple.push(&JsValue::from_str(&event.data));
            tuple.push(&JsValue::from_str(&event.id));
            js_events.push(&tuple);
        }
        #[allow(clippy::cast_precision_loss)]
        let retry = self
            .inner
            .take_retry()
            .map_or(JsValue::NULL, |ms| JsValue::from_f64(ms as f64));
        let err = error.map_or(JsValue::NULL, JsValue::from);
        let out = js_sys::Array::new();
        out.push(&js_events);
        out.push(&retry);
        out.push(&err);
        out.into()
    }
}
