//! Per-origin availability circuit. Epochs prevent an old in-flight attempt
//! from closing a newer open circuit or changing a half-open probe's result.

use crate::{
    error::{Error, Result},
    limiter::origin,
    runtime,
};
use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex},
    time::Duration,
};

/// Open a circuit after consecutive failed attempts, then allow one recovery probe.
#[derive(Clone, Debug)]
pub struct CircuitBreaker {
    pub(crate) failure_threshold: u32,
    pub(crate) reset_after: Duration,
}

impl CircuitBreaker {
    /// Network errors, timeouts and 5xx count as failures. Other responses reset the streak.
    pub fn new(failure_threshold: u32, reset_after: Duration) -> Self {
        Self {
            failure_threshold,
            reset_after,
        }
    }
}

/// A circuit's current state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CircuitState {
    /// Requests are allowed.
    Closed,
    /// Requests fail immediately during the recovery delay.
    Open,
    /// Exactly one recovery probe is in flight.
    HalfOpen,
}

impl CircuitState {
    /// The JavaScript/logging spelling of this state.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Open => "open",
            Self::HalfOpen => "half-open",
        }
    }
}

/// One state transition, reported outside the circuit's lock.
#[derive(Clone, Debug)]
pub struct CircuitChange {
    /// Origin (scheme, hostname and port), without credentials or a path.
    pub origin: String,
    /// Previous state.
    pub from: CircuitState,
    /// New state.
    pub to: CircuitState,
}

/// Circuit callback; native callbacks must be safe to share across tasks.
#[cfg(not(target_arch = "wasm32"))]
pub trait CircuitCallback: Fn(CircuitChange) + Send + Sync {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Fn(CircuitChange) + Send + Sync> CircuitCallback for T {}
/// Circuit callback; JavaScript callbacks run on the current thread.
#[cfg(target_arch = "wasm32")]
pub trait CircuitCallback: Fn(CircuitChange) {}
#[cfg(target_arch = "wasm32")]
impl<T: Fn(CircuitChange)> CircuitCallback for T {}

/// Details available through `Error::circuit_open()` without adding a variant
/// to the existing exhaustive Rust error enum.
#[derive(Debug)]
pub struct CircuitOpenError {
    /// The origin whose circuit is open.
    pub origin: String,
    /// Remaining recovery delay (or probe interval while a probe is active).
    pub retry_after: Duration,
}

impl fmt::Display for CircuitOpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Circuit open for {}", self.origin)
    }
}
impl std::error::Error for CircuitOpenError {}

struct State {
    phase: CircuitState,
    failures: u32,
    until: f64,
    epoch: u64,
    active: usize,
}
impl Default for State {
    fn default() -> Self {
        Self {
            phase: CircuitState::Closed,
            failures: 0,
            until: 0.0,
            epoch: 0,
            active: 0,
        }
    }
}

pub(crate) struct Breaker {
    config: CircuitBreaker,
    states: Mutex<HashMap<String, State>>,
    hook: Option<Arc<dyn CircuitCallback>>,
}

impl Breaker {
    pub(crate) fn new(
        config: CircuitBreaker,
        hook: Option<Arc<dyn CircuitCallback>>,
    ) -> Result<Self> {
        if config.failure_threshold == 0 || config.reset_after.is_zero() {
            return Err(Error::InvalidInput {
                parameter: "circuitBreaker".to_string(),
                reason: "failureThreshold and resetAfterMs must be positive".to_string(),
            });
        }
        Ok(Self {
            config,
            states: Mutex::default(),
            hook,
        })
    }

    pub(crate) fn check(&self, url: &str) -> Result<()> {
        let origin = origin(url);
        let now = runtime::now_ms();
        let states = self
            .states
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(state) = states.get(&origin) {
            if state.phase == CircuitState::HalfOpen
                || state.phase == CircuitState::Open && now < state.until
            {
                return Err(self.blocked(origin, state, now));
            }
        }
        Ok(())
    }

    fn blocked(&self, origin: String, state: &State, now: f64) -> Error {
        let delay = if state.phase == CircuitState::HalfOpen {
            self.config.reset_after
        } else {
            Duration::try_from_secs_f64((state.until - now).max(0.0) / 1000.0)
                .unwrap_or(Duration::MAX)
        };
        Error::network(
            "Circuit open",
            CircuitOpenError {
                origin,
                retry_after: delay,
            },
        )
    }

    pub(crate) fn enter(self: &Arc<Self>, url: &str) -> Result<Probe> {
        let origin = origin(url);
        let now = runtime::now_ms();
        let mut states = self
            .states
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !states.contains_key(&origin) && states.len().is_multiple_of(128) {
            states.retain(|_, state| {
                state.phase != CircuitState::Closed || state.failures != 0 || state.active != 0
            });
        }
        let state = states.entry(origin.clone()).or_default();
        let change = if state.phase == CircuitState::Open && now >= state.until {
            state.phase = CircuitState::HalfOpen;
            state.epoch = state.epoch.wrapping_add(1);
            Some(CircuitChange {
                origin: origin.clone(),
                from: CircuitState::Open,
                to: CircuitState::HalfOpen,
            })
        } else if state.phase != CircuitState::Closed {
            return Err(self.blocked(origin, state, now));
        } else {
            None
        };
        state.active += 1;
        let probe = Probe {
            breaker: Arc::clone(self),
            origin,
            epoch: state.epoch,
            half_open: state.phase == CircuitState::HalfOpen,
            settled: false,
        };
        drop(states);
        if let Some(change) = change {
            self.notify(change);
        }
        Ok(probe)
    }

