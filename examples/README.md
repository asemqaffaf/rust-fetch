# Examples

Runnable examples for rust-fetch. Each folder has an `index.mjs` that exports a `run()` function and also works as a script. CI runs all of them against local test servers (`wasm-module/js/test/examples.test.mjs`; the Worker runs on `workerd` in `wasm-module/js/test/runtimes/workers.mjs`), so they track the API.

| Folder | Shows | Run it |
| --- | --- | --- |
| [`node-client/`](node-client) | A production client for a JSON API: base URL, timeouts, retries, bearer auth, interceptors, idempotency keys, typed errors, metrics | `BASE_URL=https://api.example.com TOKEN=… npm run node-client` |
| [`llm-streaming/`](llm-streaming) | Server-Sent Events from an OpenAI-compatible API, and NDJSON from Ollama | `BASE_URL=http://localhost:11434 npm run llm-streaming` |
| [`websocket-chat/`](websocket-chat) | A WebSocket client that reconnects by itself and queues messages while away, a request/response helper (`request.mjs`) and channels that subscribe again after a reconnect (`channels.mjs`); Node.js 22+ | `URL=wss://chat.example.com/room npm run websocket-chat` |
| [`cloudflare-worker/`](cloudflare-worker) | A Worker in front of another API: the `.wasm` imported as a module and passed to `init()`, retries, a timeout, errors mapped to responses | `npx wrangler dev` in that folder |

```sh
cd examples
npm install        # links ../wasm-module/pkg; run `npm run build` in the repository root first
```

In your own project, install the published package instead: `npm install rust-fetch`, and the imports in these files work unchanged.

A browser example (a Vite app with an upload progress bar) is still to come ([#73](https://github.com/asemqaffaf/rust-fetch/issues/73)).
