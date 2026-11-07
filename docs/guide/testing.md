# Testing your code

`createMockTransport()`, from `rust-fetch/testing` (a separate file, so it never reaches your production bundle), answers your client's requests from routes you write, so unit tests need no server and no network. The client still runs its real retry policy, timeouts, cancellation, error mapping and response decoding: only the bytes come from your routes.

```js
import { WasmClient } from 'rust-fetch';
import { createMockTransport } from 'rust-fetch/testing';

const mock = createMockTransport()
  .on('GET', '/users/42', { status: 200, body: { id: 42 } })
  .on('POST', '/users', ({ body }) => ({ status: 201, body: { id: 1, ...body } }))
  .onAny({ status: 503 }); // everything else

const client = new WasmClient({ baseUrl: 'https://api.test', transport: mock });

const user = await client.get('/users/42'); // user.body is { id: 42 }
mock.calls; // [{ method: 'GET', url: 'https://api.test/users/42', path: '/users/42', query: {}, headers: {…}, body: undefined }]
```

## Routes

`on(method, matcher, response)` matches a request whose method is `method` and whose path (or full URL) equals `matcher` (a string), matches a `RegExp`, or satisfies a function of the call. The first route that matches wins. `onAny(response)` matches everything; add it last. A request no route matches fails with a `NetworkError`.

A `response` is an object, an `Error`, or a function of the call that returns either (or a promise of one):

| Field | |
| --- | --- |
| `status` | Default 200. Non-2xx statuses reject with an `HttpError`, and 429 and 5xx are retried like real ones |
| `headers` | Names are lower-cased. `retry-after` is honoured |
| `body` | An object is sent as JSON, a string as text, bytes as they are |
| `delayMs` | Wait before answering, to test `timeoutMs`, `responseTimeoutMs` and cancellation |
| `error` | `true`, a message or an `Error`: fail like a network error |

The call a function receives has `method`, `url`, `path`, `query`, `headers` (lower-case names) and `body`: parsed for JSON, text for text, bytes otherwise.

## What it covers

- Every buffered request method, `extend()` clients included.
- Retries, timeouts (`timeoutMs`, `responseTimeoutMs`), `AbortSignal` cancellation (with `error.reason`), `responseType`, error mapping, interceptors.
- Not covered: streamed responses (`responseType: 'stream'` and `'ndjson'` reject with a `NetworkError` saying so), `events()` and `websocket()`, which use the real network.

Keep the transport per test: `mock.reset()` clears routes and recorded calls.

## Under the hood

`transport` is an option for the client: a function that takes the request and returns a promise of the response, with a `cancel()` method. `createMockTransport()` builds one. The shape is internal and may change, so write custom transports against `createMockTransport()`'s behaviour and not the request object.
