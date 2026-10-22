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
| [2.3.0](#230-the-native-transport-on-npm) | Native transport on npm | Next |
| [2.4.0](#240-performance-and-proxies) | Performance and proxies | Planned |
| [2.5.0](#250-webrtc-signaling) | WebRTC signaling (WHIP/WHEP) | Planned |
| [2.6.0](#260-streaming-apis) | Streaming APIs: SSE, NDJSON | Planned |
| [2.7.0](#270-resilience-and-observability) | Resilience and observability | Planned |
| [2.8.0](#280-data-and-developer-experience) | Data and developer experience | Planned |

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

## 2.3.0: the native transport on npm

*Goal: `npm install rust-fetch` gets the native transport, with its measured gains (up to 1.95× `fetch()`'s throughput under concurrency), on every supported platform, with no build step.*

| | |
| --- | --- |
| Prebuilt binaries as per-platform optional packages; loader, CI build matrix and publishing | [#14](https://github.com/asemqaffaf/rust-fetch/issues/14) |
| Windows support and a Windows CI job | [#15](https://github.com/asemqaffaf/rust-fetch/issues/15) |
| Real-browser CI in Chromium, Firefox and WebKit | [#19](https://github.com/asemqaffaf/rust-fetch/issues/19) |
| Web Workers and service workers tested | [#20](https://github.com/asemqaffaf/rust-fetch/issues/20) |

**Needs a decision first ([#14](https://github.com/asemqaffaf/rust-fetch/issues/14)):** the npm package names (scope), whether the native transport is on by default when installed, and the minimum glibc for Linux builds.

## 2.4.0: performance and proxies

*Goal: close the remaining gaps in the measurements, and work behind proxies everywhere.*

| | |
| --- | --- |
| Find the ~565 ms p99 stall at a steady 15,000 requests/s | [#16](https://github.com/asemqaffaf/rust-fetch/issues/16) |
| Native transport at least as fast as `node:http` for sequential requests | [#17](https://github.com/asemqaffaf/rust-fetch/issues/17) |
| Bounded memory under overload | [#18](https://github.com/asemqaffaf/rust-fetch/issues/18) |
| Proxies from the environment (`HTTPS_PROXY`, `NO_PROXY`) | [#49](https://github.com/asemqaffaf/rust-fetch/issues/49) |
| WebSocket proxy support in Node.js | [#21](https://github.com/asemqaffaf/rust-fetch/issues/21) |
| How exceptions in WebSocket callbacks are reported | [#22](https://github.com/asemqaffaf/rust-fetch/issues/22) |

## 2.5.0: WebRTC signaling

*Goal: set up WebRTC sessions with the standard HTTP signaling protocols, WHIP (RFC 9725) and WHEP, with the client's timeouts, retries and typed errors. Tracked in [#30](https://github.com/asemqaffaf/rust-fetch/issues/30).*

| | |
| --- | --- |
| WHIP client for publishing: `client.whip(url, pc)` | [#31](https://github.com/asemqaffaf/rust-fetch/issues/31) |
| WHEP client for playback: `client.whep(url, pc)` | [#32](https://github.com/asemqaffaf/rust-fetch/issues/32) |
| Trickle ICE and ICE restarts | [#33](https://github.com/asemqaffaf/rust-fetch/issues/33) |
| Local WHIP/WHEP test server and real-browser WebRTC tests | [#34](https://github.com/asemqaffaf/rust-fetch/issues/34) |

## 2.6.0: streaming APIs

*Goal: first-class support for the streaming formats APIs use today, including LLM streaming APIs.*

| | |
| --- | --- |
| Server-Sent Events with reconnection, `POST` bodies and headers: `client.events()` | [#37](https://github.com/asemqaffaf/rust-fetch/issues/37) |
| Newline-delimited JSON as an async iterator: `responseType: 'ndjson'` | [#38](https://github.com/asemqaffaf/rust-fetch/issues/38) |

## 2.7.0: resilience and observability

*Goal: protect both the client and the APIs it calls, and show where the time goes.*

| | |
| --- | --- |
| Safe POST retries with idempotency keys | [#39](https://github.com/asemqaffaf/rust-fetch/issues/39) |
| Concurrency limits and client-side rate limiting | [#40](https://github.com/asemqaffaf/rust-fetch/issues/40) |
| Circuit breaker per origin | [#41](https://github.com/asemqaffaf/rust-fetch/issues/41) |
| Request timings, lifecycle hooks and W3C trace propagation | [#42](https://github.com/asemqaffaf/rust-fetch/issues/42) |

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

## Suggesting changes

Open an [issue](https://github.com/asemqaffaf/rust-fetch/issues) describing the problem and your use case, or comment on an existing one; real-world use cases move items up. See [CONTRIBUTING.md](CONTRIBUTING.md) to work on something here.
