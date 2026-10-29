//! Phase timers and a body deadline that closes the underlying stream even
//! when its consumer is not polling. All timer allocation is opt-in.

use crate::{
    error::{Error, Result},
    runtime,
};
use futures_util::{future::Either, Stream};
use std::{
    fmt,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Waker},
    time::Duration,
};

/// The part of a request that timed out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeoutPhase {
    /// Acquiring/establishing the connection, including TLS.
    Connect,
    /// Waiting for response headers.
    Response,
    /// Waiting for another body chunk.
    Idle,
    /// Whole-attempt timeout or logical-request deadline.
    Total,
}

impl TimeoutPhase {
    /// The JavaScript spelling of the phase.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Connect => "connect",
            Self::Response => "response",
            Self::Idle => "idle",
            Self::Total => "total",
        }
    }
    pub(crate) fn parse(value: &str) -> Self {
        match value {
            "connect" => Self::Connect,
            "response" => Self::Response,
            "idle" => Self::Idle,
            _ => Self::Total,
        }
    }
}

/// Structured timeout details, also used as a typed error source to preserve
/// the existing exhaustive Rust error enum.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeoutDetails {
    /// Which phase expired.
    pub phase: TimeoutPhase,
    /// Configured duration, in milliseconds.
    pub duration_ms: u64,
}
impl fmt::Display for TimeoutDetails {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Request {} timeout after {}ms",
            self.phase.as_str(),
            self.duration_ms
        )
    }
}
impl std::error::Error for TimeoutDetails {}

