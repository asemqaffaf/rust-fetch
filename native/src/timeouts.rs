//! Optional phase timers. The ordinary transport future stays unboxed.

use futures_util::future::Either;
use std::{future::Future, time::Duration};

const PREFIX: &str = "RUST_FETCH_PHASE_TIMEOUT:";

pub(crate) fn duration(ms: Option<f64>) -> Option<Duration> {
    ms.filter(|ms| ms.is_finite() && *ms > 0.0)
        .and_then(|ms| Duration::try_from_secs_f64(ms / 1000.0).ok())
}

fn message(phase: &str, duration: Duration) -> String {
    format!("{PREFIX}{phase}:{}", duration.as_secs_f64() * 1000.0)
}

pub(crate) fn details(message: &str) -> Option<(&str, f64)> {
    let (phase, ms) = message.strip_prefix(PREFIX)?.split_once(':')?;
    let ms = ms.parse::<f64>().ok()?;
    (matches!(phase, "connect" | "response" | "idle") && ms.is_finite() && ms >= 0.0)
        .then_some((phase, ms))
}

pub(crate) fn wait<'a, T, F: Future<Output = Result<T, String>> + 'a>(
    duration: Option<Duration>,
    phase: &'static str,
    future: F,
) -> impl Future<Output = Result<T, String>> + 'a {
    match duration {
        None => Either::Left(future),
        Some(duration) => Either::Right(Box::pin(async move {
            tokio::time::timeout(duration, future)
                .await
                .map_err(|_| message(phase, duration))?
        })),
    }
}

pub(crate) fn until<'a, T, F: Future<Output = Result<T, String>> + 'a>(
    deadline: Option<tokio::time::Instant>,
    configured: Option<Duration>,
    future: F,
) -> impl Future<Output = Result<T, String>> + 'a {
    match deadline.zip(configured) {
        None => Either::Left(future),
        Some((deadline, configured)) => Either::Right(Box::pin(async move {
            tokio::time::timeout_at(deadline, future)
                .await
                .map_err(|_| message("response", configured))?
        })),
    }
}
