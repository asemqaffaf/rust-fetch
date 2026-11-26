//! Minimal Web Streams (`ReadableStream`) interop, replacing `wasm-streams`.
//!
//! Keeps `IntoUnderlyingByteSource`, `IntoUnderlyingSink`, and `futures-sink`
//! out of the Wasm binary and JS glue while preserving the `IntoUnderlyingSource`
//! stream bridge and prototype-pollution-safe construction.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use futures_util::Stream;
use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

type JsStream = dyn Stream<Item = std::result::Result<JsValue, JsValue>>;

#[wasm_bindgen]
extern "C" {
    /// Web Streams `ReadableStreamDefaultController` passed to `IntoUnderlyingSource::pull`.
    #[wasm_bindgen(typescript_type = "ReadableStreamDefaultController")]
    pub type ReadableStreamDefaultController;

    #[wasm_bindgen(method, catch)]
    fn enqueue(
        this: &ReadableStreamDefaultController,
        chunk: &JsValue,
    ) -> std::result::Result<(), JsValue>;

    #[wasm_bindgen(method, catch)]
    fn close(this: &ReadableStreamDefaultController) -> std::result::Result<(), JsValue>;

    #[wasm_bindgen(js_name = ReadableStream)]
    type JsReadableStream;

    #[wasm_bindgen(constructor, js_class = ReadableStream)]
    fn new_readable_stream(source: IntoUnderlyingSource) -> JsReadableStream;

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

struct PullState {
    stream: Option<Pin<Box<JsStream>>>,
    cancelled: bool,
    waker: Option<Waker>,
}

// Underlying JS `ReadableStream` source backed by a Rust `Stream`.
#[wasm_bindgen]
pub struct IntoUnderlyingSource {
    state: Rc<RefCell<PullState>>,
}

impl IntoUnderlyingSource {
    fn new(stream: Pin<Box<JsStream>>) -> Self {
        Self {
            state: Rc::new(RefCell::new(PullState {
                stream: Some(stream),
                cancelled: false,
                waker: None,
            })),
        }
    }

    fn abort(&self) {
        let (stream, waker) = {
            let mut state = self.state.borrow_mut();
            state.cancelled = true;
            (state.stream.take(), state.waker.take())
        };
        drop(stream);
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

#[wasm_bindgen]
impl IntoUnderlyingSource {
    // Pull the next chunk from the Rust stream into `controller`.
    pub fn pull(&mut self, controller: ReadableStreamDefaultController) -> js_sys::Promise {
        super::futures::promise(PullFuture {
            state: Rc::clone(&self.state),
            controller,
        })
    }

    // Cancel the stream and drop any underlying Rust resources immediately.
    pub fn cancel(self) {
        drop(self);
    }
}

impl Drop for IntoUnderlyingSource {
    fn drop(&mut self) {
        self.abort();
    }
}

struct PullFuture {
    state: Rc<RefCell<PullState>>,
    controller: ReadableStreamDefaultController,
}

impl Future for PullFuture {
    type Output = std::result::Result<JsValue, JsValue>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut stream = {
            let mut state = self.state.borrow_mut();
            if state.cancelled {
                state.stream = None;
                state.waker = None;
                return Poll::Ready(Ok(JsValue::UNDEFINED));
            }
            let Some(stream) = state.stream.take() else {
                return Poll::Ready(Ok(JsValue::UNDEFINED));
            };
            stream
        };

        match stream.as_mut().poll_next(cx) {
            Poll::Pending => {
                let mut state = self.state.borrow_mut();
                if state.cancelled {
                    drop(state);
                    drop(stream);
                    return Poll::Ready(Ok(JsValue::UNDEFINED));
                }
                state.stream = Some(stream);
                state.waker = Some(cx.waker().clone());
                Poll::Pending
            }
            Poll::Ready(Some(Ok(chunk))) => {
                let cancelled = {
                    let mut state = self.state.borrow_mut();
                    state.waker = None;
                    if state.cancelled {
                        Some(stream)
                    } else {
                        state.stream = Some(stream);
                        None
                    }
                };
                if cancelled.is_some() {
                    drop(cancelled);
                    return Poll::Ready(Ok(JsValue::UNDEFINED));
                }
                if let Err(err) = self.controller.enqueue(&chunk) {
                    return Poll::Ready(Err(err));
                }
                Poll::Ready(Ok(JsValue::UNDEFINED))
            }
            Poll::Ready(Some(Err(err))) => {
                self.state.borrow_mut().waker = None;
                drop(stream);
                Poll::Ready(Err(err))
            }
            Poll::Ready(None) => {
                self.state.borrow_mut().waker = None;
                drop(stream);
                if let Err(err) = self.controller.close() {
                    return Poll::Ready(Err(err));
                }
                Poll::Ready(Ok(JsValue::UNDEFINED))
            }
        }
    }
}

/// Expose a boxed Rust `Stream` as a JS `ReadableStream`.
pub(crate) fn from_stream(stream: Pin<Box<JsStream>>) -> web_sys::ReadableStream {
    JsReadableStream::new_readable_stream(IntoUnderlyingSource::new(stream)).unchecked_into()
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
