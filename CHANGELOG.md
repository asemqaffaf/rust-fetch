# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **A redirect's body is read up to 64 KiB, then its connection is closed.** On the node:http transport, the body of a followed redirect was drained in the background with no end, so a server sending an endless redirect body kept that connection, and its slot in the pool of 256 per origin, busy for good. The native transport read the whole redirect body into memory before following it, so an endless one grew memory until the request timed out. Small redirect bodies are still drained so their connection is reused. Tests cover both transports: the redirect is followed promptly, each connection closes, 50 in a row keep memory bounded, and a redirect-limit error or cancellation closes them too.

## [2.5.1] - 2026-10-24

### Fixed
- **Requests are fast again: 2.5.0 threw and caught an exception on every request without an options object.** It read `maxResponseBytes` with `Reflect.get` even when no options were passed, and `Reflect.get(undefined, …)` throws. That nearly doubled rust-fetch's own cost per request (9.05 → 17.27 µs with an instant transport). Under load, an independent evaluation measured 18% lower throughput than 2.4.0. A request's options are now read once (`Object.keys` on plain objects), and unset options cost no lookup at all. Per request: 9.07 µs without options (2.4.1: 9.05 µs) and 10.71 µs with options (2.4.1: 13.27 µs, 2.5.0: 14.60 µs). A regression test fails if any option lookup could throw again.
- The private-network check only computes the request host when it's turned on.

### Changed
- `npm run bench:compare` (and the benchmark job on pull requests) now also measures rust-fetch's own cost per request with an instant transport, which isn't drowned out by runner noise, and calls `client.get(url)` without options in the small-JSON scenarios, as most code does.

### Documentation
- The README leads with what holds at any request rate: typed errors, timeouts and retries, and safety with untrusted servers and URLs. The speed figures are qualified as high-volume results.
- New cases in *When to choose something else*: the server is the bottleneck, calls go through vendor SDKs, or you need a long track record.
- The comparison with `fetch()` and axios gains SSRF, response-size and header-injection rows.
- A *Stability and releases* policy: semver on 2.x, minor releases at most every two weeks from 2.6.0, patch releases only for regressions and security fixes, and how releases are checked.

## [2.5.0] - 2026-10-24

