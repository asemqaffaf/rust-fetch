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

/// [`timeout_phase`] when `duration` is set; otherwise just `fut`, as one
/// future type so that `fut` is compiled into a single poll function.
#[cfg(target_arch = "wasm32")]
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
    use futures_util::FutureExt;
    crate::wasm::futures::Deadline::optional(fut, duration).map(move |result| {
        result.unwrap_or_else(|()| Err(Error::phase_timeout(phase, configured).into()))
    })
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
        crate::wasm::futures::Deadline::optional(fut, duration)
            .await
            .unwrap_or_else(|()| {
                Err(Error::Timeout {
                    duration_ms: duration.map_or(u64::MAX, |d| {
                        u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
                    }),
                })
            })
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

/// A phase timeout preserves errors returned by the operation itself.
pub(crate) fn timeout_phase<T, E: From<Error>, F: Future<Output = std::result::Result<T, E>>>(
    duration: Duration,
    phase: crate::TimeoutPhase,
    configured: Duration,
    fut: F,
) -> impl Future<Output = std::result::Result<T, E>> {
    use futures_util::FutureExt;
    #[cfg(not(target_arch = "wasm32"))]
    let timed = tokio::time::timeout(duration, fut);
    #[cfg(target_arch = "wasm32")]
    let timed = crate::wasm::futures::Deadline::new(fut, duration);
    // Hold the operation once: an async wrapper retained another copy of
    // its state while moving it into the timer.
    timed.map(move |result| {
        result.unwrap_or_else(|_| Err(Error::phase_timeout(phase, configured).into()))
    })
}
