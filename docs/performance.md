# Performance

All results are from local servers over loopback, so they compare each client's own overhead, not network performance. Percentages are relative throughput (requests per second), not latency. Two sources:

- **Our measurements** of the `node:http` transport that the npm package uses and of the native transport (not in the npm package yet), next to Node's `fetch()` and `undici.request()`. Apple M1 Pro, Node.js 22.13.
- **An [independent benchmark](https://github.com/aakjp/stress-test/blob/main/BENCHMARK.md)** of the published rust-fetch 2.1.0 against `fetch()` and axios. Apple M4 Pro, Node.js 22.15.

These results are about Node.js. In browsers, `fetch()` is the only way to make requests, so rust-fetch uses it and can't be faster than it; the difference is a fraction of a millisecond per request, which matters little once a request crosses a real network.

## The npm package today

The published `node:http` transport against Node.js `fetch()`, as measured with rust-fetch 2.1.x. Later releases haven't been re-run against `fetch()` and axios in these harnesses, except the [2026-10-25 rerun of the p99 stall](#under-load-all-clients); the CI benchmark checks each pull request against the previous version instead. The independent column is summarized from the [full report below](#independent-benchmark-of-rust-fetch-210); ours from the [all-client tables](#throughput-all-clients):

| Workload | Independent benchmark (2.1.0, M4 Pro) | Our measurements (M1 Pro) |
| --- | --- | --- |
| Steady 15,000 requests/s | p99 **11.2 ms against 450 ms**; slowest request 64 ms against 1.5 s; **202 MB against 635 MB** of memory (one run) | Independent harness: kept up (14,981/s against 13,026/s); p50 6.3 ms against 449 ms; p99 565 ms against 920 ms (565 ms no longer reproduces: 19.6 ms on node:http and 4.7 ms on native in a 2026-10-25 rerun); event-loop delay 9.8 ms against 310 ms. Our harness: 12,955/s against 11,557/s, but a worse p99 (1.6 s against 1.2 s) |
| 50 to 500 requests in flight | **105% to 116%** throughput at every level | **107% to 114%**, with a lower p99 at every level |
| Overload (offered 40,000 and 50,000 requests/s) | Found a port-exhaustion bug in 2.1.0, fixed in 2.1.1 | **1.7×** and **1.4×** the requests delivered |
| 8 MB binary bodies | **115%** (faster in 10 of 10 runs) | **133%** |
| 0.6 MB JSON | **105%** (faster in 10 of 10 runs) | 95% |
| Small JSON, one at a time | 100% | 102% |
| Small JSON, 50 at a time | 91% | 105% (500 at a time: 112%) |
| HTTPS small JSON, 50 at a time | not tested | 92% |

The published client matches `fetch()` one request at a time, is ahead with large binary bodies and many requests in flight, and stays steadier under sustained load in tail latency and memory. It's behind on concurrent HTTPS, and in one of the two 15,000 requests/s harnesses its tail was worse.

The same independent harness later re-tested **2.2.0** ([below](#independent-benchmark-of-rust-fetch-220)): ahead of `fetch()` in all four throughput workloads (102% to 112%), including 50 requests at a time, where 2.1.0 was at 91%, and at an offered 50,000 requests/s it delivered 1.3 times `fetch()`'s requests with no errors and a third less memory.

### Independent benchmark of rust-fetch 2.2.0

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

### Independent benchmark of rust-fetch 2.1.0

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

`fetch()` had the fastest median, but its slowest requests took up to 1.5 s, and its tail varied tenfold between runs. axios with its default configuration ran out of local ports: Node's default agent keeps connections alive (since Node.js 19) but sets no socket limit, so under overload it kept opening new ones. The keep-alive axios row used an agent capped at 128 sockets, against rust-fetch's 256 per origin, so it compares connection limits as well as clients. The report's 15,000 requests per second was 89% of what its server could handle.

**Overload at 50,000 requests per second**, two to three times what any client could sustain on the M4 Pro, found a bug: rust-fetch 2.1.0 opened a new connection for every waiting request, ran out of local ports and delivered 3.2k requests per second, while `fetch()` delivered 14.4k. 2.1.1 fixed it with a pool of up to 256 connections per origin, so extra requests wait instead. In our re-run of that test on an Apple M1 Pro (Node.js 22.13), rust-fetch went from 2.7k requests per second and 43.5k errors to 18.9k and none.

The report tested three clients on one machine. It didn't include `undici.request()`, got or ky.

## The native transport (not in the npm package yet)

The native Node.js transport against Node.js `fetch()`, from [our measurements](#our-measurements-every-client) (Apple M1 Pro, Node.js 22.13). The npm package doesn't include it yet; it has to be [built from source](/architecture#architecture).

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

## Our measurements: every client

The tables behind both summaries: Node's `fetch()`, `undici.request()` and both rust-fetch transports, measured together on an Apple M1 Pro with Node.js 22.13.

### Throughput: all clients

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

### Under load: all clients

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

In both harnesses, the native transport sustained approximately the target rate and `fetch()` didn't. In that independent run, both rust-fetch transports showed a p99 of about 565 ms even though the native transport's p95 was 4.8 ms.

**That stall no longer reproduces.** The same harness (commit 2d6db73), the same scenario (a steady 15,000 requests per second for 60 s, six server processes), one machine (Apple silicon, Node.js 22.13), rerun on 2026-10-25:

| rust-fetch | Transport | Delivered | p50 | p95 | p99 | Slowest | Errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2.3.0 | node:http | 15,001/s | 5.8 ms | 8.4 ms | 53 ms | 124 ms | 0 |
| 2.4.0 | node:http | 15,001/s | 5.7 ms | 8.0 ms | 19.7 ms | 100 ms | 0 |
| 2.5.2 | node:http | 15,001/s | 5.5 ms | 7.8 ms | 19.7 ms | 105 ms | 0 |
| 2.6.0 | node:http | 15,001/s | 5.4 ms | 7.6 ms | 19.6 ms | 105 ms | 0 |
| 2.6.0 | native | 15,002/s | 3.4 ms | 4.3 ms | **4.7 ms** | 17 ms | 0 |

Even 2.3.0 no longer shows 565 ms here, so the original cause can't be pinned down with certainty. The drop from 2.3.0 to 2.4.0 matches 2.4.0's changes: at most 1,024 requests handed to a transport at once, and streaming moved onto node:http. Details are in [#16](https://github.com/asemqaffaf/rust-fetch/issues/16).

## Startup

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

## Reading these results

- **Throughput, latency and memory are separate questions.** A client can deliver more requests per second with a worse tail, or the reverse; memory is the peak resident size of the client process.
- **`fetch()`, `undici.request()` and rust-fetch do different amounts of work.** Node's `fetch()` implements the browser `fetch()` API on top of undici. `undici.request()` is undici's lower-level API, without WHATWG streams. rust-fetch adds retries, per-attempt timeouts, validation, typed errors and interceptors to every request. So `undici.request()` isn't an identical workload, and it was fastest on plain HTTP in these tests: 1.4 to 2.2 times the node:http transport's small-JSON throughput and 1.3 to 1.6 times the native transport's, while over HTTPS the native transport matched it.
- **Results vary** with hardware, Node.js version, payload size, concurrency and the server setup. The node:http transport delivered 12,955 requests per second at an offered 15,000 in one harness and 14,981 in the other, so measure on your own hardware before relying on a number ([how](/development#benchmarks)).
