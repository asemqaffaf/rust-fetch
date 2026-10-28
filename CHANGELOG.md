# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **The native transport's zstd decoder is updated to 0.14 (zstd-safe 8.2.0)**, fixing RUSTSEC-2026-0391 (data from an abandoned stream leaking into the next on a reused context), RUSTSEC-2026-0398 (`Seekable::decompress` setting a `Vec` length beyond its capacity) and RUSTSEC-2026-0403 (uninitialized memory exposed when streaming decompression of a legacy frame fails). They affect the optional native addon only, not the WebAssembly build, the `node:http` transport or browsers. Decompression limits are unchanged (#160).

### Documentation
- **A clearer path through the guide.** `/guide/` is now a Guide overview page (it was a 404) with a reading order and every client method and the most-used client and request options on one page. Getting started adds a recommended production client, interceptors, a Server-Sent Events stream and a WebSocket. The performance page opens with a short summary, and the guide's sidebar is grouped into Basics, Reliability, Streaming and real-time, and Tooling.
- **A review of the documentation site against the code.** The client options page lists all 16 options with their defaults (it had 8, none of 2.6's), and the request, `events()` and `websocket()` option tables gain the per-request and per-stream security and size options. The errors page lists the limit fields a `NetworkError` carries and `retryBudgetExhausted`. Corrected: the conformance count on the architecture page (52, not 47); when the native transport steps aside (also for `proxy` and `allowPrivateNetwork: false`); WebSockets are tested on Node.js 20 too; Deno and Bun were described as `fetch()` runtimes, which they aren't for this package (Bun loads its Node.js entry, and neither is tested); the performance summary now says it was measured with 2.1.x. `llms.txt`, which ships in the package, linked README sections that moved to the site.

## [2.6.0] - 2026-10-25

Limits for load and for servers you don't control, and credential-safe redirects. Every new limit is opt-in except the automatic backpressure on `client.events()`: `maxPendingRequests` sheds load beyond a pending-request limit, `retryBudget` caps the retries a failing upstream causes, `maxLineBytes` and `maxEventBytes` bound streamed lines and events, and `maxQueuedMessages` and `maxQueuedBytes` bound a WebSocket's send queue. `sensitiveHeaders` drops custom credential headers on cross-origin redirects, `allowInsecureRedirects: false` refuses redirects from `https:` to `http:`, and `allowPrivateNetwork: false` now covers `websocket()`. On Node.js 20 and 22, a burst of cancelled requests can no longer abort the process through a V8 bug that 2.5.2 hits too (#148). A pending request uses 45% less WebAssembly memory and the browser bundle is 31% smaller. Documentation moved to [asemqaffaf.github.io/rust-fetch](https://asemqaffaf.github.io/rust-fetch/). Performance: the packed package was benchmarked against 2.5.2 from npm, with no slowdown detected. Comparisons against `fetch()` and axios were not rerun, so the comparative results in the documentation remain tied to the versions they tested.

### Added
- **A transport conformance suite** (`npm run test:conformance`): 52 behaviours (redirects, decompression, size limits, timeouts and cancellation, errors, streaming, security checks) run with the same test code on node:http, the native addon, `fetch()` in Node.js, Chromium, Firefox and WebKit. Every difference between them is either documented with its reason or fails CI, and [CONFORMANCE.md](CONFORMANCE.md) shows the matrix (#109).
- **`maxEventBytes`: a limit on one Server-Sent Event's data.** `maxLineBytes` limits each line, but an event made of many `data:` lines was assembled in memory without limit until its blank line, with `onEvent` too. With `maxEventBytes`, a `data:` line that would take the event's data (its lines joined with `\n`) over the limit is refused before it's buffered; the events before it are delivered, then the stream errors with a `NetworkError` whose `maxEventBytes` is the limit, and isn't reconnected. Client option, or per `events()` stream (`null` for none). This completes #121.
- **`allowPrivateNetwork: false` now covers `websocket()`.** Node's built-in WebSocket connects through undici, not `node:http`, so it wasn't checked: a server opening WebSockets to user-supplied URLs could reach internal services. It now connects through its own undici agent whose DNS lookup is checked on every connection, reconnections included (so DNS rebinding can't get past it); an IP address that is private or reserved throws a `NetworkError` from `websocket()` before anything connects, and a blocked host name fails the attempt with "Blocked: …". Per connection: `websocket(url, { allowPrivateNetwork })`. It can't be combined with a `dispatcher`, and while another undici global dispatcher is installed it throws instead of connecting unchecked (#116).
- **Credential-safe redirects: `sensitiveHeaders` and `allowInsecureRedirects`.** Custom credential headers such as `X-Api-Key` followed a redirect to another origin; list them in `sensitiveHeaders` and they're dropped along with `Authorization`, `Cookie` and `Proxy-Authorization`. A redirect from `https:` to `http:` was followed; with `allowInsecureRedirects: false` it rejects with a `NetworkError` before anything is sent in clear text. Client or per-request options, on both Node.js transports (tested over HTTPS, for 302 and 307). Rust: `ClientBuilder::sensitive_headers` and `allow_insecure_redirects` (and per request); reqwest can't drop a header mid-redirect, so a request carrying a listed header refuses cross-origin redirects instead. Browsers follow redirects themselves, so neither applies there. The defaults are unchanged in 2.x (#115).
- **`retryBudget`: a client-wide retry budget.** When an upstream failed, every request in flight retried at once, multiplying the load on it. With `retryBudget: true` (or `{ ratio, minPerSecond, windowMs }`), retries may add `ratio` of the first attempts in a sliding window plus a minimum per second; first attempts are always sent. The budget is checked before waiting to retry and spent when the retry is sent, so cancelling while waiting spends nothing. A refused retry rejects with the attempt's own error, marked `retryBudgetExhausted: true`, and `client.retriesRefused` counts refusals. One budget per client, for all origins. Rust: `ClientBuilder::retry_budget(RetryBudget)` and `Client::retries_refused()` (#117).
- **`websocket()` options `maxQueuedMessages` and `maxQueuedBytes`.** Messages sent before a WebSocket opens, or while it reconnects, were queued without limit, so a producer that kept sending during an outage could fill memory. With either option, a `send()` that would go over throws a `NetworkError` carrying the limit it reached (`maxQueuedMessages` or `maxQueuedBytes`), and the message isn't queued. Bytes are UTF-8 for text and the size of binary data and Blobs. The count starts again from zero once the queue is sent. `bufferedAmount` no longer walks the queue (#121).
- **`maxLineBytes`: a limit on one line of a newline-delimited JSON response or a Server-Sent Events stream.** An incomplete line was held in memory until its line break arrived, so a server that never sent one could grow it without bound. The limit counts UTF-8 bytes without the line break, the same however the network splits the line, and it's checked before anything is buffered. The lines or events before the long one are delivered, then the stream errors with a `NetworkError` whose `maxLineBytes` is the limit, and the connection is closed; an event stream isn't reconnected. Set it on the client, per `ndjson` request or per `events()` stream (`null` for none). Event streams check each `data:` line, not an event's total (#121).
- **`maxPendingRequests`: load shedding.** A client option that refuses a request at once while the client already has that many started and not yet settled, whether in flight or waiting for a connection (retries included; a streamed response counts until its headers arrive). The rejection is a `NetworkError` with `maxPendingRequests` set to the limit, and nothing is sent. In Node.js, requests beyond the 1,024 handed to a transport used to wait in memory without limit; with this option, a caller that can't keep up sheds load instead. The count is per client (shared by Rust clones) and applies on every transport. Rust: `ClientBuilder::max_pending_requests` and `Error::too_many_pending_requests` (#117).

### Fixed
- **Node.js 20 and 22 no longer abort under bursts of cancelled requests.** V8 before 13 could crash the process with "Fatal error … unreachable code" when it deoptimized `client.get()`, inlined into its caller, during the call into WebAssembly; 2.5.2 and earlier did it too, in about one run in three on Node.js 20 and one in ten on Node.js 22 under 20,000 requests cancelled together. On V8 before 13 (Node.js 20 to 23), importing rust-fetch now turns that inlining off for the process (`--turbo-inline-js-wasm-calls`), with no measurable change in throughput on either transport. A test runs the load in six processes and fails on the crash; Node.js 24 was never affected. A `--turbo-inline-js-wasm-calls` or `--no-…` flag on the command line is left as given, and Bun, which reports a V8 version without having V8's flags, is left alone. On 2.5.2 and earlier, run `node --no-turbo-inline-js-wasm-calls` (it isn't allowed in `NODE_OPTIONS`) or set it with `v8.setFlagsFromString()` before importing rust-fetch (#148).
- **An already-aborted `signal` no longer sends the request.** The request started before the signal was looked at, so on the `fetch()` path (browsers, other runtimes, and the browser build in Node.js) it reached the server even though it rejected with a `CancelledError`. Found by the conformance suite (#109).
- **POST and PUT bodies are resent after a 307 or 308 redirect on Node.js's `fetch()`.** undici in Node.js 20.20 and 22.13 detaches a byte-array body's buffer on the first attempt and can't resend it, so the redirect failed with a `NetworkError`. The `fetch()` path now sends the body as a `Blob`, which it can resend (browsers send either the same way). Found by the conformance suite (#109).
- **The native transport warns when `NODE_TLS_REJECT_UNAUTHORIZED=0` turns certificate verification off**, with the warning Node prints, once per process. It honoured the variable but said nothing, since it doesn't use Node's `tls`; node:http requests get Node's own warning as before (#118).
- **A slow `for await` loop over `client.events()` no longer buffers every event.** Events waiting for the loop were queued without limit, so a fast server (or a large backlog after a reconnect) could fill memory while the loop was busy. The stream now stops reading once 64 events are waiting and resumes when the loop has taken half of them, so the connection slows the server down. In a test, a server offering 20 MB of events wrote about 830 KB while the loop paused for a second, against 12 MB before: reduced read-ahead, not a fixed memory ceiling (#121).

### Changed
- **A pending request costs 45% less WebAssembly memory: 3.7 KB instead of 6.7 KB** (7 KB in all, against 8.9 KB for 2.5.2). The wrapper that makes requests cancellable with an `AbortSignal`, and the per-attempt timeout, were `async fn`s whose compiled state kept two copies of the request's future; they're now plain futures that hold it once. Under sustained overload without `maxPendingRequests`, where every pending request is kept, this moved the point where Node.js reaches its heap limit and stalls for minutes past 50,000 requests per second offered in our test (2.5.2: from 45,000). A test keeps it under a budget (#140).
- **The browser bundle is 31% smaller: 129 kB brotli instead of 188 kB.** In WebAssembly, URLs are now parsed by the runtime's own WHATWG `URL`, which implements the same standard as the `url` crate, so the module no longer carries `url`, `idna` and their Unicode tables (raw: 592 → 427 kB). Native Rust keeps the `url` crate. Results are unchanged, international domain names included (`bücher.example` → `xn--bcher-kva.example`), and are checked by the same expectations on both, and on every adapter by the conformance suite; only the wording of a URL parse error now comes from the runtime. The size budget is lowered to 133 kB so the saving holds (#93).
- **Streamed bodies are about 30% faster.** Without download progress or `maxResponseBytes`, a `responseType: 'stream'` body's chunks are now handed from the transport to you as they are, instead of being copied into WebAssembly and back: about 1,900 MB/s against 1,450 MB/s before when reading 256 MB from a local server (Node.js's own `fetch()`: about 2,100 MB/s). Cancellation, typed errors and backpressure work as before, and every chunk still owns its whole buffer (#111).
- The Node.js entry's budget (`node.js`, which browsers don't load) is 38 kB raw, 12.5 kB gzip and 11 kB brotli (from 36, 12 and 10.5), for the WebSocket SSRF guard and the redirect options (36.9 kB raw).
- **Releases check the exact package before publishing.** The release workflow packs the package, installs the tarball in an empty directory, and checks its files, a request, and the security regression tests. It then benchmarks the tarball against the version already on npm; a regression (more than 10% worse in the median and in most rounds) stops the release. After publishing, a clean install must verify its signature and provenance. Pull requests run the same checks, with the benchmark informational (#123).
- **CI inputs are pinned:** every GitHub Action to a commit SHA (Dependabot keeps them current), and Rust to 1.99.1 instead of whatever is stable that day, so sizes and formatting don't change on their own (#123).
- The WebAssembly module's budget was raised during 2.6.0 to 190 kB brotli and 595 kB raw (from 183 kB and 580 kB), then lowered to 133 kB brotli and 440 kB raw once #93 removed the URL parser's Unicode tables. 2.6's limits and options add about 6 kB brotli: `maxPendingRequests`, SSE backpressure, `maxLineBytes` and the WebSocket queue limits about 2.6 kB (181.1 → 183.7 kB), the retry budget about 1.9 kB, and the redirect and WebSocket SSRF options the rest (187.2 kB on CI's Linux build, 0.3 kB more than a macOS build). #93 then recovered about 59 kB.

### Documentation
- **A documentation site: [asemqaffaf.github.io/rust-fetch](https://asemqaffaf.github.io/rust-fetch/).** It is also the package's homepage on npm and crates.io. The README had grown past 1,200 lines; its content now lives in `docs/` (VitePress, with search), in pages for the guide, security, performance, transport conformance and reference, and is published to GitHub Pages from `main`. The README keeps every badge, the overview, quick start, release status and comparison table, and links into the site. Every anchor the README used still works (the site uses GitHub's anchors), and a CI check fails on any broken link between pages, anchors and the README. The hardened configurations' test now reads them from the security page. The introduction's feature list gains the 2.6 safety and load limits.
- **The independent harness's 565 ms p99 stall no longer reproduces** (README, Under load): rerun with aakjp/stress-test at a steady 15,000 requests per second for 60 s, 2.6.0's p99 is 19.6 ms on node:http and 4.7 ms on native; 2.3.0 shows 53 ms, 2.4.0 and later about 20 ms (#16).
- **Overload without `maxPendingRequests`, measured** (README, Limiting pending requests): what each pending request costs, what an unbounded backlog does under sustained overload, and `maxPendingRequests` as the remedy (#140).
- **Memory while streaming** (README, Streaming): what a slow reader keeps, what closes a connection, and who owns each chunk. The conformance suite now checks it on every transport: a slow reader holds the server back on Node.js (about 1.5 MB of 64 MB read ahead during a one-second pause), and `cancel()`, an aborted signal and `maxResponseBytes` each close the connection (#110).
- **Hardened configurations** in the README's Security section: a fixed API with credentials, fetching URLs from users, and streaming APIs. Each turns on the protections that fit and says what it doesn't cover. A test reads each configuration from the README and exercises every protection its comments claim, so the README can't drift from the client (#122).

## [2.5.2] - 2026-10-24

A security patch: a server can no longer tie up connections, or memory on the native transport, with a long or endless redirect body. Performance: the base-against-head benchmark detected no slowdown. Comparisons against `fetch()` and axios were not rerun, so the comparative results in the README remain tied to the versions they tested.

### Fixed
- **A redirect's body is read up to 64 KiB, then its connection is closed.** On the node:http transport, the body of a followed redirect was drained in the background with no end, so a server sending an endless redirect body kept that connection, and its slot in the pool of 256 per origin, busy for good. The native transport read the whole redirect body into memory before following it, so an endless one grew memory until the request timed out. Small redirect bodies are still drained so their connection is reused. Tests cover both transports: the redirect is followed promptly, each connection closes, 50 in a row keep memory bounded, and a redirect-limit error or cancellation closes them too.

### Documentation
- The README's "Which transport a request uses" table said streamed responses, download progress and `client.events()` use Node's `fetch()` in Node.js. They have used `node:http` since 2.4.0.
- The 2.0 migration notes said `Method::to_reqwest()` returns reqwest 0.12's `Method`; the crate has used reqwest 0.13 since 2.0.0.
- The independent benchmark section said axios's default configuration opens a new connection per request. On Node.js 19 and later its default agent keeps connections alive; it has no socket limit, so under overload it kept opening connections until it ran out of local ports. The keep-alive axios row was capped at 128 sockets, against rust-fetch's 256 per origin, which the README now notes.

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

[Unreleased]: https://github.com/asemqaffaf/rust-fetch/compare/v2.6.0...HEAD
[2.6.0]: https://github.com/asemqaffaf/rust-fetch/compare/v2.5.2...v2.6.0
[2.5.2]: https://github.com/asemqaffaf/rust-fetch/compare/v2.5.1...v2.5.2
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
