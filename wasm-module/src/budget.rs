//! A client-wide retry budget: when an upstream fails, every request in
//! flight would otherwise retry at once and multiply the load on it (a retry
//! storm). With a budget, retries may add at most a share of recent first
//! attempts, plus a minimum, over a sliding window (the gRPC and Finagle
//! model).
//!
//! - First attempts are always sent, and each one adds to the budget.
//! - A retry is allowed while `min_per_second × window + ratio × first
//!   attempts in the window − retries in the window` is at least 1.
//! - The window slides in `SLOTS` steps, so attempts and retries older than it
//!   no longer count: a spent budget refills as time passes.
//! - The budget is checked before waiting to retry, so an exhausted budget
//!   fails at once, and spent only when the retry is sent, so a request
//!   cancelled while waiting doesn't use any.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// A limit on retries shared by a client and its clones, across all origins
/// (see [`ClientBuilder::retry_budget`](crate::client::ClientBuilder::retry_budget)).
#[derive(Debug, Clone, PartialEq)]
pub struct RetryBudget {
    pub(crate) ratio: f64,
    pub(crate) min_per_second: f64,
    pub(crate) window: Duration,
}

impl Default for RetryBudget {
    fn default() -> Self {
        Self {
            ratio: 0.2,
            min_per_second: 10.0,
            window: Duration::from_secs(10),
        }
    }
}

impl RetryBudget {
    /// The defaults: retries may add 20% of first attempts, plus 10 per
    /// second, over a 10-second window
    pub fn new() -> Self {
        Self::default()
    }

    /// Retries allowed per first attempt in the window, on top of the
    /// minimum (default 0.2)
    pub fn ratio(mut self, ratio: f64) -> Self {
        self.ratio = ratio;
        self
    }

    /// Retries allowed per second of the window whatever the traffic, so
    /// a quiet client can still retry (default 10)
    pub fn min_per_second(mut self, min_per_second: f64) -> Self {
        self.min_per_second = min_per_second;
        self
    }

    /// How far back attempts and retries count (default 10 seconds)
    pub fn window(mut self, window: Duration) -> Self {
        self.window = window;
        self
    }

    /// The (JavaScript) name of the first invalid setting
    pub(crate) fn invalid(&self) -> Option<&'static str> {
        if !(self.ratio.is_finite() && self.ratio >= 0.0) {
            Some("retryBudget.ratio")
        } else if !(self.min_per_second.is_finite() && self.min_per_second >= 0.0) {
            Some("retryBudget.minPerSecond")
        } else if self.window.is_zero() {
            Some("retryBudget.windowMs")
        } else {
            None
        }
    }
}

const SLOTS: u64 = 10;

/// First attempts and retries counted in one slot of the window
#[derive(Debug, Clone, Copy, Default)]
struct Slot {
    index: u64,
    requests: u64,
    retries: u64,
}

/// A budget's state
#[derive(Debug)]
pub(crate) struct Budget {
    config: RetryBudget,
    slots: Mutex<[Slot; SLOTS as usize]>,
    refused: AtomicU64,
}

impl Budget {
    pub(crate) fn new(config: RetryBudget) -> Self {
        Self {
            config,
            slots: Mutex::default(),
            refused: AtomicU64::new(0),
        }
    }

    /// Count a first attempt
    pub(crate) fn request(&self, now_ms: f64) {
        self.update(now_ms, |slot, _| slot.requests += 1);
    }

    /// Whether a retry would be allowed now (counted as refused if not)
    pub(crate) fn can_retry(&self, now_ms: f64) -> bool {
        self.decide(now_ms, false)
    }

    /// Spend a retry if one is allowed (counted as refused if not)
    pub(crate) fn spend(&self, now_ms: f64) -> bool {
        self.decide(now_ms, true)
    }

    /// Retries refused so far
    pub(crate) fn refused(&self) -> u64 {
        self.refused.load(Ordering::Relaxed)
    }