/// Optional connect/header/body-idle timeouts and a total logical-request deadline.
#[derive(Clone, Copy, Debug, Default)]
pub struct PhaseTimeouts {
    pub(crate) connect: Option<Duration>,
    pub(crate) response: Option<Duration>,
    pub(crate) idle: Option<Duration>,
    pub(crate) deadline: Option<Duration>,
}
impl PhaseTimeouts {
    /// All phases disabled, preserving the client's existing attempt timeout.
    pub fn new() -> Self {
        Self::default()
    }
    /// Limit acquiring/establishing a connection (native runtimes only). Zero disables it.
    pub fn connect(mut self, duration: Duration) -> Self {
        self.connect = (!duration.is_zero()).then_some(duration);
        self
    }
    /// Limit waiting for response headers. Zero disables it.
    pub fn response(mut self, duration: Duration) -> Self {
        self.response = (!duration.is_zero()).then_some(duration);
        self
    }
    /// Limit waiting for each new body chunk. Zero disables it.
    pub fn idle(mut self, duration: Duration) -> Self {
        self.idle = (!duration.is_zero()).then_some(duration);
        self
    }
    /// Bound the logical request, including retries, queueing and body lifetime. Zero disables it.
    pub fn deadline(mut self, duration: Duration) -> Self {
        self.deadline = (!duration.is_zero()).then_some(duration);
        self
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Deadline {
    end_ms: f64,
    pub(crate) duration: Duration,
}
impl Deadline {
    pub(crate) fn new(duration: Duration) -> Self {
        Self {
            end_ms: runtime::now_ms() + duration.as_secs_f64() * 1000.0,
            duration,
        }
    }
    pub(crate) fn remaining(self) -> Duration {
        Duration::try_from_secs_f64((self.end_ms - runtime::now_ms()).max(0.0) / 1000.0)
            .unwrap_or(Duration::MAX)
    }
}

/// Keep the optional timer/future out of the default request's inline state.
pub(crate) fn with_deadline<T, F: Future<Output = Result<T>>>(
    deadline: Option<Deadline>,
    future: F,
) -> impl Future<Output = Result<T>> {
    match deadline {
        None => Either::Left(future),
        Some(deadline) => {
            let remaining = deadline.remaining();
            let timed = if remaining.is_zero() {
                Either::Left(std::future::ready(Err(Error::phase_timeout(
                    TimeoutPhase::Total,
                    deadline.duration,
                ))))
            } else {
                Either::Right(runtime::timeout_phase(
                    remaining,
                    TimeoutPhase::Total,
                    deadline.duration,
                    future,
                ))
            };
            Either::Right(Box::pin(timed))
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
type Timer = Pin<Box<tokio::time::Sleep>>;
#[cfg(target_arch = "wasm32")]
type Timer = Pin<Box<crate::wasm::futures::Delay>>;
fn timer(duration: Duration) -> Timer {
    #[cfg(not(target_arch = "wasm32"))]
    {
        Box::pin(tokio::time::sleep(duration))
    }
    #[cfg(target_arch = "wasm32")]
    {
        Box::pin(crate::wasm::futures::Delay::new(duration))
    }
}

pin_project_lite::pin_project! {
    struct IdleStream<S> {
        #[pin]
        inner: Option<S>,
        delay: Option<Timer>,
        duration: Duration,
    }
}
impl<S, T> Stream for IdleStream<S>
where
    S: Stream<Item = Result<T>>,
{
    type Item = Result<T>;
    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let mut this = self.project();
        let Some(inner) = this.inner.as_mut().as_pin_mut() else {
            return Poll::Ready(None);
        };
        match inner.poll_next(cx) {
            Poll::Ready(result) => {
                this.delay.take();
                if matches!(&result, None | Some(Err(_))) {
                    this.inner.set(None);
                }
                return Poll::Ready(result);
            }
            Poll::Pending => {}
        }
        let delay = this.delay.get_or_insert_with(|| timer(*this.duration));
        if delay.as_mut().poll(cx).is_ready() {
            this.inner.set(None);
            this.delay.take();
            return Poll::Ready(Some(Err(Error::phase_timeout(
                TimeoutPhase::Idle,
                *this.duration,
            ))));
        }
        Poll::Pending
    }
}

pub(crate) fn idle<S, T>(stream: S, duration: Option<Duration>) -> impl Stream<Item = Result<T>>
where
    S: Stream<Item = Result<T>>,
{
    match duration {
        None => Either::Left(stream),
        Some(duration) => Either::Right(Box::pin(IdleStream {
            inner: Some(stream),
            delay: None,
            duration,
        })),
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) trait DeadlineBody: Stream<Item = Result<Vec<u8>>> + Send + 'static {}
#[cfg(not(target_arch = "wasm32"))]
impl<S: Stream<Item = Result<Vec<u8>>> + Send + 'static> DeadlineBody for S {}
#[cfg(target_arch = "wasm32")]
pub(crate) trait DeadlineBody: Stream<Item = Result<Vec<u8>>> + 'static {}
#[cfg(target_arch = "wasm32")]
impl<S: Stream<Item = Result<Vec<u8>>> + 'static> DeadlineBody for S {}

struct BodyState<S> {
    inner: Option<Pin<Box<S>>>,
    expired: bool,
    waker: Option<Waker>,
}

struct Task {
    #[cfg(not(target_arch = "wasm32"))]
    handle: tokio::task::JoinHandle<()>,
    #[cfg(target_arch = "wasm32")]
    handle: futures_util::future::AbortHandle,
}
impl Drop for Task {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

async fn expire_body<S>(weak: std::sync::Weak<Mutex<BodyState<S>>>, deadline: Deadline) {
    runtime::sleep(deadline.remaining()).await;
    if let Some(state) = weak.upgrade() {
        let mut state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.expired = true;
        let inner = state.inner.take();
        let waker = state.waker.take();
        drop(state);
        drop(inner); // Close the connection and release its concurrency permit.
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

/// The timer owns a weak reference, so it cannot keep an abandoned body alive.
pub(crate) struct DeadlineStream<S> {
    state: Arc<Mutex<BodyState<S>>>,
    task: Option<Task>,
    duration: Duration,
    done: bool,
}
impl<S: DeadlineBody> DeadlineStream<S> {
    pub(crate) fn new(inner: S, deadline: Deadline) -> Self {
        let state = Arc::new(Mutex::new(BodyState {
            inner: Some(Box::pin(inner)),
            expired: false,
            waker: None,
        }));
        let weak = Arc::downgrade(&state);
        let expire = expire_body(weak, deadline);
        #[cfg(not(target_arch = "wasm32"))]
        let task = Task {
            handle: tokio::spawn(expire),
        };
        #[cfg(target_arch = "wasm32")]
        let task = {
            let (handle, registration) = futures_util::future::AbortHandle::new_pair();
            wasm_bindgen_futures::spawn_local(async move {
                let _ = futures_util::future::Abortable::new(expire, registration).await;
            });
            Task { handle }
        };
        Self {
            state,
            task: Some(task),
            duration: deadline.duration,
            done: false,
        }
    }
}
impl<S: DeadlineBody> Stream for DeadlineStream<S> {
    type Item = Result<Vec<u8>>;
    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        if this.done {
            return Poll::Ready(None);
        }
        let mut state = this
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.expired {
            this.done = true;
            drop(state);
            this.task.take();
            return Poll::Ready(Some(Err(Error::phase_timeout(
                TimeoutPhase::Total,
                this.duration,
            ))));
        }
        let result = state
            .inner
            .as_mut()
            .map_or(Poll::Ready(None), |inner| inner.as_mut().poll_next(cx));
        if result.is_pending() {
            state.waker = Some(cx.waker().clone());
        } else {
            state.waker = None;
        }
        let inner = if matches!(result, Poll::Ready(None | Some(Err(_)))) {
            this.done = true;
            state.inner.take()
        } else {
            None
        };
        drop(state);
        drop(inner);
        if this.done {
            this.task.take();
        }
        result
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use futures_util::{stream, StreamExt};
    use std::sync::atomic::{AtomicBool, Ordering};

    type TestBody = Pin<Box<dyn Stream<Item = Result<Vec<u8>>> + Send>>;
    fn boxed<S: DeadlineBody>(stream: S) -> TestBody {
        Box::pin(stream)
    }

    #[tokio::test]
    async fn phase_timers_preserve_other_errors_and_deadlines_bound_pending_work() {
        for phase in [
            TimeoutPhase::Connect,
            TimeoutPhase::Response,
            TimeoutPhase::Idle,
            TimeoutPhase::Total,
        ] {
            assert_eq!(TimeoutPhase::parse(phase.as_str()), phase);
            let error = runtime::timeout_phase(
                Duration::from_millis(5),
                phase,
                Duration::from_millis(50),
                std::future::pending::<Result<()>>(),
            )
            .await
            .unwrap_err();
            assert_eq!(error.kind(), "TimeoutError");
            assert_eq!(error.timeout_details().unwrap().phase, phase);
            assert_eq!(error.timeout_details().unwrap().duration_ms, 50);
            assert!(error.is_retryable());
            assert!(format!("{}", error.timeout_details().unwrap()).contains(phase.as_str()));
        }
        assert_eq!(TimeoutPhase::parse("unknown"), TimeoutPhase::Total);
        let original = runtime::timeout_phase(
            Duration::from_secs(1),
            TimeoutPhase::Response,
            Duration::from_secs(1),
            async { Err::<(), _>(Error::Cancelled) },
        )
        .await
        .unwrap_err();
        assert_eq!(original.kind(), "CancelledError");
        let work = |ready: bool| -> Pin<Box<dyn Future<Output = Result<()>> + Send>> {
            if ready {
                Box::pin(std::future::ready(Ok(())))
            } else {
                Box::pin(std::future::pending())
            }
        };
        let error = with_deadline(Some(Deadline::new(Duration::from_millis(5))), work(false))
            .await
            .unwrap_err();
        assert_eq!(error.timeout_details().unwrap().phase, TimeoutPhase::Total);
        let error = with_deadline(Some(Deadline::new(Duration::ZERO)), work(true))
            .await
            .unwrap_err();
        assert_eq!(error.kind(), "TimeoutError");
        with_deadline(None, work(true)).await.unwrap();
        with_deadline(Some(Deadline::new(Duration::from_secs(1))), work(true))
            .await
            .unwrap();
        let phases = PhaseTimeouts::new()
            .connect(Duration::from_millis(1))
            .response(Duration::from_millis(2))
            .idle(Duration::from_millis(3))
            .deadline(Duration::from_millis(4));
        assert!(format!("{phases:?}").contains("connect"));
        assert!(phases.deadline.is_some());
        assert!(phases.idle(Duration::ZERO).idle.is_none());
    }

    #[tokio::test]
    async fn idle_timers_reset_on_data_and_finish_on_eof_or_error() {
        let mut expired = Box::pin(idle(
            boxed(stream::pending()),
            Some(Duration::from_millis(5)),
        ));
        assert_eq!(
            expired
                .next()
                .await
                .unwrap()
                .unwrap_err()
                .timeout_details()
                .unwrap()
                .phase,
            TimeoutPhase::Idle
        );
        assert!(expired.next().await.is_none());
        let mut bytes = Box::pin(idle(
            boxed(stream::iter([Ok(vec![1]), Err(Error::Cancelled)])),
            Some(Duration::from_millis(5)),
        ));
        assert_eq!(bytes.next().await.unwrap().unwrap(), vec![1]);
        assert_eq!(
            bytes.next().await.unwrap().unwrap_err().kind(),
            "CancelledError"
        );
        assert!(bytes.next().await.is_none());
        let mut empty = Box::pin(idle(boxed(stream::empty()), Some(Duration::from_millis(5))));
        assert!(empty.next().await.is_none());
        let mut off = Box::pin(idle(boxed(stream::iter([Ok(vec![1])])), None));
        assert_eq!(off.next().await.unwrap().unwrap(), vec![1]);
    }

    struct PendingBody(Arc<AtomicBool>);
    impl Stream for PendingBody {
        type Item = Result<Vec<u8>>;
        fn poll_next(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            Poll::Pending
        }
    }
    impl Drop for PendingBody {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn deadlines_close_unpolled_bodies_and_wake_waiting_readers() {
        expire_body::<TestBody>(std::sync::Weak::new(), Deadline::new(Duration::ZERO)).await;
        let dropped = Arc::new(AtomicBool::new(false));
        let mut body = DeadlineStream::new(
            boxed(PendingBody(Arc::clone(&dropped))),
            Deadline::new(Duration::from_millis(5)),
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            dropped.load(Ordering::SeqCst),
            "the body closes without a read"
        );
        assert_eq!(
            body.next().await.unwrap().unwrap_err().kind(),
            "TimeoutError"
        );
        assert!(body.next().await.is_none());
        let mut pending = DeadlineStream::new(
            boxed(PendingBody(Arc::clone(&dropped))),
            Deadline::new(Duration::from_millis(5)),
        );
        assert_eq!(
            pending.next().await.unwrap().unwrap_err().kind(),
            "TimeoutError"
        );
        let mut empty = DeadlineStream::new(
            boxed(stream::empty()),
            Deadline::new(Duration::from_secs(100)),
        );
        assert!(empty.next().await.is_none());
        let mut failed = DeadlineStream::new(
            boxed(stream::iter([Err(Error::Cancelled)])),
            Deadline::new(Duration::from_secs(100)),
        );
        assert_eq!(
            failed.next().await.unwrap().unwrap_err().kind(),
            "CancelledError"
        );
        let mut data = DeadlineStream::new(
            boxed(stream::iter([Ok(vec![1])])),
            Deadline::new(Duration::from_secs(100)),
        );
        assert_eq!(data.next().await.unwrap().unwrap(), vec![1]);
        assert!(data.next().await.is_none());
    }
}
