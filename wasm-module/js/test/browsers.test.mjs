// The browser entry (pkg/rust_fetch.js) in real browsers: Chromium, Firefox
// and WebKit through Playwright, against local HTTP and WebSocket servers.
// A second origin (localhost against 127.0.0.1) covers cross-origin requests.
//
// Run `npm run build` first, then `npm run test:browsers`. Browsers come from
// `npx playwright install`; a browser that isn't installed is skipped.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { startWebSocketServer } from './helpers.mjs';

const { chromium, firefox, webkit } = await import('playwright');
const pkg = new URL('../../pkg/', import.meta.url);

const preflights = [];
const attempts = new Map();

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** Routes shared by both origins; `cors` adds the headers a cross-origin page needs */
function handler(cors) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const headers = cors ? { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-trace' } : {};
    if (req.method === 'OPTIONS') {
      preflights.push(url.pathname);
      res.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET, POST, PUT', 'access-control-allow-headers': 'content-type, x-trace' });
      return res.end();
    }
    if (url.pathname === '/slow-read') {
      // Read slowly so the browser's upload takes long enough to report progress
      let length = 0;
      req.on('data', (c) => {
        length += c.length;
        req.pause();
        setTimeout(() => req.resume(), 15);
      });
      req.on('end', () => {
        res.writeHead(200, { ...headers, 'content-type': 'application/json' });
        res.end(JSON.stringify({ length }));
      });
      return;
    }
    const body = await readBody(req);
    switch (url.pathname) {
      case '/':
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<!doctype html><title>rust-fetch browser tests</title>');
      case '/worker.js':
      case '/sw.js':
        res.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' });
        return res.end(workerSource(url.pathname === '/sw.js'));
      case '/rust_fetch.js':
      case '/rust_fetch_bg.wasm':
        res.writeHead(200, { 'content-type': url.pathname.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
        return res.end(readFileSync(new URL(url.pathname.slice(1), pkg)));
      case '/echo': {
        const json = JSON.stringify({ method: req.method, length: body.length, type: req.headers['content-type'] ?? null, trace: req.headers['x-trace'] ?? null });
        res.writeHead(200, { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(json), 'x-trace': 'abc' });
        return res.end(json);
      }
      case '/moved':
        res.writeHead(302, { ...headers, location: '/echo', 'content-type': 'text/plain' });
        return res.end('see /echo');
      case '/status': {
        const code = Number(url.searchParams.get('code'));
        res.writeHead(code, { ...headers, 'content-type': 'text/plain' });
        return res.end(`status ${code}`);
      }
      case '/flaky': {
        // 429 with Retry-After: 0 on the first attempt for each id
        const id = url.searchParams.get('id');
        const n = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, n);
        if (n === 1) {
          res.writeHead(429, { ...headers, 'retry-after': '0', 'content-type': 'text/plain' });
          return res.end('slow down');
        }
        res.writeHead(200, { ...headers, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ attempts: n }));
      }
      case '/slow':
        await new Promise((r) => setTimeout(r, 3000));
        res.writeHead(200, { ...headers, 'content-type': 'application/json' });
        return res.end('{}');
      case '/stream':
        res.writeHead(200, { ...headers, 'content-type': 'text/plain' });
        res.write('first,');
        await new Promise((r) => setTimeout(r, 100));
        return res.end('second');
      case '/sse':
        res.writeHead(200, { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write('event: greeting\ndata: hello\nid: 1\n\n');
        res.write('data: {"token":"Hi"}\n\n');
        return res.end();
      case '/sse-json':
        res.writeHead(200, { ...headers, 'content-type': 'text/event-stream' });
        res.write('data: {"token":"Hi"}\n\ndata: {"token":"!"}\n\ndata: [DONE]\n\n');
        return res.end();
      case '/ndjson':
        res.writeHead(200, { ...headers, 'content-type': 'application/x-ndjson' });
        res.write('{"n":1}\n{"n"');
        await new Promise((r) => setTimeout(r, 20));
        return res.end(':2}\n');
      case '/large': {
        const size = 2 * 1024 * 1024;
        res.writeHead(200, { ...headers, 'content-type': 'application/octet-stream', 'content-length': size });
        return res.end(Buffer.alloc(size, 7));
      }
      default:
        res.writeHead(404, { ...headers, 'content-type': 'text/plain' });
        return res.end('not found');
    }
  };
}

/**
 * A module worker (dedicated or service) that runs rust-fetch and posts back
 * what happened. Service workers have no XMLHttpRequest, so upload progress
 * falls back to fetch() and reports once.
 */
function workerSource(service) {
  return `
import init, { WasmClient } from '/rust_fetch.js';

async function run({ origin, wsBase }) {
  const out = { hasXhr: typeof XMLHttpRequest === 'function' };
  try {
    await init();
    const client = new WasmClient({ baseUrl: origin });
    out.json = (await client.post('/echo', { body: { a: 1 } })).body;
    try {
      await client.get('/status?code=500');
    } catch (error) {
      out.error = error.kind;
    }
    const uploads = [];
    await client.put('/echo', { body: new Uint8Array(100000), onUploadProgress: (p) => uploads.push(p) });
    out.uploads = { count: uploads.length, last: uploads.at(-1) };
    const events = [];
    const stream = client.events('/sse', { reconnect: false, onEvent: (e) => events.push(e.data) });
    await stream.closed;
    out.sse = events;
    const socket = new WasmClient({ baseUrl: wsBase }).websocket('/worker');
    await socket.opened;
    socket.close();
    out.ws = (await socket.closed).code;
  } catch (error) {
    out.failure = String(error);
  }
  return out;
}
${service
    ? `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => event.waitUntil(run(event.data).then((out) => event.ports[0].postMessage(out))));`
    : `self.onmessage = async (event) => self.postMessage(await run(event.data));`}
`;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const pageServer = http.createServer(handler(false));
const crossServer = http.createServer(handler(true));
let origin;
let crossOrigin;
let ws;

before(async () => {
  origin = `http://127.0.0.1:${await listen(pageServer)}`;
  crossOrigin = `http://localhost:${await listen(crossServer)}`;
  ws = await startWebSocketServer((peer, req) => {
    if (req.url.includes('/drop')) setTimeout(() => peer.drop(), 50);
    peer.onmessage = (message) => peer.send(message);
  });
});

after(async () => {
  pageServer.close();
  crossServer.close();
  await ws.close();
});

/** Run `fn(rustFetch, config)` in the page, after loading and initializing the browser entry */
function inPage(page, fn) {
  return page.evaluate(
    async ({ source, config }) => {
      const module = await import('/rust_fetch.js');
      await module.default();
      // eslint-disable-next-line no-new-func
      return new Function('rf', 'config', `return (${source})(rf, config);`)(module, config);
    },
    { source: fn.toString(), config: { origin, crossOrigin, wsBase: `http://127.0.0.1:${ws.port}` } },
  );
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  let browser;
  let page;
  let available = true;
  try {
    // Probe: an engine whose browser isn't installed is skipped
    readFileSync(engine.executablePath());
  } catch {
    available = false;
  }

  describe(name, { skip: !available && `${name} isn't installed (npx playwright install ${name})`, timeout: 120_000 }, () => {
    before(async () => {
      browser = await engine.launch();
      page = await browser.newPage();
      await page.goto(`${origin}/`);
    });
    after(() => browser?.close());

    it('makes requests and rejects with typed errors', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin }) => {
        const client = new WasmClient({ baseUrl: origin });
        const ok = await client.post('/echo', { body: { a: 1 }, headers: { 'x-trace': 't1' } });
        const errors = {};
        for (const [key, run] of Object.entries({
          http: () => client.get('/status?code=404'),
          network: () => client.get('http://127.0.0.1:1/'),
          invalid: () => client.get('ftp://example.com/'),
        })) {
          try {
            await run();
          } catch (error) {
            errors[key] = { kind: error.kind, status: error.status, body: error.body, parameter: error.parameter, isError: error instanceof Error };
          }
        }
        return { status: ok.status, statusText: ok.statusText, body: ok.body, trace: ok.headers['x-trace'], errors };
      });
      assert.equal(result.status, 200);
      assert.equal(result.statusText, 'OK');
      assert.deepEqual(result.body, { method: 'POST', length: 7, type: 'application/json', trace: 't1' });
      assert.equal(result.trace, 'abc');
      assert.deepEqual(result.errors.http, { kind: 'HttpError', status: 404, body: 'status 404', parameter: undefined, isError: true });
      assert.equal(result.errors.network.kind, 'NetworkError');
      assert.equal(result.errors.invalid.kind, 'InvalidInputError');
      assert.equal(result.errors.invalid.parameter, 'url');
    });

    it('follows, returns or rejects redirects', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin }) => {
        const client = new WasmClient({ baseUrl: origin });
        const followed = await client.get('/moved');
        const manual = await client.get('/moved', { redirect: 'manual' });
        const streamed = await client.get('/moved', { redirect: 'manual', responseType: 'stream' });
        const out = { followed: { url: followed.url, method: followed.body.method } };
        out.streamed = { status: streamed.status, text: await new Response(streamed.body).text() };
        out.manual = { status: manual.status, ok: manual.ok, headers: manual.headers, body: manual.body, url: manual.url };
        for (const options of [{ redirect: 'error' }, { maxRedirects: 0 }]) {
          try {
            await client.get('/moved', options);
          } catch (error) {
            (out.errors ??= []).push({ kind: error.kind, message: error.message });
          }
        }
        return out;
      });
      assert.deepEqual(result.followed, { url: `${origin}/echo`, method: 'GET' });
      // Browsers hide the redirect: an opaque response with status 0 and no headers
      assert.deepEqual(result.manual, { status: 0, ok: false, headers: {}, body: null, url: `${origin}/moved` });
      assert.deepEqual(result.streamed, { status: 0, text: '' });
      assert.deepEqual(result.errors, [
        { kind: 'NetworkError', message: 'Network error: Redirect not allowed' },
        { kind: 'NetworkError', message: 'Network error: Redirect not allowed' },
      ]);
    });

    it('enforces timeouts, retries with Retry-After, and cancels', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin }) => {
        const out = {};
        try {
          await new WasmClient({ baseUrl: origin, timeoutMs: 200 }).get('/slow');
        } catch (error) {
          out.timeout = { kind: error.kind, timeoutMs: error.timeoutMs };
        }
        const retried = await new WasmClient({ baseUrl: origin, retries: { maxRetries: 2, initialDelayMs: 5000 } }).get(`/flaky?id=${crypto.randomUUID()}`);
        out.retried = retried.body;
        const controller = new AbortController();
        const pending = new WasmClient({ baseUrl: origin }).get('/slow', { signal: controller.signal });
        setTimeout(() => controller.abort(), 50);
        try {
          await pending;
        } catch (error) {
          out.cancelled = error.kind;
        }
        return out;
      });
      assert.deepEqual(result.timeout, { kind: 'TimeoutError', timeoutMs: 200 });
      assert.deepEqual(result.retried, { attempts: 2 }); // Retry-After: 0 overrode the 5 s backoff
      assert.equal(result.cancelled, 'CancelledError');
    });

    it('streams responses and reports download progress', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin }) => {
        const client = new WasmClient({ baseUrl: origin });
        const streamed = await client.get('/stream', { responseType: 'stream' });
        const reader = streamed.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
        const events = [];
        const large = await client.get('/large', { onDownloadProgress: (p) => events.push(p) });
        return { text, length: large.body.length, events: events.length, last: events.at(-1) };
      });
      assert.equal(result.text, 'first,second');
      assert.equal(result.length, 2 * 1024 * 1024);
      assert.ok(result.events >= 1);
      assert.deepEqual(result.last, { loaded: 2 * 1024 * 1024, total: 2 * 1024 * 1024 });
    });

    it('reports upload progress through XMLHttpRequest, cross-origin with a preflight', async () => {
      const before = preflights.length;
      const result = await inPage(page, async ({ WasmClient }, { origin, crossOrigin }) => {
        const size = 8 * 1024 * 1024;
        const uploads = [];
        const slow = await new WasmClient({ baseUrl: origin }).put('/slow-read', {
          body: new Uint8Array(size),
          timeoutMs: 0,
          onUploadProgress: (p) => uploads.push(p),
        });
        const form = new FormData();
        form.append('file', new File([new Uint8Array(100_000)], 'a.bin'));
        const crossEvents = [];
        const cross = await new WasmClient({ baseUrl: crossOrigin }).post('/echo', { body: form, onUploadProgress: (p) => crossEvents.push(p) });
        return {
          size,
          slow: slow.body,
          count: uploads.length,
          increasing: uploads.every((e, i) => i === 0 || e.loaded >= uploads[i - 1].loaded),
          last: uploads.at(-1),
          cross: cross.body,
          crossLast: crossEvents.at(-1),
        };
      });
      assert.equal(result.slow.length, result.size);
      assert.ok(result.count > 1, `expected several progress events, got ${result.count}`);
      assert.ok(result.increasing);
      assert.deepEqual(result.last, { loaded: result.size, total: result.size });
      assert.match(result.cross.type, /^multipart\/form-data; boundary=/);
      assert.equal(result.crossLast.loaded, result.crossLast.total);
      assert.ok(preflights.length > before, 'the cross-origin upload was preflighted');
    });

    it('reads Server-Sent Events and newline-delimited JSON', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin, crossOrigin }) => {
        const client = new WasmClient({ baseUrl: origin });
        const raw = [];
        const first = client.events('/sse', { reconnect: false, onEvent: (e) => raw.push(e) });
        await first.closed;

        // A streaming-API style request: POST, JSON data, ends at [DONE]
        let text = '';
        const stream = new WasmClient({ baseUrl: crossOrigin }).events('/sse-json', { method: 'POST', body: { prompt: 'hi' }, messageType: 'json' });
        const reader = { next: () => stream.next() };
        for (;;) {
          const { value, done } = await reader.next();
          if (done) break;
          if (value.event === 'message') text += value.data.token;
        }

        const res = await client.get('/ndjson', { responseType: 'ndjson' });
        const values = [];
        const r = res.body.getReader();
        for (;;) {
          const { value, done } = await r.read();
          if (done) break;
          values.push(value);
        }
        return { raw: raw.slice(0, 2), text, values };
      });
      assert.deepEqual(result.raw, [
        { event: 'greeting', data: 'hello', id: '1' },
        { event: 'message', data: '{"token":"Hi"}', id: '1' },
      ]);
      assert.equal(result.text, 'Hi!');
      assert.deepEqual(result.values, [{ n: 1 }, { n: 2 }]);
    });

    it('works in a dedicated Web Worker', async () => {
      const result = await page.evaluate(async (config) => {
        const worker = new Worker('/worker.js', { type: 'module' });
        const out = await new Promise((resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage(config);
        });
        worker.terminate();
        return out;
      }, { origin, wsBase: `http://127.0.0.1:${ws.port}` });
      assert.equal(result.failure, undefined);
      assert.equal(result.hasXhr, true);
      assert.deepEqual(result.json, { method: 'POST', length: 7, type: 'application/json', trace: null });
      assert.equal(result.error, 'HttpError');
      assert.ok(result.uploads.count >= 1);
      assert.deepEqual(result.uploads.last, { loaded: 100000, total: 100000 });
      assert.deepEqual(result.sse, ['hello', '{"token":"Hi"}']);
      assert.equal(result.ws, 1000);
    });

    it('works in a service worker, where upload progress falls back to fetch()', async (t) => {
      const result = await page.evaluate(async (config) => {
        if (!('serviceWorker' in navigator)) return { unsupported: 'no navigator.serviceWorker' };
        let registration;
        try {
          registration = await navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' });
        } catch (error) {
          return { unsupported: String(error) };
        }
        await navigator.serviceWorker.ready;
        const worker = registration.active;
        const channel = new MessageChannel();
        const out = await new Promise((resolve) => {
          channel.port1.onmessage = (event) => resolve(event.data);
          worker.postMessage(config, [channel.port2]);
        });
        await registration.unregister();
        return out;
      }, { origin, wsBase: `http://127.0.0.1:${ws.port}` });
      if (result.unsupported) return t.skip(`module service workers unavailable: ${result.unsupported}`);
      assert.equal(result.failure, undefined);
      assert.equal(result.hasXhr, false);
      assert.deepEqual(result.json, { method: 'POST', length: 7, type: 'application/json', trace: null });
      assert.equal(result.error, 'HttpError');
      assert.deepEqual(result.uploads, { count: 1, last: { loaded: 100000, total: 100000 } });
      assert.deepEqual(result.sse, ['hello', '{"token":"Hi"}']);
      assert.equal(result.ws, 1000);
    });

    it('opens WebSockets, exchanges messages, reconnects and closes', async () => {
      const result = await inPage(page, async ({ WasmClient }, { wsBase }) => {
        const client = new WasmClient({ baseUrl: `${wsBase}/v1` });
        const messages = [];
        const socket = client.websocket('/live', { params: { room: 'blue' }, messageType: 'json', onMessage: (m) => messages.push(m) });
        const url = socket.url;
        await socket.opened;
        socket.sendJson({ hello: 'world' });
        socket.send(new Uint8Array([1, 2, 3]));
        await new Promise((r) => setTimeout(r, 200));
        socket.close(1000, 'bye');
        const closed = await socket.closed;

        let headers;
        try {
          client.websocket('/live', { headers: { authorization: 'x' } });
        } catch (error) {
          headers = { kind: error.kind, parameter: error.parameter };
        }

        let opens = 0;
        const reconnecting = client.websocket('/drop', { reconnect: { initialDelayMs: 10 }, onOpen: () => opens++ });
        while (opens < 2) await new Promise((r) => setTimeout(r, 20));
        reconnecting.close();
        await reconnecting.closed;

        let refused;
        try {
          await new WasmClient().websocket('ws://127.0.0.1:1/', { timeoutMs: 3000 }).opened;
        } catch (error) {
          refused = error.kind;
        }
        return { url, messages: messages.map((m) => (m instanceof Uint8Array ? [...m] : m)), closed, headers, opens, refused };
      });
      assert.equal(result.url, `ws://127.0.0.1:${ws.port}/v1/live?room=blue`);
      assert.deepEqual(result.messages, [{ hello: 'world' }, [1, 2, 3]]);
      assert.deepEqual(result.closed, { code: 1000, reason: 'bye', wasClean: true });
      assert.deepEqual(result.headers, { kind: 'InvalidInputError', parameter: 'headers' });
      assert.ok(result.opens >= 2);
      assert.equal(result.refused, 'NetworkError');
    });
  });
}
