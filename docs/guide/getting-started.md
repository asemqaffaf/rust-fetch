# Getting started

```bash
npm install rust-fetch
```

## Your first request

**Node.js** (20 or newer): the WebAssembly module loads on import.

```js
import { WasmClient } from 'rust-fetch';

const client = new WasmClient();
const res = await client.get('https://jsonplaceholder.typicode.com/todos/1');
console.log(res.status, res.body.title);
```

**Browsers and bundlers**: call `init()` once before the first request. It downloads and compiles the `.wasm` file.

```js
import init, { WasmClient } from 'rust-fetch';

await init();
const client = new WasmClient();
```

`init()` is safe to call more than once, and calling it in Node.js is harmless, so shared code can always call it. Serve the `.wasm` file with `Content-Type: application/wasm`, so the browser compiles it while it downloads, and consider preloading it (see [Startup](/performance#startup)).

## Handling errors

A client with a base URL, timeouts and retries. Every failure rejects with a typed error, so one `catch` handles them all:

```js
import { WasmClient } from 'rust-fetch';

const api = new WasmClient({
  baseUrl: 'https://api.example.com/v1',
  timeoutMs: 10_000, // per attempt, including reading the body
  retries: 3,        // exponential backoff with jitter; honours Retry-After
});

try {
  const { body: user } = await api.get('/users/42');
} catch (error) {
  if (error.kind === 'HttpError' && error.status === 404) {
    // not found: error.body has the response text
  } else if (error.kind === 'TimeoutError') {
    // the last attempt took over 10 s, with no retries left
  } else {
    throw error;
  }
}
```

See [Errors](/guide/errors#errors) for every `kind` and its fields.

## A recommended production client

The protections against retry storms, unbounded queues, oversized responses and leaked credentials are off by default, so upgrading never changes behaviour. For a server or app calling an API you know, turn them on:

```js
import { WasmClient } from 'rust-fetch';

const api = new WasmClient({
  baseUrl: 'https://api.example.com/v1',
  timeoutMs: 10_000,                  // per attempt, including the body
  retries: 2,                         // GET, HEAD, PUT, DELETE…; POST and PATCH aren't retried
  retryBudget: true,                  // no retry storms when the API struggles
  maxPendingRequests: 256,            // shed load instead of queuing without bound
  maxResponseBytes: 10 * 1024 * 1024, // 10 MB, after decompression
  allowAbsoluteUrls: false,           // a path can't replace the host, so credentials stay with it
});

// Credentials that change: add them to each request as it starts
api.addRequestInterceptor(async (request) => {
  request.headers.authorization = `Bearer ${await getAccessToken()}`;
});
```

`getAccessToken()` stands for your own auth code. This is the [fixed API configuration](/security#hardened-configurations) from the security page, with the token in an interceptor instead of a fixed header; that page also has configurations for fetching URLs from users and for streaming APIs.

## Interceptors

Interceptors run code around every request on the client: add headers, unwrap bodies, report failures in one place.

```js
// Resolve to the body instead of the whole response
api.addResponseInterceptor((response) => response.body);

// Report failures, then keep rejecting
api.addResponseInterceptor(undefined, (error) => {
  console.error('request failed:', error.kind, error.message);
  throw error;
});

const user = await api.get('/users/42'); // the body, thanks to the first interceptor
```

See [Interceptors](/guide/interceptors#interceptors) for their order, how to remove them, and recovering from errors.

## Streaming a response

`client.events()` reads Server-Sent Events, as streaming LLM APIs send them, in browsers and Node.js, with any method, headers and body:

```js
const stream = api.events('/chat/completions', {
  method: 'POST',
  body: { model: 'my-model', messages: [{ role: 'user', content: 'Hello' }], stream: true },
  messageType: 'json', // parse each event's data; ends at `data: [DONE]`
});
for await (const { data } of stream) {
  console.log(data.choices[0].delta.content ?? '');
}
```

For raw bytes, use `responseType: 'stream'`; for newline-delimited JSON, `responseType: 'ndjson'`. See [Streaming and Server-Sent Events](/guide/streaming#streaming).

## Opening a WebSocket

A WebSocket on the same client uses its base URL, timeout and typed errors, and can reconnect after unexpected drops (browsers and Node.js 22+):

```js
const socket = api.websocket('/live', {   // wss://api.example.com/v1/live
  messageType: 'json',
  reconnect: true,                        // 1 s doubling to 30 s, with jitter
  onMessage: (message) => console.log(message),
});

await socket.opened;
socket.sendJson({ type: 'subscribe', channel: 'prices' });
```

See [WebSockets](/guide/websockets#websockets) for every option, queue limits and close codes.

## Next steps

- [Guide overview](/guide/): every method and the options you'll use most, on one page.
- [Timeouts, retries and cancellation](/guide/timeouts-and-retries#timeouts-retries-and-cancellation): what each attempt covers, and the retry budget.
- [Security](/security#security): SSRF protection, size limits and hardened configurations.

> **Release status**
> - **On npm (2.6.1):** everything in these docs except what the [2.7.0 changelog](https://github.com/asemqaffaf/rust-fetch/blob/main/CHANGELOG.md#270---2026-11-08) lists under *Added* (streaming request bodies, phase timeouts, circuit breakers, rate limits, idempotency keys, per-request retry policies and observability), which is prepared but not yet published.
> - **In the repository, not yet in the npm package:** the [native Node.js transport](/performance#the-native-transport-not-in-the-npm-package-yet), behind the largest performance gains. The package doesn't include its prebuilt binaries yet; build it with `npm run build:native`.
