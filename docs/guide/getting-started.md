# Getting started

```bash
npm install rust-fetch
```

**Node.js** (20 or newer): the WebAssembly module loads on import.

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

`init()` is safe to call more than once, and calling it in Node.js is harmless, so shared code can always call it. Serve the `.wasm` file with `Content-Type: application/wasm`, so the browser compiles it while it downloads, and consider preloading it (see [Startup](/performance#startup)).

**A client set up for production**, with a base URL, timeouts, retries and error handling:

```js
import { WasmClient } from 'rust-fetch';

const api = new WasmClient({
  baseUrl: 'https://api.example.com/v1',
  timeoutMs: 10_000, // per attempt, including reading the body
  retries: 3,        // exponential backoff with jitter; honours Retry-After
});

try {
  const { body: user } = await api.get('/users/42');
} catch (error) {
  if (error.kind === 'HttpError' && error.status === 404) {
    // not found: error.body has the response text
  } else if (error.kind === 'TimeoutError') {
    // the last attempt took over 10 s, with no retries left
  } else {
    throw error;
  }
}
```

> **Release status**
> - **On npm (2.5.2):** everything in these docs, including the [security options](/security#security) (SSRF protection, response size limits, `allowAbsoluteUrls`), [redirect control](/guide/requests#redirects), [browser `fetch()` options](/guide/requests#browser-request-options), [proxies in Node.js](/guide/configuration#proxies), [Server-Sent Events](/guide/streaming#server-sent-events), newline-delimited JSON, [upload progress](/guide/uploads#upload-progress) and [WebSockets](/guide/websockets#websockets), except what's listed below. Node.js requests use a `node:http` transport with a bounded connection pool; browsers use `fetch()`.
> - **In the repository, not yet in the npm package:** the [native Node.js transport](/performance#the-native-transport-not-in-the-npm-package-yet) behind the largest performance gains below. The package doesn't include its prebuilt binaries yet; build it with `npm run build:native`.
