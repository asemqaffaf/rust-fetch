//! FIFO admission for attempts. Dropping a queued ticket cancels it; dropping
//! an admitted ticket releases concurrency. Tokens are spent only on admission.

use crate::{
    error::{Error, Result},
    runtime,
};
use futures_util::{future::poll_fn, Stream};
use std::{
    collections::{BTreeMap, HashMap},
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Waker},
    time::Duration,
};

/// A token bucket: a burst of `requests` attempts, refilling over `per`.
#[derive(Clone, Debug)]
pub struct RateLimit {
    pub(crate) requests: u32,
    pub(crate) per: Duration,
}

impl RateLimit {
    /// Allow this many attempts per interval, including retries.
    pub fn new(requests: u32, per: Duration) -> Self {
        Self { requests, per }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Config {
    pub(crate) concurrent: Option<usize>,
    pub(crate) rate: Option<RateLimit>,
    pub(crate) per_origin: bool,
}

impl Config {
    pub(crate) fn validate(&self) -> Result<()> {
        let bad = if self.concurrent == Some(0) {
            Some("maxConcurrent")
        } else if self.rate.as_ref().is_some_and(|rate| rate.requests == 0) {
            Some("rateLimit.requests")
        } else if self.rate.as_ref().is_some_and(|rate| rate.per.is_zero()) {
            Some("rateLimit.perMs")
        } else {
            None
        };
        if let Some(parameter) = bad {
            return Err(Error::InvalidInput {
                parameter: parameter.to_string(),
                reason: "must be positive".to_string(),
            });
        }
        Ok(())
    }

    pub(crate) fn enabled(&self) -> bool {
        self.concurrent.is_some() || self.rate.is_some()
    }
}

#[derive(Debug)]
pub(crate) struct Limiter {
    config: Config,
    gates: Mutex<HashMap<String, Arc<Gate>>>,
}

impl Limiter {
    pub(crate) fn new(config: Config) -> Self {
        Self {
            config,
            gates: Mutex::default(),
        }
    }

    pub(crate) fn gate(&self, url: &str) -> Arc<Gate> {
        let key = if self.config.per_origin {
            origin(url)
        } else {
            String::new()
        };
        let mut gates = self
            .gates
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Forget idle origins whose buckets have completely refilled. Active
        // or rate-limited origins are retained, so quotas cannot be reset.
        if let Some(gate) = gates.get(&key) {
            return Arc::clone(gate);
        }
        let now = runtime::now_ms();
        if self.config.per_origin && gates.len().is_multiple_of(128) {
            gates.retain(|_, gate| Arc::strong_count(gate) > 1 || !gate.expired(now));
        }
        Arc::clone(
            gates
                .entry(key)
                .or_insert_with(|| Arc::new(Gate::new(self.config.clone(), now))),
        )
    }
}

/// The URL has already been normalized/validated by the request builder.
pub(crate) fn origin(url: &str) -> String {
    let (scheme, rest) = url.split_once("://").expect("validated HTTP URL");
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    format!(
        "{scheme}://{}",
        authority.rsplit('@').next().unwrap_or(authority)
    )
}

#[derive(Debug)]
struct State {
    active: usize,
    next: u64,
    queue: BTreeMap<u64, Option<Waker>>,
    tokens: f64,
    updated: f64,
    paused: f64,
}

#[derive(Debug)]
pub(crate) struct Gate {
    config: Config,
    state: Mutex<State>,
}

impl Gate {
    fn new(config: Config, now: f64) -> Self {
        let tokens = config
            .rate
            .as_ref()
            .map_or(0.0, |rate| f64::from(rate.requests));
        Self {
            config,
            state: Mutex::new(State {
                active: 0,
                next: 0,
                queue: BTreeMap::new(),
                tokens,
                updated: now,
                paused: 0.0,
            }),
        }
    }

    fn expired(&self, now: f64) -> bool {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.active == 0
            && state.queue.is_empty()
            && state.paused <= now
            && self
                .config
                .rate
                .as_ref()
                .is_none_or(|rate| now - state.updated >= rate.per.as_secs_f64() * 1000.0)
    }

    pub(crate) async fn acquire(self: &Arc<Self>) -> Ticket {
        let mut ticket = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let id = state.next;
            state.next = state.next.wrapping_add(1);
            state.queue.insert(id, None);
            Ticket {
                gate: Arc::clone(self),
                id,
                admitted: false,
            }
        };
        while let Some(delay) = poll_fn(|cx| ticket.poll(cx)).await {
            runtime::sleep(delay).await;
        }
        ticket
    }

    pub(crate) fn pause(&self, delay: Duration) {
        if self.config.rate.is_none() {
            return;
        }
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.paused = state
            .paused
            .max(runtime::now_ms() + delay.as_secs_f64() * 1000.0);
    }
}

/// Owns either a FIFO queue entry or an admitted concurrency slot.
#[derive(Debug)]
pub(crate) struct Ticket {
    gate: Arc<Gate>,
    id: u64,
    admitted: bool,
}

impl Ticket {
    fn poll(&mut self, cx: &Context<'_>) -> Poll<Option<Duration>> {
        let mut state = self
            .gate
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *state.queue.get_mut(&self.id).expect("queued ticket exists") = Some(cx.waker().clone());
        if state.queue.first_key_value().map(|(id, _)| *id) != Some(self.id)
            || self
                .gate
                .config
                .concurrent
                .is_some_and(|limit| state.active >= limit)
        {
            return Poll::Pending;
        }
        let now = runtime::now_ms();
        let mut wait = (state.paused - now).max(0.0);
        if let Some(rate) = &self.gate.config.rate {
            let per = rate.per.as_secs_f64() * 1000.0;
            state.tokens = (state.tokens
                + (now - state.updated).max(0.0) * f64::from(rate.requests) / per)
                .min(f64::from(rate.requests));
            state.updated = now;
            wait = wait.max((1.0 - state.tokens) * per / f64::from(rate.requests));
        }
        if wait > 0.0 {
            return Poll::Ready(Some(
                Duration::try_from_secs_f64(wait / 1000.0).unwrap_or(Duration::MAX),
            ));
        }
        if self.gate.config.rate.is_some() {
            state.tokens -= 1.0;
        }
        state.queue.remove(&self.id);
        state.active += 1;
        self.admitted = true;
        let wake = state
            .queue
            .first_key_value()
            .and_then(|(_, waker)| waker.clone());
        drop(state);
        if let Some(wake) = wake {
            wake.wake();
        }
        Poll::Ready(None)
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        let mut state = self
            .gate
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if self.admitted {
            state.active -= 1;
        } else {
            state.queue.remove(&self.id);
        }
        let wake = state
            .queue
            .first_key_value()
            .and_then(|(_, waker)| waker.clone());
        drop(state);
        if let Some(wake) = wake {
            wake.wake();
        }
    }
}

pin_project_lite::pin_project! {
    /// Keep a stream's concurrency slot until EOF, error or cancellation.
    pub(crate) struct PermitStream<S> {
        #[pin]
        inner: S,
        permit: Option<Ticket>,
    }
}

impl<S> PermitStream<S> {
    pub(crate) fn new(inner: S, permit: Option<Ticket>) -> Self {
        Self { inner, permit }
    }
}

impl<S, T> Stream for PermitStream<S>
where
    S: Stream<Item = Result<T>>,
{
    type Item = Result<T>;
    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.project();
        let result = this.inner.poll_next(cx);
        if matches!(&result, Poll::Ready(None | Some(Err(_)))) {
            this.permit.take();
        }
        result
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use futures_util::{task::noop_waker, StreamExt};
    use std::future::Future;

    #[tokio::test]
    async fn fifo_cancellation_tokens_pauses_and_stream_lifetimes() {
        let config = Config {
            concurrent: Some(1),
            rate: Some(RateLimit::new(1, Duration::from_millis(30))),
            per_origin: false,
        };
        let limiter = Limiter::new(config);
        let gate = limiter.gate("http://a/");
        let first = gate.acquire().await;
        let mut cancelled = Box::pin(gate.acquire());
        let mut next = Box::pin(gate.acquire());
        let mut last = Box::pin(gate.acquire());
        let waker = noop_waker();
        let mut cx = Context::from_waker(&waker);
        assert!(cancelled.as_mut().poll(&mut cx).is_pending());
        assert!(next.as_mut().poll(&mut cx).is_pending());
        assert!(last.as_mut().poll(&mut cx).is_pending());
        drop(cancelled);
        drop(first);
        gate.pause(Duration::from_millis(40));
        let started = std::time::Instant::now();
        let permit = next.await;
        assert!(started.elapsed() >= Duration::from_millis(30));
        let stream = futures_util::stream::iter([Ok(1), Err(Error::Cancelled)]);
        let mut stream = PermitStream::new(stream, Some(permit));
        assert_eq!(stream.next().await.unwrap().unwrap(), 1);
        assert!(stream.next().await.unwrap().is_err());
        assert_eq!(gate.state.lock().unwrap().active, 0);
        assert!(stream.next().await.is_none());
        drop(last.await);
        let empty = futures_util::stream::empty::<Result<()>>();
        let mut stream = PermitStream::new(empty, Some(gate.acquire().await));
        assert!(stream.next().await.is_none());
        assert_eq!(gate.state.lock().unwrap().active, 0);
    }

    #[test]
    fn validation_and_origin_cleanup_keep_live_gates() {
        for config in [
            Config {
                concurrent: Some(0),
                ..Config::default()
            },
            Config {
                rate: Some(RateLimit::new(0, Duration::from_secs(1))),
                ..Config::default()
            },
            Config {
                rate: Some(RateLimit::new(1, Duration::ZERO)),
                ..Config::default()
            },
        ] {
            assert!(config.validate().is_err());
        }
        let limiter = Limiter::new(Config {
            concurrent: Some(1),
            per_origin: true,
            ..Config::default()
        });
        let first = limiter.gate("http://user:pass@first:80/path");
        assert!(Arc::ptr_eq(&first, &limiter.gate("http://first:80/other")));
        first.pause(Duration::from_secs(1)); // No bucket: a pause does nothing.
        for n in 0..260 {
            drop(limiter.gate(&format!("http://host{n}/")));
        }
        assert!(Arc::ptr_eq(&first, &limiter.gate("http://first:80/")));
        assert!(limiter.gates.lock().unwrap().len() < 128);
        let gate = Gate::new(
            Config {
                rate: Some(RateLimit::new(1, Duration::from_millis(10))),
                ..Config::default()
            },
            0.0,
        );
        assert!(!gate.expired(5.0));
        assert!(gate.expired(20.0));
    }
}
