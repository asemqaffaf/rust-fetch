# Unreleased packed artifact versus npm 2.6.1

Median of 7 interleaved rounds, 1.5 s each, fresh process per measurement, Node.js 22.23.3 (darwin arm64). Change: positive is better. Flagged when more than 10% worse in the median *and* in most rounds.

| Benchmark | 2.6.1 | Follow-up | Change | |
| --- | ---: | ---: | ---: | --- |
| Small JSON, sequential (node:http) | 11,895 req/s | 11,456 req/s | -3.7% |  |
| Small JSON, 50 concurrent (node:http) | 21,354 req/s | 20,393 req/s | -4.5% |  |
| 8 MB body, sequential (node:http) | 2,762 MB/s | 2,727 MB/s | -1.2% |  |
| Client overhead per request (instant transport) | 7.5 µs | 7.6 µs | -1.0% |  |
| Startup: import + first request (node:http) | 14.7 ms | 15.1 ms | -3.0% |  |
| Browser bundle, brotli (.wasm + JS glue) | 131.3 kB | 162.8 kB | +31.5 kB | |
| Browser bundle, gzip (.wasm + JS glue) | 158.8 kB | 198.5 kB | +39.7 kB | |

No regressions above the threshold.


The packed package passed contents, smoke, security and strict benchmark checks. It was installed from a local tarball, not published.
