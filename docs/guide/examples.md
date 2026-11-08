# Examples

Runnable examples, each a small script that is also tested in CI against local servers (or, for the Worker, on `workerd`, and for the browser page, in Chromium), so they track the API.

| Folder | Shows | Run it |
| --- | --- | --- |
| [`node-client/`](https://github.com/asemqaffaf/rust-fetch/tree/main/examples/node-client) | A production client for a JSON API: base URL, timeouts, retries, bearer auth, interceptors, idempotency keys, typed errors, metrics | `BASE_URL=https://api.example.com TOKEN=… npm run node-client` |
| [`llm-streaming/`](https://github.com/asemqaffaf/rust-fetch/tree/main/examples/llm-streaming) | Server-Sent Events from an OpenAI-compatible API, and NDJSON from Ollama | `BASE_URL=http://localhost:11434 npm run llm-streaming` |
| [`websocket-chat/`](https://github.com/asemqaffaf/rust-fetch/tree/main/examples/websocket-chat) | A WebSocket client that reconnects by itself and queues messages while away, a request/response helper (`request.mjs`) and channels that subscribe again after a reconnect (`channels.mjs`); Node.js 22+ | `URL=wss://chat.example.com/room npm run websocket-chat` |
| [`browser-upload/`](https://github.com/asemqaffaf/rust-fetch/tree/main/examples/browser-upload) | A Vite page that uploads a file with a progress bar and a cancel button, using `onUploadProgress`, an `AbortSignal` and typed errors | `npx vite` in that folder |
| [`cloudflare-worker/`](https://github.com/asemqaffaf/rust-fetch/tree/main/examples/cloudflare-worker) | A Worker in front of another API: the `.wasm` imported as a module and passed to `init()`, retries, a timeout, errors mapped to responses | `npx wrangler dev` in that folder |

From a clone, build the package first, then link it into the examples:

```sh
npm run build        # in the repository root
cd examples
npm install
```

In your own project, install the published package (`npm install rust-fetch`) and the imports in these files work unchanged.

## What the browser and Worker examples need

- **Browser upload:** your server needs `POST /upload` (multipart) and, on another origin, CORS that answers the `OPTIONS` preflight: a request with an upload progress listener is always preflighted. See [Uploads](/guide/uploads#upload-progress).
- **Cloudflare Worker:** Workers cannot fetch and compile code at run time, so the `.wasm` is imported as a module (`import wasm from 'rust-fetch/rust_fetch_bg.wasm'`) and passed to `init({ module_or_path: wasm })`. See [Compatibility](/compatibility).
- **WebSocket recipes:** request/response over a socket and channels that subscribe again after a reconnect are in the [WebSockets guide](/guide/websockets).
