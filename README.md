# rust-fetch

[![npm version](https://img.shields.io/npm/v/rust-fetch.svg)](https://www.npmjs.com/package/rust-fetch)
[![CI](https://github.com/asemqaffaf/rust-fetch/actions/workflows/rust.yml/badge.svg)](https://github.com/asemqaffaf/rust-fetch/actions/workflows/rust.yml)
[![Coverage: 100% (enforced)](https://img.shields.io/badge/coverage-100%25%20enforced-brightgreen.svg)](https://github.com/asemqaffaf/rust-fetch/actions/workflows/rust.yml)
[![codecov](https://codecov.io/gh/asemqaffaf/rust-fetch/graph/badge.svg)](https://app.codecov.io/gh/asemqaffaf/rust-fetch)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#contributing-and-license)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=flat&logo=WebAssembly&logoColor=white)](https://webassembly.org/)

**A resilient HTTP client for JavaScript and TypeScript: `fetch()` plus the timeouts, retries, typed errors and interceptors that production code needs, from one Rust core that behaves the same in browsers, Web Workers and Node.js.**

- **Errors you can branch on.** Every failure rejects with a typed `Error`: `HttpError` (with the status and response body), `TimeoutError`, `NetworkError`, `CancelledError` and [more](#errors), so one `catch` handles them all.
- **Timeouts and retries done right.** `timeoutMs` covers each attempt up to the last byte of the body. Retries back off with jitter, honour `Retry-After`, and never repeat a POST or PATCH unless you allow it.
- **One core, every runtime.** The request policy is written once in Rust and compiled to WebAssembly, so a request is validated, retried and timed out the same way in a browser tab and in a Node.js service.
- **More than `fetch()` offers.** Interceptors, streaming, Server-Sent Events and newline-delimited JSON (for LLM and other streaming APIs), and download and upload progress.
- **One client for HTTP and WebSockets.** `client.websocket()` shares the client's base URL, timeouts and typed errors, and adds reconnection with backoff.
- **Steady under load.** In an [independent benchmark](#independent-benchmark-of-rust-fetch-210) at 15,000 requests per second, the published client's p99 latency was **11.2 ms against 450 ms** for Node.js `fetch()`, with a third of the memory. The native transport, not in the npm package yet, reached up to **1.95×** `fetch()`'s throughput ([performance](#performance)).

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

`init()` is safe to call more than once, and calling it in Node.js is harmless, so shared code can always call it. Serve the `.wasm` file with `Content-Type: application/wasm`, so the browser compiles it while it downloads, and consider preloading it (see [Startup](#startup)).

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

> **Release status**
> - **On npm (2.5.0):** everything in this README, including the [security options](#security) (SSRF protection, response size limits, `allowAbsoluteUrls`), [redirect control](#redirects), [browser `fetch()` options](#browser-request-options), [proxies in Node.js](#proxies), [Server-Sent Events](#server-sent-events), newline-delimited JSON, [upload progress](#upload-progress) and [WebSockets](#websockets), except what's listed below. Node.js requests use a `node:http` transport with a bounded connection pool; browsers use `fetch()`.
> - **In the repository, not yet in the npm package:** the [native Node.js transport](#the-native-transport-not-in-the-npm-package-yet) behind the largest performance gains below. The package doesn't include its prebuilt binaries yet; build it with `npm run build:native`.

## Contents

- [Why rust-fetch?](#why-rust-fetch)
- [Features](#features)
- [Performance](#performance)
- [Usage and configuration](#usage-and-configuration): [client options](#client-options) · [requests](#making-requests) · [bodies](#request-bodies) · [responses](#responses) · [errors](#errors) · [timeouts](#timeouts) · [retries](#retries) · [cancellation](#cancellation) · [interceptors](#interceptors) · [streaming](#streaming) · [Server-Sent Events](#server-sent-events) · [download progress](#download-progress) · [uploads](#file-uploads) · [upload progress](#upload-progress) · [WebSockets](#websockets) · [TypeScript](#typescript) · [legacy functions](#legacy-functions)
- [Security](#security)
- [Using it from Rust](#using-it-from-rust)
- [Architecture](#architecture)
- [Compatibility and limitations](#compatibility-and-limitations)
- [Development and benchmarking](#development-and-benchmarking)
- [FAQ](#faq)
- [Contributing and license](#contributing-and-license)

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
| Added to a browser bundle (brotli) | Nothing, it's built in | About 21 KB | About 188 KB: the WebAssembly module (179 KB) and its JS glue |

The rust-fetch column describes the JavaScript API; the Rust crate has no interceptors, upload progress or WebSockets ([Rust usage](#using-it-from-rust)).

### One client for HTTP and WebSockets

Real-time features usually mean a second client with its own URL handling, timeouts and error handling. In rust-fetch, `client.websocket()` is part of the same client: it resolves against the same `baseUrl`, uses the same timeout for each connection attempt, and fails with the same typed errors as requests. It also adds what the platform's `WebSocket` lacks: reconnection with backoff after unexpected drops, a connect timeout, `opened`/`closed` promises and JSON messages ([WebSockets](#websockets)).

### Compared with `undici.request()`

`undici.request()`, the engine under Node's `fetch()`, is a lower-level, Node.js-only API. It was faster than both rust-fetch transports for small requests over plain HTTP in our tests, so it's the better choice when raw throughput is all you need and you'll build error handling, timeouts and retries yourself. rust-fetch is the better choice when you want that policy built in and the same client in browsers. Over HTTPS, the native transport matched `undici.request()` (30,452 against 30,546 requests per second), and on 8 MB bodies it was ahead (322 against 301).

### When to choose something else

- **Every kilobyte counts in your browser bundle.** The WebAssembly module is about 179 KB brotli-compressed.
- **You only need raw throughput in Node.js** and will handle failures yourself: use `undici.request()` (see above).
- **Your Node.js code makes one request at a time** and you're considering the native transport for speed: there it's level with the node:http transport and a few percent behind `fetch()` (it was about 6% slower before 2.4.0).

## Features

Unless noted, each of these works the same in browsers, Web Workers and Node.js 20+.

**Reliability**
- **Typed errors.** Every rejection is a real `Error` with a `kind` (`HttpError`, `TimeoutError`, `NetworkError`, …) and details like `status`, `body` and `timeoutMs`, so error handling branches on data instead of parsing messages. [Errors](#errors)
- **Per-attempt timeouts** that cover the response body, not just the headers, so a server that stalls mid-body can't hang a request. The default is 30 s. [Timeouts](#timeouts)
- **Retries** with exponential backoff and jitter, so clients recovering at the same time don't hit a struggling server in lockstep. `Retry-After` is honoured, and POST/PATCH aren't retried unless you opt in, so a retry can't duplicate an order or a payment. [Retries](#retries)
- **Cancellation** with `AbortSignal`, which also stops pending retry delays and streamed bodies, so an abandoned request releases its resources. [Cancellation](#cancellation)
- **Interceptors** for requests and responses: add auth headers, refresh tokens and report errors in one place. [Interceptors](#interceptors)

**Requests and responses**
- **Request bodies** from strings, bytes, `Blob`/`File`, `FormData` (multipart with files), `URLSearchParams` or JSON, with the matching `Content-Type` set for you. [Request bodies](#request-bodies)
- **Response decoding** by `Content-Type` (including `application/*+json`), or forced to `json`, `text`, `binary` or `stream`. [Responses](#responses)
- **Streaming** responses as a `ReadableStream`, and **download progress** callbacks, for large downloads. [Streaming](#streaming)
- **Server-Sent Events** with `client.events()`: in browsers and Node.js, with any method, headers and body (as streaming LLM APIs need), JSON data, reconnection with `Last-Event-ID`, and `for await`. **Newline-delimited JSON** with `responseType: 'ndjson'`. [Server-Sent Events](#server-sent-events)
- **Upload progress** callbacks, for progress bars on large uploads, which `fetch()` can't report. [Upload progress](#upload-progress)

**Real-time**
- **WebSockets on the same client**: the same base URL, timeouts and typed errors as your requests, plus reconnection with jittered backoff after unexpected drops. Browsers and Node.js 22+. [WebSockets](#websockets)

**Node.js**
- **A bounded connection pool**: up to 256 keep-alive connections per origin, so traffic bursts queue and reuse connections instead of exhausting local ports. [Connection pooling](#connection-pooling)
- **A native transport** (not in the npm package yet; build it from source) that moves connection work off the event loop for more throughput under concurrency, and steps aside automatically for custom agents and proxies. [Architecture](#architecture)

**Tooling and quality**
- **TypeScript** definitions for the whole API, and the same client [as a Rust library](#using-it-from-rust).
- **Tested** with 100% line and function coverage of the Rust core and of the Node.js transport, enforced in CI, and with the JS suites on Node.js 20, 22 and 24. [Development](#development-and-benchmarking)

## Performance

All results are from local servers over loopback, so they compare each client's own overhead, not network performance. Percentages are relative throughput (requests per second), not latency. Two sources:

- **Our measurements** of the `node:http` transport that the npm package uses and of the native transport (not in the npm package yet), next to Node's `fetch()` and `undici.request()`. Apple M1 Pro, Node.js 22.13.
- **An [independent benchmark](https://github.com/aakjp/stress-test/blob/main/BENCHMARK.md)** of the published rust-fetch 2.1.0 against `fetch()` and axios. Apple M4 Pro, Node.js 22.15.

These results are about Node.js. In browsers, `fetch()` is the only way to make requests, so rust-fetch uses it and can't be faster than it; the difference is a fraction of a millisecond per request, which matters little once a request crosses a real network.

### The npm package today

rust-fetch as published (2.1.x, `node:http` transport) against Node.js `fetch()`. The independent column is summarized from the [full report below](#independent-benchmark-of-rust-fetch-210); ours from the [all-client tables](#throughput-all-clients):

| Workload | Independent benchmark (2.1.0, M4 Pro) | Our measurements (M1 Pro) |
| --- | --- | --- |
| Steady 15,000 requests/s | p99 **11.2 ms against 450 ms**; slowest request 64 ms against 1.5 s; **202 MB against 635 MB** of memory (one run) | Independent harness: kept up (14,981/s against 13,026/s); p50 6.3 ms against 449 ms; p99 565 ms against 920 ms; event-loop delay 9.8 ms against 310 ms. Our harness: 12,955/s against 11,557/s, but a worse p99 (1.6 s against 1.2 s) |
| 50 to 500 requests in flight | **105% to 116%** throughput at every level | **107% to 114%**, with a lower p99 at every level |
| Overload (offered 40,000 and 50,000 requests/s) | Found a port-exhaustion bug in 2.1.0, fixed in 2.1.1 | **1.7×** and **1.4×** the requests delivered |
| 8 MB binary bodies | **115%** (faster in 10 of 10 runs) | **133%** |
| 0.6 MB JSON | **105%** (faster in 10 of 10 runs) | 95% |
| Small JSON, one at a time | 100% | 102% |
| Small JSON, 50 at a time | 91% | 105% (500 at a time: 112%) |
| HTTPS small JSON, 50 at a time | not tested | 92% |

The published client matches `fetch()` one request at a time, is ahead with large binary bodies and many requests in flight, and stays steadier under sustained load in tail latency and memory. It's behind on concurrent HTTPS, and in one of the two 15,000 requests/s harnesses its tail was worse.

The same independent harness later re-tested **2.2.0** ([below](#independent-benchmark-of-rust-fetch-220)): ahead of `fetch()` in all four throughput workloads (102% to 112%), including 50 requests at a time, where 2.1.0 was at 91%, and at an offered 50,000 requests/s it delivered 1.3 times `fetch()`'s requests with no errors and a third less memory.

#### Independent benchmark of rust-fetch 2.2.0

[aakjp/stress-test](https://github.com/aakjp/stress-test/blob/main/BENCHMARK-2.2.0.md) re-ran its benchmark on rust-fetch 2.2.0 (`node:http` transport) against Node's `fetch()` and axios 1.20, on Apple silicon with Node.js 22.15, against a local HTTP/1.1 server. The report has its method and raw data.

**Throughput**, requests per second, medians of 10 runs:

| Workload | `fetch()` | rust-fetch 2.2.0 | axios (default) | rust-fetch vs `fetch()` |
| --- | ---: | ---: | ---: | ---: |
| Small JSON, one at a time | 10,002 | 10,389 | 7,831 | **104%** (faster in 8 of 10 runs) |
| Small JSON, 50 at a time | 14,821 | 15,188 | 11,037 | **102%** (6 of 10) |
| Large JSON (0.6 MB) | 449 | 473 | 436 | **105%** (10 of 10) |
| Binary (8 MB) | 188 | 210 | 199 | **112%** (10 of 10) |

Against `fetch()` in the same runs, 2.1.0 had scored 100%, 91%, 105% and 115%: the clear change is 50 requests at a time, from 91% to 102%. The report also compares 2.2.0's raw numbers with 2.1.0's (+4.5% to +7.3%), but `fetch()`'s own numbers moved by up to 9% between those runs, so we read the ratios.

**Overload: an offered 50,000 requests/s for 60 s:**

| Client | Delivered | p50 | p99 | Errors | Peak memory |
| --- | ---: | ---: | ---: | ---: | ---: |
| rust-fetch 2.2.0 | **21,341/s** | 461 ms | **505 ms** | **0** | **604 MB** |
| `fetch()` | 16,158/s | 352 ms | 832 ms | 2,166 | 913 MB |
| axios (keep-alive) | 13,763/s | 716 ms | 786 ms | 0 | 754 MB |
| axios (default) | 3,113/s | 2.6 s | 10.5 s | 149,749 | 912 MB |

The improvement over 2.1.0 at this load (3,493/s with 172,942 errors) comes from the bounded connection pool released in 2.1.1, after the first report found the port exhaustion; 2.2.0 includes it. The report's [verification suite](https://github.com/aakjp/stress-test/blob/main/TEST-2.2.0.md) also checked 2.2.0's new features (typed requests, upload progress, WebSockets with reconnection and typed errors): 19 of 19 checks passed, and 2.1.0 code ran unchanged.

#### Independent benchmark of rust-fetch 2.1.0

[aakjp/stress-test](https://github.com/aakjp/stress-test/blob/main/BENCHMARK.md) compared the published client, rust-fetch 2.1.0 (`node:http` transport), with Node's built-in `fetch()` and axios 1.20, on an Apple M4 Pro with Node.js 22.15, against a local HTTP/1.1 server without TLS or compression. The full report has its method and raw data.

**Throughput**, requests per second, median of 10 runs:

| Workload | `fetch()` | rust-fetch | axios | rust-fetch vs `fetch()` |
| --- | ---: | ---: | ---: | ---: |
| Small JSON, one at a time | 9,649 | 9,680 | 7,497 | 100% |
| Small JSON, 50 at a time | 15,529 | 14,191 | 9,902 | 91% |
| Large JSON (0.6 MB) | 426 | 446 | 407 | **105%** (faster in 10 of 10 runs) |
| Binary (8 MB) | 174 | 201 | 188 | **115%** (faster in 10 of 10 runs) |

With each client in its own process and a constant number of requests in flight, rust-fetch was ahead of `fetch()` at every level (one run per level):

| Requests in flight | 50 | 100 | 200 | 500 |
| --- | ---: | ---: | ---: | ---: |
| `fetch()` | 22,800 | 22,390 | 21,181 | 19,019 |
| rust-fetch | **23,977** | **23,882** | **23,454** | **22,064** |
| axios (default) | 14,737 | 14,519 | 13,449 | 12,461 |

**A steady 15,000 requests per second for 60 seconds** (one run):

| Client | Delivered | Errors | p50 | p99 | Slowest | Peak memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rust-fetch | 15,001/s | 0 | 4.7 ms | **11.2 ms** | **64 ms** | **202 MB** |
| `fetch()` | 14,944/s | 0 | **3.1 ms** | 450 ms | 1,545 ms | 635 MB |
| axios (keep-alive agent, 128 sockets) | 14,578/s | 0 | 669 ms | 718 ms | 731 ms | 761 MB |
| axios (default) | 3,292/s | 165,440 | 2.4 s | 13 s | 14 s | 843 MB |

`fetch()` had the fastest median, but its slowest requests took up to 1.5 s, and its tail varied tenfold between runs. axios's default configuration opens a new connection per request and ran out of local ports. The report's 15,000 requests per second was 89% of what its server could handle.

**Overload at 50,000 requests per second**, two to three times what any client could sustain on the M4 Pro, found a bug: rust-fetch 2.1.0 opened a new connection for every waiting request, ran out of local ports and delivered 3.2k requests per second, while `fetch()` delivered 14.4k. 2.1.1 fixed it with a pool of up to 256 connections per origin, so extra requests wait instead. In our re-run of that test on an Apple M1 Pro (Node.js 22.13), rust-fetch went from 2.7k requests per second and 43.5k errors to 18.9k and none.

The report tested three clients on one machine. It didn't include `undici.request()`, got or ky.

### The native transport (not in the npm package yet)

The native Node.js transport against Node.js `fetch()`, from [our measurements](#our-measurements-every-client) (Apple M1 Pro, Node.js 22.13). The npm package doesn't include it yet; it has to be [built from source](#architecture).

| Workload | Native transport vs `fetch()` |
| --- | --- |
| HTTPS, 50 concurrent small-JSON requests | **1.95×** throughput |
| 500 concurrent small-JSON requests | **1.89×** throughput |
| 50 concurrent small-JSON requests | **1.71×** throughput |
| 8 MB binary transfers | **1.61×** throughput |
| Offered 40,000 requests/s (overload) | **2.9×** requests delivered |
| 50 to 500 requests in flight, independent harness | **1.6× to 1.7×** throughput, about **half the p99** at every level |
| Event loop at 15,000 requests/s, independent harness | **1.6 ms** p95 delay against 310 ms, leaving the event loop free for your application |
| Steady 15,000 requests/s, our harness | Kept up (14,992/s against 11,557/s), about **13× lower p99** (91 ms against 1.2 s) and about **4× less memory** (195 MB against 782 MB) |
| Steady 15,000 requests/s, independent harness | Kept up (14,991/s against 13,026/s); p99 568 ms against 920 ms; 541 MB against 903 MB |
| Large JSON, 0.6 MB | 1.02×, even |
| Sequential small-JSON requests | 0.94×, about 6% slower (before 2.4.0; see below) |

**Since 2.4.0** the native transport runs on a single Tokio worker thread, with large compressed bodies decoded on a separate blocking pool. Each request is a short burst of work, so more workers mostly added cross-thread wake-ups. Measured against the previous build in fresh processes over 5 interleaved rounds (`npm run bench:compare`): sequential small JSON **+7.3%**, now level with the node:http transport (11,220 against 11,126 requests/s); 8 MB bodies **+5.5%**; 50 concurrent unchanged; and at an offered 40,000 requests/s, **+9%** delivered (34,827 against 31,970/s) with a lower p99 (281 against 316 ms). The table above predates this change.

**Why concurrency is where it wins.** With the `node:http` transport, connection handling, HTTP parsing and decompression share the JavaScript event loop with your application. The native transport runs them on its own threads, leaving the event loop free to build requests and decode responses. With one request at a time there's little to overlap, and the hand-off between threads costs a little. How much you gain depends on your hardware, payloads and concurrency.

**Where it doesn't win:** sequential requests were about 6% slower than with `fetch()` and the node:http transport before 2.4.0, and are now level with the node:http transport; large JSON is effectively even (304 against 299 requests per second), and both parse the JSON in JavaScript; and under heavy overload it used about as much memory as `fetch()` (796 MB against 781 MB).

### Our measurements: every client

The tables behind both summaries: Node's `fetch()`, `undici.request()` and both rust-fetch transports, measured together on an Apple M1 Pro with Node.js 22.13.

#### Throughput: all clients

All four clients ran in the same rounds, in rotating order, against a server in a separate process (HTTP/1.1, and HTTPS where noted). Requests per second, median of 7 rounds:

| Workload | `fetch()` | `undici.request()` | rust-fetch, node:http | rust-fetch, native | Native vs `fetch()` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small JSON, sequential | 10,468 | 15,346 | 10,691 | 9,857 | 94% (6% slower) |
| Small JSON, 50 concurrent | 18,019 | 42,260 | 18,916 | 30,874 | **171%** |
| Small JSON, 500 concurrent | 15,419 | 38,171 | 17,285 | 29,209 | **189%** |
| HTTPS small JSON, 50 concurrent | 15,639 | 30,546 | 14,444 | 30,452 | **195%** |
| Large JSON, 0.6 MB | 299 | 325 | 283 | 304 | 102% |
| Binary, 8 MB | 201 | 301 | 267 | 322 | **161%** |

In the three concurrent workloads, the native transport's p99 latency was less than half of `fetch()`'s (50 concurrent: 2.41 ms against 5.38 ms; 500 concurrent: 23.45 ms against 58.64 ms; HTTPS: 2.44 ms against 6.46 ms). For large JSON it was higher (8.76 ms against 5.39 ms).

#### Under load: all clients

Each client ran in its own process. These rows come from two different harnesses and aren't comparable with each other:

| Test | `fetch()` | `undici.request()` | rust-fetch, node:http | rust-fetch, native | Native vs `fetch()` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Offered 40,000 requests/s for 20 s, delivered (our harness) | 10,081/s | 37,687/s | 16,984/s | 29,502/s | **2.9×** |
| Offered 50,000 requests/s for 60 s, delivered ([aakjp/stress-test](https://github.com/aakjp/stress-test) harness) | 12,421/s | not tested | 17,828/s | 32,678/s | **2.6×** |

**Concurrency sweep**, a constant number of requests in flight for 10 s each ([aakjp/stress-test](https://github.com/aakjp/stress-test) harness), requests per second with p99 latency:

| Requests in flight | `fetch()` | rust-fetch, node:http | rust-fetch, native | Native vs `fetch()` |
| --- | ---: | ---: | ---: | ---: |
| 50 | 17,041 (6.8 ms) | 18,452 (6.1 ms) | **29,198 (2.4 ms)** | **171%** |
| 100 | 17,660 (10.2 ms) | 18,855 (9.3 ms) | **28,402 (5.1 ms)** | **161%** |
| 200 | 16,365 (24.3 ms) | 18,624 (14.8 ms) | **28,454 (11.3 ms)** | **174%** |
| 500 | 15,960 (47.3 ms) | 17,685 (38.7 ms) | **27,563 (24.6 ms)** | **173%** |

At 40,000 requests per second, peak memory was 781 MB for `fetch()`, 244 MB for `undici.request()`, 567 MB for the node:http transport and 796 MB for the native transport, whose queued requests wait inside the addon.

**A steady 15,000 requests per second**, sent on a fixed schedule whether or not the client keeps up. No client had errors. Our harness (20 s, one server process):

| Client | Delivered | p50 | p95 | p99 | Peak memory |
| --- | ---: | ---: | ---: | ---: | ---: |
| `fetch()` | 11,557/s | 477 ms | 779 ms | 1.2 s | 782 MB |
| `undici.request()` | 14,992/s | 2.4 ms | 11 ms | 31 ms | 135 MB |
| rust-fetch, node:http | 12,955/s | 404 ms | 1.1 s | 1.6 s | 541 MB |
| rust-fetch, native | **14,992/s** | 4.1 ms | 46 ms | **91 ms** | **195 MB** |

The [aakjp/stress-test](https://github.com/aakjp/stress-test) harness (60 s, six server processes):

| Client | Delivered | p50 | p95 | p99 | Peak memory | JS heap after the run | Event-loop delay (p95) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `fetch()` | 13,026/s | 449 ms | 491 ms | 920 ms | 903 MB | 479 MB | 310 ms |
| rust-fetch, node:http | 14,981/s | 6.3 ms | 118 ms | 565 ms | 548 MB | 82 MB | 9.8 ms |
| rust-fetch, native | **14,991/s** | **3.5 ms** | **4.8 ms** | 568 ms | 541 MB | **23 MB** | **1.6 ms** |

Event-loop delay is how late the harness's 10 ms scheduler ran: how long your own code would wait behind the HTTP client.

In both harnesses, the native transport sustained approximately the target rate and `fetch()` didn't. In the independent harness, both rust-fetch transports still show a p99 stall of about 565 ms even though the native transport's p95 was 4.8 ms. Its cause hasn't been verified.

### Startup

How long until the first response, from a fresh Node.js process or a fresh page (`npm run bench:cold`; median of 7 samples, local server, Apple M1 Pro, Node.js 22.13). *Import* is importing the package, or `init()` in browsers; *first request* is the first `get()` of a small JSON response.

| Runtime | Client | Import / `init()` | First request | Total |
| --- | --- | ---: | ---: | ---: |
| Node.js | `fetch()` | — | 21.9 ms | 21.9 ms |
| Node.js | rust-fetch, node:http transport | 18.3 ms | 9.3 ms | 27.6 ms |
| Node.js | rust-fetch, native transport | 20.2 ms | 5.3 ms | 25.5 ms |
| Chromium | rust-fetch, empty cache | 8.3 ms | 6.6 ms | 14.9 ms |
| Chromium | rust-fetch, cached | 2.4 ms | 1.3 ms | 3.7 ms |
| Firefox | rust-fetch, empty cache | 15.0 ms | 3.0 ms | 18.0 ms |
| Firefox | rust-fetch, cached | 13.0 ms | 3.0 ms | 16.0 ms |
| WebKit | rust-fetch, empty cache | 10.0 ms | 5.0 ms | 15.0 ms |
| WebKit | rust-fetch, cached | 7.0 ms | 3.0 ms | 10.0 ms |

- **Node.js:** about 13 ms of the import is Node.js loading `node:http`, which `fetch()` pays too, on its first call (it loads undici lazily). rust-fetch's own share is about 7 ms: compiling the WebAssembly module (about 1 ms, since V8 compiles functions on first use), its JS glue, and loading the native addon. All told, the first response arrives 4 to 6 ms later than with `fetch()`.
- **Browsers:** `init()` streams the module into the compiler as it downloads (`WebAssembly.instantiateStreaming`, which needs `Content-Type: application/wasm`). Chromium also caches the compiled code, so a returning visit costs a few milliseconds. The numbers above don't include download time. On a real network, start the download early by preloading the file from your page's `<head>`:

  ```html
  <link rel="preload" href="/assets/rust_fetch_bg.wasm" as="fetch" type="application/wasm" crossorigin>
  ```

  Use the URL your bundler gives the file. With Vite, for example, `import wasmUrl from 'rust-fetch/rust_fetch_bg.wasm?url'` returns it, and `init({ module_or_path: wasmUrl })` then loads that same URL.

### Reading these results

- **Throughput, latency and memory are separate questions.** A client can deliver more requests per second with a worse tail, or the reverse; memory is the peak resident size of the client process.
- **`fetch()`, `undici.request()` and rust-fetch do different amounts of work.** Node's `fetch()` implements the browser `fetch()` API on top of undici. `undici.request()` is undici's lower-level API, without WHATWG streams. rust-fetch adds retries, per-attempt timeouts, validation, typed errors and interceptors to every request. So `undici.request()` isn't an identical workload, and it was fastest on plain HTTP in these tests: 1.4 to 2.2 times the node:http transport's small-JSON throughput and 1.3 to 1.6 times the native transport's, while over HTTPS the native transport matched it.
- **Results vary** with hardware, Node.js version, payload size, concurrency and the server setup. The node:http transport delivered 12,955 requests per second at an offered 15,000 in one harness and 14,981 in the other, so measure on your own hardware before relying on a number ([how](#benchmarks)).

## Usage and configuration

The examples in this section use a client like this one:

```js
import { WasmClient } from 'rust-fetch';

const client = new WasmClient({ baseUrl: 'https://api.example.com/v1' });
```

### Client options

```ts
const client = new WasmClient({
  baseUrl: 'https://api.example.com/v1', // relative request URLs are appended to this
  headers: { Authorization: 'Bearer …' }, // sent with every request
  timeoutMs: 10_000,                      // per attempt; 0 disables. Default: 30000
  retries: 3,                             // or a RetryOptions object, see Retries
  redirect: 'follow',                     // or 'manual' / 'error', see Redirects. Default: 'follow'
  maxRedirects: 20,                       // Node.js; browsers apply their own limit. Default: 20
  proxy: 'env',                           // Node.js: HTTPS_PROXY / HTTP_PROXY / NO_PROXY, or a proxy URL; see Proxies
  allowAbsoluteUrls: false,               // reject absolute URLs instead of letting them replace baseUrl; see Security. Default: true
});
```

#### Proxies

In Node.js, requests can go through an HTTP or HTTPS proxy: HTTPS requests through a `CONNECT` tunnel, so the proxy never sees their contents, and plain HTTP requests as absolute-URL requests.

```js
new WasmClient({ proxy: 'env' });                              // HTTPS_PROXY, HTTP_PROXY and NO_PROXY (or lower case)
new WasmClient({ proxy: 'http://user:pass@proxy.internal:3128' }); // every request; credentials as Proxy-Authorization
```

- `'env'` reads the variables on each request: `HTTPS_PROXY` for `https:` URLs, `HTTP_PROXY` for `http:` ones, and skips hosts in `NO_PROXY`. A `NO_PROXY` entry is `*`, a host name (which also covers its subdomains; a leading `.` or `*.` is optional) or an IP address (matched exactly), each with an optional `:port`.
- `NODE_USE_ENV_PROXY=1`, which Node.js uses for its own `fetch()`, turns on `'env'` for clients without a `proxy` option.
- Proxied requests use the `node:http` transport, with a pool of connections per proxy. This includes streamed responses (`'stream'`, `'ndjson'`) and `events()`.
- Browsers use the system's proxy settings and ignore this option.

Invalid options throw an `InvalidInputError` right away, from the constructor.

### Making requests

| Method | Use |
| --- | --- |
| `get(url, options?)`, `head(url, options?)`, `delete(url, options?)` | Requests without a body |
| `post(url, init?)`, `put(url, init?)`, `patch(url, init?)` | `init.body` is the body; any other [request option](#request-options) can go next to it |
| `fetch(url, init?)` | `fetch`-style, with `init.method` (default `GET`) |
| `post_json`, `put_json`, `patch_json(url, body, options?)` | Always send `body` as JSON |
| `request(method, url, headers?, body?, options?)` | Fully positional |

```js
await client.post('/users', { body: { name: 'Zoë' } });
await client.get('/search', { params: { q: 'rust wasm', page: 2, tag: ['a', 'b'] } }); // ?q=rust+wasm&page=2&tag=a&tag=b
await client.fetch('/users/1', { method: 'DELETE', headers: { 'X-Reason': 'cleanup' } });
```

Relative URLs need a `baseUrl`. In a browser page without one, they resolve against the page URL. Absolute URLs always win over `baseUrl`. `TRACE` and `CONNECT` are rejected, because browsers' `fetch()` forbids them.

#### Request options

| Option | Type | Description |
| --- | --- | --- |
| `headers` | object, `Headers`, `Map` or `[name, value][]` | Override client headers with the same name. Numbers and booleans are converted to strings. |
| `params` | object or `URLSearchParams` | Appended to the query string. Arrays repeat the key; `null`/`undefined` are skipped. |
| `timeoutMs` | number | Overrides the client timeout; `0` disables it |
| `responseType` | `'auto'` \| `'json'` \| `'text'` \| `'binary'` \| `'stream'` \| `'ndjson'` | See [Responses](#responses) |
| `signal` | `AbortSignal` | See [Cancellation](#cancellation) |
| `onDownloadProgress` | `({ loaded, total }) => void` | See [Download progress](#download-progress) |
| `onUploadProgress` | `({ loaded, total }) => void` | See [Upload progress](#upload-progress) |
| `redirect` | `'follow'` \| `'manual'` \| `'error'` | Overrides the client's; see [Redirects](#redirects) |
| `maxRedirects` | number | Overrides the client's; see [Redirects](#redirects) |
| `credentials`, `mode`, `cache`, `keepalive`, `priority`, `referrer`, `referrerPolicy`, `integrity` | as in `fetch()` | Browsers; see [Browser request options](#browser-request-options) |

#### Browser request options

In browsers, Web Workers and other `fetch()` runtimes (Deno, Bun), the standard `fetch()` options are passed through: set them on the client for every request, or per request, where each one overrides the client's.

```js
const api = new WasmClient({ baseUrl: 'https://api.example.com', credentials: 'include' }); // send cookies cross-origin
await api.get('/feed', { cache: 'no-store' });                     // bypass the HTTP cache
await api.post('/analytics', { body: event, keepalive: true });    // outlives the page
await api.get('https://cdn.example.com/ping', { mode: 'no-cors' }); // opaque: status 0, no headers or body
```

| Option | Values |
| --- | --- |
| `credentials` | `'same-origin'` (default), `'include'` (cross-origin too; the server must send `Access-Control-Allow-Credentials: true` and its exact origin), `'omit'` |
| `mode` | `'cors'` (default), `'same-origin'`, `'no-cors'` (resolves with an opaque response: `status: 0`, `ok: false`, no headers, `body: null`) |
| `cache` | `'default'`, `'no-store'`, `'reload'`, `'no-cache'`, `'force-cache'`, `'only-if-cached'` |
| `keepalive` | `true` lets the request outlive the page (browsers limit these bodies to 64 KB) |
| `priority` | `'high'`, `'low'`, `'auto'` |
| `referrer`, `referrerPolicy`, `integrity` | As in `fetch()` |

They apply to every request, streamed responses and `client.events()`. With upload progress, which uses `XMLHttpRequest`, `credentials: 'include'` becomes `withCredentials`. For the other options, or `credentials: 'omit'`, the request goes through `fetch()` instead, so upload progress is reported once. Node.js requests don't use these options; invalid values still throw an `InvalidInputError` there.

#### Redirects

Redirects (301, 302, 303, 307 and 308) are followed the way `fetch()` follows them: a 303, or a 301 or 302 after `POST`, becomes a `GET` without a body, and `res.url` is the final URL. In Node.js, `Authorization`, `Cookie` and `Proxy-Authorization` headers are dropped when a redirect leaves the origin; browsers apply their own rules.

| `redirect` | What happens |
| --- | --- |
| `'follow'` (default) | Follow up to `maxRedirects` redirects (default 20); one more rejects with a `NetworkError` |
| `'manual'` | Resolve with the redirect response itself, with `ok: false` and its `Location` header |
| `'error'` | Reject with a `NetworkError` on any redirect (the same as `maxRedirects: 0`) |

```js
const res = await client.get('/login', { redirect: 'manual' });
if (!res.ok) console.log(res.status, res.headers.location); // 302 '/sso?…'
```

In browsers, `fetch()` hides redirects from scripts: with `'manual'` the response has `status: 0` and no headers, and the browser's own limit (20) applies instead of `maxRedirects`. With upload progress in browsers, they send the request with `fetch()` instead of `XMLHttpRequest` (which always follows redirects), so upload progress is reported once.

### Request bodies

The body's type decides how it's sent. A `Content-Type` header you set yourself is always kept, except for `FormData`, which needs its own boundary.

| Body | Sent as | Default `Content-Type` |
| --- | --- | --- |
| `string` | as-is | `text/plain` |
| `Uint8Array`, `ArrayBuffer`, `DataView`, `Buffer` | bytes | `application/octet-stream` |
| `Blob` / `File` | bytes | the blob's `type` |
| `FormData` | `multipart/form-data`, including files | `multipart/form-data; boundary=…` |
| `URLSearchParams` | form-encoded | `application/x-www-form-urlencoded;charset=UTF-8` |
| anything else (objects, arrays, numbers, booleans) | `JSON.stringify` | `application/json` |

`null` and `undefined` mean no body. The `*_json` methods are the exception: they always send JSON, so `post_json(url, null)` sends `null`. `ReadableStream` request bodies aren't supported; send a `Blob` or bytes instead.

### Responses

Successful (2xx) requests, and redirects with `redirect: 'manual'`, resolve to:

```ts
interface HttpResponse<T = any> {
  status: number;          // 200
  statusText: string;      // "OK"
  ok: boolean;             // true; false only for a redirect with redirect: 'manual'. Other non-2xx responses reject with an HttpError
  url: string;             // final URL after redirects
  headers: Record<string, string>; // lower-cased names; repeated headers joined with ", "
  body: T;
}
```

With the default `responseType: 'auto'`, `body` is:
- **parsed JSON** for `application/json` and `application/*+json` (e.g. `problem+json`), falling back to text if it isn't valid JSON
- **a string** for `text/*`, XML, JavaScript and form-encoded responses
- **a `Uint8Array`** for anything else
- **`null`** when the body is empty (e.g. `204` or `HEAD`)

Force a type with `responseType: 'json'` (fails with a `ParseError` if the body isn't JSON), `'text'`, `'binary'`, `'stream'` or `'ndjson'` (see [Streaming](#streaming)). JSON is parsed by the JS engine's `JSON.parse`, exactly like `Response.json()`.

### Errors

Every rejection is an `Error` whose `name` and `kind` are one of:

| `kind` | When | Extra fields |
| --- | --- | --- |
| `HttpError` | Non-2xx response | `status`, `statusText`, `body` (full response body as text) |
| `TimeoutError` | An attempt exceeded `timeoutMs` | `timeoutMs` |
| `NetworkError` | DNS, connection, TLS or CORS failure, a body cut off mid-transfer, or a WebSocket that fails to connect or drops | |
| `CancelledError` | The `signal` was aborted | |
| `InvalidInputError` | Bad URL, method, header, option or body. Rejected before anything is sent. | `parameter` |
| `ParseError` | `responseType: 'json'` and the body isn't JSON | |
| `JsInteropError` | Unexpected JS ↔ Wasm conversion failure | |

```js
try {
  await client.get('/users/9');
} catch (error) {
  if (error.kind === 'HttpError' && error.status === 404) {
    // not found
  } else if (error.kind === 'TimeoutError') {
    console.warn(`gave up after ${error.timeoutMs} ms`);
  } else {
    throw error;
  }
}
```

Long error bodies (such as an HTML error page) are truncated to 200 characters in `message`. `error.body` always has the full text.

### Timeouts

`timeoutMs` limits each attempt, from sending the request to receiving the last byte of the body. When retries are on, each attempt gets the full timeout. For `responseType: 'stream'`, the timeout covers only the wait for the headers; after that, reading the stream is up to you.

### Retries

Retries are off by default. `retries: 3` enables them with these defaults; pass an object to change them:

```ts
new WasmClient({
  retries: {
    maxRetries: 3,          // retries after the first attempt
    initialDelayMs: 100,    // first backoff
    maxDelayMs: 10_000,     // cap for any delay, including Retry-After
    multiplier: 2,          // exponential backoff: 100, 200, 400 … ms, each randomized to 50–100%
    retryOn: [408, 429, 500, 502, 503, 504],
    retryOnNetworkError: true,
    retryOnTimeout: true,
    retryNonIdempotent: false, // set to true to also retry POST and PATCH
  },
});
```

- A `Retry-After` header in seconds is honoured, capped at `maxDelayMs`.
- POST and PATCH aren't retried by default. The server may already have acted on a failed attempt, so retrying can duplicate work.
- `InvalidInputError`, `ParseError` and unlisted statuses are never retried.
- When every attempt fails, the request rejects with the last attempt's error.

### Cancellation

```js
const controller = new AbortController();
const request = client.get('/report', { signal: controller.signal });
controller.abort();
try {
  await request;
} catch (error) {
  console.log(error.kind); // 'CancelledError'
}

await client.get('/report', { signal: AbortSignal.timeout(5_000) }); // total deadline, including retries
```

Aborting cancels the request in flight, any pending retry delay, and a body being streamed.

### Interceptors

```js
const token = 'your-access-token'; // e.g. from your auth flow

// Add a header to every request (may be async)
client.addRequestInterceptor((request) => {
  request.headers.authorization = `Bearer ${token}`;
  // mutate in place, or return a new { method, url, headers, body }
});

// Resolve to the body instead of the whole response
client.addResponseInterceptor((response) => response.body);

// Report failures, then keep rejecting
client.addResponseInterceptor(undefined, (error) => {
  console.error('request failed:', error.kind, error.message);
  throw error;
});
```

An `onRejected` handler can also recover by returning a value, for example the result of retrying the request after refreshing a token.

- Request interceptors run in order before each request. They see `{ method, url, headers, body }`, where `headers` holds the per-request headers. Client default headers are added afterwards, and a request header with the same name wins.
- Response interceptors chain like `promise.then(onFulfilled, onRejected)`. Their return values are what the call resolves to. Throw to reject.
- `addRequestInterceptor` and `addResponseInterceptor` return an id for `ejectInterceptor(id)`. `clearInterceptors()` removes all of them.
- A request uses the interceptors registered when it started.
- Interceptors apply to HTTP requests, not to WebSockets.

### Streaming

`responseType: 'stream'` resolves as soon as the headers arrive. `body` is then a `ReadableStream<Uint8Array>`:

```js
const res = await client.get('/export.csv', { responseType: 'stream' });
let received = 0;
for await (const chunk of res.body) {
  received += chunk.byteLength; // each chunk is a Uint8Array
}
console.log(`${received} bytes`);
```

`for await` over a stream works in Node.js, Chrome and Firefox. Safari doesn't support it yet, so use `res.body.getReader()` there. Retries apply until the headers arrive, and error statuses still reject with an `HttpError`.

**Newline-delimited JSON** (NDJSON, JSON Lines), as streamed by Ollama, many search and log APIs, and Kubernetes watches: with `responseType: 'ndjson'`, `body` is a `ReadableStream` of parsed values, one per line, as each line arrives:

```js
const res = await client.post('/api/generate', { body: { model: 'llama3', prompt: 'Why is the sky blue?' }, responseType: 'ndjson' });
for await (const chunk of res.body) {
  console.log(chunk.response);
}
```

Lines may be split across network chunks, end in `\n` or `\r\n`, and the last one doesn't need a newline; empty lines are skipped. A line that isn't JSON errors the stream with a `ParseError` naming the line number.

### Server-Sent Events

`client.events()` reads a [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) stream. Unlike the browser's `EventSource`, it works in Node.js too, sends any method, headers and body, and uses the client's base URL, interceptors, timeouts and typed errors.

```js
// A streaming LLM API: POST a JSON body, read JSON events until `data: [DONE]`
const stream = client.events('/v1/chat/completions', {
  method: 'POST',
  body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hello' }], stream: true },
  headers: { authorization: 'Bearer your-api-key' },
  messageType: 'json',
});
for await (const { data } of stream) {
  console.log(data.choices[0].delta.content ?? '');
}

// A notification feed: callbacks, reconnecting with Last-Event-ID
const feed = client.events('/notifications', {
  onEvent: ({ event, data, id }) => console.log(event, data, id),
  onError: (error) => console.warn(error.kind, error.message),
});
await feed.opened;
feed.close();
```

Each event is `{ event, data, id }`: `event` is `'message'` unless the server set one, `data` is the `data:` lines joined with `\n` (or parsed JSON with `messageType: 'json'`), and `id` is the last event ID. Events go to `onEvent` when it's set; otherwise they're buffered for `for await`, and `break` closes the stream.

| Option | Description |
| --- | --- |
| `method`, `body`, `headers`, `params`, `timeoutMs` | As for requests. `timeoutMs` covers each connection attempt until the response headers arrive |
| `reconnect` | Reconnect after the stream ends or a connection fails, sending `Last-Event-ID` and waiting the server's `retry:` delay (otherwise backing off like WebSockets). `true`, a maximum number of attempts in a row, or `{ maxRetries, initialDelayMs, maxDelayMs, multiplier }`. Default: on for `GET`, off for other methods, which would resend their body |
| `messageType` | `'auto'` (default: `data` is a string) or `'json'` |
| `end` | Close the stream normally when an event's `data` equals this. Default: `'[DONE]'` with `messageType: 'json'` |
| `signal` | Closes the stream and stops reconnecting when aborted |
| `onOpen`, `onEvent`, `onError`, `onReconnect`, `onClose` | Callbacks; `onClose` runs once, when the stream is closed for good |

The stream also has `url`, `state` (`'connecting'`, `'open'`, `'reconnecting'` or `'closed'`), `lastEventId`, and `opened` and `closed` promises. Failures are typed: a refused connection or dropped stream is a `NetworkError`, a response that isn't `text/event-stream` a `ParseError`, an error status an `HttpError` (408, 429 and 5xx are reconnected after, others end the stream), and a `204 No Content` ends it normally. With `messageType: 'json'`, a `data` that isn't JSON goes to `onError`; when iterating, it ends the stream with the `ParseError`. Request interceptors run before each connection.

### Download progress

```js
await client.get('/video.mp4', {
  responseType: 'binary',
  onDownloadProgress: ({ loaded, total }) => {
    console.log(total ? `${Math.round((loaded / total) * 100)}%` : `${loaded} bytes`);
  },
});
```

The callback runs after each chunk of a successful response, including streamed ones. `total` comes from `Content-Length` and is `null` when the server doesn't send it. Exceptions thrown by the callback are ignored.

### File uploads

Pass a `FormData` and it's sent as `multipart/form-data`, files included:

```js
const form = new FormData();
form.append('title', 'Quarterly report');
form.append('file', new File(['%PDF-1.7 …'], 'report.pdf', { type: 'application/pdf' })); // or a file from <input type="file">
await client.post('/upload', { body: form });
```

A single `Blob` or `File` body is sent as raw bytes with the blob's type.

### Upload progress

Report how much of a request body has been sent, for example to drive a progress bar:

```js
const form = new FormData();
form.append('video', new Blob([new Uint8Array(50_000_000)]), 'video.mp4');

await client.post('/upload', {
  body: form,
  onUploadProgress: ({ loaded, total }) => {
    console.log(`${Math.round((loaded / total) * 100)}% uploaded`);
  },
});
```

`loaded` is the number of body bytes sent so far and `total` is the body's size. A retried request starts again from 0. Exceptions thrown by the callback are ignored, and requests without a body report nothing. It works with `onDownloadProgress` on the same request, but not with `responseType: 'stream'`.

How it's sent:
- **Browsers:** `fetch()` has no upload progress events, so these requests go through `XMLHttpRequest`, with the same redirects, credentials, timeouts, retries and errors. Like any `XMLHttpRequest` with an upload listener, a cross-origin request is always [preflighted](https://developer.mozilla.org/docs/Web/HTTP/CORS#preflighted_requests), so the server must answer `OPTIONS`. Where `XMLHttpRequest` doesn't exist (service workers), progress is reported once, when the response arrives.
- **Node.js:** the `node:http` transport (never the native one) writes the body in 64 KB chunks and reports each once it has been handed to the operating system.

### WebSockets

Available in browsers and in Node.js 22 and newer (Node.js 20 needs `--experimental-websocket`).

```js
const socket = client.websocket('/live', {     // wss://api.example.com/v1/live?room=blue
  params: { room: 'blue' },
  messageType: 'json',                         // parse text messages as JSON
  reconnect: true,                             // after failures and unexpected drops, 1 s doubling to 30 s
  onMessage: (message) => console.log('received', message),
  onError: (error) => console.warn(error.kind, error.message),
  onReconnect: ({ attempt, delayMs }) => console.log(`reconnecting in ${delayMs} ms (attempt ${attempt})`),
});

await socket.opened;                           // rejects with a typed error if it never connects
socket.sendJson({ type: 'subscribe', channel: 'prices' });
socket.close();                                // stops reconnecting
const { code, reason, wasClean } = await socket.closed;
```

In Node.js you can authenticate the handshake with headers, which browsers don't allow:

```js
const authed = client.websocket('/live', { headers: { authorization: 'Bearer your-access-token' } }); // Node.js only
```

`websocket()` resolves relative URLs against `baseUrl`, turning `http:` into `ws:` and `https:` into `wss:`, and returns at once; messages sent before the connection opens (or while it reconnects) are queued. `state` is `'connecting'`, `'open'`, `'reconnecting'`, `'closing'` or `'closed'`.

| Option | Description |
| --- | --- |
| `protocols` | Subprotocols to offer; the chosen one is `socket.protocol` |
| `params` | Appended to the query string |
| `headers` | Handshake headers, merged over the client's. Node.js only: browsers don't allow WebSocket headers, so passing them there throws an `InvalidInputError`, and the client's headers aren't sent |
| `dispatcher` | Node.js only: an [undici](https://undici.nodejs.org) dispatcher for the connection, e.g. `new ProxyAgent('http://proxy:3128')` to connect through a proxy (see below). Browsers use the system's proxy settings, so passing one there throws an `InvalidInputError` |
| `timeoutMs` | Time allowed for each connection attempt; defaults to the client's `timeoutMs`, `0` disables it |
| `reconnect` | `true`, a maximum number of attempts in a row, or `{ maxRetries, initialDelayMs, maxDelayMs, multiplier }` (defaults: unlimited, 1000, 30000, 2). Off by default |
| `messageType` | `'auto'` (default: text as strings, binary as `Uint8Array`) or `'json'` |
| `signal` | Closes the connection and stops reconnecting when aborted |
| `onOpen`, `onMessage`, `onError`, `onReconnect`, `onClose` | Callbacks; `onClose` runs once, when the connection is closed for good |

Failures are typed like request errors: a refused or failed connection is a `NetworkError`, an attempt that takes too long a `TimeoutError`, a JSON message that doesn't parse a `ParseError`, and closing before the first connection opens rejects `opened` with a `CancelledError`. With `reconnect`, a failed attempt or an unexpected drop (close codes 1001, 1006 and 1011–1014) is retried with jittered exponential backoff, and the count resets once a connection opens. A server that closes normally (1000) or with its own code isn't reconnected to. An exception thrown by a callback doesn't affect the connection; it's reported as an unhandled promise rejection. As with an exception in a handler of the platform's own `WebSocket`, Node.js then ends the process unless you handle it (`process.on('unhandledRejection', …)`), so catch errors inside your callbacks.

`send()` takes a string, `ArrayBuffer`, typed array, `DataView` or `Blob`; `sendJson()` takes any JSON value. `close(code, reason)` takes 1000 (the default) or 3000–4999.

### TypeScript

Type definitions ship with the package and need TypeScript 5.2 or newer. Besides `WasmClient`, it exports the option and result types `ClientOptions`, `RequestOptions`, `FetchInit`, `RetryOptions`, `HttpResponse`, `RustFetchError`, `DownloadProgress`, `UploadProgress` and `InterceptedRequest`, for WebSockets `WebSocketConnection`, `WebSocketOptions`, `ReconnectOptions`, `WebSocketCloseInfo`, `WebSocketReconnectInfo`, `WebSocketState` and `WebSocketData`, and for Server-Sent Events `EventStream`, `EventStreamOptions`, `EventStreamState` and `ServerSentEvent`.

Every request method takes the response body's type as a type parameter, defaulting to `any`:

```ts
import { WasmClient, type HttpResponse, type RustFetchError } from 'rust-fetch';

const client = new WasmClient({ baseUrl: 'https://api.example.com/v1' });

interface User { id: number; name: string }

const res = await client.get<User>('/users/42'); // HttpResponse<User>
res.body.name; // string

const created: HttpResponse<User> = await client.post<User>('/users', { body: { name: 'Zoë' } });

try {
  await client.get('/users/9');
} catch (e) {
  const error = e as RustFetchError;
  if (error.kind === 'HttpError') console.log(error.status);
}
```

The type parameter describes what you expect; rust-fetch doesn't check the JSON against it. Validate untrusted responses with a schema library if you need to.

### Legacy functions

These standalone functions still work. Each call uses a default client: 30 s timeout, no retries.

| Function | Resolves to |
| --- | --- |
| `fetch_json(url)` / `fetch_json_promise(url)` | Parsed JSON, whatever the `Content-Type`; `null` for an empty body |
| `fetch_text(url)` | The body as a string |
| `fetch_with_options(url, method, headers, body?)` | The full `HttpResponse` |
| `create_client()` | `new WasmClient()` |
| `fetch_wasm_json`, `fetch_wasm_map`, `fetch_wasm_api`, `fetch_wasm_html` | Deprecated aliases of `fetch_json` / `fetch_text` |

## Security

What the client does for you, each behaviour covered by tests:

- **Credentials stay with their origin on redirects.** When a redirect leaves the origin (another host, port or scheme, including `https:` to `http:`), the Node.js transports drop `Authorization`, `Cookie` and `Proxy-Authorization`. This is the class of bug behind CVEs in node-fetch, follow-redirects and undici. Browsers apply their own, equivalent rules.
- **No header injection.** A header name or value containing CR or LF rejects with an `InvalidInputError` before anything is sent.
- **Only `http:` and `https:`.** Request URLs, `baseUrl`, and redirect targets with any other scheme (`file:`, `data:`, …) are rejected.
- **Paths stay under `baseUrl`.** Relative paths, including tricks like `//other.host/x` or `/\other.host`, resolve under the base URL (the class of axios CVE-2024-39338).
- **Proxy credentials go only to the proxy.** They're sent as `Proxy-Authorization` to the proxy, never to the origin.
- **No runtime dependencies.** The npm package has none, and every release is published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). Rust dependencies are audited in CI (`cargo-deny`: advisories, licenses, sources).

### Compared with `fetch()` and axios

The same attacks against each client, with the protections it offers turned on (`npm run security:compare`; Node.js 22.13, axios 1.20). Each rust-fetch row is also a regression test in CI (`wasm-module/js/test/security.test.mjs`), named after the advisories it covers.

| Attack | rust-fetch | Node's `fetch()` | axios |
| --- | --- | --- | --- |
| Credentials on a cross-origin redirect (node-fetch CVE-2022-0235, follow-redirects CVE-2022-0536 and CVE-2024-28849, undici CVE-2023-45143 and CVE-2024-24758) | dropped | dropped | dropped |
| CR/LF in a header (undici CVE-2022-31150, CVE-2022-35948) | rejected before sending | rejected | stripped silently |
| Path tricks with a base URL (axios CVE-2024-39338) | stay on the base host | no base URL | stay on the base host |
| Absolute URL with a base URL (axios CVE-2025-27152) | blocked with `allowAbsoluteUrls: false` | no base URL | blocked with `allowAbsoluteUrls: false` |
| Redirect to `file:` | refused | refused | refused |
| 256 MB gzip bomb | rejected with `maxResponseBytes`, +3 MB of memory | **no limit available**: accepted, +853 MB | rejected with `maxContentLength`, +2 MB |
| Request to the cloud metadata endpoint `169.254.169.254` (SSRF) | **blocked** with `allowPrivateNetwork: false` | no built-in check | no built-in check |
| Runtime dependencies | none | built in | 4 |

Only rust-fetch blocks SSRF before connecting, and rejects header injection instead of altering the header. Like axios, and unlike `fetch()`, it can bound a response's size. Every protection that isn't on by default (absolute URLs, size, private networks) is one option away.

### Absolute URLs and `baseUrl`

By default, as in axios, an absolute URL passed to a client with a `baseUrl` replaces the base URL, **and receives the client's headers**, such as `Authorization`. If any part of a request URL comes from user input, an attacker can send it to their own server along with your credentials (the class of axios CVE-2025-27152). Turn it off:

```js
const api = new WasmClient({
  baseUrl: 'https://api.example.com/v1',
  headers: { authorization: `Bearer ${token}` },
  allowAbsoluteUrls: false,
});
await api.get(`/users/${userInput}`);   // stays on api.example.com
await api.get('https://evil.example/'); // rejects with InvalidInputError (parameter: 'url'); nothing is sent
await api.get('https://partner.example/data', { allowAbsoluteUrls: true }); // per request, deliberately
```

`allowAbsoluteUrls` applies to requests, `client.events()` and `client.websocket()`, and can be set per request. In Rust, it's `ClientBuilder::allow_absolute_urls(false)`.

### Response size limits and decompression bombs

A server, or anyone who controls a URL you fetch, can send an endless body, or a few kilobytes of gzip that decompress to gigabytes, and exhaust your process's memory. `fetch()` has no way to limit either. Set `maxResponseBytes`:

```js
const client = new WasmClient({ maxResponseBytes: 10 * 1024 * 1024 });        // 10 MB, for every request
await client.get('/export', { maxResponseBytes: 500 * 1024 * 1024 });         // per request
await client.get('/trusted', { maxResponseBytes: null });                     // no limit for this one
// → NetworkError "Response body larger than maxResponseBytes (10485760 bytes)", error.maxResponseBytes === 10485760
```

The limit is on the decompressed body, and it's enforced on every transport (node:http, native, browser `fetch()`), without reading more than needed:

- A `Content-Length` over the limit fails before the body is read. For a compressed body, the limit applies to its decompressed size.
- Without a `Content-Length`, the body is counted as it arrives, and reading stops at the limit.
- Decompression is bounded too: zlib, brotli and zstd stop one byte past the limit. A 64 MB gzip bomb with a 1 MB limit fails without expanding in memory (tested for gzip, deflate, brotli and zstd).
- Error responses and streamed bodies (`responseType: 'stream' | 'ndjson'`) are limited the same way; a stream errors once it passes the limit. In browsers, a request with `onUploadProgress` and a limit uses `fetch()` instead of `XMLHttpRequest`, which can't stop at a limit.

The default is no limit, as before. For servers that fetch URLs they don't control, set one.

### Fetching user-supplied URLs (SSRF)

A server that fetches URLs its users give it (webhooks, link previews, image proxies, importers) can be pointed at its own network: `http://169.254.169.254/` (cloud credentials), `http://localhost:6379/`, an admin panel on `10.0.0.5`. Checking the URL string isn't enough: a public-looking name can resolve to a private address, and a redirect can point anywhere. In Node.js, set `allowPrivateNetwork: false`:

```js
const fetcher = new WasmClient({ allowPrivateNetwork: false, maxResponseBytes: 5 * 1024 * 1024, timeoutMs: 10_000 });
await fetcher.get(userUrl); // NetworkError "Blocked: … resolves to 10.0.0.5, a private or reserved address" for internal targets
```

- **Every address is checked when connecting:** the host's DNS answers (all of them), or the IP address itself. So DNS rebinding can't get past it, and each redirect is checked again.
- **Blocked ranges:**
  - IPv4: loopback, RFC 1918 private, link-local (including the 169.254.169.254 metadata endpoint), carrier-grade NAT, "this network", multicast, reserved and documentation ranges
  - IPv6: loopback, unspecified, unique-local, link-local and multicast, plus IPv4-mapped (`::ffff:10.0.0.1`) and NAT64 (`64:ff9b::…`) forms of the IPv4 ranges
- **Separate connection pool:** checked requests never reuse a connection another client made to a private address.
- **Proxies:** through a proxy, only IP-address targets are checked, since the proxy resolves names. Apply the same rule in the proxy's own configuration.
- **Not covered:** `client.websocket()` connections (Node's built-in WebSocket). In browsers this option does nothing; they enforce their own private-network rules.
- **Combine it with limits:** use `maxResponseBytes`, `timeoutMs` and `allowAbsoluteUrls` (above) when fetching anything untrusted.

## Using it from Rust

The same client is a Rust library, for native code (on tokio) and for your own wasm crates:

```rust
use rust_fetch::{Client, Multipart, types::RetryConfig};
use std::time::Duration;

let client = Client::builder()
    .base_url("https://api.example.com/v1")
    .timeout(Duration::from_secs(10))
    .retry_config(RetryConfig { max_retries: 3, ..Default::default() })
    .build()?;

let user = client.get("users/42").await?;
println!("{}", user.json().unwrap()["name"]);

let pdf: Vec<u8> = std::fs::read("report.pdf")?;
let form = Multipart::new().text("title", "Report").file("file", "report.pdf", Some("application/pdf".into()), pdf);
client.post("upload").multipart(&form).send().await?;

let mut chunks = client.get_streaming("export.csv").await?.into_stream(); // a futures::Stream of Vec<u8>
```

Redirects: `.redirect(Redirect::Manual)` or `Redirect::Error`, and `.max_redirects(n)` (default 20), on the `ClientBuilder` or per request on the `RequestBuilder`.

Request futures are `Send`, so you can `tokio::spawn` them. Progress callbacks (`on_download_progress`) must be `Send + Sync` on native targets. Upload progress, WebSockets and interceptors are only in the JavaScript API.

## Architecture

Everything that decides what happens to a request (URL handling, validation, retries and backoff, per-attempt timeouts, typed errors, interceptors) is Rust compiled to WebAssembly, so it behaves the same in every runtime. Underneath, a transport only moves bytes:

| Transport | Where | In the npm package |
| --- | --- | --- |
| The platform's `fetch()` | Browsers and Web Workers | Yes |
| `XMLHttpRequest` | Browsers, for upload progress | Yes |
| `node:http` / `node:https` with keep-alive | Node.js | Yes |
| The runtime's `WebSocket`, with the connection policy (URL, timeout, reconnection, errors) in Rust | WebSockets, everywhere | Yes |
| Native addon: HTTP/1.1 on [hyper](https://hyper.rs) and Tokio threads, loaded through Node-API, with the same redirect, decompression, timeout and connection-limit rules and Node's TLS defaults (Mozilla root certificates, `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED`) | Node.js | Not yet: build it with `npm run build:native` |

**Which transport a request uses:**

| Request | Browsers | Node.js |
| --- | --- | --- |
| Most requests | `fetch()` | The native transport where it's built and Node's global agents are untouched; otherwise `node:http` |
| With `onUploadProgress` (with or without `onDownloadProgress`) | `XMLHttpRequest`, or `fetch()` where there's none | `node:http` |
| With `onDownloadProgress` only, `responseType: 'stream'` or `'ndjson'`, and `client.events()` | `fetch()` | Node's `fetch()` |

**What the native transport changes.** Connection handling, TLS, HTTP parsing and decompression move from the JavaScript event loop to Tokio threads; JavaScript only builds requests and decodes their bodies. That's why it gains most with many requests in flight, and why the hand-off between threads likely contributes to its slower sequential results ([measurements](#the-native-transport-not-in-the-npm-package-yet)).

**When it's used.** The native transport is used when `rust-fetch-native.<platform>-<arch>.node` sits next to the package's `node.js` (`npm run build:native` puts it there). It steps aside where you have installed your own `http.globalAgent` / `https.globalAgent` (for example a proxy agent) or set `NODE_USE_ENV_PROXY`, and `RUST_FETCH_NATIVE=0` turns it off.

### Connection pooling

Browsers pool connections for `fetch()`. In Node.js, both transports keep up to 256 keep-alive connections per origin and queue further requests until one is free, so bursts reuse connections instead of exhausting local ports. If you install your own `http.globalAgent` / `https.globalAgent`, or set limits on Node's, that agent is used instead.

## Compatibility and limitations

### Supported environments

| Environment | Status |
| --- | --- |
| Browsers, Web Workers and service workers | Supported, directly or through bundlers like Vite and webpack; call `init()` first. Tested in CI in Chromium, Firefox and WebKit (Safari's engine), on pages, in dedicated workers and in module service workers. [`fetch()` options](#browser-request-options) such as `credentials` and `cache` are passed through |
| Node.js 20, 22 and 24 | Supported and tested in CI; Node.js 20 is the minimum |
| TypeScript | Definitions included; TypeScript 5.2 or newer |
| Upload progress, WebSockets | JavaScript API only, from 2.2.0. WebSockets need a built-in `WebSocket`: browsers, Node.js 22+, or Node.js 20 with `--experimental-websocket`. Tested in CI on Node.js 22 and 24 |
| Rust | The same client as a Rust library ([usage](#using-it-from-rust)), on tokio or in your own wasm crates |
| Native Node.js transport | In the repository, not yet in the npm package (no prebuilt binaries); build it with `npm run build:native`. Tested in CI on Linux with Node.js 20, 22 and 24, and run on macOS (Apple silicon); not tried on Windows |

### Limitations

- **Bundle size:** the WebAssembly module adds about 179 KB (brotli) to a browser bundle, plus 9 KB of JS glue.
- **HTTP/2:** browsers negotiate it automatically; both Node.js transports use HTTP/1.1 with keep-alive.
- **Proxies:** in Node.js, use the [`proxy` option](#proxies) or `NODE_USE_ENV_PROXY=1`; a proxy agent installed as `http.globalAgent` / `https.globalAgent` (for example from `https-proxy-agent`) works too. In browsers, use the system settings.
- **Native transport:** has to be built from source for each platform until it's published. Sequential requests are level with the node:http transport (they were about 6% slower than `fetch()` before 2.4.0). It isn't used for streamed responses or requests with progress callbacks, and the p99 stall seen in the independent harness is unexplained (see [Under load](#under-load-all-clients)).
- **WebSockets** use the runtime's own `WebSocket`: built into browsers and Node.js 22 and newer, and into Node.js 20 only with `--experimental-websocket` (without it, `websocket()` throws a `NetworkError`). In Node.js it doesn't go through `http.globalAgent` or the client's `proxy` option; pass an undici `ProxyAgent` as `dispatcher` to connect through a proxy:

  ```js
  import { ProxyAgent } from 'undici'; // npm install undici
  const socket = client.websocket('wss://stream.example.com/', { dispatcher: new ProxyAgent(process.env.HTTPS_PROXY) });
  ```
- **Upload progress** in browsers needs `XMLHttpRequest`, which makes cross-origin requests preflighted (see [Upload progress](#upload-progress)).

### Upgrading to 2.0

2.0 fixes long-standing bugs, and some code may have depended on the old behaviour. Check these points:

- **Timeouts are enforced** in browsers and Node.js. In 1.x the 30 s default was silently ignored, so slow requests never failed. For long downloads, set `timeoutMs` higher, or to `0` to disable it.
- **`WasmClient` JSON bodies are plain objects**, not `Map`s: use `body.title`, not `body.get('title')`. JSON with integers above 2^53 no longer fails the request.
- **More responses are decoded:** `application/*+json` (e.g. `problem+json`) is parsed as JSON instead of returned as bytes, and empty bodies are `null`.
- **Errors are real `Error` objects.** `kind`, `message`, `status` and the other fields are unchanged, and `name` equals `kind`. Like any `Error`, `message` isn't enumerable, so `JSON.stringify(error)` leaves it out.
- **Invalid `headers` values reject** with an `InvalidInputError`; they used to be dropped silently. Numbers and booleans are converted to strings.
- **Text is decoded as UTF-8**, whatever the `charset` in `Content-Type`. Invalid bytes become `�`.
- **The package uses an `exports` map.** Import `rust-fetch`, `rust-fetch/rust_fetch.js` or `rust-fetch/rust_fetch_bg.wasm`.
- **Node.js 20+ is required.** In Node.js you no longer need to load the `.wasm` file yourself; `init()` is optional there.

These changed too, but are unlikely to break anything:
- POST and PATCH aren't retried by default (`retryNonIdempotent: true` re-enables it).
- Your `Content-Type` is no longer duplicated.
- `fetch_json` parses JSON whatever the `Content-Type`.
- Invalid URLs, and `TRACE`/`CONNECT`, fail fast with an `InvalidInputError`.

Rust crate users:
- `RetryConfig` has a new field, so add `..Default::default()` to struct literals.
- `Method::to_reqwest()` returns reqwest 0.12's `Method`.
- `RequestBuilder::header()` replaces a default header with the same name instead of adding a second value.

1.x keeps receiving critical fixes on the [`v1.x`](https://github.com/asemqaffaf/rust-fetch/tree/v1.x) branch (`npm install rust-fetch@1`).

## Development and benchmarking

The npm package is built from `wasm-module/` with [wasm-pack](https://rustwasm.github.io/wasm-pack/); the native transport is built from `native/`. The repository root is a private workspace.

```bash
npm run build      # wasm-pack build + package metadata (wasm-module/pkg)
npm run build:native  # build the native Node.js transport (native/) into wasm-module/pkg
npm test           # Rust unit + integration tests, then the JS tests
npm run test:js    # JS end-to-end tests against the built package (requires a build)
npm run test:browsers  # the same package in Chromium, Firefox and WebKit (requires a build and npx playwright install)
npm run bench      # rust-fetch vs native fetch (requires a build)
npm run size       # size budget for the built package
npm run api:check  # public TypeScript API vs the committed snapshot
npm run coverage:js  # Node.js transport coverage (100% lines and functions)

cd wasm-module
wasm-pack test --node    # wasm unit tests for the JS bindings
cargo llvm-cov --ignore-filename-regex 'src/(wasm/|http\.rs)|tests/'   # coverage
```

| Suite | Where | What |
| --- | --- | --- |
| Rust unit tests | `wasm-module/src/**` | URL handling, retry policy, decoding, errors, multipart |
| Rust integration tests | `wasm-module/tests/integration_tests.rs` | Real HTTP against a local server: retries, timeouts, redirects, chunked/truncated/large bodies, streaming, progress, concurrency |
| Wasm unit tests | `wasm-module/src/wasm/tests.rs` | JS conversions, bodies, options, interceptors, timers and abort signals in Node.js |
| JS end-to-end tests | `wasm-module/js/test/client.test.mjs` | The built package against a local server |
| Node transport tests | `wasm-module/js/test/node-transport.test.mjs` | Redirects, decompression, default headers, connection pooling and HTTPS. With `client.test.mjs`, they run once per Node.js transport: native (when built) and node:http (the `*-js.test.mjs` files) |
| Browser transport tests | `wasm-module/js/test/browser-transport.test.mjs` | The browser entry without the Node.js transport: `fetch()`, and `XMLHttpRequest` (simulated over `node:http`) for upload progress |
| WebSocket tests | `wasm-module/js/test/websocket.test.mjs` | `websocket()` against a local WebSocket server: URLs, headers, messages, timeouts, reconnection, closing |
| Real-browser tests | `wasm-module/js/test/browsers.test.mjs` | The browser entry in Chromium, Firefox and WebKit (Playwright): requests and typed errors, timeouts, retries, cancellation, streaming, Server-Sent Events and NDJSON, download progress, upload progress with a cross-origin preflight, WebSockets, and the same client in a dedicated worker and a module service worker. `npm run test:browsers` after `npx playwright install` |
| Package tests | `wasm-module/js/test/package.test.mjs` | Installs the packed tarball and uses it via `import`, `require`, the browser entry and its types |

CI runs the Rust suites with a coverage gate that fails if line or function coverage of the Rust core, or of the Node.js transport, drops below 100%. It also runs the wasm and JS suites on Node.js 20, 22 and 24 (against both Node.js transports), and checks formatting, lints of the native transport, dependencies (security advisories and licenses), API compatibility and the size budget. The JS-only bindings in `src/wasm/` and `src/http.rs` need a JS engine, so they're covered by the wasm and JS suites instead.

### Benchmarks

`npm run bench` compares rust-fetch with Node's `fetch()` on a local server, and `npm run bench:cold` measures [startup](#startup) in Node.js and, when Playwright's browsers are installed, Chromium, Firefox and WebKit. It measures the native transport when it's built (`npm run build:native`); run it with `RUST_FETCH_NATIVE=0` to measure the node:http transport. For sustained load and overload, the [aakjp/stress-test](https://github.com/aakjp/stress-test) harness runs against any installed version of rust-fetch.

Every pull request also compares itself with its base branch in CI: small JSON (sequential and 50 concurrent), an 8 MB body and startup, on both Node.js transports, plus the browser bundle size. Each measurement runs in a fresh process, alternating the two builds over 5 rounds; the table is in the *Benchmarks* job's summary. A change over 10% worse in the median and in most rounds shows as a warning, never a failure, since shared runners are noisy. To reproduce it locally against `main`:

```sh
git worktree add ../rust-fetch-main main
(cd ../rust-fetch-main && npm ci && npm run build && npm run build:native)
npm run build && npm run build:native
npm run bench:compare -- ../rust-fetch-main/wasm-module/pkg
```

## FAQ

**How do I add retries and timeouts to `fetch()`?**
Use rust-fetch's client instead: `new WasmClient({ timeoutMs: 10_000, retries: 3 })` times out each attempt (including the body) and retries network errors, timeouts and 408/429/5xx responses with exponential backoff and jitter, honouring `Retry-After`. POST and PATCH aren't retried unless you opt in. See [Timeouts](#timeouts) and [Retries](#retries).

**Is rust-fetch an alternative to axios?**
Yes, for most uses: it rejects on HTTP errors, has interceptors, timeouts, upload and download progress, and adds built-in retries, typed errors and WebSockets, with the same client in browsers and Node.js. axios is much smaller in a browser bundle (about 21 KB against 188 KB brotli). See [Compared with `fetch()` and axios](#compared-with-fetch-and-axios).

**Does it work in browsers and Node.js?**
Both, with the same API: browsers and Web Workers (through bundlers such as Vite and webpack; call `init()` first) and Node.js 20, 22 and 24. TypeScript definitions are included. See [Supported environments](#supported-environments).

**Is it faster than `fetch()`?**
In Node.js, the published client matches `fetch()` one request at a time and is ahead with large bodies, many requests in flight and sustained load, but behind on concurrent HTTPS. The native transport, not in the npm package yet, reached up to 1.95× `fetch()`'s throughput. In browsers it uses `fetch()` itself. See [Performance](#performance).

**How do I track upload progress?**
Pass `onUploadProgress: ({ loaded, total }) => …` to `post`, `put` or `patch`. See [Upload progress](#upload-progress).

**How do I stream a response from an LLM API?**
For Server-Sent Events APIs (OpenAI-compatible and others), use `client.events(url, { method: 'POST', body, messageType: 'json' })` and `for await` over it; it stops at `data: [DONE]`. For newline-delimited JSON APIs such as Ollama, use `responseType: 'ndjson'`. Both work in browsers and Node.js. See [Server-Sent Events](#server-sent-events).

**How do I reconnect a WebSocket automatically?**
`client.websocket(url, { reconnect: true })` reconnects after failures and unexpected drops with exponential backoff, and reports failures as typed errors. See [WebSockets](#websockets).

**How do I type the response body in TypeScript?**
`client.get<User>('/users/42')` resolves to `HttpResponse<User>`. See [TypeScript](#typescript).

**Do I need to know Rust?**
No. The npm package is used from JavaScript or TypeScript like any other; Rust is only how the core is built. Rust developers can also [use the crate directly](#using-it-from-rust).

## Contributing and license

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development process and pull request checks, and [SECURITY.md](SECURITY.md) to report a vulnerability. Releases are published by CI when a version tag is pushed; see [CONTRIBUTING.md](CONTRIBUTING.md#releasing). Planned work is in the [roadmap](ROADMAP.md).

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
