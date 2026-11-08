# rust-fetch: project reference (state of 2026-11-09)

> **Project status: on hold (from 2026-11-09), by the maintainer's decision, for a long time.** 2.8.0 is the current release and `latest` on npm; no work is in flight and no pull request is open. To resume: read section 15 (open work), section 16 (documentation drift that was found and not fixed) and section 17 (working agreements), then re-run the checks in section 0 before trusting any figure here. The first useful step is a docs-only PR fixing the drift table in section 16.

A single source of truth for the whole repository: what it is, how it is built, what it guarantees, how it is tested and released, what is done, what is open, and where the existing documentation disagrees with the code.

## 0. How this document was made, and how far to trust it

**Method.** Written on 2026-11-09 from the repository at `main` = `cc27686` (tag `v2.8.0` + 6 commits, all docs), from `gh` (issues, milestones, releases, rulesets, workflow runs), from the maintainer's session notes (section 17) and from this conversation. Every number and name below was read from a file or command output in that session, not recalled.

**What is NOT verified.** Be explicit about the limits:

| Not done | Consequence |
| --- | --- |
| The test suites were not run for this document (no `npm run build`, `npm test`, `cargo test`, browsers) | Test counts, coverage and benchmark figures are quoted from the repo's own docs and CI configuration, not re-measured. CI on `cc27686` was green (CodeQL, Scorecard, Docs, CI). |
| Source files were read through outlines (signatures, module comments, constants) and selected passages, not line by line | Statements about *behaviour inside* a function come from module doc comments, the changelog, the security docs and the tests' names. Where I could not confirm a detail I say so. |
| `docs/v2.5`, `docs/v2.6`, `docs/v2.7` (archived copies), `docs/api/` (generated), `benchmarks/*` raw data, `lcov-js.info`, `package-lock.json` files were not read | Their content is out of scope here except where named. |
| Live npm registry beyond `npm view rust-fetch dist-tags`; live site beyond HTTP checks of three URLs | |
| Anything inside the private GitHub UI (npm package settings, Codecov, OSS-Fuzz, CII badge) | Listed as "needs a person" in section 15. |

**An earlier pasted "Complete Zero-Omission Implementation Reference" must not be used as a source.** Checked against the repository it is wrong in many places, for example: it states reqwest 0.12.24 with `gzip, brotli, deflate, zstd, rustls-tls` (actual: `reqwest = "0.13"` with `json, stream`, and `tokio` with only `time, rt` on native targets); TypeScript `^6.0.2` (actual `^7.0.2`); `Lines::push`, `Budget::request/spend(&self)` signatures, `Probe::success/failure`, `Url::query()` (actual: `Lines::feed`, `Budget::request(now_ms)`, `Probe::finish(failed)`, no such method); a `docs/release-notes-2-8` branch at commit `36850ff` (neither exists in this clone; HEAD is `main` at `cc27686`); and "tag v2.8.0 at c07aeed" (the tag is at `37b2e74`). Everything below replaces it.

## 1. Identity and status

| | |
| --- | --- |
| Name | `rust-fetch` (npm package, crate `rust-fetch`, native crate `rust-fetch-native` with `publish = false`) |
| Purpose | A resilient HTTP client for JavaScript/TypeScript (`fetch()` plus timeouts, retries, typed errors, interceptors, streaming, progress, WebSockets, security limits) and for Rust. The request *policy* is Rust compiled to WebAssembly; a transport only moves bytes. |
| Author / owner | Asem Qaffaf (`asem@qaffaf.com`), single maintainer |
| Licence | `MIT OR Apache-2.0` |
| Repository | `github.com/asemqaffaf/rust-fetch`, default branch `main`; a `v1.x` maintenance branch is described in CONTRIBUTING.md (security and critical fixes only) |
| Docs site | `https://asemqaffaf.github.io/rust-fetch/` (VitePress, GitHub Pages) |
| Current release | **2.8.0**, published 2026-11-08T12:29Z, npm `latest`, tag `v2.8.0`, GitHub release "rust-fetch 2.8.0" |
| Rust | edition 2021, `rust-version`: not set in `wasm-module/Cargo.toml` (the pasted reference claimed 1.88; the manifest has no `rust-version`). CI and releases pin **Rust 1.99.1**, wasm-pack **0.15.0** |
| Node | `engines.node >= 20`; CI on 20, 22, 24 |
| Size | 351 tracked files, 253 commits. Rust core (`wasm-module/src`) 15,032 lines; native addon 1,735; JS modules (`wasm-module/js/*.js`) 2,387; Rust tests (`wasm-module/tests`) 2,092; JS tests and helpers (`wasm-module/js/test`) 33,779. (`docs/security-review.md` still quotes older figures from commit `33efb92`.) |
| Open work | 2.9.0 milestone: 18 open, 1 closed issues (section 15). No open pull requests. |

### 1.1 Published versions and dist-tags

`npm view rust-fetch dist-tags` on 2026-11-09: `latest` 2.8.0, `release-2.6` 2.6.2, `release-2.5` 2.5.3, `release-2.4` 2.4.2, `release-2.3` 2.3.1, `release-2.2` 2.2.1, `release-2.1` 2.1.2. There is **no `release-2.7` tag**: 2.7.2 is installed with `rust-fetch@2.7` (SECURITY.md says so).

Tag `v2.8.0` points at `37b2e74`. Release history from CHANGELOG.md: 0.1.0 (2025-02-23), 0.7.2, 1.0.2, 1.0.4, 1.1.0 (2025-07-27), 2.0.0 (2026-10-22), 2.1.0, 2.1.1, 2.2.0, 2.3.0 (2026-10-23), 2.4.0, 2.4.1 (2026-10-23), 2.5.0, 2.5.1, 2.5.2 (2026-10-24), 2.6.0 (2026-10-25), 2.6.1 (2026-10-29), 2.7.0 (2026-11-02), 2.7.1 (2026-11-03), 2.7.2 (2026-11-06), **2.8.0 (2026-11-08)**. GitHub releases also exist for 2.1.2, 2.2.1, 2.3.1, 2.4.2, 2.5.3, 2.6.2 (security backports, published 2026-11-02).

### 1.2 Support policy (SECURITY.md)

| Line | Support | Notes |
| --- | --- | --- |
| 2.8.x | Yes (features, fixes, security) | `latest` |
| 2.7.x | Security fixes only | latest 2.7.2, no dist-tag |
| 2.6.x to 2.1.x | Security fixes only | `release-2.6` … `release-2.1` |
| 2.0.x, 1.x, <1.0 | No | end of life; 1.x and 2.0 use built-in `fetch()` and cannot be shielded from prototype pollution; upgrade to ≥2.1.2 (≥2.4.2 for streaming) |

2.3.x, 2.2.x, 2.1.x carry only a *partial* prototype-pollution fix, because `stream`/`ndjson` and upload-progress requests used Node's built-in `fetch()` there.

## 2. Repository map

