# Introduction

## Why rust-fetch?

`fetch()` gives you a request primitive; rust-fetch gives you the policy around it. With `fetch()`, every caller checks `res.ok`, wires up an `AbortSignal` for timeouts, and writes its own retry loop. rust-fetch does that once, correctly, for every request.

### Compared with `fetch()` and axios

| | `fetch()` | axios | rust-fetch |
| --- | --- | --- | --- |
| Rejects on HTTP errors (4xx, 5xx) | No, check `res.ok` | Yes | Yes, with `status` and the body |
| Timeouts | Wire up `AbortSignal.timeout()` | `timeout` option | `timeoutMs` per attempt, including the body; 30 s by default |
| Retries with backoff | No | With a plugin (`axios-retry`) | Built in: jitter, `Retry-After`, no POST or PATCH retries unless enabled |
| Interceptors | No | Yes | Yes |
| Server-Sent Events | `EventSource`: browsers only, `GET` only, no custom headers | No | `client.events()`: any method, headers and body, reconnection, browsers and Node.js |
| Download progress | Read the stream yourself | Yes | Yes |
| Upload progress | No | Yes | Yes |
| Reuses connections in Node.js by default | Yes | No, needs a keep-alive agent | Yes, up to 256 per origin |
| Blocks requests to private networks (SSRF) | No | No | `allowPrivateNetwork: false` (Node.js) |
| Limits response size, including decompression | No | `maxContentLength` | `maxResponseBytes` |
| Refuses requests beyond a pending limit (load shedding) | No | No | `maxPendingRequests` |
| Header values with CR/LF | Rejected | Stripped silently | Rejected |
| Added to a browser bundle (brotli) | Nothing, it's built in | About 21 KB | About 131 KB: the WebAssembly module (121 KB) and its JS glue |

