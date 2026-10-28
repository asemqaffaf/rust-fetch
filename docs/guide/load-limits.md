# Concurrency and rate limits

Limit the load a client sends to an API before it has to respond with `429`:

```js
const client = new WasmClient({
  baseUrl: 'https://api.example.com',
  maxConcurrent: 10,
  rateLimit: { requests: 100, perMs: 60_000 },
  maxPendingRequests: 500,
});
```

Both limits are optional and off by default. They run in the shared Rust core, on every transport and for `events()` connection attempts.

- **Concurrency:** at most `maxConcurrent` attempts are in flight. A buffered response releases its slot after the body is read. A streamed response or SSE connection holds its slot until EOF, a stream error or cancellation. Consume or cancel streamed bodies so they release their slots; consider separate clients for long-lived streams and ordinary calls.
- **Rate:** a token bucket starts with `requests` tokens and refills continuously over `perMs`. Each attempt, including a retry, spends one token when admitted. A burst up to `requests` is allowed; this is not a fixed-window counter.
- **Queue:** FIFO admission. A retry releases its concurrency slot, waits for backoff, then joins the back of the queue. Cancelling a queued request removes it without sending or spending a token. An attempt's `timeoutMs` starts after admission; use an `AbortSignal` for a deadline that includes queue time.
- **Server feedback:** a `429` with `Retry-After` in seconds pauses the bucket for at least that interval, even when the failed request has no retries. Existing in-flight attempts continue. Queued calls still honor cancellation.
- **Scope:** the defaults are global across a client and its Rust clones. Set `limitsPerOrigin: true` for independent limits per origin (scheme, hostname and port); one slow API then cannot consume another API's slots. Redirect hops remain part of the admitted attempt.
- **Bound the queue:** use `maxPendingRequests` to reject excess demand before it is queued. The retry budget is separate: it is checked before backoff and spent when a retry is admitted, so cancelling a retry in the queue spends nothing.

Values must be positive integers (`perMs` may be a positive finite millisecond duration). Invalid configuration throws an `InvalidInputError` before sending.

In Rust:

```rust,no_run
use rust_fetch::{Client, RateLimit};
use std::time::Duration;

let client = Client::builder()
    .max_concurrent(10)
    .rate_limit(RateLimit::new(100, Duration::from_secs(60)))
    .limits_per_origin(true)
    .max_pending_requests(500)
    .build()?;
```
