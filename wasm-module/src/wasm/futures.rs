//! JS-backed futures: `setTimeout` delays and `AbortSignal` cancellation.
//!
//! They only rely on the global `setTimeout`/`clearTimeout` functions, so they
//! work in browsers, Web Workers, Node.js, Deno and Bun (unlike
//! `window.setTimeout`, which only exists in a browser window). They compile
//! on every target but only work inside a JavaScript engine.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use crate::error::{Error, Result};
use std::cell::Cell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};
use std::time::Duration;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = setTimeout)]
    pub(crate) fn set_timeout(handler: &js_sys::Function, timeout: i32) -> JsValue;

    #[wasm_bindgen(js_name = clearTimeout)]
    pub(crate) fn clear_timeout(handle: &JsValue);
}

struct WakeState {
    fired: Cell<bool>,
    waker: Cell<Option<Waker>>,
}

impl WakeState {
    fn new() -> Rc<Self> {
        Rc::new(Self {
            fired: Cell::new(false),
            waker: Cell::new(None),
        })
    }

    fn callback(state: &Rc<Self>) -> Closure<dyn FnMut()> {
        let state = Rc::clone(state);
        Closure::<dyn FnMut()>::new(move || {
            state.fired.set(true);
            if let Some(waker) = state.waker.take() {
                waker.wake();
            }
        })
    }

    fn park(&self, cx: &Context<'_>) -> Poll<()> {
        self.waker.set(Some(cx.waker().clone()));
        Poll::Pending
    }
}

/// A `setTimeout`-based delay that clears its timer and drops its closure
/// synchronously when dropped, so a finished request never keeps a Node.js
/// process alive or leaves unsettled `Promise`/`FinalizationRegistry` entries.
pub(crate) struct Delay {
    remaining: Duration,
    handle: JsValue,
    callback: Option<Closure<dyn FnMut()>>,
    state: Rc<WakeState>,
}

impl Delay {
    pub(crate) fn new(duration: Duration) -> Self {
        Self {
            remaining: duration,
            handle: JsValue::UNDEFINED,
            callback: None,
            state: WakeState::new(),
        }
    }

    fn arm(&mut self) {
        // Browser/Node timers clamp at i32::MAX ms. Chain long waits and
        // round sub-millisecond durations up rather than shortening them.
        let chunk = self.remaining.min(Duration::from_millis(i32::MAX as u64));
        #[allow(
            clippy::cast_possible_truncation,
            reason = "chunk <= i32::MAX ms (~24.8 days)"
        )]
        let rounded = chunk.as_secs() as u32 * 1000
            + chunk.subsec_millis()
            + u32::from(chunk.subsec_nanos() % 1_000_000 != 0);
        let ms = i32::try_from(rounded).unwrap_or(i32::MAX);
        self.remaining = self.remaining.saturating_sub(chunk);
        self.state.fired.set(false);

        let callback = WakeState::callback(&self.state);
        self.handle = set_timeout(callback.as_ref().unchecked_ref(), ms);
        self.callback = Some(callback);
    }
}

impl Future for Delay {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        loop {
            if self.callback.is_none() {
                self.arm();
            }
            if !self.state.fired.get() {
                return self.state.park(cx);
            }
            if self.remaining.is_zero() {
                return Poll::Ready(());
            }
            self.callback = None;
        }
    }
}

impl Drop for Delay {
    fn drop(&mut self) {
        clear_timeout(&self.handle);
    }
}

/// Resolves once an `AbortSignal` fires; removes its listener and drops its
/// closure synchronously when dropped.
pub(crate) struct Aborted {
    signal: web_sys::AbortSignal,
    state: Rc<WakeState>,
    listener: Option<Closure<dyn FnMut()>>,
}

impl Aborted {
    pub(crate) fn new(signal: web_sys::AbortSignal) -> Self {
        Self {
            signal,
            state: WakeState::new(),
            listener: None,
        }
    }

    fn detach(&mut self) {
        if let Some(listener) = self.listener.take() {
            let _ = self
                .signal
                .remove_event_listener_with_callback("abort", listener.as_ref().unchecked_ref());
        }
    }
}

impl Future for Aborted {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.listener.is_none() && !self.signal.aborted() {
            let listener = WakeState::callback(&self.state);
            let _ = self
                .signal
                .add_event_listener_with_callback("abort", listener.as_ref().unchecked_ref());
            self.listener = Some(listener);
        }
        if self.signal.aborted() {
            self.detach();
            return Poll::Ready(());
        }
        self.state.park(cx)
    }
}

impl Drop for Aborted {
    fn drop(&mut self) {
        self.detach();
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
        delay: Option<Delay>,
        expired: bool,
    }
}

impl<F> Deadline<F> {
    pub(crate) fn new(fut: F, duration: Duration) -> Self {
        Self::optional(fut, Some(duration))
    }

    /// Without a duration this only runs `fut`. Callers that may or may not
    /// time out use one future type, so `fut` is compiled into one poll path.
    pub(crate) fn optional(fut: F, duration: Option<Duration>) -> Self {
        Self {
            fut,
            delay: duration.map(Delay::new),
            expired: false,
        }
    }

    /// Like `optional`, but a zero duration fails at once without polling `fut`
    /// (a total deadline that already passed must not start the request).
    pub(crate) fn until(fut: F, remaining: Option<Duration>) -> Self {
        let expired = remaining.is_some_and(|remaining| remaining.is_zero());
        Self {
            fut,
            delay: remaining.filter(|_| !expired).map(Delay::new),
            expired,
        }
    }
}

impl<F: Future> Future for Deadline<F> {
    type Output = std::result::Result<F::Output, ()>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.project();
        if *this.expired {
            return Poll::Ready(Err(()));
        }
        // The work first, as `select` did: a result that's ready wins
        if let Poll::Ready(output) = this.fut.poll(cx) {
            return Poll::Ready(Ok(output));
        }
        match this.delay {
            Some(delay) => Pin::new(delay).poll(cx).map(Err),
            None => Poll::Pending,
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

/// Complete a JS promise while holding its Rust future once. The async
/// adapter in future_to_promise retained both its argument and await state,
/// doubling pending request memory when new optional policies enlarged it.
#[allow(clippy::expect_used, reason = "the Promise executor runs exactly once")]
pub(crate) fn promise<F>(future: F) -> js_sys::Promise
where
    F: Future<Output = std::result::Result<JsValue, JsValue>> + 'static,
{
    let mut future = Some(future);
    js_sys::Promise::new(&mut |resolve, reject| {
        wasm_bindgen_futures::spawn_local(PromiseFuture {
            future: future.take().expect("Promise executor runs once"),
            resolve,
            reject,
        });
    })
}

pin_project_lite::pin_project! {
    struct PromiseFuture<F> {
        #[pin]
        future: F,
        resolve: js_sys::Function,
        reject: js_sys::Function,
    }
}
impl<F: Future<Output = std::result::Result<JsValue, JsValue>>> Future for PromiseFuture<F> {
    type Output = ();
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        let this = self.project();
        let result = match this.future.poll(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(result) => result,
        };
        let (callback, value) = match result {
            Ok(value) => (this.resolve, value),
            Err(error) => (this.reject, error),
        };
        let _ = callback.call1(&JsValue::UNDEFINED, &value);
        Poll::Ready(())
    }
}
