//! Platform-specific timers, timeouts and randomness
//!
//! On WebAssembly this only relies on the global `setTimeout`/`clearTimeout`
//! functions, so it works in browsers, Web Workers, Node.js, Deno and Bun
//! (unlike `window.setTimeout`, which only exists in a browser window).

use crate::error::{Error, Result};
use std::future::Future;
use std::time::Duration;

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
pub(crate) async fn timeout<T>(
    duration: Duration,
    fut: impl Future<Output = Result<T>>,
) -> Result<T> {
    let timed_out = || Error::Timeout {
        duration_ms: u64::try_from(duration.as_millis()).unwrap_or(u64::MAX),
    };

    #[cfg(not(target_arch = "wasm32"))]
    {
        tokio::time::timeout(duration, fut)
            .await
            .map_err(|_| timed_out())?
    }

    #[cfg(target_arch = "wasm32")]
    {
        // A future of its own, not `select` on a pinned local: that kept two
        // copies of `fut` in this function's state (see `Abortable`)
        crate::wasm::futures::Deadline::new(fut, duration)
            .await
            .unwrap_or_else(|()| Err(timed_out()))
    }
}

/// Milliseconds on a clock that only matters for intervals (the retry budget)
pub(crate) fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
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
