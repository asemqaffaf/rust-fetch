# Architecture

Everything that decides what happens to a request (URL handling, validation, retries and backoff, per-attempt timeouts, typed errors, interceptors) is Rust compiled to WebAssembly, so it behaves the same in every runtime. Underneath, a transport only moves bytes:

| Transport | Where | In the npm package |
| --- | --- | --- |
| The platform's `fetch()` | Browsers and Web Workers | Yes |
| `XMLHttpRequest` | Browsers, for upload progress | Yes |
| `node:http` / `node:https` with keep-alive | Node.js | Yes |
| The runtime's `WebSocket`, with the connection policy (URL, timeout, reconnection, errors) in Rust | WebSockets, everywhere | Yes |
| Native addon: HTTP/1.1 on [hyper](https://hyper.rs) and Tokio threads, loaded through Node-API, with the same redirect, decompression, timeout and connection-limit rules and Node's TLS defaults (Mozilla root certificates, `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED`, with Node's warning when that turns verification off) | Node.js | Not yet: build it with `npm run build:native` |

Each transport's own behaviour (redirects, decompression, limits, cancellation, errors, streaming, the security checks) is held to the same results by a conformance suite: the same 69 behaviours run on node:http, the native addon, `fetch()` in Node.js, Chromium, Firefox and WebKit, and CI fails on any difference that isn't documented. The results, and the documented differences, are in [CONFORMANCE.md](/conformance).

**Which transport a request uses:**

| Request | Browsers | Node.js |
| --- | --- | --- |
| Most requests | `fetch()` | The native transport where it's built and Node's global agents are untouched; otherwise `node:http` |
| With `onUploadProgress` (with or without `onDownloadProgress`) | `XMLHttpRequest`, or `fetch()` where there's none | `node:http` |
| With `onDownloadProgress` only, `responseType: 'stream'` or `'ndjson'`, and `client.events()` | `fetch()` | `node:http` (since 2.4.0; it was Node's `fetch()` before) |
| With the `proxy` option, or `allowPrivateNetwork: false` | `fetch()` (both are Node.js options) | `node:http` |

**What the native transport changes.** Connection handling, TLS, HTTP parsing and decompression move from the JavaScript event loop to Tokio threads; JavaScript only builds requests and decodes their bodies. That's why it gains most with many requests in flight, and why the hand-off between threads likely contributes to its slower sequential results ([measurements](/performance#the-native-transport-not-in-the-npm-package-yet)).

**When it's used.** The native transport is used when `rust-fetch-native.<platform>-<arch>.node` sits next to the package's `node.js` (`npm run build:native` puts it there). It steps aside for the requests in the table above, and for every request where you have installed your own `http.globalAgent` / `https.globalAgent` (for example a proxy agent) or set `NODE_USE_ENV_PROXY`; `RUST_FETCH_NATIVE=0` turns it off.

## Connection pooling

Browsers pool connections for `fetch()`. In Node.js, both transports keep up to 256 keep-alive connections per origin and queue further requests until one is free, so bursts reuse connections instead of exhausting local ports. If you install your own `http.globalAgent` / `https.globalAgent`, or set limits on Node's, that agent is used instead.
