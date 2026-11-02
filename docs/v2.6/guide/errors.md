---
search: false
editLink: false
lastUpdated: false
---

# Errors

::: warning Documentation for 2.6.x
This documents rust-fetch 2.6.x. For the latest version, see the [current documentation](/). The [changelog](https://github.com/asemqaffaf/rust-fetch/blob/main/CHANGELOG.md#270---2026-11-02) lists what 2.7 added.
:::


Every rejection is an `Error` whose `name` and `kind` are one of:

| `kind` | When | Extra fields |
| --- | --- | --- |
| `HttpError` | Non-2xx response | `status`, `statusText`, `body` (full response body as text) |
| `TimeoutError` | An attempt exceeded `timeoutMs` | `timeoutMs` |
| `NetworkError` | DNS, connection, TLS or CORS failure, a body cut off mid-transfer, a WebSocket that fails to connect or drops, or a limit you set | The limit that was reached, when one was: `maxResponseBytes`, `maxPendingRequests`, `maxLineBytes`, `maxEventBytes`, `maxQueuedMessages` or `maxQueuedBytes` |
| `CancelledError` | The `signal` was aborted | |
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

With a [retry budget](/v2.6/guide/timeouts-and-retries#retries), an error whose retry the budget refused also has `retryBudgetExhausted: true`, whatever its `kind`.

Long error bodies (such as an HTML error page) are truncated to 200 characters in `message`. `error.body` always has the full text.
