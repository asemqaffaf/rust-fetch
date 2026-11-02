# Unreleased 2.7 performance follow-up versus 2.6.1

Median of 7 interleaved rounds, 1.5 s each, fresh process per measurement, Node.js 22.23.3 (darwin arm64). Change: positive is better. Flagged when more than 10% worse in the median *and* in most rounds.

| Benchmark | 2.6.1 | Follow-up | Change | |
| --- | ---: | ---: | ---: | --- |
| Small JSON, sequential (node:http) | 11,627 req/s | 11,366 req/s | -2.2% |  |
| Small JSON, sequential (native) | 12,356 req/s | 12,209 req/s | -1.2% |  |
| Small JSON, 50 concurrent (node:http) | 21,314 req/s | 20,318 req/s | -4.7% |  |
| Small JSON, 50 concurrent (native) | 34,170 req/s | 33,291 req/s | -2.6% |  |
| 8 MB body, sequential (node:http) | 2,736 MB/s | 2,714 MB/s | -0.8% |  |
| 8 MB body, sequential (native) | 3,295 MB/s | 3,284 MB/s | -0.3% |  |
| Client overhead per request (instant transport) | 7.5 µs | 7.5 µs | +0.0% |  |
| Startup: import + first request (node:http) | 14.7 ms | 15.2 ms | -3.7% |  |
| Startup: import + first request (native) | 12.2 ms | 13.2 ms | -7.7% |  |
| Browser bundle, brotli (.wasm + JS glue) | 131.3 kB | 162.8 kB | +31.5 kB | |
| Browser bundle, gzip (.wasm + JS glue) | 158.8 kB | 198.5 kB | +39.7 kB | |

No regressions above the threshold.
