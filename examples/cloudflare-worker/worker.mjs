// rust-fetch in a Cloudflare Worker: a small API in front of another API, with retries, a timeout
// and typed errors. Workers need the WebAssembly module declared at build time, so it is imported
// and passed to init(). Tested in CI on `workerd`, the runtime Workers run on (workers.mjs).
import init, { WasmClient, isHttpError, isTimeoutError } from 'rust-fetch/rust_fetch.js';
import wasm from 'rust-fetch/rust_fetch_bg.wasm';

let client;
async function api() {
  // Once per isolate: init() compiles the module, the client keeps its settings
  if (!client) {
    await init({ module_or_path: wasm });
    client = new WasmClient({ baseUrl: 'https://api.example.com', retries: 2, retryDelayMs: 20, timeoutMs: 3000 });
  }
  return client;
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request) {
    const match = /^\/users\/([\w-]+)$/.exec(new URL(request.url).pathname);
    if (!match) return json({ error: 'not found' }, 404);
    try {
      const user = await (await api()).get(`/users/${match[1]}`);
      return json(user.body);
    } catch (error) {
      if (isHttpError(error)) return json({ error: `upstream answered ${error.status}` }, error.status === 404 ? 404 : 502);
      if (isTimeoutError(error)) return json({ error: 'upstream timed out' }, 504);
      return json({ error: 'upstream unreachable' }, 502);
    }
  },
};