    fn decide(&self, now_ms: f64, spend: bool) -> bool {
        let allowed = self.update(now_ms, |slot, allowance| {
            let allowed = allowance >= 1.0;
            if allowed && spend {
                slot.retries += 1;
            }
            allowed
        });
        if !allowed {
            self.refused.fetch_add(1, Ordering::Relaxed);
        }
        allowed
    }

    /// Run `f` on the current slot with the allowance left in the window
    fn update<R>(&self, now_ms: f64, f: impl FnOnce(&mut Slot, f64) -> R) -> R {
        let window_ms = self.config.window.as_secs_f64() * 1000.0;
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let now = (now_ms.max(0.0) / (window_ms / SLOTS as f64)) as u64;
        let mut slots = self
            .slots
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // A clock that went back counts as the latest time seen
        let index = slots.iter().map(|slot| slot.index).fold(now, u64::max);
        // Slots from before the window don't count
        let current = |slot: &Slot| slot.index + SLOTS > index;
        let (requests, retries) = slots
            .iter()
            .filter(|slot| current(slot))
            .fold((0, 0), |(a, b), s| (a + s.requests, b + s.retries));
        #[allow(clippy::cast_precision_loss)]
        let allowance = self.config.min_per_second * self.config.window.as_secs_f64()
            + self.config.ratio * requests as f64
            - retries as f64;
        let slot = &mut slots[(index % SLOTS) as usize];
        if slot.index != index {
            *slot = Slot {
                index,
                ..Slot::default()
            };
        }
        f(slot, allowance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn budget(ratio: f64, min_per_second: f64) -> Budget {
        Budget::new(
            RetryBudget::new()
                .ratio(ratio)
                .min_per_second(min_per_second)
                .window(Duration::from_secs(10)),
        )
    }

    #[test]
    fn retries_may_add_a_share_of_first_attempts_plus_a_minimum() {
        // 0.5 retries per request, no minimum: 4 requests allow 2 retries
        let b = budget(0.5, 0.0);
        assert!(!b.can_retry(0.0), "no requests, no minimum: no retries");
        for _ in 0..4 {
            b.request(0.0);
        }
        assert!(b.can_retry(0.0) && b.spend(0.0) && b.spend(500.0));
        assert!(!b.spend(900.0), "the third retry is over the budget");
        assert_eq!(b.refused(), 2);

        // A minimum of 0.2 per second over 10 s: 2 retries with no traffic at all
        let b = budget(0.0, 0.2);
        assert!(b.spend(0.0) && b.spend(0.0) && !b.spend(0.0));
    }

    #[test]
    fn checking_spends_nothing() {
        let b = budget(0.0, 0.1); // one retry per window
        assert!(b.can_retry(0.0) && b.can_retry(0.0), "checks don't spend");
        assert!(b.spend(0.0));
        assert!(!b.can_retry(0.0));
    }

    #[test]
    fn a_spent_budget_refills_as_the_window_slides() {
        let b = budget(1.0, 0.0);
        b.request(0.0);
        assert!(b.spend(0.0) && !b.spend(9_000.0), "spent within the window");
        // 10 s later the first slot has left the window: its request and
        // retry no longer count, so a new request allows a new retry
        b.request(10_000.0);
        assert!(b.spend(10_000.0));
        // A clock that goes back counts as the latest time seen
        assert!(!b.spend(0.0));
        b.request(10_000.0);
        assert!(b.spend(0.0));
    }

    #[test]
    fn settings_are_validated() {
        assert_eq!(RetryBudget::new().invalid(), None);
        assert_eq!(
            RetryBudget::new().ratio(-1.0).invalid(),
            Some("retryBudget.ratio")
        );
        assert_eq!(
            RetryBudget::new().ratio(f64::NAN).invalid(),
            Some("retryBudget.ratio")
        );
        let min = RetryBudget::new().min_per_second(f64::INFINITY);
        assert_eq!(min.invalid(), Some("retryBudget.minPerSecond"));
        let window = RetryBudget::new().window(Duration::ZERO);
        assert_eq!(window.invalid(), Some("retryBudget.windowMs"));
    }
}
