# Roadmap

Where rust-fetch is going, in the order we plan to ship it. Each release links its issues; the [roadmap issue](https://github.com/asemqaffaf/rust-fetch/issues/26) tracks progress, and the [milestones](https://github.com/asemqaffaf/rust-fetch/milestones) group the work by release.

**Principles**
- **Stay on 2.x.** Every change keeps existing code working; nothing here needs a major version.
- **Policy in Rust, bytes in the transport.** Retries, timeouts, validation and errors stay in the shared core, so every runtime behaves the same.
- **Measure before claiming.** Performance work lands with benchmarks, and the README reports the results, including the unfavourable ones.

Dates aren't promised; the order is.

## 2.2.0: upload progress, WebSockets, typed responses

*Status: complete, as version 2.2.0.*

| | |
| --- | --- |
| Upload progress (`onUploadProgress`) in browsers and Node.js | [#11](https://github.com/asemqaffaf/rust-fetch/issues/11) |
| `client.websocket()`: one client for HTTP and WebSockets, with reconnection and typed errors | [#11](https://github.com/asemqaffaf/rust-fetch/issues/11) |
| Generic request methods: `client.get<User>(…)` | [#27](https://github.com/asemqaffaf/rust-fetch/issues/27) |
| Coverage of the Rust core and the Node.js transport on Codecov | [#12](https://github.com/asemqaffaf/rust-fetch/issues/12) |
| Native transport code in the repository (not yet in the npm package) | [#10](https://github.com/asemqaffaf/rust-fetch/issues/10) |
| Release checklist | [#13](https://github.com/asemqaffaf/rust-fetch/issues/13) |
| TypeScript 7 for the dev toolchain, definitions checked with 5.2 and 7 | [#28](https://github.com/asemqaffaf/rust-fetch/issues/28) |

## 2.3.0: the native transport on npm

*Goal: `npm install rust-fetch` gets the native transport, with its measured gains (up to 1.95× `fetch()`'s throughput under concurrency), on every supported platform, with no build step.*

| | |
| --- | --- |
| Prebuilt binaries as per-platform optional packages; loader, CI build matrix and publishing | [#14](https://github.com/asemqaffaf/rust-fetch/issues/14) |
| Windows support and a Windows CI job | [#15](https://github.com/asemqaffaf/rust-fetch/issues/15) |
| Real-browser CI in Chromium, Firefox and WebKit | [#19](https://github.com/asemqaffaf/rust-fetch/issues/19) |
| Web Workers and service workers tested | [#20](https://github.com/asemqaffaf/rust-fetch/issues/20) |

**Needs a decision first ([#14](https://github.com/asemqaffaf/rust-fetch/issues/14)):** the npm package names (scope), whether the native transport is on by default when installed, and the minimum glibc for Linux builds.

## 2.4.0: performance and WebSocket polish

*Goal: close the remaining gaps in the measurements, and make WebSockets work behind proxies.*

| | |
| --- | --- |
| Find the ~565 ms p99 stall at a steady 15,000 requests/s | [#16](https://github.com/asemqaffaf/rust-fetch/issues/16) |
| Native transport at least as fast as `node:http` for sequential requests | [#17](https://github.com/asemqaffaf/rust-fetch/issues/17) |
| Bounded memory under overload | [#18](https://github.com/asemqaffaf/rust-fetch/issues/18) |
| WebSocket proxy support in Node.js | [#21](https://github.com/asemqaffaf/rust-fetch/issues/21) |
| How exceptions in WebSocket callbacks are reported | [#22](https://github.com/asemqaffaf/rust-fetch/issues/22) |

## Exploring

Ideas we're evaluating; each issue ends with a recommendation before any code.

| | |
| --- | --- |
| Upload progress, WebSockets and interceptors in the Rust crate | [#24](https://github.com/asemqaffaf/rust-fetch/issues/24) |
| HTTP/2 in the Node.js transports | [#25](https://github.com/asemqaffaf/rust-fetch/issues/25) |

## Suggesting changes

Open an [issue](https://github.com/asemqaffaf/rust-fetch/issues) describing the problem and your use case, or comment on an existing one; real-world use cases move items up. See [CONTRIBUTING.md](CONTRIBUTING.md) to work on something here.
