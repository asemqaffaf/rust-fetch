//! JS-backed futures: `setTimeout` delays and `AbortSignal` cancellation.
//!
//! They only rely on the global `setTimeout`/`clearTimeout` functions, so they
//! work in browsers, Web Workers, Node.js, Deno and Bun (unlike
//! `window.setTimeout`, which only exists in a browser window). They compile
//! on every target but only work inside a JavaScript engine.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use crate::error::{Error, Result};
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = setTimeout)]
    pub(crate) fn set_timeout(handler: &js_sys::Function, timeout: i32) -> JsValue;

    #[wasm_bindgen(js_name = clearTimeout)]
    pub(crate) fn clear_timeout(handle: &JsValue);
}

/// A `setTimeout`-based delay that clears its timer when dropped, so a
/// finished request never keeps a Node.js process alive.
pub(crate) struct Delay {
    inner: JsFuture,
    handle: JsValue,
}

impl Delay {
    pub(crate) fn new(duration: Duration) -> Self {
        let ms = i32::try_from(duration.as_millis()).unwrap_or(i32::MAX);
        let mut handle = JsValue::UNDEFINED;
        let promise = js_sys::Promise::new(&mut |resolve, _reject| {
            handle = set_timeout(&resolve, ms);
        });
        Self {
            inner: JsFuture::from(promise),
            handle,
        }
    }
}

impl Future for Delay {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        Pin::new(&mut self.inner).poll(cx).map(|_| ())
    }
}

impl Drop for Delay {
    fn drop(&mut self) {
        clear_timeout(&self.handle);
    }
}

/// Resolves once an `AbortSignal` fires; removes its listener when dropped.
pub(crate) struct Aborted {
    inner: JsFuture,
    signal: web_sys::AbortSignal,
    listener: Option<js_sys::Function>,
}

impl Aborted {
    pub(crate) fn new(signal: web_sys::AbortSignal) -> Self {
        let mut listener = None;
        let promise = js_sys::Promise::new(&mut |resolve, _reject| {
            if signal.aborted() {
                let _ = resolve.call0(&JsValue::UNDEFINED);
            } else {
                let _ = signal.add_event_listener_with_callback("abort", &resolve);
                listener = Some(resolve);
            }
        });
        Self {
            inner: JsFuture::from(promise),
            signal,
            listener,
        }
    }
}

impl Future for Aborted {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        // Promise callbacks run on a later microtask; check the flag directly
        // so an already-aborted signal wins the race against ready work.
        if self.signal.aborted() {
            return Poll::Ready(());
        }
        Pin::new(&mut self.inner).poll(cx).map(|_| ())
    }
}

impl Drop for Aborted {
    fn drop(&mut self) {
        if let Some(listener) = &self.listener {
            let _ = self
                .signal
                .remove_event_listener_with_callback("abort", listener);
        }
    }
}

/// Run a future, failing with [`Error::Cancelled`] if the signal aborts first.
///
/// The future is dropped on abort, which aborts the underlying request
/// and any pending retry delay. An already-aborted signal fails without
/// polling it at all, so the request isn't even started.
pub(crate) fn abortable<F>(signal: Option<web_sys::AbortSignal>, fut: F) -> Abortable<F> {
    let cancelled = signal.as_ref().is_some_and(web_sys::AbortSignal::aborted);
    Abortable {
        fut,
        aborted: signal.filter(|_| !cancelled).map(Aborted::new),
        cancelled,
    }
}

pin_project_lite::pin_project! {
    /// See [`abortable`]. A hand-written future rather than an `async fn`:
    /// the compiler kept two copies of the wrapped future in the `async fn`'s
    /// state (its argument, then the pinned local), which doubled the memory
    /// every pending request holds.
    pub(crate) struct Abortable<F> {
        #[pin]
        fut: F,
        aborted: Option<Aborted>,
        cancelled: bool,
    }
}

impl<T, F: Future<Output = Result<T>>> Future for Abortable<F> {
    type Output = Result<T>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<T>> {
        let this = self.project();
        if *this.cancelled {
            return Poll::Ready(Err(Error::Cancelled));
        }
        // The work first, as `select` did: a result that's ready wins
        if let Poll::Ready(result) = this.fut.poll(cx) {
            return Poll::Ready(result);
        }
        let aborted = this
            .aborted
            .as_mut()
            .is_some_and(|aborted| Pin::new(aborted).poll(cx).is_ready());
        if aborted {
            *this.cancelled = true;
            return Poll::Ready(Err(Error::Cancelled));
        }
        Poll::Pending
    }
}

pin_project_lite::pin_project! {
    /// A future with a deadline: its output, or `Err(())` once `duration`
    /// passes first (for `runtime::timeout`)
    pub(crate) struct Deadline<F> {
        #[pin]
        fut: F,
        delay: Delay,
    }
}

impl<F> Deadline<F> {
    pub(crate) fn new(fut: F, duration: Duration) -> Self {
        Self {
            fut,
            delay: Delay::new(duration),
        }
    }
}

impl<F: Future> Future for Deadline<F> {
    type Output = std::result::Result<F::Output, ()>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.project();
        // The work first, as `select` did: a result that's ready wins
        if let Poll::Ready(output) = this.fut.poll(cx) {
            return Poll::Ready(Ok(output));
        }
        match Pin::new(this.delay).poll(cx) {
            Poll::Ready(()) => Poll::Ready(Err(())),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// A stream that fails with [`Error::Cancelled`] once an `AbortSignal` fires
pub(crate) struct AbortableStream<S> {
    inner: Pin<Box<S>>,
    aborted: Option<Aborted>,
    done: bool,
}

impl<S> AbortableStream<S> {
    pub(crate) fn new(inner: S, signal: Option<web_sys::AbortSignal>) -> Self {
        Self {
            inner: Box::pin(inner),
            aborted: signal.map(Aborted::new),
            done: false,
        }
    }
}

impl<T, S: futures_util::Stream<Item = Result<T>>> futures_util::Stream for AbortableStream<S> {
    type Item = Result<T>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Result<T>>> {
        if self.done {
            return Poll::Ready(None);
        }
        if let Some(aborted) = self.aborted.as_mut() {
            if Pin::new(aborted).poll(cx).is_ready() {
                self.done = true;
                return Poll::Ready(Some(Err(Error::Cancelled)));
            }
        }
        self.inner.as_mut().poll_next(cx)
    }
}
