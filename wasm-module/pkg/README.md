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
- **More than `fetch()` offers.** Interceptors, streaming, and download and upload progress.
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

`init()` is safe to call more than once, and calling it in Node.js is harmless, so shared code can always call it.

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
> - **On npm (2.1.1):** everything in this README, except what's listed below. Node.js requests use a `node:http` transport with a bounded connection pool; browsers use `fetch()`.
> - **Next release:** [upload progress](#upload-progress) and [WebSockets](#websockets).
> - **In the repository, not yet in the npm package:** the [native Node.js transport](#the-native-transport-not-in-the-npm-package-yet) behind the largest performance gains below. The package doesn't include its prebuilt binaries yet; build it with `npm run build:native`.

## Contents

- [Why rust-fetch?](#why-rust-fetch)
- [Features](#features)
- [Performance](#performance)
- [Usage and configuration](#usage-and-configuration): [client options](#client-options) · [requests](#making-requests) · [bodies](#request-bodies) · [responses](#responses) · [errors](#errors) · [timeouts](#timeouts) · [retries](#retries) · [cancellation](#cancellation) · [interceptors](#interceptors) · [streaming](#streaming) · [download progress](#download-progress) · [uploads](#file-uploads) · [upload progress](#upload-progress) · [WebSockets](#websockets) · [TypeScript](#typescript) · [legacy functions](#legacy-functions)
- [Using it from Rust](#using-it-from-rust)
- [Architecture](#architecture)
- [Compatibility and limitations](#compatibility-and-limitations)
- [Development and benchmarking](#development-and-benchmarking)
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
| Download progress | Read the stream yourself | Yes | Yes |
| Upload progress | No | Yes | Yes (next release) |
| Reuses connections in Node.js by default | Yes | No, needs a keep-alive agent | Yes, up to 256 per origin |
| Added to a browser bundle (brotli) | Nothing, it's built in | About 21 KB | About 207 KB: the WebAssembly module (198 KB) and its JS glue |

The rust-fetch column describes the JavaScript API; the Rust crate has no interceptors, upload progress or WebSockets ([Rust usage](#using-it-from-rust)).

### One client for HTTP and WebSockets

Real-time features usually mean a second client with its own URL handling, timeouts and error handling. In rust-fetch (from the next release), `client.websocket()` is part of the same client: it resolves against the same `baseUrl`, uses the same timeout for each connection attempt, and fails with the same typed errors as requests. It also adds what the platform's `WebSocket` lacks: reconnection with backoff after unexpected drops, a connect timeout, `opened`/`closed` promises and JSON messages ([WebSockets](#websockets)).

### Compared with `undici.request()`

`undici.request()`, the engine under Node's `fetch()`, is a lower-level, Node.js-only API. It was faster than both rust-fetch transports for small requests over plain HTTP in our tests, so it's the better choice when raw throughput is all you need and you'll build error handling, timeouts and retries yourself. rust-fetch is the better choice when you want that policy built in and the same client in browsers. Over HTTPS, the native transport matched `undici.request()` (30,452 against 30,546 requests per second), and on 8 MB bodies it was ahead (322 against 301).

### When to choose something else

- **Every kilobyte counts in your browser bundle.** The WebAssembly module is about 198 KB brotli-compressed.
- **You only need raw throughput in Node.js** and will handle failures yourself: use `undici.request()` (see above).
- **Your Node.js code makes one request at a time** and you're considering the native transport for speed: it's about 6% slower there.

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
- **Upload progress** callbacks, for progress bars on large uploads, which `fetch()` can't report. Next release. [Upload progress](#upload-progress)

**Real-time**
- **WebSockets on the same client**: the same base URL, timeouts and typed errors as your requests, plus reconnection with jittered backoff after unexpected drops. Browsers and Node.js 22+; next release. [WebSockets](#websockets)

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
| Sequential small-JSON requests | 0.94×, about 6% slower |

**Why concurrency is where it wins.** With the `node:http` transport, connection handling, HTTP parsing and decompression share the JavaScript event loop with your application. The native transport runs them on its own threads, leaving the event loop free to build requests and decode responses. With one request at a time there's little to overlap, and the hand-off between threads costs a little. How much you gain depends on your hardware, payloads and concurrency.

**Where it doesn't win:** sequential requests are about 6% slower than with `fetch()` (and than with the node:http transport); large JSON is effectively even (304 against 299 requests per second), and both parse the JSON in JavaScript; and under heavy overload it used about as much memory as `fetch()` (796 MB against 781 MB).

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
});
```

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
| `responseType` | `'auto'` \| `'json'` \| `'text'` \| `'binary'` \| `'stream'` | See [Responses](#responses) |
| `signal` | `AbortSignal` | See [Cancellation](#cancellation) |
| `onDownloadProgress` | `({ loaded, total }) => void` | See [Download progress](#download-progress) |
| `onUploadProgress` | `({ loaded, total }) => void` | See [Upload progress](#upload-progress) |

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

Successful (2xx) requests resolve to:

```ts
interface HttpResponse<T = any> {
  status: number;          // 200
  statusText: string;      // "OK"
  ok: boolean;             // always true: non-2xx responses reject with an HttpError
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

Force a type with `responseType: 'json'` (fails with a `ParseError` if the body isn't JSON), `'text'`, `'binary'` or `'stream'`. JSON is parsed by the JS engine's `JSON.parse`, exactly like `Response.json()`.

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

*Next release.* Report how much of a request body has been sent, for example to drive a progress bar:

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

*Next release.* Available in browsers and in Node.js 22 and newer (Node.js 20 needs `--experimental-websocket`).

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
| `timeoutMs` | Time allowed for each connection attempt; defaults to the client's `timeoutMs`, `0` disables it |
| `reconnect` | `true`, a maximum number of attempts in a row, or `{ maxRetries, initialDelayMs, maxDelayMs, multiplier }` (defaults: unlimited, 1000, 30000, 2). Off by default |
| `messageType` | `'auto'` (default: text as strings, binary as `Uint8Array`) or `'json'` |
| `signal` | Closes the connection and stops reconnecting when aborted |
| `onOpen`, `onMessage`, `onError`, `onReconnect`, `onClose` | Callbacks; `onClose` runs once, when the connection is closed for good |

Failures are typed like request errors: a refused or failed connection is a `NetworkError`, an attempt that takes too long a `TimeoutError`, a JSON message that doesn't parse a `ParseError`, and closing before the first connection opens rejects `opened` with a `CancelledError`. With `reconnect`, a failed attempt or an unexpected drop (close codes 1001, 1006 and 1011–1014) is retried with jittered exponential backoff, and the count resets once a connection opens. A server that closes normally (1000) or with its own code isn't reconnected to. An exception thrown by a callback doesn't affect the connection; it's reported as an unhandled promise rejection. As with an exception in a handler of the platform's own `WebSocket`, Node.js then ends the process unless you handle it (`process.on('unhandledRejection', …)`), so catch errors inside your callbacks.

`send()` takes a string, `ArrayBuffer`, typed array, `DataView` or `Blob`; `sendJson()` takes any JSON value. `close(code, reason)` takes 1000 (the default) or 3000–4999.

### TypeScript

Type definitions ship with the package and need TypeScript 5.2 or newer. Besides `WasmClient`, it exports the option and result types `ClientOptions`, `RequestOptions`, `FetchInit`, `RetryOptions`, `HttpResponse`, `RustFetchError`, `DownloadProgress`, `UploadProgress` and `InterceptedRequest`, and for WebSockets `WebSocketConnection`, `WebSocketOptions`, `ReconnectOptions`, `WebSocketCloseInfo`, `WebSocketReconnectInfo`, `WebSocketState` and `WebSocketData`.

```ts
import { WasmClient, type HttpResponse, type RustFetchError } from 'rust-fetch';

const client = new WasmClient({ baseUrl: 'https://api.example.com/v1' });

interface User { id: number; name: string }

const res: HttpResponse<User> = await client.get('/users/42');
res.body.name; // string

try {
  await client.get('/users/9');
} catch (e) {
  const error = e as RustFetchError;
  if (error.kind === 'HttpError') console.log(error.status);
}
```

### Legacy functions

These standalone functions still work. Each call uses a default client: 30 s timeout, no retries.

| Function | Resolves to |
| --- | --- |
| `fetch_json(url)` / `fetch_json_promise(url)` | Parsed JSON, whatever the `Content-Type`; `null` for an empty body |
| `fetch_text(url)` | The body as a string |
| `fetch_with_options(url, method, headers, body?)` | The full `HttpResponse` |
| `create_client()` | `new WasmClient()` |
| `fetch_wasm_json`, `fetch_wasm_map`, `fetch_wasm_api`, `fetch_wasm_html` | Deprecated aliases of `fetch_json` / `fetch_text` |

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

Request futures are `Send`, so you can `tokio::spawn` them. Progress callbacks (`on_download_progress`) must be `Send + Sync` on native targets. Upload progress, WebSockets and interceptors are only in the JavaScript API.

## Architecture

Everything that decides what happens to a request (URL handling, validation, retries and backoff, per-attempt timeouts, typed errors, interceptors) is Rust compiled to WebAssembly, so it behaves the same in every runtime. Underneath, a transport only moves bytes:

| Transport | Where | In the npm package |
| --- | --- | --- |
| The platform's `fetch()` | Browsers and Web Workers | Yes |
| `XMLHttpRequest` | Browsers, for upload progress | Next release |
| `node:http` / `node:https` with keep-alive | Node.js | Yes |
| The runtime's `WebSocket`, with the connection policy (URL, timeout, reconnection, errors) in Rust | WebSockets, everywhere | Next release |
| Native addon: HTTP/1.1 on [hyper](https://hyper.rs) and Tokio threads, loaded through Node-API, with the same redirect, decompression, timeout and connection-limit rules and Node's TLS defaults (Mozilla root certificates, `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED`) | Node.js | Not yet: build it with `npm run build:native` |

**Which transport a request uses:**

| Request | Browsers | Node.js |
| --- | --- | --- |
| Most requests | `fetch()` | The native transport where it's built and Node's global agents are untouched; otherwise `node:http` |
| With `onUploadProgress` (with or without `onDownloadProgress`) | `XMLHttpRequest`, or `fetch()` where there's none | `node:http` |
| With `onDownloadProgress` only, or `responseType: 'stream'` | `fetch()` | Node's `fetch()` |

**What the native transport changes.** Connection handling, TLS, HTTP parsing and decompression move from the JavaScript event loop to Tokio threads; JavaScript only builds requests and decodes their bodies. That's why it gains most with many requests in flight, and why the hand-off between threads likely contributes to its slower sequential results ([measurements](#the-native-transport-not-in-the-npm-package-yet)).

**When it's used.** The native transport is used when `rust-fetch-native.<platform>-<arch>.node` sits next to the package's `node.js` (`npm run build:native` puts it there). It steps aside where you have installed your own `http.globalAgent` / `https.globalAgent` (for example a proxy agent) or set `NODE_USE_ENV_PROXY`, and `RUST_FETCH_NATIVE=0` turns it off.

### Connection pooling

Browsers pool connections for `fetch()`. In Node.js, both transports keep up to 256 keep-alive connections per origin and queue further requests until one is free, so bursts reuse connections instead of exhausting local ports. If you install your own `http.globalAgent` / `https.globalAgent`, or set limits on Node's, that agent is used instead.

## Compatibility and limitations

### Supported environments

| Environment | Status |
| --- | --- |
| Browsers and Web Workers | Supported, directly or through bundlers like Vite and webpack; call `init()` first |
| Node.js 20, 22 and 24 | Supported and tested in CI; Node.js 20 is the minimum |
| TypeScript | Definitions included; TypeScript 5.2 or newer |
| Upload progress, WebSockets | JavaScript API only, from the next release. WebSockets need a built-in `WebSocket`: browsers, Node.js 22+, or Node.js 20 with `--experimental-websocket`. Tested in CI on Node.js 22 and 24 |
| Rust | The same client as a Rust library ([usage](#using-it-from-rust)), on tokio or in your own wasm crates |
| Native Node.js transport | In the repository, not yet in the npm package (no prebuilt binaries); build it with `npm run build:native`. Tested in CI on Linux with Node.js 20, 22 and 24, and run on macOS (Apple silicon); not tried on Windows |

### Limitations

- **Bundle size:** the WebAssembly module adds about 198 KB (brotli) to a browser bundle.
- **HTTP/2:** browsers negotiate it automatically; both Node.js transports use HTTP/1.1 with keep-alive.
- **Proxies:** in Node.js, install a proxy agent as `http.globalAgent` / `https.globalAgent` (for example from `https-proxy-agent`). In browsers, use the system settings.
- **Native transport:** has to be built from source for each platform until it's published. It's about 6% slower than `fetch()` for sequential requests, isn't used for streamed responses or requests with progress callbacks, and the p99 stall seen in the independent harness is unexplained (see [Under load](#under-load-all-clients)).
- **WebSockets** use the runtime's own `WebSocket`: built into browsers and Node.js 22 and newer, and into Node.js 20 only with `--experimental-websocket` (without it, `websocket()` throws a `NetworkError`). In Node.js it doesn't go through `http.globalAgent`, so proxy agents installed there don't apply.
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
| Package tests | `wasm-module/js/test/package.test.mjs` | Installs the packed tarball and uses it via `import`, `require`, the browser entry and its types |

CI runs the Rust suites with a coverage gate that fails if line or function coverage of the Rust core, or of the Node.js transport, drops below 100%. It also runs the wasm and JS suites on Node.js 20, 22 and 24 (against both Node.js transports), and checks formatting, lints of the native transport, dependencies (security advisories and licenses), API compatibility and the size budget. The JS-only bindings in `src/wasm/` and `src/http.rs` need a JS engine, so they're covered by the wasm and JS suites instead.

### Benchmarks

`npm run bench` compares rust-fetch with Node's `fetch()` on a local server. It measures the native transport when it's built (`npm run build:native`); run it with `RUST_FETCH_NATIVE=0` to measure the node:http transport. For sustained load and overload, the [aakjp/stress-test](https://github.com/aakjp/stress-test) harness runs against any installed version of rust-fetch.

## Contributing and license

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development process and pull request checks, and [SECURITY.md](SECURITY.md) to report a vulnerability. Releases are published by CI when a version tag is pushed; see [CONTRIBUTING.md](CONTRIBUTING.md#releasing).

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
