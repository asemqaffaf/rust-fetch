# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Redirect control:** `redirect: 'follow' | 'manual' | 'error'` and `maxRedirects`, as client options and per request, with `fetch()`'s semantics. `'manual'` resolves with the redirect response (`ok: false`, with its `Location` header); `'error'` rejects with a `NetworkError` on any redirect; `maxRedirects` (default 20, as before) limits how many are followed in Node.js, on both transports. In browsers, `fetch()` hides redirects from scripts, so `'manual'` resolves with `status: 0` and no headers, and the browser's own limit applies. In the Rust API: `Redirect`, and `redirect()` / `max_redirects()` on `ClientBuilder` and `RequestBuilder`.

### Changed
- **Smaller browser bundle: 197.6 kB brotli, down from 217.4 kB in 2.3.0** (WebAssembly 207.8 → 188.3 kB, JS glue 9.5 → 9.3 kB). In JavaScript runtimes, streamed requests (`responseType: 'stream' | 'ndjson'`, `events()`) are now sent with `fetch()` directly instead of through reqwest's wrapper around it, so reqwest's WebAssembly code is no longer in the module. The size budgets are lowered to match: 640 kB raw / 250 kB gzip for the `.wasm`, 66 kB / 11.5 kB for `rust_fetch.js`.
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

[Unreleased]: https://github.com/asemqaffaf/rust-fetch/compare/v2.3.0...HEAD
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