The rust-fetch column describes the JavaScript API; the Rust crate has no interceptors, upload progress or WebSockets ([Rust usage](/rust#using-it-from-rust)).

### One client for HTTP and WebSockets

Real-time features usually mean a second client with its own URL handling, timeouts and error handling. In rust-fetch, `client.websocket()` is part of the same client: it resolves against the same `baseUrl`, uses the same timeout for each connection attempt, and fails with the same typed errors as requests. It also adds what the platform's `WebSocket` lacks: reconnection with backoff after unexpected drops, a connect timeout, `opened`/`closed` promises and JSON messages ([WebSockets](/guide/websockets#websockets)).

### Compared with `undici.request()`

`undici.request()`, the engine under Node's `fetch()`, is a lower-level, Node.js-only API. It was faster than both rust-fetch transports for small requests over plain HTTP in our tests, so it's the better choice when raw throughput is all you need and you'll build error handling, timeouts and retries yourself. rust-fetch is the better choice when you want that policy built in and the same client in browsers. Over HTTPS, the native transport matched `undici.request()` (30,452 against 30,546 requests per second), and on 8 MB bodies it was ahead (322 against 301).

### When to choose something else

- **Every kilobyte counts in your browser bundle.** The WebAssembly module is about 121 KB brotli-compressed.
- **You only need raw throughput in Node.js** and will handle failures yourself: use `undici.request()` (see above).
- **Your latency is the server, not the client.** If each request waits seconds on the other side (an AI model, a payment provider, a report) and you send a few a minute, no HTTP client will make it faster. rust-fetch would still give you per-attempt timeouts, retries and typed errors, but if your SDKs already do that, you don't need it.
- **Your calls go through vendor SDKs.** Most payment, email and AI SDKs make their own requests. Using rust-fetch there means passing it as a custom `fetch` where the SDK allows that; it's simplest for calls your own code makes.
- **You need a long track record.** rust-fetch 2.x is new: 2.0 to 2.5 shipped within three days in October 2026, and download counts are still small. See the [stability policy](/stability#stability-and-releases) for how releases work from here.
- **Your Node.js code makes one request at a time** and you're considering the native transport for speed: there it's level with the node:http transport and a few percent behind `fetch()` (it was about 6% slower before 2.4.0).

## Features

Unless noted, each of these works the same in browsers, Web Workers and Node.js 20+.

**Reliability**
- **Typed errors.** Every rejection is a real `Error` with a `kind` (`HttpError`, `TimeoutError`, `NetworkError`, …) and details like `status`, `body` and `timeoutMs`, so error handling branches on data instead of parsing messages. [Errors](/guide/errors#errors)
- **Per-attempt timeouts** that cover the response body, not just the headers, so a server that stalls mid-body can't hang a request. The default is 30 s. [Timeouts](/guide/timeouts-and-retries#timeouts)
- **Retries** with exponential backoff and jitter, so clients recovering at the same time don't hit a struggling server in lockstep. `Retry-After` is honoured, and POST/PATCH aren't retried unless you opt in, so a retry can't duplicate an order or a payment. [Retries](/guide/timeouts-and-retries#retries)
- **Cancellation** with `AbortSignal`, which also stops pending retry delays and streamed bodies, so an abandoned request releases its resources. [Cancellation](/guide/timeouts-and-retries#cancellation)
- **Interceptors** for requests and responses: add auth headers, refresh tokens and report errors in one place. [Interceptors](/guide/interceptors#interceptors)

**Requests and responses**
- **Request bodies** from strings, bytes, `Blob`/`File`, `FormData` (multipart with files), `URLSearchParams` or JSON, with the matching `Content-Type` set for you. [Request bodies](/guide/requests#request-bodies)
- **Response decoding** by `Content-Type` (including `application/*+json`), or forced to `json`, `text`, `binary` or `stream`. [Responses](/guide/requests#responses)
- **Streaming** responses as a `ReadableStream`, and **download progress** callbacks, for large downloads. [Streaming](/guide/streaming#streaming)
- **Server-Sent Events** with `client.events()`: in browsers and Node.js, with any method, headers and body (as streaming LLM APIs need), JSON data, reconnection with `Last-Event-ID`, and `for await`. **Newline-delimited JSON** with `responseType: 'ndjson'`. [Server-Sent Events](/guide/streaming#server-sent-events)
- **Upload progress** callbacks, for progress bars on large uploads, which `fetch()` can't report. [Upload progress](/guide/uploads#upload-progress)

**Safety with servers and URLs you don't control**
- **SSRF protection:** `allowPrivateNetwork: false` blocks loopback, private, link-local and metadata addresses, checked on the resolved address when connecting, on every redirect and on every WebSocket connection (Node.js). [SSRF](/security#fetching-user-supplied-urls-ssrf)
- **Credential-safe redirects:** `Authorization`, `Cookie` and `Proxy-Authorization` never follow a redirect to another origin; `sensitiveHeaders` adds your own (`X-Api-Key`), and `allowInsecureRedirects: false` refuses HTTPS → HTTP. [Security](/security#security)
- **Size limits** for a whole response, decompression bombs included (`maxResponseBytes`), one NDJSON or SSE line (`maxLineBytes`) and one SSE event (`maxEventBytes`). [Size limits](/security#response-size-limits-and-decompression-bombs)
- **`allowAbsoluteUrls: false`** keeps a URL from your users from sending the client's credentials away from `baseUrl`, and header values with CR/LF are rejected. [Absolute URLs](/security#absolute-urls-and-baseurl)
- **Hardened configurations** to copy, each checked by a test. [Hardened configurations](/security#hardened-configurations)

**Limits under load**
- **Load shedding:** `maxPendingRequests` refuses a request at once beyond a limit, instead of queuing without bound. [Load shedding](/security#limiting-pending-requests-load-shedding)
- **A retry budget:** `retryBudget` keeps a failing upstream from getting every request retried at once. [Retry budget](/guide/timeouts-and-retries#retries)
- **Backpressure:** a slow reader of a stream or a `for await` over Server-Sent Events holds the server back instead of buffering everything. [Memory while streaming](/guide/streaming#streaming)

**Real-time**
- **WebSockets on the same client**: the same base URL, timeouts and typed errors as your requests, plus reconnection with jittered backoff after unexpected drops. Browsers and Node.js 22+ (Node.js 20 with `--experimental-websocket`). [WebSockets](/guide/websockets#websockets)

**Node.js**
- **A bounded connection pool**: up to 256 keep-alive connections per origin, so traffic bursts queue and reuse connections instead of exhausting local ports. [Connection pooling](/architecture#connection-pooling)
- **A native transport** (not in the npm package yet; build it from source) that moves connection work off the event loop for more throughput under concurrency, and steps aside automatically for custom agents and proxies. [Architecture](/architecture#architecture)

**Tooling and quality**
- **TypeScript** definitions for the whole API, and the same client [as a Rust library](/rust#using-it-from-rust).
- **Tested** with 100% line and function coverage of the Rust core and of the Node.js transport, enforced in CI, and with the JS suites on Node.js 20, 22 and 24. [Development](/development#development-and-benchmarking)
