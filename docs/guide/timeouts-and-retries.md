# Timeouts, retries and cancellation

## Timeouts

`timeoutMs` limits each attempt, from sending the request to receiving the last byte of the body. When retries are on, each attempt gets the full timeout. For `responseType: 'stream'`, the timeout covers only the wait for the headers; after that, reading the stream is up to you.

## Retries

Retries are off by default. `retries: 3` enables them with these defaults; pass an object to change them:

```ts
new WasmClient({
  retries: {
    maxRetries: 3,          // retries after the first attempt
    initialDelayMs: 100,    // first backoff
    maxDelayMs: 10_000,     // cap for any delay, including Retry-After
    multiplier: 2,          // exponential backoff: 100, 200, 400 … ms, each randomized to 50–100%
    retryOn: [408, 429, 500, 502, 503, 504],
    retryOnNetworkError: true,
    retryOnTimeout: true,
    retryNonIdempotent: false, // set to true to also retry POST and PATCH
  },
});
```

- A `Retry-After` header in seconds is honoured, capped at `maxDelayMs`.
- POST and PATCH aren't retried by default. The server may already have acted on a failed attempt, so retrying can duplicate work.
- `InvalidInputError`, `ParseError` and unlisted statuses are never retried.
- When every attempt fails, the request rejects with the last attempt's error.

Set `retries` per request to replace the client's policy for that call:

```js
const client = new WasmClient({ retries: 3 });
await client.get('/search', { params: { q: 'rust' }, retries: 0 });
await client.post('/sync', {
  body: { cursor: 42 },
  retries: { maxRetries: 5, retryNonIdempotent: true },
});
```

`0` disables retries. Omitting `retries` (or passing `undefined` or `null`) uses the client's policy. An object replaces the whole policy: omitted fields take the standard defaults above, so `{ maxRetries: 1 }` does not inherit a client's custom `retryOn` or `retryNonIdempotent`. It applies to buffered responses, streamed responses, progress requests and `events()` connection attempts. For `events()`, `reconnect` separately controls opening another connection after a failed connection or an ended stream; `retries: 0` does not disable reconnection. Per-request retries still use the client's shared retry budget.

In Rust, use `RequestBuilder::retry_config(RetryConfig { … })` to replace the policy, or `RequestBuilder::no_retries()` to disable retries for one request.

### Idempotency keys

If an API supports deduplication using an idempotency key, you can retry POST and PATCH without `retryNonIdempotent`:

```js
const client = new WasmClient({ retries: 3 });
await client.post('/payments', {
  body: { amount: 1000 },
  idempotencyKey: true, // crypto.randomUUID(), once per call, reused on every attempt
});
await client.post('/payments', { body: { amount: 1000 }, idempotencyKey: 'order-42' });
```

The default header is `Idempotency-Key`; set `idempotencyHeader: 'X-Request-Key'` when an API uses another name. These options may also be client defaults. Prefer a client default of `idempotencyKey: true`; an explicit client string reuses the same key across calls and can cause a server to treat different operations as duplicates. Pass `idempotencyKey: false` to opt out for a call. `null`/`undefined` inherit the default.

- **The server must honor the key.** The client alone cannot prevent duplicate effects. Follow the API's rules about key format, retention time and reuse with identical payloads. Reuse an explicit key when retrying the same operation across separate calls or application restarts.
- Keys are non-empty strings of visible ASCII characters without whitespace. The option sets/replaces the chosen header after request interceptors. A raw header alone does not change the existing retry rules.
- Keys allow POST/PATCH replay under the configured retry policy; they do not enable retries, override `retries: 0`, change retryable statuses, or bypass the shared retry budget. CONNECT remains non-idempotent.
- Automatic generation requires `crypto.randomUUID()` (a secure browser context or a runtime providing Web Crypto); otherwise an `InvalidInputError` is returned before sending. Explicit keys work without it.
- Applies to progress requests, streamed responses and SSE. `events()` keeps a generated key across connection retries and reconnections, without changing the caller's options.
- **Rust:** `.idempotency_key("order-42")?`, or `.idempotency_key_header("X-Request-Key", "order-42")?` with a custom header, on a `RequestBuilder`. Generate keys in the application when using the Rust API.

**Retry budget.** When an upstream fails, every request in flight retries at once, which multiplies the load on a service that's already struggling (a retry storm). `retryBudget` limits retries across the client, the gRPC and Finagle way:

```js
const client = new WasmClient({ retries: 3, retryBudget: true }); // or { ratio: 0.2, minPerSecond: 10, windowMs: 10_000 }
try {
  await client.get('/orders');
} catch (error) {
  error.retryBudgetExhausted; // true when the budget refused a retry; the error is the attempt's own (e.g. HttpError 503)
}
client.retriesRefused; // refusals so far
```

- **Only retries are limited.** First attempts are always sent, and each one adds to the budget.
- **The allowance:** retries may add `ratio` of the first attempts in the last `windowMs`, plus `minPerSecond` for each second of the window, so a quiet client can still retry. With the defaults (0.2, 10, 10 s): 100 retries per 10 s, plus one for every five requests.
- **Refill:** the window slides in tenths, so attempts and retries older than `windowMs` stop counting and a spent budget refills as time passes.
- **When it's spent:** it's checked before waiting to retry, so an exhausted budget fails at once without the backoff, and spent when the retry is sent, so a request cancelled while waiting uses nothing. Two requests can both pass the check and then race for the last retry; the one that loses is refused.
- **Scope:** one budget per client, for all origins, shared by a Rust client's clones. To keep one failing upstream from using up the retries of others, give each upstream its own client.
- **Rust:** `ClientBuilder::retry_budget(RetryBudget::new().ratio(0.2))` and `Client::retries_refused()`.

The default is no budget, as before.

## Cancellation

```js
const controller = new AbortController();
const request = client.get('/report', { signal: controller.signal });
controller.abort();
try {
  await request;
} catch (error) {
  console.log(error.kind); // 'CancelledError'
}

await client.get('/report', { signal: AbortSignal.timeout(5_000) }); // total deadline, including retries
```

Aborting cancels the request in flight, any pending retry delay, and a body being streamed.
