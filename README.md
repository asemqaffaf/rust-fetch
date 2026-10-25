# rust-fetch

[![npm version](https://img.shields.io/npm/v/rust-fetch.svg)](https://www.npmjs.com/package/rust-fetch)
[![CI](https://github.com/asemqaffaf/rust-fetch/actions/workflows/rust.yml/badge.svg)](https://github.com/asemqaffaf/rust-fetch/actions/workflows/rust.yml)
[![Coverage: 100% (enforced)](https://img.shields.io/badge/coverage-100%25%20enforced-brightgreen.svg)](https://github.com/asemqaffaf/rust-fetch/actions/workflows/rust.yml)
[![codecov](https://codecov.io/gh/asemqaffaf/rust-fetch/graph/badge.svg)](https://app.codecov.io/gh/asemqaffaf/rust-fetch)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#contributing-and-license)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=flat&logo=WebAssembly&logoColor=white)](https://webassembly.org/)

**A resilient HTTP client for JavaScript and TypeScript: `fetch()` plus the timeouts, retries, typed errors and interceptors that production code needs, from one Rust core that behaves the same in browsers, Web Workers and Node.js.**

📖 **Documentation: [asemqaffaf.github.io/rust-fetch](https://asemqaffaf.github.io/rust-fetch/)**

- **Errors you can branch on.** Every failure rejects with a typed `Error`: `HttpError` (with the status and response body), `TimeoutError`, `NetworkError`, `CancelledError` and [more](https://asemqaffaf.github.io/rust-fetch/guide/errors), so one `catch` handles them all.
- **Safe with servers and URLs you don't control.** Block requests to private networks (SSRF, checked on the resolved address, for requests and WebSockets), cap response, line and event sizes including decompression bombs, keep absolute URLs from taking your credentials away from `baseUrl`, and drop credential headers on cross-origin redirects. Header injection is rejected. [Security](https://asemqaffaf.github.io/rust-fetch/security).
- **Timeouts and retries done right.** `timeoutMs` covers each attempt up to the last byte of the body. Retries back off with jitter, honour `Retry-After`, never repeat a POST or PATCH unless you allow it, and can share a client-wide retry budget.
- **Bounded under load.** Shed load beyond a pending-request limit, hold slow servers back with backpressure, and keep about 7 KB per pending request in Node.js.
- **One core, every runtime.** The request policy is written once in Rust and compiled to WebAssembly, and a [conformance suite](https://asemqaffaf.github.io/rust-fetch/conformance) holds every transport (node:http, the native addon, `fetch()`, real browsers) to the same results.
- **More than `fetch()` offers.** Interceptors, streaming, Server-Sent Events and newline-delimited JSON (for LLM and other streaming APIs), and download and upload progress.
- **One client for HTTP and WebSockets.** `client.websocket()` shares the client's base URL, timeouts and typed errors, and adds reconnection with backoff.
- **Steady under heavy load.** This matters at hundreds or thousands of requests per second; at a few requests a minute, `fetch()` never queues and the server's response time is all you'll see. In an [independent benchmark](https://asemqaffaf.github.io/rust-fetch/performance#independent-benchmark-of-rust-fetch-210) at 15,000 requests per second, the published client's p99 latency was **11.2 ms against 450 ms** for Node.js `fetch()`, with a third of the memory. The native transport, not in the npm package yet, reached up to **1.95×** `fetch()`'s throughput ([performance](https://asemqaffaf.github.io/rust-fetch/performance)).

## Quick start

```bash
npm install rust-fetch
```

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

**A client set up for production**, with a base URL, timeouts, retries and error handling:

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

More in [Getting started](https://asemqaffaf.github.io/rust-fetch/guide/getting-started), and configurations to copy for credentialed APIs, user-supplied URLs and streaming APIs in [Hardened configurations](https://asemqaffaf.github.io/rust-fetch/security#hardened-configurations).

> **Release status**
> - **On npm (2.6.0):** everything in the documentation, except what's listed below. Node.js requests use a `node:http` transport with a bounded connection pool; browsers use `fetch()`.
> - **In the repository, not yet in the npm package:** the [native Node.js transport](https://asemqaffaf.github.io/rust-fetch/performance#the-native-transport-not-in-the-npm-package-yet) behind the largest performance gains. The package doesn't include its prebuilt binaries yet; build it with `npm run build:native`.

## Compared with `fetch()` and axios

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

The rust-fetch column describes the JavaScript API; the Rust crate has no interceptors, upload progress or WebSockets ([Rust usage](https://asemqaffaf.github.io/rust-fetch/rust)). When something else is the better choice is in [Why rust-fetch?](https://asemqaffaf.github.io/rust-fetch/guide/introduction#when-to-choose-something-else)

## Documentation

- **[Introduction](https://asemqaffaf.github.io/rust-fetch/guide/introduction)**: why rust-fetch, the full feature list, and when to choose something else
- **Guide**: [client options](https://asemqaffaf.github.io/rust-fetch/guide/configuration) · [requests and responses](https://asemqaffaf.github.io/rust-fetch/guide/requests) · [errors](https://asemqaffaf.github.io/rust-fetch/guide/errors) · [timeouts, retries and cancellation](https://asemqaffaf.github.io/rust-fetch/guide/timeouts-and-retries) · [interceptors](https://asemqaffaf.github.io/rust-fetch/guide/interceptors) · [streaming and Server-Sent Events](https://asemqaffaf.github.io/rust-fetch/guide/streaming) · [uploads](https://asemqaffaf.github.io/rust-fetch/guide/uploads) · [WebSockets](https://asemqaffaf.github.io/rust-fetch/guide/websockets) · [TypeScript](https://asemqaffaf.github.io/rust-fetch/guide/typescript)
- **[Security](https://asemqaffaf.github.io/rust-fetch/security)**: SSRF, size limits, load shedding, credential-safe redirects, and hardened configurations
- **[Performance](https://asemqaffaf.github.io/rust-fetch/performance)**: our measurements and independent benchmarks, including where rust-fetch loses
- **[Transport conformance](https://asemqaffaf.github.io/rust-fetch/conformance)**: every behaviour on every transport
- **Reference**: [architecture](https://asemqaffaf.github.io/rust-fetch/architecture) · [using it from Rust](https://asemqaffaf.github.io/rust-fetch/rust) · [compatibility and limitations](https://asemqaffaf.github.io/rust-fetch/compatibility) (and upgrading to 2.0) · [stability and releases](https://asemqaffaf.github.io/rust-fetch/stability) · [development and benchmarking](https://asemqaffaf.github.io/rust-fetch/development) · [FAQ](https://asemqaffaf.github.io/rust-fetch/faq)
- **[Changelog](https://github.com/asemqaffaf/rust-fetch/blob/main/CHANGELOG.md)**

The documentation is in [`docs/`](https://github.com/asemqaffaf/rust-fetch/tree/main/docs) and published from it on every change to `main`.

## Contributing and license

Contributions are welcome. See [CONTRIBUTING.md](https://github.com/asemqaffaf/rust-fetch/blob/main/CONTRIBUTING.md) for the development process and pull request checks, and [SECURITY.md](https://github.com/asemqaffaf/rust-fetch/blob/main/SECURITY.md) to report a vulnerability. Releases are published by CI when a version tag is pushed; see [CONTRIBUTING.md](https://github.com/asemqaffaf/rust-fetch/blob/main/CONTRIBUTING.md#releasing). Planned work is in the [roadmap](https://github.com/asemqaffaf/rust-fetch/blob/main/ROADMAP.md).

Licensed under either of [MIT](https://github.com/asemqaffaf/rust-fetch/blob/main/LICENSE-MIT) or [Apache-2.0](https://github.com/asemqaffaf/rust-fetch/blob/main/LICENSE-APACHE), at your option.