### Added
- **`allowAbsoluteUrls`** (client and per request, also for `events()` and `websocket()`): with `false`, an absolute URL on a client with a `baseUrl` rejects with an `InvalidInputError` instead of replacing the base URL, and so the client's headers such as `Authorization` can't be sent to a host taken from user input (the class of axios CVE-2025-27152). Default `true`, as before. Rust: `allow_absolute_urls()` on `ClientBuilder` and `RequestBuilder`.
- **`maxResponseBytes`** (client and per request; `null` per request for none): rejects responses whose decompressed body is larger, with a `NetworkError` that carries the limit as `maxResponseBytes`. Checked against `Content-Length` before reading, counted while reading, and enforced while decompressing (gzip, deflate, brotli, zstd stop one byte past the limit), so a decompression bomb never expands in memory: a 64 MB gzip bomb with a 1 MB limit fails with no measurable memory growth. Applies on every transport, to error bodies, and to streamed bodies (the stream errors). Rust: `max_response_bytes()` on `ClientBuilder` and `RequestBuilder`, and `Error::response_too_large()`.
- **SSRF protection: `allowPrivateNetwork: false`** (Node.js, client and per request): requests to private and reserved addresses reject with a `NetworkError` before connecting. Blocked: loopback, RFC 1918, link-local (cloud metadata), CGNAT, multicast, reserved and documentation ranges, IPv6 unique-local/link-local/multicast, and IPv4-mapped and NAT64 forms. Every address a name resolves to is checked when connecting (DNS rebinding can't slip past), IP-literal hosts before the request, on every redirect; checked requests use their own connection pool. Through a proxy, only IP-literal targets are checked. Not applied to `websocket()`; ignored in browsers.
- README *Security* section: what the client protects against, and a comparison with `fetch()` and axios (`npm run security:compare`).
- **Security regression tests** (`security.test.mjs`, both Node.js transports): one test per vulnerability class found in other clients, named after the advisories, so a change that reintroduces one fails CI.
- The Node.js entry point is 33.2 kB (11.1 kB gzipped) with the SSRF guard; its budget is 36 kB / 12 kB. Browsers don't load it.
- The WebAssembly module's brotli budget is 183 kB (from 180 kB) for these limits, until #93 removes the URL parser's Unicode tables.

## [2.4.1] - 2026-10-23

### Fixed
- **Requests are about 5% faster again: 2.4.0 had made every request slower.** Every request looked up the eight browser `fetch()` options (`credentials`, `mode`, …), one call into JavaScript each, even when none were set and in Node.js, where they're only validated. One `Object.keys` call now skips them when none are set. Published 2.4.0 against this fix (fresh processes, 9 interleaved rounds, node:http transport): small JSON sequential +2.7%, 50 concurrent +5.2%, back to 2.3.0's level. Found by comparing the published 2.3.0 and 2.4.0 packages, and swapping their WebAssembly modules and JS transports, to isolate the cause.

## [2.4.0] - 2026-10-23

### Added
- **Proxies in Node.js:** a `proxy` client option, `'env'` (`HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, upper or lower case, read on each request) or a proxy URL with optional credentials (sent as `Proxy-Authorization`). HTTPS goes through `CONNECT` tunnels, plain HTTP as absolute-URL requests, with a connection pool per proxy; `http:` and `https:` proxies are supported. `NODE_USE_ENV_PROXY=1` turns on `'env'` by default, as it does for Node's `fetch()`. Proxied requests use the `node:http` transport. The Node.js entry point grows to 22.4 kB (7.8 kB gzipped); its budget is now 24 kB / 8.5 kB.
- **WebSockets through a proxy in Node.js:** a `dispatcher` option for `client.websocket()`, passed to Node's built-in `WebSocket`, e.g. `new ProxyAgent(url)` from the `undici` package. Tested through a local `CONNECT` proxy with proxy credentials. Browsers reject it with an `InvalidInputError` (they use the system's proxy settings).
- **Browser `fetch()` options:** `credentials`, `mode`, `cache`, `keepalive`, `priority`, `referrer`, `referrerPolicy` and `integrity`, as client defaults and per request (each overriding the client's), for buffered and streamed requests and `client.events()`. `mode: 'no-cors'` resolves with the opaque response (`status: 0`). With upload progress, `credentials: 'include'` sets `XMLHttpRequest.withCredentials`; other options send the request with `fetch()`, which reports upload progress once. Node.js requests don't use them (they're validated). Tested with real cookies, the HTTP cache and `no-cors` in Chromium, Firefox and WebKit. Adds 1.4 kB brotli to the module.
- **Redirect control:** `redirect: 'follow' | 'manual' | 'error'` and `maxRedirects`, as client options and per request, with `fetch()`'s semantics. `'manual'` resolves with the redirect response (`ok: false`, with its `Location` header); `'error'` rejects with a `NetworkError` on any redirect; `maxRedirects` (default 20, as before) limits how many are followed in Node.js, on both transports. In browsers, `fetch()` hides redirects from scripts, so `'manual'` resolves with `status: 0` and no headers, and the browser's own limit applies. In the Rust API: `Redirect`, and `redirect()` / `max_redirects()` on `ClientBuilder` and `RequestBuilder`.

### Fixed
- **Node.js: throughput no longer collapses when far more requests are sent than the server answers.** With a backlog of hundreds of thousands of requests (an offered 40,000/s from one process, no load shedding), the node:http transport delivered about 600 requests/s, because every waiting request was already a `ClientRequest` queued in Node's agent, and WebAssembly memory grew one 64 KB page at a time. Now at most 1,024 requests are handed to a transport at once and the rest wait in an O(1) queue (their wait counts towards `timeoutMs`; cancelling one drops it before it's sent), and memory grows in steps of an eighth of its size. Same test: 11,868 requests/s with node:http, and 37,956 (from 28,353) with the native transport, whose WebAssembly memory peaked at 104 MB instead of 442 MB. In the independent harness at an offered 40,000/s, peak memory fell from 506 to 387 MB (node:http) and from 722 to 660 MB (native) at the same throughput, and at a steady 15,000/s the node:http transport no longer showed its intermittent stall (#16) in the runs so far.

### Changed
- **Native transport: one Tokio worker thread**, with large compressed bodies (over 16 KB) decoded on the blocking pool. Against the previous build (one worker per core), in fresh processes over 5 interleaved rounds: sequential small JSON +7.3%, now level with the node:http transport; 8 MB bodies +5.5%; 50 concurrent unchanged; +9% delivered at an offered 40,000 requests/s with a lower p99. Decoding off the runtime thread also speeds up concurrent gzip responses by about 50% (5,196 to 7,756 per second for 0.6 MB bodies, 8 concurrent).
- **Benchmarks on every pull request:** a CI job compares the PR's package with its base branch (small JSON sequential and 50 concurrent, an 8 MB body and startup, on both Node.js transports, and the bundle size), in fresh processes over interleaved rounds, and flags changes over 10% worse that reproduce in most rounds. `npm run bench:compare` runs it locally.
- **Startup measured** (`npm run bench:cold`, README *Startup*): in a fresh Node.js 22 process the first response arrives in 25.5 ms with the native transport and 27.6 ms with node:http, against 21.9 ms for `fetch()`; in browsers `init()` plus the first request takes 15–18 ms with an empty cache and 4–16 ms cached. Most of Node's import time is loading `node:http`, which `fetch()` pays too. The README now covers serving the `.wasm` file as `application/wasm` and preloading it.
- **Node.js: streamed responses (`responseType: 'stream' | 'ndjson'`) and `events()` go through the `node:http` transport** instead of Node's `fetch()`, like other requests. So they honour `proxy`, share the bounded connection pool, and are decompressed as they arrive (gzip, deflate, brotli, zstd). Small streamed requests are about 25% faster (3,700 vs 2,950 req/s at 50 concurrent, 64 KB each); large single streams are within 5% of `fetch()` (about 1,080 vs 1,140 MB/s). The Node.js entry point is 24.7 kB (8.4 kB gzipped); its budget is now 26 kB / 9 kB (30 kB / 10 kB with the request queue, at 27.7 kB).
- **Smaller browser bundle: 187.9 kB brotli, down from 204.8 kB in the published 2.3.0** (WebAssembly 195.2 → 178.5 kB, JS glue 9.6 → 9.4 kB; both built with Rust 1.99, as releases are). Sizes quoted for earlier releases came from local builds with an older Rust, which produces a module about 11 kB larger. In JavaScript runtimes, streamed requests (`responseType: 'stream' | 'ndjson'`, `events()`) are now sent with `fetch()` directly instead of through reqwest's wrapper around it, so reqwest's WebAssembly code is no longer in the module. The size budgets are lowered to match: 640 kB raw / 250 kB gzip for the `.wasm`, 70 kB / 11.5 kB for `rust_fetch.js` (its raw size varies by about 2 kB between wasm-bindgen builds).
- Streamed responses honour `redirect` too, like other requests.
- Download progress is reported for each chunk on every path: in browsers it was reported once when combined with upload progress, or in service workers. In Node.js, requests with only `onDownloadProgress` now use the `node:http` transport instead of Node's `fetch()`.
- Rust API: `RequestConfig`'s `follow_redirects` and `max_redirects` are now applied (they were ignored), and the default limit is 20, like browsers and the JavaScript API, instead of reqwest's 10.
- The Node.js entry point's raw size budget is now 18 kB (it's 17.1 kB, 6.1 kB gzipped).

## [2.3.0] - 2026-10-23

### Added
- Web Workers and service workers are tested in CI in Chromium, Firefox and WebKit: requests, typed errors, upload progress (one report in service workers, which have no `XMLHttpRequest`), Server-Sent Events and WebSockets.
- **Server-Sent Events:** `client.events(url, options)` reads an event stream in browsers and Node.js, with any method, headers and body (as streaming LLM APIs need), the client's base URL, interceptors, timeouts and typed errors. Events are parsed in Rust to the WHATWG spec (`event`, multi-line `data`, `id`, `retry`, comments, BOM, CR/LF/CRLF, characters split across chunks). Reconnection sends `Last-Event-ID` and honours `retry:`, on by default for `GET`. `messageType: 'json'` parses `data` and stops at `data: [DONE]`. Use callbacks (`onEvent`, …) or `for await`; `break` closes the stream. `opened`/`closed` promises, `signal`, `close()`.
- **Newline-delimited JSON:** `responseType: 'ndjson'` returns a `ReadableStream` of parsed values, one per line, as lines arrive. A line that isn't JSON errors the stream with a `ParseError` naming the line.
- The browser bundle grows by about 10 kB brotli for these two features, from 206.8 to 217.4 kB (WebAssembly 197.7 → 207.8 kB, JS glue 9.1 → 9.5 kB); the size budgets are now 700 kB raw / 275 kB gzip for the `.wasm` and 70 kB / 12 kB for `rust_fetch.js`.
- Real-browser tests in CI: the browser entry runs in Chromium, Firefox and WebKit (Playwright), covering requests, typed errors, timeouts, retries, cancellation, streaming, download and upload progress (with a cross-origin preflight) and WebSockets (`npm run test:browsers`).

## [2.2.0] - 2026-10-23

### Added
- **Typed responses in TypeScript:** every `WasmClient` request method is generic over the response body, e.g. `client.get<User>('/users/42')` resolves to `HttpResponse<User>`. The type parameter defaults to `any`, so existing code type-checks unchanged.
- **Upload progress:** an `onUploadProgress({ loaded, total })` request option. In Node.js the body is written in 64 KB chunks and each is reported once it's handed to the OS. In browsers these requests go through `XMLHttpRequest`, since `fetch()` has no upload progress events, with the same redirects, credentials, timeouts, retries and errors; cross-origin ones are preflighted. Without `XMLHttpRequest` (service workers), progress is reported once, when the response arrives. It can be combined with `onDownloadProgress`, but not with `responseType: 'stream'`. Requests with progress callbacks don't use the native transport.
- **WebSockets:** `client.websocket(url, options)` opens a connection through the runtime's `WebSocket` (browsers; Node.js 22+, or 20 with `--experimental-websocket`). URLs resolve against `baseUrl` (`http:` → `ws:`, `https:` → `wss:`), with `params`, subprotocols, handshake headers in Node.js (merged over the client's), a per-attempt connect timeout, optional reconnection with jittered exponential backoff, JSON messages, an `AbortSignal`, `opened`/`closed` promises and typed errors. Messages sent before the connection opens are queued.
- The browser bundle grows by about 16 kB brotli, from 190.9 to 206.8 kB (WebAssembly 183.1 → 197.7 kB, JS glue 7.8 → 9.1 kB), for these two features; the size budgets are now 660 kB raw / 260 kB gzip for the `.wasm`, 65 kB / 11.5 kB for `rust_fetch.js` and 17 kB / 6.5 kB for `node.js`.
- **Native Node.js transport (not yet in the npm package).** `native/` builds a Node-API addon that moves requests off the JS thread: HTTP/1.1 on hyper and Tokio, with the same rules as the node:http transport (fetch() redirects, decompression, default headers, per-attempt timeout, cancellation, at most 256 connections per origin) and Node's TLS defaults (Mozilla root certificates, `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED=0`). Retries, timeouts, validation, errors and interceptors still come from the Rust core, unchanged. When `rust-fetch-native.<platform>-<arch>.node` sits next to the package's `node.js`, it is used wherever the node:http transport would use its own pool; an agent installed as `http.globalAgent` / `https.globalAgent`, or `NODE_USE_ENV_PROXY`, keeps node:http. `RUST_FETCH_NATIVE=0` turns it off. Build it with `npm run build:native`.
- The Node.js entry point (`node.js`) grows by about 1 kB (to 15 kB, 5.5 kB gzipped) for the native transport's loader; its size budget is now 16 kB (6 kB gzipped). Browsers don't load it.

### Changed
- npm and crate metadata: a description that lists what the client does, without the "faster than fetch()" claim (the published client is behind `fetch()` on concurrent HTTPS); more npm keywords; the package ships `llms.txt`, a concise API summary for AI assistants.
- Development uses TypeScript 7; the published definitions are type-checked with TypeScript 7 and 5.2.

## [2.1.1] - 2026-10-22

### Fixed
- **Node.js: bursts of requests no longer exhaust ephemeral ports.** Node's default global agents open a new socket for every request that finds no idle one and keep only 256 afterwards; the rest were closed into TIME_WAIT, and under sustained overload every connect failed with `EADDRNOTAVAIL` (50,000 req/s against a local server: 2.7k req/s delivered, 43.5k errors). rust-fetch now uses its own pool of up to 256 keep-alive connections per origin and queues further requests (same test: 18.9k req/s, no errors). Throughput below saturation is unchanged. An agent you install as `http.globalAgent` / `https.globalAgent` (e.g. a proxy), or Node's own agent with a `maxSockets` limit you set, is still used as before.

## [2.1.0] - 2026-10-22

### Changed
- **Node.js requests no longer go through `fetch()`.** A lean transport on `node:http`/`node:https` with keep-alive connections makes rust-fetch as fast as or faster than Node's built-in `fetch()`: small JSON requests are 1.9× (sequential) to 2.2× (50 concurrent) faster than in 2.0.0. It follows redirects like `fetch()` (dropping credentials on cross-origin redirects), decodes gzip, deflate, brotli and (where Node supports it) zstd, and sends `accept: */*`, `accept-encoding` and `user-agent: rust-fetch` unless set. Retries, timeouts, validation and errors still come from the Rust core. Browsers keep using `fetch()`.
- In Node.js, proxies now come from `http.globalAgent`/`https.globalAgent` instead of undici's `setGlobalDispatcher`
- Buffered responses (everything except `responseType: 'stream'` and requests with `onDownloadProgress`) are decoded in JS without copying the body into Wasm memory
- Binary responses are returned without an extra copy
- Finished requests no longer create an `AbortError` each, which removed about 13% of the CPU time of a small request
- The npm description no longer says "high-performance"; it describes what the package does

## [2.0.0] - 2026-10-22

### Breaking changes
See "Upgrading to 2.0" in the README for migration steps.
- Timeouts are enforced in browsers and Node.js (default 30 s per attempt); they were silently ignored in 1.x
- `WasmClient` JSON bodies are plain objects instead of `Map`s
- `application/*+json` responses are parsed as JSON in auto mode, and empty bodies are `null`
- Errors are `Error` instances; `message` is no longer an enumerable own property
- Invalid `headers` values reject with `InvalidInputError` instead of being silently dropped
- Response text is decoded as UTF-8 regardless of the `charset` parameter
- The package has an `exports` map (Node.js and browser entries); only the documented paths can be imported
- Node.js 20 or newer is required
- Rust: `RetryConfig` has a new `retry_non_idempotent` field; `Method::to_reqwest()` returns reqwest 0.12's `Method`; `RequestBuilder::header()` replaces default headers with the same name; `WasmClient` methods take an options argument

### Added
- `WasmClient` options: `baseUrl`, `headers`, `timeoutMs` and `retries` (count or `RetryOptions`)
- Per-request options on every method: `headers`, `params`, `timeoutMs`, `responseType`, `signal`, `onDownloadProgress`
- `post`/`put`/`patch(url, { body, ... })` and `fetch(url, init)`
- Request cancellation with `AbortSignal`, including during retry backoff and while streaming
- Streaming responses: `responseType: 'stream'` (a `ReadableStream`); `send_streaming()`/`get_streaming()` in Rust
- Download progress callbacks (`onDownloadProgress`; `on_download_progress()` in Rust)
- `multipart/form-data` uploads from `FormData` (including files); `Blob`/`File`, `ArrayBuffer`, `DataView` and `URLSearchParams` bodies; `Multipart` builder in Rust
- Request and response interceptors: `addRequestInterceptor`, `addResponseInterceptor`, `ejectInterceptor`, `clearInterceptors`
- Node.js entry point: no `init()` or manual `.wasm` loading needed; conditional `exports` for Node.js and browsers
- TypeScript definitions for all options, responses and errors
- `Retry-After` support, jittered backoff, `retry_non_idempotent` option
- Benchmark against native `fetch` (`npm run bench`)
- Test suites: Rust integration tests against a local server, wasm tests in Node.js, JS end-to-end and package-install tests; CI with a 100% line-coverage gate for the Rust core

### Changed
- Errors thrown to JS are real `Error` instances; `name` equals `kind`
- POST and PATCH are no longer retried unless `retryNonIdempotent`/`retry_non_idempotent` is set
- Only statuses listed in `retryOn` are retried (default `[408, 429, 500, 502, 503, 504]`)
- Per-request headers replace client default headers with the same name instead of being sent twice
- `fetch_json` parses JSON regardless of `Content-Type`; empty bodies are `null`
- `application/*+json` responses are parsed as JSON in auto mode; empty responses are `null`
- Long error bodies are truncated in error messages (the full body stays on `error.body`)
- Upgraded to reqwest 0.13. Native (non-wasm) Rust builds now use rustls with aws-lc instead of OpenSSL for TLS; the npm package is unaffected

### Fixed
- Timeouts were ignored in browsers and Node.js, so stuck requests could hang forever
- Retry delays used `window.setTimeout`, which crashed in Node.js and Web Workers
- `WasmClient` returned JSON objects as `Map`s
- JSON containing integers above 2^53 failed the whole request
- An explicit `Content-Type` was sent alongside a default one (e.g. `application/json, text/plain`)
- `Uint8Array` request bodies failed; `URLSearchParams` bodies were sent empty
- `baseUrl` was blindly concatenated (missing or doubled slashes; absolute URLs were broken)
- Invalid URLs and headers were reported as retryable network errors
- `TRACE`/`CONNECT` failed with an opaque "builder error"; they're now rejected with a clear message
- Retry delay calculation could panic with very large `max_delay`/`multiplier` values
- Updated dependencies with security advisories: `bytes` (RUSTSEC-2026-0007, also in the wasm build) and `openssl` (RUSTSEC-2025-0004, RUSTSEC-2025-0022, native builds only)
- The npm package's broken `client.js`/`server.js` wrappers and stale `types.d.ts` were removed

## [1.1.0] - 2025-07-27

### Added
- **Extended HTTP Methods**: Added support for PUT, DELETE, PATCH, and HEAD methods in `WasmClient`
- **Flexible Request Method**: New `request()` method in `WasmClient` for custom HTTP requests with headers and body
- **TypeScript Definitions**: Comprehensive TypeScript type definitions (`types.d.ts`) with detailed interfaces:
  - `HttpResponse` interface for type-safe responses
  - `RequestOptions` interface for request configuration
  - `HttpError` interface for structured error handling
  - `ClientConfig` interface for client configuration
- **Enhanced Error Handling**: Added `From` implementation for `serde_wasm_bindgen::Error`
- **Comprehensive Tests**: Added extensive test suite in `tests/client_tests.rs`
- **Better Documentation**: Improved inline documentation and code examples

### Changed
- **Error Conversion**: Improved error conversion from JavaScript values
- **API Consistency**: Standardized method naming (e.g., `put_json`, `patch_json` for JSON payloads)

### Fixed
- **Duplicate Implementation**: Removed duplicate `From` implementation for `serde_wasm_bindgen::Error`

## [1.0.4] - 2025-07-26

### Added
- World-class WebAssembly HTTP client library
- Excellent error handling with detailed context
- Clean API design with builder pattern

## [1.0.2] - 2025-07-26

### Added
- Basic HTTP client implementation with builder pattern
- Support for GET, POST, PUT, DELETE, PATCH methods
- Retry logic with exponential backoff
- WASM bindings for browser and Node.js
- Error handling system with structured error types
- Response format handling (JSON, text, binary)

### Features
- Type-safe HTTP client
- Comprehensive error handling
- Automatic retries for transient failures
- Platform optimizations for WASM and native targets
- Backward compatibility with legacy APIs

## [0.7.2] - 2025-02-24

### Added
- Initial WASM module structure
- Basic fetch functions for JSON and text
- Simple HTTP client wrapper

### Changed
- Project structure reorganization
- Updated dependencies

## [0.1.0] - 2025-02-23

### Added
- Initial release
- Basic HTTP functionality using reqwest
- WASM compilation support
- Simple fetch APIs

[Unreleased]: https://github.com/asemqaffaf/rust-fetch/compare/v2.5.1...HEAD
[2.5.1]: https://github.com/asemqaffaf/rust-fetch/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/asemqaffaf/rust-fetch/compare/v2.4.1...v2.5.0
[2.4.1]: https://github.com/asemqaffaf/rust-fetch/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/asemqaffaf/rust-fetch/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/asemqaffaf/rust-fetch/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/asemqaffaf/rust-fetch/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/asemqaffaf/rust-fetch/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/asemqaffaf/rust-fetch/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/asemqaffaf/rust-fetch/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/asemqaffaf/rust-fetch/tree/v1.1.0
[1.0.4]: https://www.npmjs.com/package/rust-fetch/v/1.0.4
[1.0.2]: https://www.npmjs.com/package/rust-fetch/v/1.0.2
[0.7.2]: https://www.npmjs.com/package/rust-fetch/v/0.7.2
[0.1.0]: https://www.npmjs.com/package/rust-fetch/v/0.1.0