```
.                          private npm workspace "rust-fetch-workspace" 2.8.0
├─ api/rust-fetch.d.ts     committed snapshot of the public TypeScript API (1,035 lines), checked by `npm run api:check`
├─ benchmarks/             fetch-comparison, compare, cold-start, startup-breakdown, security-compare,
│                          reliability/{run.mjs,results.json}, performance-2.7/ (method + raw samples)
├─ docs/                   VitePress site: guide/ (18 pages), reference pages, v2.5/ v2.6/ v2.7/ archives, api/ (TypeDoc output),
│                          scripts/check-links.mjs, typedoc.json, .vitepress/config.mts
├─ examples/               node-client, llm-streaming, websocket-chat, browser-upload, cloudflare-worker (+ README, package.json)
├─ native/                 rust-fetch-native: Node-API addon (hyper + Tokio + rustls); src/{lib,pool,pending,timeouts,upload}.rs, build.rs
├─ scripts/                postbuild, build-native, bump-version, check-api, check-size, check-package, check-unsafe,
│                          check-wasm-reproducible.sh, ci-build-wasm.sh, fuzz-{js-boundary,node-boundary,url-differential}
├─ wasm-module/            crate `rust-fetch` (cdylib+rlib)
│  ├─ src/                 Rust core (+ src/wasm/ JS bindings, only built for wasm32)
│  ├─ tests/               client_tests.rs, integration_tests.rs (real HTTP against local servers)
│  ├─ js/                  Node entry (node.js), feature layers, testing.js(+.d.ts), test/ (JS suites)
│  ├─ fuzz/                cargo-fuzz: 6 targets, corpus/, oss-fuzz/
│  ├─ pkg/                 BUILD OUTPUT = the npm package (git-ignored: the .wasm is no longer committed)
│  └─ deny.toml            cargo-deny policy shared by both crates
├─ .clusterfuzzlite/       Dockerfile, build.sh, project.yaml
├─ .github/                12 workflows, dependabot.yml, issue forms, PR template
├─ CHANGELOG.md  CONFORMANCE.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  README.md  ROADMAP.md  SECURITY.md  llms.txt
├─ SECURITY_PROGRESS.md    untracked local resume notes (STALE, see section 16)
└─ codecov.yml  lcov-js.info (generated)
```

Root `package.json` devDependencies (all pinned exactly except TypeScript): axios 1.21.0, esbuild 0.28.2, got 16.2.0, ky 2.2.0, playwright 1.64.1, typescript ^7.0.2, `typescript-5.2` (alias of typescript 5.2.2, used to check the d.ts on the minimum supported version), undici 7.30.1, valibot 1.5.0, vite 8.3.6, webpack 5.112.2, zod 4.6.7. Nothing here ships. `wasm-module/js/test/runtimes/` is a separate package (Bun, Deno, workerd, pinned) that Dependabot and the audit cover.

### 2.1 The published package (`wasm-module/pkg`, produced by `npm run build`)

`npm run build` = `cd wasm-module && wasm-pack build --release --target web && node ../scripts/postbuild.mjs`. The package contains exactly (set by `postbuild.mjs` `manifest.files`, verified by `check-package.mjs` and `package.test.mjs`): `rust_fetch_bg.wasm`, `rust_fetch_bg.wasm.d.ts`, `rust_fetch.js`, `rust_fetch.d.ts`, `node.js`, `testing.js`, `testing.d.ts`, `llms.txt`, `LICENSE-MIT`, `LICENSE-APACHE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (+ `package.json`, `README.md`). **Zero runtime dependencies, zero devDependencies, no install scripts.** The native addon is *not* in the package (a dev build leaves `rust-fetch-native.darwin-arm64.node` in `pkg/`; the package check fails on stray files).

Conditional exports: `"."` → types `./rust_fetch.d.ts`, `node` → `./node.js`, default → `./rust_fetch.js`; `./rust_fetch.js`; `./testing`; `./rust_fetch_bg.wasm`; `./package.json`. `engines.node >= 20`. 29 npm keywords, homepage and bugs URL are written by postbuild.

### 2.2 What `postbuild.mjs` does (the glue is assembled, not hand-written)

1. Copies `node.js`, `testing.js`, `testing.d.ts`, `README.md`, `llms.txt` and five policy files into `pkg/`.
2. Edits `rust_fetch.d.ts`: adds `/// <reference lib="esnext.disposable" />`; makes the request methods generic (`get<T = any>`) and adds `schema` overloads inferring the body from a Standard Schema; adds `[Symbol.asyncIterator]` to `EventStream` (and the glue); declares `extend()` and `paginate()` on `WasmClient`.
3. Patches `rust_fetch.js`: the wasm-streams `ReadableStream` construction gets own-property source fields and a prototype-free `CountQueuingStrategy` (prototype-pollution fix: `type`, `start`, `autoAllocateChunkSize`, `size`). It fails the build if the expected single construction site is not found.
4. **Appends the JavaScript feature layers to `rust_fetch.js` in this order:** `upload.js`, `observability.js`, `blob.js`, `transport.js`, `auth.js`, `dedupe.js`, `cache.js`, `schema.js`, `resume.js`, `extend.js`, `paginate.js`, `guards.js`. Each layer captures the then-current `WasmClient` (`const Base = WasmClient`) and wraps or subclasses it, so later layers sit outside earlier ones. (`paginate.js` and `guards.js` add a prototype method and exported functions instead.)
5. Writes the package manifest.

## 3. Architecture

**Principle (ROADMAP.md): policy in Rust, bytes in the transport.** URL resolution, header/URL validation, retries and backoff, per-phase timeouts and deadlines, limits, the circuit breaker, the typed errors and interceptors are all in the Wasm core and so behave identically on every runtime. A transport only sends bytes.

### 3.1 Transports

| Transport | Where | In npm package |
| --- | --- | --- |
| Platform `fetch()` | Browsers, Workers, Deno, Bun, workerd | yes |
| `XMLHttpRequest` | Browsers, for upload progress (cross-origin requests are preflighted); falls back to `fetch()` where absent | yes |
| `node:http`/`node:https`, keep-alive | Node.js | yes |
| Runtime `WebSocket` (policy in Rust) | everywhere with a WebSocket | yes |
| Native addon (hyper/Tokio/rustls via Node-API) | Node.js | **no**, build with `npm run build:native` |
| Custom `transport` option | any; for tests (`rust-fetch/testing`) | yes (code path); mock only for buffered requests |

Which Node.js transport serves a request (docs/architecture.md): the native addon when `rust-fetch-native.<platform>-<arch>.node` sits next to `node.js` and Node's global agents are untouched; `node:http` otherwise, and always for `onUploadProgress`, `onDownloadProgress`-only, `responseType: 'stream'|'ndjson'`, `events()`, the `proxy` option, and `allowPrivateNetwork: false`. The addon steps aside if the app installed its own `http.globalAgent`/`https.globalAgent` or set `NODE_USE_ENV_PROXY`; `RUST_FETCH_NATIVE=0` disables it (it also accepts a path, per SECURITY.md). Browsers use `fetch()`, or `XMLHttpRequest` for upload progress.

**Connection pooling.** Both Node transports: ≤256 keep-alive connections per origin (`MAX_SOCKETS = 256`, `scheduling: 'lifo'`, idle timeout 5 s in `node.js`; the addon closes idle connections after 4 s, `IDLE_TIMEOUT` in `pool.rs`), further requests queue. Before reaching a transport, requests wait in a JS queue capped at `MAX_IN_FLIGHT = 1024` (time in that queue counts toward the timeout).

### 3.2 Conformance

`CONFORMANCE.md` (generated by `npm run test:conformance`; CI fails on any undocumented difference) runs **81 behaviours** on six adapters: node:http, native, `fetch()` in Node.js, Chromium, Firefox, WebKit. Rows per section (counted from the file): Redirects 18, Decompression 5, Size limits 2, Timeouts and cancellation 5, Errors 6, Streaming 10, URLs 1, Security 5, Hostile responses 12, Reliability and observability 17. **Documentation drift:** `docs/index.md:36`, `docs/development.md:32` and `ROADMAP.md:162` still say "69 behaviours (414 observations)", which was the 2.7 count; 2.8 added the 12 hostile-response rows (69 + 12 = 81).

## 4. Rust core (`wasm-module/src`)

