# rust-fetch

[![npm version](https://img.shields.io/npm/v/rust-fetch.svg)](https://www.npmjs.com/package/rust-fetch)
[![CI](https://github.com/asemqaffaf/rust-fetch/actions/workflows/rust.yml/badge.svg)](https://github.com/asemqaffaf/rust-fetch/actions/workflows/rust.yml)
[![Coverage: 100% (enforced)](https://img.shields.io/badge/coverage-100%25%20enforced-brightgreen.svg)](https://github.com/asemqaffaf/rust-fetch/actions/workflows/rust.yml)
[![codecov](https://codecov.io/gh/asemqaffaf/rust-fetch/branch/main/graph/badge.svg)](https://codecov.io/gh/asemqaffaf/rust-fetch)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=flat&logo=WebAssembly&logoColor=white)](https://webassembly.org/)

**A reliable HTTP client for JavaScript and TypeScript, written in Rust and compiled to WebAssembly.**
It runs in browsers, Web Workers and Node.js, and adds what `fetch()` leaves to you: timeouts, retries with backoff, typed errors, interceptors, multipart uploads and download progress.

```js
import { WasmClient } from 'rust-fetch';

const api = new WasmClient({ baseUrl: 'https://api.example.com/v1', timeoutMs: 10_000, retries: 3 });
const { body: user } = await api.get('/users/42');
```

## Contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Guide](#guide): [client options](#client-options) · [requests](#making-requests) · [bodies](#request-bodies) · [responses](#responses) · [errors](#errors) · [timeouts](#timeouts) · [retries](#retries) · [cancellation](#cancellation) · [streaming](#streaming) · [progress](#download-progress) · [uploads](#file-uploads) · [interceptors](#interceptors) · [TypeScript](#typescript)
- [Legacy functions](#legacy-functions)
- [Using it from Rust](#using-it-from-rust)
- [Performance](#performance)
- [Roadmap](#roadmap)
- [Upgrading to 2.0](#upgrading-to-20)
- [Development](#development)
- [License](#license)

## Features

- **Works everywhere**: browsers (directly or through bundlers like Vite and webpack), Web Workers and Node.js 20+. In Node.js there's no setup: `import` and go.
- **Timeouts** per attempt, covering the response body, not just the headers. The default is 30 s.
- **Retries** with exponential backoff and jitter. `Retry-After` is honoured, and POST/PATCH aren't retried unless you opt in.
- **Typed errors**: every rejection is a real `Error` with a `kind` (`HttpError`, `TimeoutError`, …) and details like `status` and `body`.
- **Cancellation** with `AbortSignal`, including during retry backoff and while streaming.
- **Request bodies** from strings, bytes, `Blob`/`File`, `FormData` (multipart with files), `URLSearchParams`, or JSON.
- **Response decoding** by `Content-Type` (including `application/*+json`), or forced to `json`, `text`, `binary` or `stream`.
- **Streaming** responses as a `ReadableStream`, and **download progress** callbacks.
- **Interceptors** for requests and responses, e.g. auth headers and token refresh.
- **TypeScript** definitions for the whole API.
- **Tested**: 100% line coverage of the Rust core, plus wasm tests and end-to-end tests of the packed npm package. See [Development](#development).

## Installation

```bash
npm install rust-fetch
```

## Quick start

**Node.js** (20+): the WebAssembly module loads on import.

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

## Guide

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

Relative URLs need a `baseUrl`. In a browser page without one, they resolve against the page URL. Absolute URLs always win over `baseUrl`. `TRACE` and `CONNECT` are rejected because `fetch()` forbids them.

#### Request options

| Option | Type | Description |
| --- | --- | --- |
| `headers` | object, `Headers`, `Map` or `[name, value][]` | Override client headers with the same name. Numbers and booleans are converted to strings. |
| `params` | object or `URLSearchParams` | Appended to the query string. Arrays repeat the key; `null`/`undefined` are skipped. |
| `timeoutMs` | number | Overrides the client timeout; `0` disables it |
| `responseType` | `'auto'` \| `'json'` \| `'text'` \| `'binary'` \| `'stream'` | See [Responses](#responses) |
| `signal` | `AbortSignal` | See [Cancellation](#cancellation) |
| `onDownloadProgress` | `({ loaded, total }) => void` | See [Download progress](#download-progress) |

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
| `NetworkError` | DNS, connection, TLS or CORS failure, or a body cut off mid-transfer | |
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

### Cancellation

```js
const controller = new AbortController();
const promise = client.get('/report', { signal: controller.signal });
controller.abort(); // rejects with a CancelledError

await client.get('/report', { signal: AbortSignal.timeout(5_000) }); // total deadline, including retries
```

Aborting cancels the underlying `fetch`, any pending retry delay, and a body being streamed.

### Streaming

`responseType: 'stream'` resolves as soon as the headers arrive. `body` is then a `ReadableStream<Uint8Array>`:

```js
const res = await client.get('/export.csv', { responseType: 'stream' });
for await (const chunk of res.body) {
  process(chunk); // Uint8Array
}
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

Upload progress isn't available, because `fetch()` doesn't report it.

### File uploads

Pass a `FormData` and it's sent as `multipart/form-data`, files included:

```js
const form = new FormData();
form.append('title', 'Quarterly report');
form.append('file', fileInput.files[0]); // or new File([bytes], 'report.pdf', { type: 'application/pdf' })
await client.post('/upload', { body: form });
```

A single `Blob` or `File` body is sent as raw bytes with the blob's type.

### Interceptors

```js
// Add a header to every request (may be async)
client.addRequestInterceptor((request) => {
  request.headers.authorization = `Bearer ${getToken()}`;
  // mutate in place, or return a new { method, url, headers, body }
});

// Resolve to the body instead of the whole response
client.addResponseInterceptor((response) => response.body);

// Report failures, then keep rejecting
client.addResponseInterceptor(undefined, (error) => {
  reportError(error);
  throw error;
});
```

An `onRejected` handler can also recover by returning a value, for example the result of retrying the request after refreshing a token.

- Request interceptors run in order before each request. They see `{ method, url, headers, body }`, where `headers` holds the per-request headers. Client default headers are added afterwards, and a request header with the same name wins.
- Response interceptors chain like `promise.then(onFulfilled, onRejected)`. Their return values are what the call resolves to. Throw to reject.
- `addRequestInterceptor` and `addResponseInterceptor` return an id for `ejectInterceptor(id)`. `clearInterceptors()` removes all of them.
- A request uses the interceptors registered when it started.

### TypeScript

Type definitions ship with the package and need TypeScript 5.2 or newer. Besides `WasmClient`, it exports the option and result types `ClientOptions`, `RequestOptions`, `FetchInit`, `RetryOptions`, `HttpResponse`, `RustFetchError`, `DownloadProgress` and `InterceptedRequest`.

```ts
import { WasmClient, type HttpResponse, type RustFetchError } from 'rust-fetch';

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

## Legacy functions

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

Request futures are `Send`, so you can `tokio::spawn` them. Progress callbacks (`on_download_progress`) must be `Send + Sync` on native targets.

## Performance

rust-fetch makes its requests through the runtime's own `fetch()`, so the network work is the same as plain `fetch`. The extra cost comes from crossing the JS ↔ Wasm boundary and copying bodies. It is **not faster than native `fetch`**. Use it for the reliability features, not for speed.

`npm run bench` (Node 22.13, Apple M1 Pro, local server):

| Scenario | native `fetch` | rust-fetch | rust-fetch / native |
| --- | ---: | ---: | ---: |
| Small JSON, sequential | 5,465 req/s | 4,015 req/s | 73% |
| Small JSON, 50 concurrent | 12,155 req/s | 6,035 req/s | 50% |
| JSON 0.6 MB | 219 req/s | 212 req/s | 97% |
| Binary 8 MB | 189 req/s | 147 req/s | 77% |

The overhead per request is a fraction of a millisecond, which matters little once a request crosses a real network.

## Roadmap

- [x] POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- [x] Request header customization
- [x] Comprehensive test suite: Rust unit and integration tests (100% line coverage, enforced in CI), wasm tests, and JS end-to-end tests
- [x] Streaming responses (`responseType: 'stream'`; `send_streaming()` in Rust)
- [x] Request cancellation (`AbortSignal`)
- [x] Performance benchmarks against native fetch (`npm run bench`)
- [x] Multipart form data and file uploads
- [x] Request/response interceptors
- [x] Download progress tracking
- [ ] Upload progress tracking: not possible on top of `fetch()`, which has no upload progress events
- [ ] WebSocket support
- Handled by the runtime, not by rust-fetch:
  - **Connection pooling:** browsers and Node.js pool connections for `fetch()` themselves.
  - **Proxies:** set them up in the runtime, e.g. with undici's `setGlobalDispatcher(new ProxyAgent(url))` in Node.js, or with system settings in browsers.
  - **HTTP/2:** browsers negotiate it automatically; in Node.js it depends on undici's dispatcher (`allowH2`).

## Upgrading to 2.0

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

## Development

The npm package is built from `wasm-module/` with [wasm-pack](https://rustwasm.github.io/wasm-pack/). The repository root is a private workspace.

```bash
npm run build      # wasm-pack build + package metadata (wasm-module/pkg)
npm test           # Rust unit + integration tests, then the JS tests
npm run test:js    # JS end-to-end tests against the built package (requires a build)
npm run bench      # rust-fetch vs native fetch (requires a build)

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
| Package tests | `wasm-module/js/test/package.test.mjs` | Installs the packed tarball and uses it via `import`, `require`, the browser entry and its types |

CI runs the Rust suites with a coverage gate that fails if line or function coverage of the Rust core drops below 100%. It also checks formatting, and runs the wasm and JS suites on Node 20, 22 and 24. The JS-only bindings in `src/wasm/` and `src/http.rs` need a JS engine, so they're covered by the wasm and JS suites instead.

Releases are published by CI when a version tag is pushed. See [CONTRIBUTING.md](CONTRIBUTING.md#releasing).

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development and release process, and [SECURITY.md](SECURITY.md) to report a vulnerability.
