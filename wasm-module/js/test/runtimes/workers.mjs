// rust-fetch on Cloudflare's Workers runtime (#48): the built browser entry runs inside `workerd`,
// the open-source runtime Workers use, with the module declared at build time as Workers require.
// Run `npm run build` first, then `node workers.mjs` here (the workerd binary comes from this
// directory's locked manifest). Outbound requests go to a second worker that plays the origin, so
// the test needs no network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../../../pkg/', import.meta.url));
const workerd = fileURLToPath(new URL('./node_modules/.bin/workerd', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'rust-fetch-workers-'));

const port = await new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

copyFileSync(join(pkg, 'rust_fetch.js'), join(dir, 'rust_fetch.js'));
copyFileSync(join(pkg, 'rust_fetch_bg.wasm'), join(dir, 'rust_fetch_bg.wasm'));

// The origin: what the client under test talks to
writeFileSync(join(dir, 'origin.mjs'), `
let flaky = 0;
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    switch (url.pathname) {
      case '/hello': return json({ hello: 'world' });
      case '/echo': return json({ method: request.method, body: await request.json(), type: request.headers.get('content-type') });
      case '/missing': return new Response('no such thing', { status: 404 });
      case '/flaky': return ++flaky < 3 ? new Response(null, { status: 503, headers: { 'retry-after': '0' } }) : json({ attempts: flaky });
      case '/sse': return new Response('data: {"n":1}\\n\\ndata: {"n":2}\\n\\ndata: [DONE]\\n\\n', { headers: { 'content-type': 'text/event-stream' } });
      default: return new Response('unexpected ' + url.pathname, { status: 500 });
    }
  },
};
`);

// The application: rust-fetch with the module passed to init(), as Workers need
writeFileSync(join(dir, 'app.mjs'), `
import init, { WasmClient, isHttpError } from './rust_fetch.js';
import wasmModule from './rust_fetch_bg.wasm';

export default {
  async fetch() {
    const out = {};
    try {
      await init({ module_or_path: wasmModule });
      const client = new WasmClient({ baseUrl: 'https://origin.test', retries: 3, retryDelayMs: 1, timeoutMs: 5000 });
      const get = await client.get('/hello');
      out.get = { status: get.status, body: get.body };
      const post = await client.post('/echo', { body: { n: 1 } });
      out.post = post.body;
      try { await client.get('/missing', { retries: 0 }); } catch (error) { out.missing = { http: isHttpError(error), status: error.status }; }
      out.flaky = (await client.get('/flaky')).body;
      const events = [];
      for await (const event of await client.events('/sse')) { if (event.data === '[DONE]') break; events.push(JSON.parse(event.data)); }
      out.events = events;
    } catch (error) {
      out.error = String(error?.kind ?? error) + ': ' + String(error?.message ?? error);
    }
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  },
};
`);

writeFileSync(join(dir, 'workerd.capnp'), `
using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "app", worker = (
      compatibilityDate = "2026-01-01",
      modules = [
        (name = "app.mjs", esModule = embed "app.mjs"),
        (name = "rust_fetch.js", esModule = embed "rust_fetch.js"),
        (name = "rust_fetch_bg.wasm", wasm = embed "rust_fetch_bg.wasm"),
      ],
      globalOutbound = "origin",
    )),
    (name = "origin", worker = (
      compatibilityDate = "2026-01-01",
      modules = [(name = "origin.mjs", esModule = embed "origin.mjs")],
    )),
  ],
  sockets = [(name = "http", address = "127.0.0.1:${port}", http = (), service = "app")],
);
`);

const child = spawn(workerd, ['serve', '--experimental', join(dir, 'workerd.capnp')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (chunk) => (log += chunk));
child.stderr.on('data', (chunk) => (log += chunk));

let code = 1;
try {
  let response;
  for (let attempt = 0; attempt < 100 && !response; attempt++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/`);
    } catch {
      if (child.exitCode !== null) throw new Error(`workerd exited early:\n${log}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(response, `workerd did not start:\n${log}`);
  const result = await response.json();
  console.log(JSON.stringify(result));
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.get, { status: 200, body: { hello: 'world' } });
  assert.deepEqual(result.post, { method: 'POST', body: { n: 1 }, type: 'application/json' });
  assert.deepEqual(result.missing, { http: true, status: 404 });
  assert.deepEqual(result.flaky, { attempts: 3 });
  assert.deepEqual(result.events, [{ n: 1 }, { n: 2 }]);
  console.log(`ok   rust-fetch on workerd ${(await new Promise((resolve) => { const v = spawn(workerd, ['--version']); let s = ''; v.stdout.on('data', (c) => (s += c)); v.on('close', () => resolve(s.trim())); })) || ''}`);
  code = 0;
} catch (error) {
  console.log(`FAIL\n${error?.stack ?? error}`);
} finally {
  child.kill();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
