# Errors

Every rejection is an `Error` whose `name` and `kind` are one of:

| `kind` | When | Extra fields |
| --- | --- | --- |
| `HttpError` | Non-2xx response | `status`, `statusText`, `body` (full response body as text) |
| `TimeoutError` | An attempt, phase timer or logical deadline expired | `timeoutMs`, `phase` (`connect`, `response`, `idle`, `total`) |
| `CircuitOpenError` | Opt-in [circuit breaker](/guide/circuit-breakers) refused the attempt | `origin`, `retryAfterMs` |
| `NetworkError` | DNS, connection, TLS or CORS failure, a body cut off mid-transfer, a WebSocket that fails to connect or drops, or a limit you set | The limit that was reached, when one was: `maxResponseBytes`, `maxPendingRequests`, `maxLineBytes`, `maxEventBytes`, `maxQueuedMessages` or `maxQueuedBytes` |
| `CancelledError` | The `signal` was aborted | `reason` and `cause`: the signal's abort reason |
| `InvalidInputError` | Bad URL, method, header, option or body. Rejected before anything is sent. | `parameter` |
| `ParseError` | `responseType: 'json'` and the body isn't JSON | |
| `JsInteropError` | Unexpected JS ↔ Wasm conversion failure | |

```js
try {
  await client.get('/users/9');
} catch (error) {
  if (error.kind === 'HttpError' && error.status === 404) {
    // not found
  } else if (error.kind === 'TimeoutError') {
    console.warn(`gave up after ${error.timeoutMs} ms`);
  } else {
    throw error;
  }
}
```

A `CancelledError` carries the signal's abort reason as `reason` (and as the standard `cause`), so you can tell a user cancellation from a deadline:

```js
try {
  await client.get('/report', { signal: AbortSignal.timeout(5_000) });
} catch (error) {
  if (error.kind === 'CancelledError' && error.reason?.name === 'TimeoutError') {
    // the deadline passed, nobody cancelled
  }
}
```

`controller.abort()` without an argument gives a `DOMException` named `AbortError`; `controller.abort(value)` gives `value`. This covers requests, retry delays, response streams (`stream` and `ndjson`) and the `opened` promise of `events()` and `websocket()` when the signal aborts before they open. A signal that aborts an open `events()` or `websocket()` connection closes it cleanly, so nothing rejects.

With a [retry budget](/guide/timeouts-and-retries#retries), an error whose retry the budget refused also has `retryBudgetExhausted: true`, whatever its `kind`.

Request errors also carry `method`, `url` and `attempts` (zero for validation failures). The URL identifies the last destination known to the transport and includes query strings unless you configure `redactUrl`. Opt-in [observability](/guide/observability) adds timings and preserves an underlying JavaScript `cause` where available. SSE and WebSocket errors carry connection context too.

Long error bodies (such as an HTML error page) are truncated to 200 characters in `message`. `error.body` always has the full text.
