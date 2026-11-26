//! Platform-specific timers, timeouts and randomness
//!
//! On WebAssembly this only relies on the global `setTimeout`/`clearTimeout`
//! functions, so it works in browsers, Web Workers, Node.js, Deno and Bun
//! (unlike `window.setTimeout`, which only exists in a browser window).

use crate::error::{Error, Result};
use std::future::Future;
use std::time::Duration;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch, js_namespace = performance, js_name = now)]
    fn monotonic_now() -> std::result::Result<f64, wasm_bindgen::JsValue>;
}

/// Sleep for the given duration
pub(crate) async fn sleep(duration: Duration) {
    #[cfg(not(target_arch = "wasm32"))]
    tokio::time::sleep(duration).await;

    #[cfg(target_arch = "wasm32")]
    crate::wasm::futures::Delay::new(duration).await;
}

/// Run a future, failing with [`Error::Timeout`] if it takes longer than `duration`.
///
/// The future is dropped on timeout, which aborts the underlying request.
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
pub(crate) async fn timeout<T>(
    duration: Duration,
    fut: impl Future<Output = Result<T>>,
) -> Result<T> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let timed_out = || Error::Timeout {
            duration_ms: u64::try_from(duration.as_millis()).unwrap_or(u64::MAX),
        };
        tokio::time::timeout(duration, fut)
            .await
            .map_err(|_| timed_out())?
    }

    #[cfg(target_arch = "wasm32")]
    {
        // A future of its own, not `select` on a pinned local: that kept two
        // copies of `fut` in this function's state (see `Abortable`)
        crate::wasm::futures::Deadline::new(fut, duration, crate::TimeoutPhase::Total, duration)
            .await
    }
}

/// [`timeout_phase`] when `duration` is set; otherwise just `fut`, as one
/// future type so that `fut` is compiled into a single poll function.
#[cfg(target_arch = "wasm32")]
#[allow(dead_code)]
pub(crate) fn timeout_phase_optional<
    T,
    E: From<Error>,
    F: Future<Output = std::result::Result<T, E>>,
>(
    duration: Option<Duration>,
    phase: crate::TimeoutPhase,
    configured: Duration,
    fut: F,
) -> impl Future<Output = std::result::Result<T, E>> {
    crate::wasm::futures::Deadline::optional(fut, duration, phase, configured)
}

/// [`timeout`] when `duration` is set; otherwise just `fut`, as one future type.
pub(crate) async fn timeout_optional<T>(
    duration: Option<Duration>,
    fut: impl Future<Output = Result<T>>,
) -> Result<T> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        match duration {
            Some(duration) => timeout(duration, fut).await,
            None => fut.await,
        }
    }

    #[cfg(target_arch = "wasm32")]
    {
        let configured = duration.unwrap_or(Duration::MAX);
        crate::wasm::futures::Deadline::optional(
            fut,
            duration,
            crate::TimeoutPhase::Total,
            configured,
        )
        .await
    }
}

/// Milliseconds on an interval clock for budgets and deadlines.
pub(crate) fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        monotonic_now().unwrap_or_else(|_| js_sys::Date::now())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
        START
            .get_or_init(std::time::Instant::now)
            .elapsed()
            .as_secs_f64()
            * 1000.0
    }
}

/// Random number in `[0, 1)`, used for retry jitter
pub(crate) fn random() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Math::random()
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::hash::{BuildHasher, Hasher};
        // `RandomState` is seeded randomly per instance; good enough for jitter.
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u8(0);
        #[allow(clippy::cast_precision_loss)]
        let value = (hasher.finish() >> 11) as f64 / (1u64 << 53) as f64;
        value
    }
}

/// Convert milliseconds to [`Duration`] without pulling `Duration::from_secs_f64`
/// (and its formatting/panic strings) into Wasm. Non-positive or NaN inputs return
/// `Duration::ZERO`; values past `u64::MAX` seconds saturate to `Duration::MAX`.
pub(crate) fn duration_from_ms(ms: f64) -> Duration {
    if !(ms > 0.0) {
        return Duration::ZERO;
    }
    let secs_f = (ms / 1000.0).floor();
    if secs_f >= 18_446_744_073_709_551_616.0 {
        return Duration::MAX;
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let secs = secs_f as u64;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let nanos = ((ms - secs_f * 1000.0) * 1_000_000.0).round() as u32;
    Duration::new(secs, 0).saturating_add(Duration::from_nanos(u64::from(nanos)))
}

/// A phase timeout preserves errors returned by the operation itself.
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
pub(crate) fn timeout_phase<T, E: From<Error>, F: Future<Output = std::result::Result<T, E>>>(
    duration: Duration,
    phase: crate::TimeoutPhase,
    configured: Duration,
    fut: F,
) -> impl Future<Output = std::result::Result<T, E>> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use futures_util::FutureExt;
        tokio::time::timeout(duration, fut).map(move |result| {
            result.unwrap_or_else(|_| Err(Error::phase_timeout(phase, configured).into()))
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        crate::wasm::futures::Deadline::new(fut, duration, phase, configured)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_from_ms_handles_edges() {
        assert_eq!(duration_from_ms(0.0), Duration::ZERO);
        assert_eq!(duration_from_ms(-5.0), Duration::ZERO);
        assert_eq!(duration_from_ms(f64::NAN), Duration::ZERO);
        assert_eq!(duration_from_ms(0.5), Duration::from_micros(500));
        assert_eq!(duration_from_ms(1500.0), Duration::from_millis(1500));
        assert_eq!(duration_from_ms(f64::INFINITY), Duration::MAX);
        assert_eq!(duration_from_ms(1e30), Duration::MAX);
    }
}
