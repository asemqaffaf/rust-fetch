# Compatibility and limitations

## Supported environments

| Environment | Status |
| --- | --- |
| Browsers, Web Workers and service workers | Supported, directly or through bundlers like Vite and webpack; call `init()` first. Tested in CI in Chromium, Firefox and WebKit (Safari's engine), on pages, in dedicated workers and in module service workers. [`fetch()` options](/guide/requests#browser-request-options) such as `credentials` and `cache` are passed through |
| Node.js 20, 22 and 24 | Supported and tested in CI; Node.js 20 is the minimum |
| TypeScript | Definitions included; TypeScript 5.2 or newer |
| Upload progress, WebSockets | JavaScript API only, from 2.2.0. WebSockets need a built-in `WebSocket`: browsers, Node.js 22+, or Node.js 20 with `--experimental-websocket`. Tested in CI on Node.js 22 and 24 |
| Rust | The same client as a Rust library ([usage](/rust#using-it-from-rust)), on tokio or in your own wasm crates |
| Native Node.js transport | In the repository, not yet in the npm package (no prebuilt binaries); build it with `npm run build:native`. Tested in CI on Linux with Node.js 20, 22 and 24, and run on macOS (Apple silicon); not tried on Windows |

## Limitations

- **Bundle size:** the WebAssembly module adds about 121 KB (brotli) to a browser bundle, plus 10 KB of JS glue.
- **HTTP/2:** browsers negotiate it automatically; both Node.js transports use HTTP/1.1 with keep-alive.
- **Proxies:** in Node.js, use the [`proxy` option](/guide/configuration#proxies) or `NODE_USE_ENV_PROXY=1`; a proxy agent installed as `http.globalAgent` / `https.globalAgent` (for example from `https-proxy-agent`) works too. In browsers, use the system settings.
- **Native transport:** has to be built from source for each platform until it's published. Sequential requests are level with the node:http transport (they were about 6% slower than `fetch()` before 2.4.0). It isn't used for streamed responses or requests with progress callbacks, and the p99 stall once seen in the independent harness no longer reproduces: p99 4.7 ms at a steady 15,000 requests per second (see [Under load](/performance#under-load-all-clients)).
- **WebSockets** use the runtime's own `WebSocket`: built into browsers and Node.js 22 and newer, and into Node.js 20 only with `--experimental-websocket` (without it, `websocket()` throws a `NetworkError`). In Node.js it doesn't go through `http.globalAgent` or the client's `proxy` option; pass an undici `ProxyAgent` as `dispatcher` to connect through a proxy:

  ```js
  import { ProxyAgent } from 'undici'; // npm install undici
  const socket = client.websocket('wss://stream.example.com/', { dispatcher: new ProxyAgent(process.env.HTTPS_PROXY) });
  ```
- **A V8 flag on Node.js 20 to 23:** importing rust-fetch turns off V8's `--turbo-inline-js-wasm-calls` for the process. With it on, V8 before 13 could abort the process ("Fatal error … unreachable code") when it deoptimized `client.get()` during its call into WebAssembly, as bursts of cancelled requests did. Throughput is unchanged; other WebAssembly in the process loses that one optimization too. Node.js 24 and newer are unaffected and keep it.
- **Upload progress** in browsers needs `XMLHttpRequest`, which makes cross-origin requests preflighted (see [Upload progress](/guide/uploads#upload-progress)).

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
- `Method::to_reqwest()` returns reqwest 0.13's `Method`.
- `RequestBuilder::header()` replaces a default header with the same name instead of adding a second value.

1.x keeps receiving critical fixes on the [`v1.x`](https://github.com/asemqaffaf/rust-fetch/tree/v1.x) branch (`npm install rust-fetch@1`).