`lib.rs` sets `#![deny(unsafe_code)]`, `#![warn(missing_docs, clippy::all, clippy::pedantic)]` and, outside tests, `deny(clippy::unwrap_used, clippy::expect_used)` (a panic aborts the Wasm module). Public modules: `client`, `error`, `types`, `http`; private: `budget circuit idempotency limiter lines runtime sse timeouts url wasm`; `fuzzing` only with feature `fuzzing` (hidden; never in published builds). Re-exports: `RetryBudget`; `CircuitBreaker, CircuitCallback, CircuitChange, CircuitOpenError, CircuitState`; `Client, ClientBuilder, ProgressCallback, RequestBuilder, StreamingResponse`; `Error, Result`; `RateLimit`; `PhaseTimeouts, TimeoutDetails, TimeoutPhase`; `Headers, Method, Multipart, Progress, Redirect, Response, ResponseBody`; `WasmClient`; `prelude`.

Cargo (`wasm-module/Cargo.toml`): deps `wasm-bindgen 0.2` (+serde-serialize), `reqwest 0.13` (json, stream), `serde`, `serde_json`, `wasm-bindgen-futures`, `serde-wasm-bindgen`, `js-sys`, `web-sys` (18 features: AbortController/Signal, EventTarget, Headers, ProgressEvent, ReadableStream, Request(Init), RequestRedirect, Response(Type), Url, UrlSearchParams, XmlHttpRequest*), `futures-util` (no default features), `pin-project-lite`, `wasm-streams 0.5`, `serde_urlencoded`; wasm32 only: `dlmalloc`; non-wasm: `tokio` (`time`, `rt`); dev: `wasm-bindgen-test`, tokio (`macros rt rt-multi-thread time`). Release profile `opt-level = "s"`, `lto = true`, `codegen-units = 1`; wasm-opt `-O --one-caller-inline-max-function-size=500` (the comments cite #179 per-request overhead and #180 first-request compile cost). Feature `fuzzing = []`. `wasm-streams` is held at 0.5 because `reqwest 0.13.5` depends on it and two versions fail the Wasm link (Dependabot ignore rule). Line counts: `client.rs` 2,699, `wasm/mod.rs` 2,719, `wasm/transport.rs` 1,644, `wasm/websocket.rs` 1,123, `wasm/events.rs` 862, `types.rs` 744, `error.rs` 738, `timeouts.rs` 517, `limiter.rs` 411, `sse.rs` 388, `circuit.rs` 375, `budget.rs` 242.

### 4.1 `error.rs`: taxonomy

`Error` variants: `Network{message,source}`, `Http{status,status_text,body}`, `Parse{message,source}`, `Timeout{duration_ms}`, `InvalidInput{parameter,message}`, `JsInterop{message}`, `Cancelled`. `kind()` returns the JS-visible string: `CircuitOpenError` (source is a `CircuitOpenError`), `TimeoutError` (variant `Timeout`, or a `Network` whose source is `TimeoutDetails`), else `NetworkError`, `HttpError`, `ParseError`, `InvalidInputError`, `JsInteropError`, `CancelledError`. A ninth JS kind, `ValidationError`, exists only in the JS layer (`schema`). `is_retryable()` is the default retry eligibility. Marker error types carried as `source` so structured fields reach JS: `ResponseTooLarge(u64)` (pub), `LineTooLong`, `EventTooLarge`, `QueueFull` (crate-private), `TooManyPendingRequests` (pub), `CircuitOpenError{origin,retry_after}`, `TimeoutDetails{phase,duration_ms}`. Accessors include `response_too_large()`, `too_many_pending_requests()`, `timeout_details()`, `circuit_open()`. `From<reqwest::Error>` and `From<serde_json::Error>` exist; reqwest chain text is flattened so TLS/DNS causes are not lost.

### 4.2 `types.rs`

`Method` (Get/Post/Put/Delete/Patch/Head/Options; `is_idempotent`), `ResponseFormat` (Auto/Json/Text/Binary), `Headers` (lower-cased keys, multi-value; `insert/set/get/get_first/remove/contains/iter`), `Redirect` (Follow default/Manual/Error; `DEFAULT_MAX_REDIRECTS = 20`), `RequestConfig`, `Body` (Empty/Text/Json/Binary/Form/Multipart, + `Upload` on wasm32), `Progress`, `Multipart`/`Part` (`text`, `file`, generated boundary; field names escaped), `Response`/`ResponseBody` (`text()`, `json()`, `bytes()`, `is_success()` … ), `RetryConfig`. **`RetryConfig` defaults (verified):** `max_retries 3`, `initial_delay 100 ms`, `max_delay 10 s`, `multiplier 2.0`, `retry_on_status [408,429,500,502,503,504]`, `retry_on_network_error true`, `retry_on_timeout true`, `retry_non_idempotent false`. Content-type helpers treat `application/json` and `*+json` as JSON and `text/*`, XML, `application/x-www-form-urlencoded` as text.

### 4.3 `client.rs`

`Client` (cheap clone; shares `Pending` counter, budget, breaker, limiter), `ClientBuilder`, `RequestBuilder`, `StreamingResponse` (`content_length`, `into_stream`, `bytes`). `ClientBuilder::new()` defaults (verified): `timeout 30 s`, `redirect Follow`, `max_redirects 20`, `allow_absolute_urls true`, `allow_insecure_redirects true`, no retries, no base URL, no limits, no breaker. Builder methods: `redirect`, `max_redirects`, `allow_absolute_urls`, `max_response_bytes`, `sensitive_headers`, `allow_insecure_redirects`, `retry_budget`, `max_pending_requests`, `default_header(s)`, `timeout`, `no_timeout`, `with_retries`, `retry_config`, `base_url`, `max_concurrent`, `rate_limit`, `limits_per_origin`, `circuit_breaker`, … Client methods: `builder`, `new`, `get`, `get_streaming`, `post/put/delete/patch`, `request`, `retries_refused`. Key functions: `check_absolute_url`, `resolve_url`, `join_base_url`, `parse_retry_after`, `decode_body`, `strip_bom`, `page_url`; `UPLOAD_CHUNK = 64 KiB` for native upload progress (`on_upload_progress`, new in 2.8.0).

Behaviour documented in the changelog/security docs and confirmed by names in the code: `baseUrl` with a query or fragment is rejected (`InvalidInputError`, `parameter: 'baseUrl'`) and stored in parsed form; with `allowAbsoluteUrls: false` absolute URLs are refused; relative input is joined by stripping leading `/` and `\` so `//host`, `/\host` cannot change origin, with an origin-equality defence-in-depth check. `Retry-After` is read as delta-seconds or an HTTP date. Equal-jitter backoff. On native targets there is a cache of alternative `reqwest::Client`s for per-request redirect/connect-timeout settings (this per-settings client cache is `http_client(RedirectKey)`; I found no cap constant for it in `client.rs`).

### 4.4 Policy modules

| Module | What it does (verified from source/comments) |
| --- | --- |
| `budget.rs` | Sliding-window retry budget shared by a client and clones, across origins. `RetryBudget::default()` = ratio **0.2**, min **10**/s, window **10 s**; 10 slots (`SLOTS = 10`). A retry is allowed while retries ≤ ratio·first-attempts + min·window; refusals are counted (`retries_refused`). Builder: `ratio`, `min_per_second`, `window`. |
| `circuit.rs` | Per-origin breaker: `CircuitBreaker::new(failure_threshold, reset_after)`; states Closed/Open/HalfOpen (`as_str()` gives `closed/open/half-open`). Network errors, timeouts and 5xx count; other responses reset the streak. One recovery probe in half-open; `Probe` reverts on drop if cancelled; transitions reported through `CircuitCallback` outside the lock. JS defaults: threshold **5**, reset **30 000 ms**. |
| `limiter.rs` | `max_concurrent` + token-bucket `RateLimit::new(requests, per)` with FIFO queueing (`Ticket`, `PermitStream` holds a slot until a stream ends/cancels), optional per-origin gates; cancelled waiters leave without spending a token; `Gate::pause` on 429 `Retry-After`. With `limitsPerOrigin`, whenever the number of gates reaches a multiple of 128, idle gates whose bucket has refilled are dropped (active or rate-limited ones are kept so quotas cannot be reset). |
| `timeouts.rs` | `TimeoutPhase` {Connect,Response,Idle,Total}; `TimeoutDetails`; `PhaseTimeouts::{new,connect,response,idle,deadline}`; `Deadline`; `with_deadline`; `IdleStream` (resets per chunk, ends with an idle `TimeoutError`); `DeadlineStream` (expires even if nobody polls, dropping the inner stream to close the socket). `deadlineMs` covers queueing + all attempts + sleeps + body streaming; `timeoutMs` bounds one attempt. |
| `lines.rs` | NDJSON splitter: `Lines::with_limit`, `feed(chunk) -> (Vec<Line>, Option<Error>)`, `finish()`. Checks `maxLineBytes` before buffering. |
| `sse.rs` | WHATWG SSE parser: `Parser::with_limit`, `.event_limit()`, `feed`, `last_event_id`, `take_retry`; handles BOM, split `\r\n`, `id` with NUL ignored, `retry` digits only; limits on line and on event size; an unterminated event at EOF is dropped. |
| `idempotency.rs` | `validate_key` (visible ASCII, non-empty), `validate_header`. JS side (`wasm/idempotency.rs`) generates UUID v4 keys, reuses them across retries/reconnects (`freeze`), and an idempotency key makes POST/PATCH retryable. Default header `Idempotency-Key`. |
| `runtime.rs` | `sleep`, `timeout`, `timeout_phase(_optional)`, `now_ms` (monotonic on native), `random` over tokio/`std` or JS `setTimeout`/`Date.now`/`Math.random`. |
| `url.rs` | 9 lines: re-exports `reqwest::Url` natively, `wasm::url::Url` on wasm32. |
| `fuzzing.rs` | Harness entry points `fuzz_sse`, `fuzz_lines`, `fuzz_retry_after`, `fuzz_urls`, `fuzz_headers`, `fuzz_multipart` (feature `fuzzing`). |
| `http.rs` | wasm-only free functions: `fetch_json`, `fetch_json_promise`, `fetch_text`, `fetch_with_options`, `create_client`, and deprecated `fetch_wasm_{json,html,map,api}`. |

## 5. WebAssembly bridge (`wasm-module/src/wasm`)

| File | Role |
| --- | --- |
| `mod.rs` | `WasmClient` (constructor, interceptors, `get/head/delete/post/put/patch`, `*_json`, `request`, `fetch`, `retries_refused`), the TypeScript option typings (`TYPESCRIPT_TYPES`), prototype-safe `Options` reader, `JsRequest`, request pipeline (`send`, `send_request`, `send_prepared`), per-attempt error context (`method`, `url`, `attempts`), body conversion (JSON, text, bytes, Blob/File, `FormData` → multipart, `URLSearchParams`, upload streams), response → JS (including `stream` and `ndjson`), parsers for `retries`, `retryBudget`, timeouts, `proxy`, `maxResponseBytes`, `redirect`, `maxRedirects`. `RARE_CLIENT_OPTIONS` lists 25 less-common option names. |
| `transport.rs` | Chooses and drives the transport: `PreparedRequest`/`StreamingRequest`, Node (via the callback registered by `node.js`: `bind_node_transport`), `send_fetch`, `send_xhr`, stream bodies (`FetchBody`), redirect and declared-length checks, `websocket_guard` hook. |
| `events.rs` | `EventStream` (SSE): reconnect on 408/429/500/502/503/504 (`RECONNECT_ON`), `Last-Event-ID`, server `retry:`, queue of 64 events with resume at 32 for backpressure (`QUEUE_LIMIT`, `QUEUE_RESUME`). |
| `websocket.rs` | `WebSocketConnection`: state machine (connecting/open/reconnecting/closing/closed), jittered reconnect, idle timeout, bounded pre-open send queue, `send`, `sendJson`, `close`. |
| `futures.rs` | `Delay`, `Aborted`, `Abortable`, `Deadline`, `AbortableStream`, `PromiseFuture`; use global `setTimeout`/`clearTimeout` so they work in any JS runtime. |
| `upload.rs` | Opaque streaming-body handle bridging to `upload.js`. |
| `idempotency.rs`, `url.rs` | See above; `url.rs` wraps the runtime `URL` (saves the `url`/`idna` tables in the bundle). |
| `alloc.rs` | `GrowInSteps`: dlmalloc that grows memory by 1/8 of current size, at least 1 MiB (`MIN_STEP`), because each `memory.grow` costs ~0.13 ms in V8. The **only** hand-written `unsafe` (7 keywords) in the repository. A build with `atomics` fails to compile. |
| `tests.rs` | `wasm-pack test --node` unit tests (1,092 lines). |

## 6. JavaScript layers (`wasm-module/js`)

| File | Option / API | Notes |
| --- | --- | --- |
| `upload.js` | streaming request bodies (`ReadableStream`, async iterables, factory for replay) | 64 KiB chunks; a one-shot source cannot be retried; a factory can |
| `observability.js` | `timings`, `metrics`, `onRequestStart/End`, `debug`, `redactUrl`, `propagateTrace`/`traceOrigins`/`traceContext`, `client.stats()` | URLs lose credentials/query/fragment before hooks see them; trace propagation is off unless enabled with an origin allow-list; Node `DEBUG=rust-fetch` |
| `blob.js` | `responseType: 'blob'` | built from the binary body; empty body → empty Blob |
| `transport.js` | `transport` option | read from the client's own options only (not request options or the prototype) |
| `auth.js` | `auth: { bearer, basic, refresh, origins }` | credentials only to the `baseUrl` origin plus `auth.origins`; 401 → single-flight refresh → replay once; a request with its own `Authorization` keeps it; not replayed for stream bodies |
| `dedupe.js` | `dedupe` | identical in-flight `get`/`head` share one request; each caller gets a cloned response; not for streamed types or callbacks |
| `cache.js` | `httpCache` (RFC 9111, private, in-memory) | defaults `maxEntries 100`, `maxBytes 50 000 000`, `maxEntryBytes 1 000 000`; stores 200/203/204; `no-store`, `no-cache`, `Vary`, `ETag`/`Last-Modified` revalidation; response gets `cached`/`revalidated`; unrelated to the browser `cache` mode |
| `schema.js` | `schema` (Standard Schema v1) | body replaced by schema output; failure → `ValidationError` (`issues`, `status`), not retried; not with `stream`/`ndjson` |
| `resume.js` | `resume` | streamed `get` only; `Range` + `If-Range`; needs `Accept-Ranges: bytes`, strong `ETag` or `Last-Modified`, no `Content-Encoding`; `maxResumes` default 3; checks the `206` start offset; `response.resumes` |
| `extend.js` | `client.extend(overrides)` | headers merged by name, other options replaced; breakers, limits, budgets, metrics **not** shared |
| `paginate.js` | `client.paginate(url, opts)` | follows `Link: rel="next"` or custom `next`; `maxPages` 1000; cross-origin next URL throws `InvalidInputError` unless `crossOrigin: true` |
| `guards.js` | `isRustFetchError(v, kind?)` + 9 per-kind guards | structural checks (kind + string message), so they work across realms/copies |
| `testing.js` / `testing.d.ts` | `rust-fetch/testing`: `createMockTransport()` with `on(method, path|RegExp|fn, response|fn)`, `onAny`, `calls`, `reset` | separate entry so it stays out of production bundles; 100% line/function coverage gated |
| `node.js` | Node entry (1,329 lines) | see 6.1 |

### 6.1 `node.js`

Compiles the `.wasm` synchronously at import (so `init()` is optional on Node) and registers the transport. Contents (from its outline and comments): optional native-addon loader (`TRANSPORT_VERSION` 6 on the addon side) with a TLS-verification warning when `NODE_TLS_REJECT_UNAUTHORIZED=0`; a V8 workaround that turns off `--turbo-inline-js-wasm-calls` on Node 20–23 (an abort on cancelled-request bursts; documented in compatibility.md); bounded `http`/`https` agents (256 sockets, LIFO); a TLS policy that matches the addon (#244): `checkServerIdentity` that refuses a certificate without `subjectAltName`, and ciphers `…:@SECLEVEL=2`; proxy support (`proxy: 'env' | url`, `NO_PROXY`, CONNECT tunnel agent, `NODE_USE_ENV_PROXY`); prototype-pollution shadowing of the option names Node's `http`/`net`/`tls` read; the SSRF guard (`net.BlockList` of special-purpose ranges, a checking DNS `lookup`, IPv6 embedded-IPv4 handling, undici dispatcher for WebSockets); the request queue (`MAX_IN_FLIGHT = 1024`); redirect handling (≤20, 301/302/303/307/308, `Authorization`/`Cookie`/`Proxy-Authorization` + `sensitiveHeaders` stripped on cross-origin, https→http refusal, 64 KiB redirect-body drain); decompression (gzip, deflate, br, zstd where Node has it) bounded by `maxResponseBytes` with 1 MiB compressed slack; phase timers; header parsing into null-prototype maps; upload writing with progress; pool statistics for `stats()`.

## 7. Native addon (`native/`)

Crate `rust-fetch-native` 2.8.0, `cdylib`, Node-API (`napi 3`, feature `napi9`, `tokio_rt`), deps: `brotli 9`, `flate2`, `zstd 0.14`, `hyper 1` (client, http1), `hyper-util`, `http-body-util`, `rustls 0.23` (ring, tls12), `tokio-rustls`, `webpki-roots`, `x509-parser`, `url`, `tokio`; release `opt-level 3`, LTO, strip. Exports `configure`, `send`, `sendSimple`, `cancel`, `stats`, `TRANSPORT_VERSION`. `pool.rs`: ≤256 connections per origin, LIFO, 4 s idle, `MAX_CACHED_ORIGINS = 256`, TLS config with a `NodeVerifier` (honours `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED`). `pending.rs`: request-id registry scoped to one JS environment. `timeouts.rs`: phase timeout encoding (`RUST_FETCH_PHASE_TIMEOUT:` prefix). `upload.rs`: pulls one bounded chunk from JS only when hyper can write a frame. Redirect ≤20, 64 KiB redirect drain, 1 MiB compressed slack. 0 hand-written `unsafe` (napi macros expand to unsafe, so the crate uses `deny` not `forbid`). Known: with both `Content-Length` and `Transfer-Encoding` it reads chunked and closes the connection afterwards (#243). Status: tested on Linux (Node 20/22/24) and Windows MSVC (22/24) in CI, run on macOS arm64; **not published**; prebuilt binaries wait on #14.

## 8. Public API surface (source of truth: `api/rust-fetch.d.ts`)

Exports: `WasmClient`, `EventStream`, `WebSocketConnection`, `init` (default) and `initSync`, `create_client`, `fetch_json`, `fetch_json_promise`, `fetch_text`, `fetch_with_options`, deprecated `fetch_wasm_{api,html,json,map}`, the guards, and ~60 types. `IntoUnderlying{Source,Sink,ByteSource}` are wasm-streams plumbing exposed by the glue.

**Client options (`ClientOptions`) with defaults** (everything off unless stated): `baseUrl`; `headers`; `timeoutMs` **30 000** (`0` disables); `connectTimeoutMs`, `responseTimeoutMs`, `idleTimeoutMs`, `deadlineMs` (`0` disables); `retries` (number or `RetryOptions`: `maxRetries 3`, `initialDelayMs 100`, `maxDelayMs 10 000`, `multiplier 2`, `retryOn [408,429,500,502,503,504]`, `retryOnNetworkError true`, `retryOnTimeout true`, `retryNonIdempotent false`) default **no retries**; `retryBudget` (`ratio 0.2`, `minPerSecond 10`, `windowMs 10 000`); `idempotencyKey`, `idempotencyHeader` (`Idempotency-Key`); `redirect` (`follow`), `maxRedirects` (20); `proxy` (`'env'` or URL); `allowAbsoluteUrls` (true); `maxResponseBytes`, `maxPendingRequests`, `maxConcurrent`, `rateLimit {requests, perMs}`, `limitsPerOrigin`, `circuitBreaker {failureThreshold 5, resetAfterMs 30000}`, `onCircuitChange`; `sensitiveHeaders`; `allowInsecureRedirects` (true); `maxLineBytes`, `maxEventBytes`; `allowPrivateNetwork` (true; Node.js only); `httpCache`, `dedupe`, `auth`, `transport`; observability: `timings`, `metrics`, `onRequestStart`, `onRequestEnd`, `debug`, `redactUrl`, `propagateTrace`, `traceOrigins`, `traceContext`; browser fetch options (`BrowserRequestOptions`): `credentials`, `mode`, `cache`, `keepalive`, `priority`, `referrer`, `referrerPolicy`, `integrity` (ignored on Node but validated).

**Request options (`RequestOptions`)** add/override: `headers`, `params`, the timeouts, `retries`, `idempotencyKey/Header`, `responseType` (`auto|json|text|binary|blob|stream|ndjson`), `redirect`, `maxRedirects`, `allowAbsoluteUrls`, `maxResponseBytes` (`null` removes), `sensitiveHeaders`, `allowInsecureRedirects`, `maxLineBytes` (`null`), `allowPrivateNetwork`, `signal`, `onDownloadProgress`, `onUploadProgress` (not with `stream`), `schema`, `resume`, `httpCache: false`, `dedupe`. `FetchInit` adds `method` and `body`. `EventStreamOptions` and `WebSocketOptions` are separate (reconnect defaults: `initialDelayMs 1000`, `maxDelayMs 30000`, `multiplier 2`, unlimited retries; SSE reconnect on by default for GET only, `[DONE]` ends a `messageType: 'json'` stream; WebSocket `reconnect` off by default and only for close codes 1001, 1006, 1011–1014; browsers reject WebSocket `headers`; `dispatcher` Node-only).

**Errors.** Every rejection is an `Error` with `name === kind` ∈ {CircuitOpenError, NetworkError, HttpError, ParseError, TimeoutError, InvalidInputError, JsInteropError, CancelledError, ValidationError} plus `method`, `url` (credentials/fragment removed), `attempts`, `cause`, `timings`, and kind-specific fields (`status`, `statusText`, `body`, `timeoutMs`, `phase`, `parameter`, `maxResponseBytes`, `maxPendingRequests`, `maxLineBytes`, `maxEventBytes`, `maxQueuedMessages`, `maxQueuedBytes`, `reason`, `issues`, `retryBudgetExhausted`, `origin`, `retryAfterMs`). `RustFetchErrorOf<K>` narrows by kind.

**Rust API** (docs/rust.md, README): `Client::builder()…build()`, `get`, `post(..).json(..).send()`, `get_streaming`, `RequestBuilder::on_upload_progress` (native targets, new 2.8.0), `sse()`. The Rust crate has **no interceptors or WebSockets** (open in #24). API compatibility is checked with `cargo-semver-checks` against `main`.

## 9. Security

### 9.1 Model

`docs/threat-model.md`: assets A1–A4 (credentials, network position, process memory/availability, package integrity); attackers T1 malicious server, T2 application user/data source, T3 prototype polluter, T4 malicious dependency, T5 compromised CI/release step, T6 network attacker; six adapters with trust boundaries; 16 threats TM01–TM16. Marked **"Written by the maintainer's tooling and not yet reviewed by anyone else (#223)."**

### 9.2 Controls (all opt-in unless noted)

SSRF (`allowPrivateNetwork: false`, Node.js, resolved-address check at connect and on every redirect/reconnect; proxies: IP literals checked, hostnames refused; all IANA special-purpose ranges incl. `2001:2::/48`, `2001:10::/28`); credential-safe redirects (cross-origin strip of `Authorization`/`Cookie`/`Proxy-Authorization`/`sensitiveHeaders`; `allowInsecureRedirects: false`; non-http(s) redirect schemes refused); `allowAbsoluteUrls: false` and `baseUrl` rules; CRLF/NUL/illegal-token header rejection; `maxResponseBytes` incl. decompression; `maxLineBytes`/`maxEventBytes`; `maxPendingRequests`; WebSocket send-queue limits; phase timeouts + `deadlineMs`; retry budget; circuit breaker; prototype-pollution hardening (#191; own-property option reads, null-prototype state, shadowing Node option names); redaction of URL userinfo/query/fragment and headers in hooks, logs and errors (`error.url` still keeps the **query** unless `redactUrl` is set: TM13 residual); TLS verification on by default on both Node transports (SAN required, security level 2); zero runtime dependencies, no install scripts, provenance.

### 9.3 Claims table (`docs/security.md`, C01–C30, enforced by `claims.test.mjs`)

C01–C03 package has no runtime deps/ships only expected files; C04 provenance/signatures (process); C05 no network at import; C06 no telemetry (source review, *stated*); C07–C08 prototype pollution; C09–C13 SSRF (redirect hops, connection reuse, IANA ranges, proxy, WebSocket reconnect); C14–C16, C28 redirects/credentials/schemes; C17 absolute URLs/baseUrl; C18 header injection; C19 response size; C20 redirect body; C21 line/event limits; C22 load shedding; C23 WebSocket queue; C24 timeouts (*partial*: events); C25 redaction; C26 native adapter isolation (*stated: design, no multi-thread test*); C27 (*partial*); C29 supply-chain checks; C30 strict CSP/Trusted Types. `claims.test.mjs` fails if a named test disappears. The docs also carry "Wording this project does not use" (eight phrases it will not claim, e.g. "rigorous", "bank-level", an unscoped "100% coverage").

### 9.4 Memory safety and unsafe

`docs/unsafe.md` + `scripts/check-unsafe.mjs` (CI): only `wasm/alloc.rs` (7 `unsafe`; verified by running the script on 2026-11-09: "unsafe inventory matches") and both crates `deny(unsafe_code)`. `memory-safety.yml`: Miri on the pure-Rust unit tests, AddressSanitizer on the host suite, and the native addon built with ASan and run through the JS tests. Not done: `cargo geiger`/`cargo vet` for dependencies.

### 9.5 Process and open security items

Reporting through GitHub Security Advisories (private vulnerability reporting enabled 2026-11-07) or `asem@qaffaf.com` with `[SECURITY] rust-fetch`; ack in 48–72 h (internal 7-day triage goal not published). Ruleset "Protect main" active (no deletion/force-push, PR + status checks, admins can bypass; tags not covered). Secret-scanning push protection on. **One person can publish** (a tag push runs `release.yml`): if the maintainer is unavailable nobody can ship a fix (#234 open). No independent review yet (#223 open; call published in `docs/security-review.md`; OSTIF application planned). Release drill done twice (local; draft advisory + temporary private fork); the drill fork `GHSA-6p9x-xrpw-h2gf` still has to be deleted in the web UI (from the local notes).

## 10. Build, test and quality gates

### 10.1 Commands (root `package.json`)

`build`, `build:native`, `test` (= `test:rust` + `test:js`), `test:rust` (`cargo test` in `wasm-module`), `test:js` (`node --test` over ~40 files), `pack:check`, `bench`, `size`, `api:check`/`api:update`, `coverage:js`, `test:browsers`, `test:conformance`, `bench:cold`, `bench:compare`, `security:compare`, `reliability:compare`, `fuzz:js`. Also `wasm-pack test --node` (Wasm unit tests), `cargo llvm-cov`.

Local build rule from the maintainer notes: build, `cargo fmt` and size checks with `RUSTUP_TOOLCHAIN=1.99.1` (local default is 1.88, which makes the Wasm ~11 kB larger and formats differently). After heavy builds delete `wasm-module/target` and `wasm-module/fuzz/target` (29 GB once filled the disk).

### 10.2 Suites

Rust unit tests in `src/**`; Rust integration tests (`tests/integration_tests.rs`, 1,912 lines: retries, timeouts, redirects, chunked/truncated/large bodies, streaming, progress, concurrency; `client_tests.rs`); Wasm tests `src/wasm/tests.rs`; ~45 JS test files in `wasm-module/js/test/` (client, node-transport, browser-transport, websocket, events, security, hardened, memory, v8-crash, package, uploads, prototype-pollution, observability, response-framing, redirect-credentials, tls-verification, ssrf-ranges, secret-canary, claims, no-startup-network, csp-static, browser-csp, bundlers, examples, auth, blob, dedupe, http-cache, schema, paginate, resume, client-extend, error-guards, mock-transport, browsers, browser-uploads, browser-pollution, observability-browser…; many have `*-js` twins that force the node:http transport); `conformance/` (`cases.mjs` 81, `hostile-cases.mjs` 12, `reliability-cases.mjs` 17, `run.mjs`, `server.mjs`); `runtimes/` (Bun, Deno smoke: 13 checks; workerd smoke).

### 10.3 Gates enforced in CI (`.github/workflows/rust.yml` and others)

100% line **and** function coverage of the Rust core (excluding `src/wasm/`, `src/http.rs`, `tests/`) and of `node.js` + `testing.js` (`coverage:js`); the generated glue and option layers are tested but **not** under the gate. `cargo fmt --check`; panic lints for native and wasm32; unsafe inventory; `cargo-deny` (advisories, `yanked = deny`, licences allow-list incl. `CDLA-Permissive-2.0`, `wildcards = deny`, only crates.io) for both crates; `npm audit --audit-level=low` for root, `docs`, `examples`; `cargo-semver-checks`; native `clippy -D warnings`; TypeScript API snapshot; size budgets; benchmarks of the PR vs its base and vs npm `latest` (warn at >10% worse in median and most rounds; never a failure on PRs); packed-package check; Bun/Deno/workerd smoke; Chromium/Firefox/WebKit tests + conformance; WebKit streaming uploads on macOS.

**Size budgets (`scripts/check-size.mjs`):** `rust_fetch_bg.wasm` raw 455 500 / gzip 183 300 / brotli 148 900 bytes; `rust_fetch.js` 135 500 / 28 100 / 24 200; `node.js` 60 500 / 19 400 / 16 950. README quotes about 148 kB brotli for the module and ~171 kB for the browser entry.

### 10.4 Workflows

| File | Name | Triggers | Purpose |
| --- | --- | --- | --- |
| `rust.yml` | CI | push, PR | rust, dependencies, semver, npm-audit, native, wasm, benchmarks, package, runtimes, browsers, webkit-uploads |
| `release.yml` | Release | push of tag `v*.*.*` | build with pinned toolchain (no caches), reproducibility check (blocks release), tag/version match, tests, dist-tag choice, packed-package check with strict benchmark vs the line's latest, `npm publish --provenance` (trusted publishing or `NPM_TOKEN`), clean-install verify of signature + provenance (≤~10 min), GitHub release from the CHANGELOG section, cosign signature of the published tarball attached (`rust-fetch-X.Y.Z.tgz.sigstore.json`). Re-runnable (skips already-published versions). `contents: write` only on its one job. |
| `docs.yml` | Docs | push, PR, dispatch | build site + link check; deploy to Pages |
| `audit.yml` | Scheduled dependency audit | Mon 05:43 UTC, PR, dispatch | `cargo deny` both crates + `npm audit` x3; opens one deduplicated `security` issue |
| `codeql.yml` | CodeQL | push, PR, Tue 06:29 | JS/TS, Rust, Actions (`security-extended`) |
| `fuzz.yml` | Parser and JS boundary fuzzing | daily 18:17, PR, dispatch | 6 cargo-fuzz targets (3 min each), JS/Node boundary fuzzing; corpus kept; failures upload artifacts and open an issue |
| `clusterfuzzlite.yml` | ClusterFuzzLite | PR | ASan fuzzing of the 6 parser targets; findings as code-scanning alerts |
| `memory-safety.yml` | Miri and AddressSanitizer | Sun 19:41, PR, dispatch | `miri`, `asan`, `native-asan` |
| `reproducible.yml` | Reproducible Wasm build | Mon 04:23, PR, dispatch | build twice in two dirs, SHA-256 must match; weekly rebuild of the latest tag vs npm |
| `scorecard.yml` | OpenSSF Scorecard | Wed 05:47, push, rule change | uploads to code scanning and the public API |
| `windows.yml` | Windows | Sun 20:17, PR, dispatch | MSVC build of package + addon, JS suite on Node 22/24 both transports |
| `workflow-lint.yml` | Workflow security lint | push, PR | zizmor |

Dependabot: weekly, 7-day cooldown, grouped; cargo (`wasm-module`, `native`), npm (`/`, `/docs`, `/examples`, `/wasm-module/js/test/runtimes`), github-actions, docker (`.clusterfuzzlite`, `wasm-module/fuzz/oss-fuzz`); ignores `wasm-streams >= 0.6`, `typescript-5.2`, undici majors.

### 10.5 Release procedure (CONTRIBUTING.md + notes)

`release/X.Y.Z` branch → `node scripts/bump-version.mjs X.Y.Z` (changes 10 files: root `package.json` and `package-lock.json`, `examples/package-lock.json`, both `Cargo.toml`, three `Cargo.lock` (wasm-module, wasm-module/fuzz, native), README and getting-started "On npm (X.Y.Z)"; writes nothing unless every pattern matches) → by hand: move `[Unreleased]` entries in CHANGELOG.md, update the "Latest patch" column in SECURITY.md → PR → merge → `git tag -a vX.Y.Z -m "rust-fetch X.Y.Z"` and push (tag push triggers `release.yml`) → verify npm, provenance, then update docs. Minor releases at most every two weeks; patches only for regressions/security (stability.md). Performance regressions block a release (checked against npm `latest` with `node scripts/check-package.mjs --strict`).

## 11. Fuzzing

Six cargo-fuzz targets in `wasm-module/fuzz/fuzz_targets`: `sse`, `lines`, `retry_after`, `urls`, `headers`, `multipart` (corpus dirs also `node-content-type`, `node-decompression`, `node-proxy`, `node-redirect`). Run: `cargo +nightly-2026-10-28 fuzz run <target> -- -max_total_time=180` from `wasm-module` (cargo-fuzz 0.13.2 pinned). Chunked parser results must equal whole-input results (4 KiB line / 16 KiB event limits). JS: `npm run fuzz:js` (`FUZZ_SEED`, `FUZZ_CASES`, fetch stubbed); `scripts/fuzz-node-boundary.mjs` (targets `proxy|redirect|content-type|decompression`, `FUZZ_TARGET`); `scripts/fuzz-url-differential.mjs` compares URL resolution with Node's WHATWG `URL` (20 000+ hostile inputs, 16 base shapes per the pasted reference: **not re-verified**; decided differences are listed in `docs/security.md`). OSS-Fuzz files are prepared in `wasm-module/fuzz/oss-fuzz/` but **not submitted**.

## 12. Performance and benchmarks

`docs/performance.md` reports (all loopback, relative throughput): vs Node `fetch()` level one-at-a-time (100–104%), ahead with many in flight (102–116% since 2.2.0), large binary bodies 112–133%; behind on concurrent HTTPS (92%) and 0.6 MB JSON in one harness (95%); the native addon gains most (up to 1.95× `fetch()` under concurrency). Independent runs by `aakjp/stress-test`. 2.7.0 failed its own benchmark gate before optimisation (+11% per-request overhead, +10–15% startup); the 2.7.1 follow-up (#203, #204) brought it within the gate; `benchmarks/performance-2.7/README.md` records favourable and unfavourable runs. Memory: ~7 kB per pending request on Node; Wasm allocator growth in steps (#140: 45% less memory per pending request). Open: #114 (HTTP/2 for Node transports), #156 (WebSocket performance), both need a quiet machine.

## 13. Documentation inventory

- **Site** (`docs/`, VitePress 2.0.0-alpha.21, TypeDoc 0.28.20 + markdown plugin for `docs/api/`; `npm run build` also runs `scripts/check-links.mjs`): Guide pages: introduction, getting-started, index, configuration, requests, errors, timeouts-and-retries, load-limits, circuit-breakers, observability, interceptors, streaming, uploads, websockets, typescript, testing, examples, validation. Reference/other: architecture, rust, compatibility, stability, development, faq, security, threat-model, security-review, security-release-checklist, unsafe, performance, reliability, conformance, changelog (reads `CHANGELOG.md` at build), index. Nav "More" menu and a version menu (latest, 2.7, 2.6, 2.5). 2.8-only pages are intentionally not backfilled into the 2.7 archive; 2.6.x and earlier docs unchanged.
- **Repo docs:** README (additive-only rule, section 17), CONFORMANCE.md, CONTRIBUTING.md, SECURITY.md, ROADMAP.md, CODE_OF_CONDUCT.md, `llms.txt` (182 lines, 18 KB; copied into the npm package by postbuild; updated for 2.8 in #324).
- **Live check on 2026-11-09:** `/rust-fetch/guide/validation` 200, `/rust-fetch/changelog` 200 (shows 2.8.0). **`llms.txt` is not served by the site** (`/rust-fetch/llms.txt` and `/llms.txt` → 404; it exists only at the repo root, in the npm package, and on `raw.githubusercontent.com`). Nothing in `docs/public` or the docs config publishes it. Decision pending (section 15).
- **Verified by scripts per the last report** (not re-run): every property/method in `api/rust-fetch.d.ts` appears in the docs; identifiers named in the 2.7/2.8 changelog entries appear in the docs except internal ones. That checks presence, not quality.

## 14. Examples (`examples/`)

`node-client` (base URL, timeouts, retries, bearer auth, interceptors, idempotency keys, typed errors, metrics), `llm-streaming` (SSE from an OpenAI-compatible API, NDJSON from Ollama), `websocket-chat` (+ `request.mjs` request/response recipe #153, `channels.mjs` channels recipe #154; Node 22+), `browser-upload` (Vite, progress bar, cancel), `cloudflare-worker` (`wrangler.jsonc`, `.wasm` imported as a module). Each exports `run()`; all run in CI (`examples.test.mjs`, `bundlers.test.mjs`, workerd smoke) against local servers.

## 15. Roadmap and open work

**Done and released:** 2.2.0 (upload progress, WebSockets, generics), 2.3.0 (SSE, NDJSON, real-browser CI), 2.4.0 (performance, proxies, redirect options, bundle size), 2.5.0 (SSRF, size limits, base-URL safety), 2.6.0 (conformance, credential-safe redirects, load shedding, bounded queues, hardened configs), 2.7.0–2.7.2 (idempotency, limits, circuit breaker, observability, fuzzing, phase timeouts, streaming uploads, metrics, then performance and security patches), **2.8.0** (security verification + data/DX features: `schema`/`ValidationError`, `paginate`, `httpCache`, `dedupe`, `testing` mock transport, `extend`, `auth`, `resume`, `blob`, error guards, abort `reason`, docs site + TypeDoc, examples, bundler/runtime tests, Windows CI, threat model, claims audit, Miri/ASan, reproducible Wasm, Scorecard, CSP tests, Rust `on_upload_progress`; fixes: URL password/fragment no longer on errors (#238/#239), `redactUrl` covers `cause`, native `Content-Length`+`Transfer-Encoding` handling (#243), node:http TLS parity (#244), `baseUrl` query/fragment refused, new IPv6 special ranges blocked).

**Open GitHub issues (2.9.0 milestone, 18 open, as listed 2026-11-09):**

| # | Topic | State / blocker |
| --- | --- | --- |
| 235 | Tracking: security verification | umbrella |
| 234 | Vulnerability response drill | needs a second releaser (person) |
| 223 | Commission an independent security review | needs a reviewer |
| 156 | WebSocket performance benchmark | needs a quiet machine |
| 114 | HTTP/2 for Node transports | investigation; quiet machine |
| 74 | Publish to JSR | needs JSR scope/account |
| 71 | Bundler/framework tests | Vite, webpack, esbuild done; Next.js, plain Rollup, SSR open |
| 52, 36, 35, 34, 33, 32, 31, 30 | WebRTC (WHIP/WHEP clients, trickle ICE, test server, signalling helper, mediasoup, Node peers) | #36 recommended "not planned"; rest unscheduled |
| 50 | Node.js cookie jar | needs a public-suffix list |
| 24 | Rust crate: interceptors and WebSockets (upload progress done) | open |
| 14 | Prebuilt native binaries as optional npm packages | needs npm package names/permissions (one-time setup) |
| 26 | Roadmap tracking issue (no milestone) | its text says 2.8.0/2.9.0 "merged, release pending": stale |

Other milestones "Native transport delivery" and "WebRTC signaling" exist with 0 issues (issues were moved to 2.9.0). Closed in 2.8: #243, #244, #239, #238, #233 …

**Needs a person (from local notes):** #223 reviewer, #234 second releaser, #74 JSR scope, #14 npm names, CII badge, tightening the ruleset (a permission classifier denied it in a session), deleting the drill fork `GHSA-6p9x-xrpw-h2gf`.

**Limitations documented as such:** HTTP/2 only via browsers (Node transports are HTTP/1.1); WebSockets need a built-in `WebSocket` (Node 22+, or 20 with `--experimental-websocket`); no `rust-fetch` support for Vercel Edge/deployed Workers tests; browser bundle ~171 kB brotli; upload progress in browsers uses XHR (cross-origin preflight); `allowPrivateNetwork` does nothing in browsers; independent review absent; Rust crate lacks interceptors/WebSockets; native addon unpublished.

## 16. Known documentation drift and inaccuracies (verified 2026-11-09)

| Where | Says | Reality |
| --- | --- | --- |
| `ROADMAP.md` row for 2.8.0 and issue #26 text | "Merged, not released" | 2.8.0 was published 2026-11-08 |
| `SECURITY_PROGRESS.md` (untracked) | "Nothing tagged or published; npm latest is 2.7.2"; tag push denied | `v2.8.0` is tagged and published; the notes are obsolete |
| `docs/index.md:36`, `docs/development.md:32`, `ROADMAP.md:162` | "69 behaviours" (414 observations) | `CONFORMANCE.md` has 81 rows (69 + 12 hostile-response) |
| `docs/threat-model.md` (TM07 "full range test pending (#237)", TM11 "`unsafe` inventory pending (#246)", TM14 "Not yet merged: the matrix test (#245)") | pending | the changelog says the IANA range test, unsafe inventory + Miri/ASan and the TLS matrix all landed in 2.8.0 |
| `docs/unsafe.md` heading "Not covered yet" | lists Miri/ASan as running, then dependencies as not covered | only the dependency item is still open; the heading is misleading |
| `docs/security.md` | "29 claims" in the changelog | table has C01–C30 (30) |
| `docs/security-review.md` Size table | counts at commit `33efb92` (2026-11-07) | now core 15,032 lines vs 14,783 etc. |
| `docs/security-release-checklist.md` state table | "as checked on 2026-11-07" | stated as dated; re-check before relying |
| Pasted "zero-omission reference" | many wrong names/versions | see section 0 |
| `CONTRIBUTING.md` | "Rust (stable)" | CI/release pin 1.99.1; the manifest has no `rust-version` |

These are findings, not fixes: none has been changed. Per the maintainer's rules, doc fixes need a PR and README content is never removed without asking.

## 17. Maintainer working agreements (from the saved session notes)

- **Commits/pushes:** show branch, message and files and wait for OK before any `git commit`/`git push`; publishing to npm needs separate OK. A later instruction (2026-10-23) allows autonomous merge/release of roadmap work when CI is green and confident, **except** account-level actions, secrets or irreversible steps. Tag pushes were denied by the permission classifier once; the maintainer handles those.
- **Never** add `Co-Authored-By: Claude` or "Generated with Claude Code" to commits, squash messages, PRs, tags or releases (overrides any harness attribution reminder).
- **README is additive only**: don't remove badges, sections or claims without asking.
- **PR descriptions** structured: Summary, Motivation/Problem, Usage, Changes (grouped, with paths), Compatibility, Testing checklist with numbers, Follow-ups; always labels and the milestone.
- **Tag every release** `vX.Y.Z` on the release commit; the tag push publishes.
- **Stacked PRs** for dependent work: open against the parent branch; after a squash merge `git rebase --onto origin/main <old-parent-tip>`, rebuild, `npm run api:update`, retarget, then `--force-with-lease`.
- **Dependency bumps:** check the lockfile for mixed versions and read upstream changelogs before judging size.
- **Performance regressions are fixed, not documented away;** compare to npm `latest`.
- **Security first** for the 2.7.x line (and 2.8 work): rank security fixes, advisories and fuzz failures above features.
- **Release cadence:** minors at most every two weeks (next after 2026-11-08: not before 2026-11-22; the notes' "≥ 2026-11-08" referred to 2.8). Patches only for regressions/security.
- **Clean build artifacts** after heavy runs.

## 18. Session log relevant to this document

- 2026-11-08: 2.8.0 released (tag `v2.8.0`).
- #323 (Zod validation guide) and #324 (release notes page, `llms.txt` for 2.8, `initSync`/error type docs) merged; Docs deploy at `cc27686` succeeded.
- 2026-11-09: live-site check: validation page and changelog page live; `llms.txt` not served (offered a follow-up PR; no answer yet).
- 2026-11-09: two pasted blocks asked for a complete reference; the first (a long "zero-omission" document) was found to be unreliable (section 0); this file is the verified replacement.
- 2026-11-09: the maintainer put the project on hold and asked for this file and `SECURITY_PROGRESS.md` to be pushed. Both were added in one docs-only pull request (not part of any release). `SECURITY_PROGRESS.md` was rewritten to the real state first.

## 19. Completeness audit

Checked in this pass against the repo: top-level layout and all 351 tracked files by directory; every Rust module's public items; the JS layers; native addon structure; all 12 workflows' triggers; scripts; Cargo/npm manifests; the TypeScript API in full; SECURITY, security-review, security-release-checklist (head), threat-model (head to TM14), unsafe, stability, development, architecture, ROADMAP, CONTRIBUTING, CHANGELOG 2.8.0 section; issues, milestones, releases, rulesets, dist-tags.

**Still not covered at line depth (honest gaps):** the bodies of `client.rs` retry loop and `wasm/mod.rs` request pipeline; `observability.js` metrics reservoir details; `docs/security.md` sections beyond the claims table and CSP; `docs/guide/*` content; `README` mid-sections; `docs/v2.x` archives; `benchmarks/*` results; test case contents; the unread tail of `threat-model.md` (after TM14) and `security-release-checklist.md` (after step 3); CHANGELOG entries before 2.8.0 (only headings read). Items to resolve in a follow-up pass: whether the native-target `reqwest::Client` cache in `client.rs` has a size cap; the circuit breaker's healthy-origin pruning rule (not read).
