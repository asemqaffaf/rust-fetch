# Development and benchmarking

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
| Conformance suite | `wasm-module/js/test/conformance/` | The same 52 behaviours on every transport and browser, written to [CONFORMANCE.md](/conformance). `npm run test:conformance` |
| Security and hardened configurations | `wasm-module/js/test/security.test.mjs`, `hardened.test.mjs` | A test per advisory class, and each [hardened configuration](/security#hardened-configurations) read from the docs and exercised |
| Resource tests | `wasm-module/js/test/memory.test.mjs`, `v8-crash.test.mjs`, `events.test.mjs` | Memory per pending request under a budget, the V8 crash on Node.js 20 and 22, and Server-Sent Events backpressure and limits |
| Package tests | `wasm-module/js/test/package.test.mjs` | Installs the packed tarball and uses it via `import`, `require`, the browser entry and its types |

CI runs the Rust suites with a coverage gate that fails if line or function coverage of the Rust core, or of the Node.js transport, drops below 100%. It also runs the wasm and JS suites on Node.js 20, 22 and 24 (against both Node.js transports), and checks formatting, lints of the native transport, dependencies (security advisories and licenses), API compatibility and the size budget. The JS-only bindings in `src/wasm/` and `src/http.rs` need a JS engine, so they're covered by the wasm and JS suites instead.

## Benchmarks

`npm run bench` compares rust-fetch with Node's `fetch()` on a local server, and `npm run bench:cold` measures [startup](/performance#startup) in Node.js and, when Playwright's browsers are installed, Chromium, Firefox and WebKit. It measures the native transport when it's built (`npm run build:native`); run it with `RUST_FETCH_NATIVE=0` to measure the node:http transport. For sustained load and overload, the [aakjp/stress-test](https://github.com/aakjp/stress-test) harness runs against any installed version of rust-fetch.

Every pull request also compares itself with its base branch in CI: small JSON (sequential and 50 concurrent), an 8 MB body and startup, on both Node.js transports, plus the browser bundle size. Each measurement runs in a fresh process, alternating the two builds over 5 rounds; the table is in the *Benchmarks* job's summary. A change over 10% worse in the median and in most rounds shows as a warning, never a failure, since shared runners are noisy. To reproduce it locally against `main`:

```sh
git worktree add ../rust-fetch-main main
(cd ../rust-fetch-main && npm ci && npm run build && npm run build:native)
npm run build && npm run build:native
npm run bench:compare -- ../rust-fetch-main/wasm-module/pkg
```

## Parser and boundary fuzzing

The six cargo-fuzz targets in `wasm-module/fuzz` exercise the real SSE/line parsers, Retry-After, URL/base/redirect resolution, header validation and multipart encoding. Chunked parser results must match whole-input results under 4 KiB line and 16 KiB event limits. The `fuzzing` feature exposes harness entry points and is disabled in published Wasm builds.

Run `cargo +nightly-2026-10-28 fuzz run sse -- -max_total_time=180` from `wasm-module` (replace `sse` with `lines`, `retry_after`, `urls`, `headers` or `multipart`). cargo-fuzz 0.13.2 and lockfiles are pinned in CI. `FUZZ_SEED` and `FUZZ_CASES` control `npm run fuzz:js`; fetch is stubbed so generated values cannot contact the network. Failures print a reproducible seed/case.

The scheduled fuzz workflow runs each target for three minutes, with short pull-request smoke runs. Crashes are uploaded as artifacts and scheduled failures open a deduplicated issue. Minimize a reproducer, fix it and add a unit/JS regression before closing. Keep intentional seeds under `corpus/<target>/seed` or `regression-*`; generated mutation corpora and artifacts are ignored.

The reliability comparison uses loopback fault fixtures, pinned development-only client dependencies, three rounds, full body consumption and a separate abort watchdog. Run npm run reliability:compare to regenerate its raw JSON and report. Transport conformance includes the same fault classes in native, node:http, fetch and real Chromium/Firefox/WebKit.
