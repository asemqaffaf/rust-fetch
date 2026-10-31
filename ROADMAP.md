# Roadmap

Where rust-fetch is going, in the order we plan to ship it. Each release has a [milestone](https://github.com/asemqaffaf/rust-fetch/milestones), and the pinned [roadmap issue](https://github.com/asemqaffaf/rust-fetch/issues/26) tracks progress.

**Principles**
- **Stay on 2.x.** Every change keeps existing code working; nothing here needs a major version.
- **Every new feature is opt-in.** Code that doesn't use a feature behaves exactly as before.
- **Policy in Rust, bytes in the transport.** Retries, timeouts, validation and errors stay in the shared core, so every runtime behaves the same.
- **Measure before claiming.** Performance work lands with benchmarks, and the README reports the results, including the unfavourable ones.

Dates aren't promised; the order is.

| Release | Theme | Status |
| --- | --- | --- |
| [2.2.0](#220-upload-progress-websockets-typed-responses) | Upload progress, WebSockets, typed responses | Released |
| [2.3.0](#230-streaming-apis) | Streaming APIs: SSE, NDJSON | Released |
| [2.4.0](#240-performance-proxies-and-request-options) | Performance, proxies and request options | Released |
| [2.5.0](#250-security) | Security: SSRF protection, response size limits, base URL safety | Released |
| [2.6.0](#260-security-and-resource-safety-on-every-transport) | Security and resource safety on every transport, and the open performance work | Released |
| [2.7.0](#270-resilience-security-and-observability) | Resilience, security and observability | Implemented; release pending |
| [2.8.0](#280-data-and-developer-experience) | Data and developer experience | Planned |
| [WebRTC signaling](#webrtc-signaling) | WHIP/WHEP signaling clients | Not yet scheduled |
| [Native transport on npm](#the-native-transport-on-npm) | Prebuilt native binaries in the npm package (needs a one-time npm setup) | Not yet scheduled |

## 2.2.0: upload progress, WebSockets, typed responses

*Released 2026-10-23* ([release notes](https://github.com/asemqaffaf/rust-fetch/releases/tag/v2.2.0)).

| | |
| --- | --- |
| Upload progress (`onUploadProgress`) in browsers and Node.js | [#11](https://github.com/asemqaffaf/rust-fetch/issues/11) |
| `client.websocket()`: one client for HTTP and WebSockets, with reconnection and typed errors | [#11](https://github.com/asemqaffaf/rust-fetch/issues/11) |
| Generic request methods: `client.get<User>(…)` | [#27](https://github.com/asemqaffaf/rust-fetch/issues/27) |
| Coverage of the Rust core and the Node.js transport on Codecov | [#12](https://github.com/asemqaffaf/rust-fetch/issues/12) |
| Native transport code in the repository (not yet in the npm package) | [#10](https://github.com/asemqaffaf/rust-fetch/issues/10) |
| TypeScript 7 for development; definitions checked with 5.2 and 7 | [#28](https://github.com/asemqaffaf/rust-fetch/issues/28) |

## 2.3.0: streaming APIs

*Released 2026-10-23* ([release notes](https://github.com/asemqaffaf/rust-fetch/releases/tag/v2.3.0)).

| | |
| --- | --- |
| Server-Sent Events with reconnection, `POST` bodies and headers: `client.events()` | [#37](https://github.com/asemqaffaf/rust-fetch/issues/37) |
| Newline-delimited JSON as an async iterator: `responseType: 'ndjson'` | [#38](https://github.com/asemqaffaf/rust-fetch/issues/38) |
| Real-browser CI in Chromium, Firefox and WebKit | [#19](https://github.com/asemqaffaf/rust-fetch/issues/19) |
| Web Workers and service workers tested | [#20](https://github.com/asemqaffaf/rust-fetch/issues/20) |

## 2.4.0: performance, proxies and request options

*Released 2026-10-23* ([release notes](https://github.com/asemqaffaf/rust-fetch/releases/tag/v2.4.0)).

| | |
| --- | --- |
| Native transport at least as fast as `node:http` for sequential requests: one Tokio worker, +7% | [#17](https://github.com/asemqaffaf/rust-fetch/issues/17) |
| No throughput collapse under overload: request queue and WebAssembly memory growth (progress on [#16](https://github.com/asemqaffaf/rust-fetch/issues/16) and [#18](https://github.com/asemqaffaf/rust-fetch/issues/18), which continue in 2.6.0) | [#92](https://github.com/asemqaffaf/rust-fetch/pull/92) |
| Smaller WebAssembly bundle: 178.5 kB brotli (target ≤ 180 kB) | [#61](https://github.com/asemqaffaf/rust-fetch/issues/61) |
| Node.js streamed responses and `events()` through the `node:http` transport | [#85](https://github.com/asemqaffaf/rust-fetch/issues/85) |
| Faster `init()` cold start, measured | [#62](https://github.com/asemqaffaf/rust-fetch/issues/62) |
| Benchmark regressions caught in CI | [#63](https://github.com/asemqaffaf/rust-fetch/issues/63) |
| Proxies from the environment (`HTTPS_PROXY`, `NO_PROXY`) | [#49](https://github.com/asemqaffaf/rust-fetch/issues/49) |
| WebSocket proxy support in Node.js | [#21](https://github.com/asemqaffaf/rust-fetch/issues/21) |
| How exceptions in WebSocket callbacks are reported (decided: keep the current behaviour) | [#22](https://github.com/asemqaffaf/rust-fetch/issues/22) |
| Browser `fetch()` options: `credentials`, `mode`, `cache`, `keepalive`, `priority` | [#59](https://github.com/asemqaffaf/rust-fetch/issues/59) |
| Redirect control: `redirect: 'manual' \| 'error'`, `maxRedirects` | [#60](https://github.com/asemqaffaf/rust-fetch/issues/60) |

## 2.5.0: security

*Released 2026-10-24* ([release notes](https://github.com/asemqaffaf/rust-fetch/releases/tag/v2.5.0)). Moved ahead of WebRTC after a comparison with `fetch()` and axios found gaps that all three clients shared.

| | |
| --- | --- |
| `allowAbsoluteUrls: false`: absolute URLs can't replace `baseUrl` and receive its credentials (axios CVE-2025-27152 class) | [#98](https://github.com/asemqaffaf/rust-fetch/issues/98) |
| `maxResponseBytes`, enforced while reading and decompressing (decompression bombs) | [#76](https://github.com/asemqaffaf/rust-fetch/issues/76), [#77](https://github.com/asemqaffaf/rust-fetch/issues/77) |
| SSRF protection: `allowPrivateNetwork: false` checks resolved addresses at connect time | [#78](https://github.com/asemqaffaf/rust-fetch/issues/78) |
| Security regression tests per vulnerability class, and `npm run security:compare` against `fetch()` and axios | [#103](https://github.com/asemqaffaf/rust-fetch/pull/103) |

## 2.6.0: security and resource safety on every transport

*Released 2026-10-25* ([release notes](https://github.com/asemqaffaf/rust-fetch/releases/tag/v2.6.0)). Moved ahead of WebRTC signaling and the native transport on npm, which now have their own sections below.

| | |
| --- | --- |
| Transport conformance suite: 52 behaviours on every transport | [#109](https://github.com/asemqaffaf/rust-fetch/issues/109) |
| Credential-safe redirects: `sensitiveHeaders` and `allowInsecureRedirects` | [#115](https://github.com/asemqaffaf/rust-fetch/issues/115) |
| SSRF protection for `websocket()` | [#116](https://github.com/asemqaffaf/rust-fetch/issues/116) |
| Load shedding and a retry budget: `maxPendingRequests` and `retryBudget` | [#117](https://github.com/asemqaffaf/rust-fetch/issues/117) |
| Native transport warns when TLS verification is turned off | [#118](https://github.com/asemqaffaf/rust-fetch/issues/118) |
| Bounded queues: `maxLineBytes`, `maxEventBytes`, WebSocket send limits and SSE backpressure | [#121](https://github.com/asemqaffaf/rust-fetch/issues/121) |
| Hardened configurations, documented and tested | [#122](https://github.com/asemqaffaf/rust-fetch/issues/122) |
| The packed tarball checked and benchmarked before publishing; pinned CI inputs | [#123](https://github.com/asemqaffaf/rust-fetch/issues/123) |
| Real-browser CI in Chromium, Firefox and WebKit | [#19](https://github.com/asemqaffaf/rust-fetch/issues/19) |
| No more Node.js 20/22 aborts under bursts of cancelled requests | [#148](https://github.com/asemqaffaf/rust-fetch/issues/148) |

Performance carried over from 2.4.0:

| | |
| --- | --- |
| The intermittent p99 stall of the `node:http` transport at a steady 15,000 requests/s (no longer reproduces: 19.6 ms p99) | [#16](https://github.com/asemqaffaf/rust-fetch/issues/16) |
| Native transport memory under overload at or below `node:http`'s | [#18](https://github.com/asemqaffaf/rust-fetch/issues/18) |
| Parse URLs with the runtime's `URL` on wasm32, dropping `url`, `idna` and ICU from the bundle (31% smaller) | [#93](https://github.com/asemqaffaf/rust-fetch/issues/93) |
| Bounded streaming, with fewer copies for streamed bodies (about 30% faster) | [#110](https://github.com/asemqaffaf/rust-fetch/issues/110), [#111](https://github.com/asemqaffaf/rust-fetch/issues/111) |
| 45% less WebAssembly memory per pending request | [#140](https://github.com/asemqaffaf/rust-fetch/issues/140) |

## WebRTC signaling

*Goal: set up WebRTC sessions with the standard HTTP signaling protocols, WHIP (RFC 9725) and WHEP, with the client's timeouts, retries and typed errors. Tracked in [#30](https://github.com/asemqaffaf/rust-fetch/issues/30) and the [WebRTC signaling](https://github.com/asemqaffaf/rust-fetch/milestone/10) milestone.*

| | |
| --- | --- |
| WHIP client for publishing: `client.whip(url, pc)` | [#31](https://github.com/asemqaffaf/rust-fetch/issues/31) |
| WHEP client for playback: `client.whep(url, pc)` | [#32](https://github.com/asemqaffaf/rust-fetch/issues/32) |
| Trickle ICE and ICE restarts | [#33](https://github.com/asemqaffaf/rust-fetch/issues/33) |
| Local WHIP/WHEP test server and real-browser WebRTC tests | [#34](https://github.com/asemqaffaf/rust-fetch/issues/34) |

## The native transport on npm

*Goal: `npm install rust-fetch` gets the native transport, with its measured gains (up to 1.95× `fetch()`'s throughput under concurrency), on every supported platform, with no build step. Tracked in the [Native transport delivery](https://github.com/asemqaffaf/rust-fetch/milestone/9) milestone.*

| | |
| --- | --- |
| Prebuilt binaries as per-platform optional packages; loader, CI build matrix and publishing | [#14](https://github.com/asemqaffaf/rust-fetch/issues/14) |
| Windows support and a Windows CI job | [#15](https://github.com/asemqaffaf/rust-fetch/issues/15) |

**Needs one-time setup first ([#14](https://github.com/asemqaffaf/rust-fetch/issues/14)):** npm trusted publishing is configured per package, so the per-platform packages must first exist on npm. Their names (scope), whether the native transport is on by default when installed, and the minimum glibc for Linux builds also need choosing.

## 2.7.0: resilience, security and observability

*Goal: protect both the client and the APIs it calls, keep untrusted servers from exhausting memory or reaching internal networks, and show where the time goes.*

All 13 items are implemented. The npm package remains at 2.6.1 until the separate release is prepared and published. New controls are opt-in; the guides document transport limitations and compatibility details.

**Before release: performance.** A release audit against 2.6.1 found that the 2.7 work, measured cumulatively rather than PR by PR, failed the release workflow's benchmark gate. Status:

| Performance item | Issue | Status |
| --- | --- | --- |
| Per-request client overhead +11% against 2.6.1 (release gate) | [#179](https://github.com/asemqaffaf/rust-fetch/issues/179) | Fixed: +0.0% to +3.1% on CI |
| Import and first-request startup 10–15% slower | [#180](https://github.com/asemqaffaf/rust-fetch/issues/180) | Improved: +5.2% to +9.7% on CI, still close to the 10% threshold |
| Native transport concurrent throughput 15% below 2.6.1 | [#181](https://github.com/asemqaffaf/rust-fetch/issues/181) | Improved to about 10% below; outside the npm gate |
| Benchmark pull requests against the published release | [#182](https://github.com/asemqaffaf/rust-fetch/issues/182) | Done |
| Flaky Linux WebKit upload test | [#184](https://github.com/asemqaffaf/rust-fetch/issues/184) | Done |

| Implemented feature | Issue | Guide or verification |
| --- | --- | --- |
| Safe POST retries with idempotency keys | [#39](https://github.com/asemqaffaf/rust-fetch/issues/39) | [Retries and idempotency](docs/guide/timeouts-and-retries.md) |
| Concurrency limits and client-side rate limiting | [#40](https://github.com/asemqaffaf/rust-fetch/issues/40) | [Load limits](docs/guide/load-limits.md) |
| Circuit breaker per origin | [#41](https://github.com/asemqaffaf/rust-fetch/issues/41) | [Circuit breakers](docs/guide/circuit-breakers.md) |
| Request timings, lifecycle hooks and W3C trace propagation | [#42](https://github.com/asemqaffaf/rust-fetch/issues/42) | [Observability and OpenTelemetry recipes](docs/guide/observability.md) |
| Per-request retry options | [#64](https://github.com/asemqaffaf/rust-fetch/issues/64) | [Timeouts and retries](docs/guide/timeouts-and-retries.md) |
| Request method, URL and attempts on errors | [#65](https://github.com/asemqaffaf/rust-fetch/issues/65) | [Errors](docs/guide/errors.md) |
| Debug logging | [#66](https://github.com/asemqaffaf/rust-fetch/issues/66) | [Redaction and logging](docs/guide/observability.md#redaction-and-logging) |
| Fuzzing the parsers and request validation | [#67](https://github.com/asemqaffaf/rust-fetch/issues/67) | [Six parser targets](wasm-module/fuzz/), [offline JS boundary fuzzing](scripts/fuzz-js-boundary.mjs), [scheduled CI](.github/workflows/fuzz.yml) |
| Separate connect, response and idle timeouts | [#79](https://github.com/asemqaffaf/rust-fetch/issues/79) | [Timeouts and retries](docs/guide/timeouts-and-retries.md) |
| Streaming request bodies (`ReadableStream` uploads) | [#112](https://github.com/asemqaffaf/rust-fetch/issues/112) | [Uploads and browser support](docs/guide/uploads.md); [bounded 3 GiB upload tests](wasm-module/js/test/uploads.test.mjs) on both Node transports |
| Connection-pool and latency metrics | [#113](https://github.com/asemqaffaf/rust-fetch/issues/113) | [Metrics](docs/guide/observability.md#metrics) |
| Security requirements audited and enforced on every adapter | [#119](https://github.com/asemqaffaf/rust-fetch/issues/119) | [Security](docs/security.md), [six-adapter conformance matrix](CONFORMANCE.md); repository secret scanning and Dependabot security updates enabled |
| Reliability: fault injection, comparison and gap decisions | [#157](https://github.com/asemqaffaf/rust-fetch/issues/157) | [Reproducible comparison and gap decisions](docs/reliability.md), [raw results](benchmarks/reliability/results.json) |

The conformance suite checks 69 behaviors across six adapters (414 observations). Dedicated tests cover phase timeouts, cancellation, overload, SSE/WebSocket stalls and reconnect storms. CI also checks Rust and Node transport coverage, API compatibility, dependencies and package size. Performance results include the measured observability startup and bundle costs; they do not establish zero overhead. See [development and verification](docs/development.md) and the [changelog](CHANGELOG.md#unreleased).

## 2.8.0: data and developer experience

*Goal: less code around each request, and easier testing.*

| | |
| --- | --- |
| Response validation with Standard Schema (Zod, Valibot, ArkType) | [#43](https://github.com/asemqaffaf/rust-fetch/issues/43) |
| Pagination helper: iterate over pages and items | [#44](https://github.com/asemqaffaf/rust-fetch/issues/44) |
| HTTP caching with conditional requests | [#45](https://github.com/asemqaffaf/rust-fetch/issues/45) |
| Deduplicate identical in-flight GET requests | [#46](https://github.com/asemqaffaf/rust-fetch/issues/46) |
| Mock transport for unit tests | [#47](https://github.com/asemqaffaf/rust-fetch/issues/47) |
| Deno, Bun and Cloudflare Workers | [#48](https://github.com/asemqaffaf/rust-fetch/issues/48) |
| Type guards for typed errors (`isHttpError(error)`) | [#68](https://github.com/asemqaffaf/rust-fetch/issues/68) |
| `client.extend()` for derived clients | [#69](https://github.com/asemqaffaf/rust-fetch/issues/69) |
| Authentication helpers: bearer tokens with single-flight refresh | [#70](https://github.com/asemqaffaf/rust-fetch/issues/70) |
| Bundler and framework compatibility tests (Vite, webpack, Next.js) | [#71](https://github.com/asemqaffaf/rust-fetch/issues/71) |
| Documentation site with API reference | [#72](https://github.com/asemqaffaf/rust-fetch/issues/72) |
| Runnable, tested examples | [#73](https://github.com/asemqaffaf/rust-fetch/issues/73) |
| Publishing to JSR | [#74](https://github.com/asemqaffaf/rust-fetch/issues/74) |
| The abort reason (`signal.reason`) on `CancelledError` | [#80](https://github.com/asemqaffaf/rust-fetch/issues/80) |
| `responseType: 'blob'` in browsers | [#81](https://github.com/asemqaffaf/rust-fetch/issues/81) |
| When to use `websocket()` and when to use Socket.IO | [#152](https://github.com/asemqaffaf/rust-fetch/issues/152) |

## Exploring

Ideas we're evaluating; each issue ends with a recommendation before any code.

| | |
| --- | --- |
| mediasoup SFU integration: a WHIP/WHEP adapter, then a rooms SDK | [#52](https://github.com/asemqaffaf/rust-fetch/issues/52) |
| WebRTC signaling helper over `client.websocket()` | [#35](https://github.com/asemqaffaf/rust-fetch/issues/35) |
| WebRTC peer connections in Node.js (recommended: not planned) | [#36](https://github.com/asemqaffaf/rust-fetch/issues/36) |
| Upload progress, WebSockets and interceptors in the Rust crate | [#24](https://github.com/asemqaffaf/rust-fetch/issues/24) |
| HTTP/2 in the Node.js transports | [#25](https://github.com/asemqaffaf/rust-fetch/issues/25) |
| Node.js cookie jar | [#50](https://github.com/asemqaffaf/rust-fetch/issues/50) |
| Resumable downloads and uploads | [#51](https://github.com/asemqaffaf/rust-fetch/issues/51) |
| WebSocket performance: benchmark `websocket()`, then speed up connect, reconnect and messages | [#156](https://github.com/asemqaffaf/rust-fetch/issues/156) |
| WebSocket acknowledgements: request/response over `websocket()` | [#153](https://github.com/asemqaffaf/rust-fetch/issues/153) |
| WebSocket channels: client-side rooms with re-subscribe on reconnect | [#154](https://github.com/asemqaffaf/rust-fetch/issues/154) |
| A Socket.IO-compatible client and a long-polling fallback | [#155](https://github.com/asemqaffaf/rust-fetch/issues/155) |

## Suggesting changes

Open an [issue](https://github.com/asemqaffaf/rust-fetch/issues) describing the problem and your use case, or comment on an existing one; real-world use cases move items up. See [CONTRIBUTING.md](CONTRIBUTING.md) to work on something here.