    fn notify(&self, change: CircuitChange) {
        if let Some(hook) = &self.hook {
            hook(change);
        }
    }
}

pub(crate) struct Probe {
    breaker: Arc<Breaker>,
    origin: String,
    epoch: u64,
    half_open: bool,
    settled: bool,
}

impl Probe {
    pub(crate) fn finish(mut self, failed: bool) {
        let mut states = self
            .breaker
            .states
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let state = states.get_mut(&self.origin).expect("active origin exists");
        state.active -= 1;
        self.settled = true;
        if state.epoch != self.epoch {
            return;
        }
        let from = state.phase;
        if failed {
            state.failures = state.failures.saturating_add(1);
            if self.half_open || state.failures >= self.breaker.config.failure_threshold {
                state.phase = CircuitState::Open;
                state.until =
                    runtime::now_ms() + self.breaker.config.reset_after.as_secs_f64() * 1000.0;
                state.epoch = state.epoch.wrapping_add(1);
            }
        } else {
            state.failures = 0;
            state.phase = CircuitState::Closed;
        }
        let to = state.phase;
        drop(states);
        if from != to {
            self.breaker.notify(CircuitChange {
                origin: self.origin.clone(),
                from,
                to,
            });
        }
    }
}

impl Drop for Probe {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        let mut states = self
            .breaker
            .states
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let state = states.get_mut(&self.origin).expect("active origin exists");
        state.active -= 1;
        if !self.half_open || state.epoch != self.epoch {
            return;
        }
        state.phase = CircuitState::Open;
        state.until = runtime::now_ms(); // An aborted probe may be replaced immediately.
        state.epoch = state.epoch.wrapping_add(1);
        drop(states);
        self.breaker.notify(CircuitChange {
            origin: self.origin.clone(),
            from: CircuitState::HalfOpen,
            to: CircuitState::Open,
        });
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn epochs_one_probe_failure_recovery_and_cancelled_probe() {
        let changes = Arc::new(Mutex::new(Vec::new()));
        let observed = Arc::clone(&changes);
        let config = CircuitBreaker::new(2, Duration::from_millis(20));
        assert!(format!("{:?}", config.clone()).contains('2'));
        let breaker = Arc::new(
            Breaker::new(
                config,
                Some(Arc::new(move |change: CircuitChange| {
                    observed.lock().unwrap().push((
                        change.origin.clone(),
                        change.from.as_str(),
                        change.to.as_str(),
                    ));
                    assert!(!format!("{change:?}").is_empty());
                })),
            )
            .unwrap(),
        );
        let old = breaker.enter("http://a/path").unwrap();
        breaker.enter("http://a/1").unwrap().finish(true);
        breaker.enter("http://a/2").unwrap().finish(true);
        let error = breaker.check("http://a/3").unwrap_err();
        assert_eq!(error.kind(), "CircuitOpenError");
        assert!(!error.is_retryable());
        assert_eq!(error.circuit_open().unwrap().origin, "http://a");
        assert!(error.circuit_open().unwrap().retry_after > Duration::ZERO);
        assert!(format!("{error}").contains("http://a"));
        assert!(std::error::Error::source(&error).is_some());
        assert!(breaker.enter("http://a/4").is_err());
        old.finish(false); // A success from before opening must not close it.
        assert!(breaker.check("http://a/5").is_err());
        breaker.enter("http://b/").unwrap().finish(false);
        tokio::time::sleep(Duration::from_millis(25)).await;
        breaker.check("http://a/").unwrap();
        let probe = breaker.enter("http://a/").unwrap();
        assert!(breaker.check("http://a/").is_err());
        assert!(breaker.enter("http://a/").is_err());
        probe.finish(true);
        tokio::time::sleep(Duration::from_millis(25)).await;
        let probe = breaker.enter("http://a/").unwrap();
        drop(probe); // Cancellation leaves room for another probe immediately.
        breaker.enter("http://a/").unwrap().finish(false);
        breaker.check("http://a/").unwrap();
        let changes = changes.lock().unwrap();
        assert_eq!(changes.first().unwrap().1, "closed");
        assert_eq!(changes.last().unwrap().2, "closed");
        assert!(changes
            .iter()
            .any(|(_, from, to)| *from == "half-open" && *to == "open"));
    }

    #[test]
    fn resets_streaks_ignores_aborted_attempts_and_reclaims_healthy_origins() {
        assert!(Breaker::new(CircuitBreaker::new(0, Duration::from_secs(1)), None).is_err());
        assert!(Breaker::new(CircuitBreaker::new(1, Duration::ZERO), None).is_err());
        let breaker =
            Arc::new(Breaker::new(CircuitBreaker::new(2, Duration::from_secs(1)), None).unwrap());
        breaker.enter("http://a/").unwrap().finish(true);
        breaker.enter("http://a/").unwrap().finish(false);
        breaker.enter("http://a/").unwrap().finish(true);
        drop(breaker.enter("http://a/").unwrap());
        breaker.check("http://a/").unwrap();
        for i in 0..260 {
            breaker
                .enter(&format!("http://host{i}/"))
                .unwrap()
                .finish(false);
        }
        assert!(breaker.states.lock().unwrap().len() < 128);
    }
}
