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
const idempotencyKeys = new Map();
const deadlineClosed = new Set();

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
    // The exact origin, so credentialed requests are allowed too
    const headers = cors
      ? { 'access-control-allow-origin': req.headers.origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-expose-headers': 'x-trace' }
      : {};
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
      case '/cookie':
        res.writeHead(200, { ...headers, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ cookie: req.headers.cookie ?? null, length: body.length }));
      case '/cached': {
        // Cacheable for a minute; the count (per id) shows when the browser asked again
        const id = `cached:${url.searchParams.get('id')}`;
        attempts.set(id, (attempts.get(id) ?? 0) + 1);
        res.writeHead(200, { ...headers, 'content-type': 'application/json', 'cache-control': 'max-age=60' });
        return res.end(JSON.stringify({ hits: attempts.get(id) }));
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
        const keys = idempotencyKeys.get(id) ?? [];
        keys.push(req.headers[url.searchParams.get('keyHeader') ?? 'idempotency-key'] ?? null);
        idempotencyKeys.set(id, keys);
        if (n <= Number(url.searchParams.get('failures') ?? 1)) {
          res.writeHead(Number(url.searchParams.get('status') ?? 429), { ...headers, 'retry-after': '0', 'content-type': 'text/plain' });
          return res.end('slow down');
        }
        res.writeHead(200, { ...headers, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ attempts: n, ...(url.searchParams.has('keys') ? { keys } : {}) }));
      }
      case '/slow':
        await new Promise((r) => setTimeout(r, 3000));
        res.writeHead(200, { ...headers, 'content-type': 'application/json' });
        return res.end('{}');
      case '/deadline-hold':
        res.writeHead(200, { ...headers, 'content-type': 'text/plain' });
        res.write('first');
        res.once('close', () => deadlineClosed.add(url.searchParams.get('id')));
        return;
      case '/deadline-check':
        res.writeHead(200, { ...headers, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ closed: deadlineClosed.has(url.searchParams.get('id')) }));
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
// Another port on the page's host: cross-origin but same-site, so cookies
// follow `credentials` without SameSite rules getting in the way
const siblingServer = http.createServer(handler(true));
let origin;
let crossOrigin;
let siblingOrigin;
let ws;

before(async () => {
  origin = `http://127.0.0.1:${await listen(pageServer)}`;
  crossOrigin = `http://localhost:${await listen(crossServer)}`;
  siblingOrigin = `http://127.0.0.1:${await listen(siblingServer)}`;
  ws = await startWebSocketServer((peer, req) => {
    if (req.url.includes('/drop')) setTimeout(() => peer.drop(), 50);
    peer.onmessage = (message) => peer.send(message);
  });
});

after(async () => {
  pageServer.close();
  crossServer.close();
  siblingServer.close();
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
    { source: fn.toString(), config: { origin, crossOrigin, siblingOrigin, wsBase: `http://127.0.0.1:${ws.port}` } },
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

    it('applies credentials, mode, cache and keepalive', async () => {
      await page.context().addCookies([{ name: 'session', value: 'abc', url: origin }]);
      const result = await inPage(page, async ({ WasmClient }, { origin, siblingOrigin }) => {
        const cookie = async (client, url, options) => (await client.get(url, options)).body.cookie;
        const page = new WasmClient({ baseUrl: origin });
        const sibling = new WasmClient({ baseUrl: siblingOrigin });
        const out = {
          sameOrigin: await cookie(page, '/cookie'),
          omitted: await cookie(page, '/cookie', { credentials: 'omit' }),
          crossOrigin: await cookie(sibling, '/cookie'),
          included: await cookie(sibling, '/cookie', { credentials: 'include' }),
          clientDefault: await cookie(new WasmClient({ baseUrl: siblingOrigin, credentials: 'include' }), '/cookie'),
        };
        // XMLHttpRequest (upload progress) sends them with withCredentials
        const uploads = [];
        const xhr = await sibling.post('/cookie', { body: new Uint8Array(1000), credentials: 'include', onUploadProgress: (p) => uploads.push(p) });
        out.xhr = { cookie: xhr.body.cookie, uploaded: uploads.at(-1)?.loaded };
        const events = [];
        const stream = sibling.events('/sse', { credentials: 'include', reconnect: false, onEvent: (e) => events.push(e.data) });
        await stream.closed;
        out.sse = events.length;
        const opaque = await sibling.get('/echo', { mode: 'no-cors' });
        out.opaque = { status: opaque.status, ok: opaque.ok, headers: opaque.headers, body: opaque.body };
        out.cached = [];
        const cachedUrl = `/cached?id=${crypto.randomUUID()}`;
        for (const cache of ['default', 'default', 'no-store']) out.cached.push((await page.get(cachedUrl, { cache })).body.hits);
        out.keepalive = (await page.post('/cookie', { body: 'beacon', keepalive: true })).body.length;
        return out;
      });
      assert.equal(result.sameOrigin, 'session=abc');
      assert.equal(result.omitted, null);
      assert.equal(result.crossOrigin, null);
      assert.equal(result.included, 'session=abc');
      assert.equal(result.clientDefault, 'session=abc');
      assert.deepEqual(result.xhr, { cookie: 'session=abc', uploaded: 1000 });
      assert.equal(result.sse, 2);
      assert.deepEqual(result.opaque, { status: 0, ok: false, headers: {}, body: null });
      // 'no-store' always goes to the server. Chromium and Firefox serve the
      // second request from their HTTP cache; Playwright's WebKit doesn't cache it.
      assert.equal(result.cached[2], result.cached[1] + 1, String(result.cached));
      if (name !== 'webkit') assert.deepEqual(result.cached, [1, 1, 2]);
      assert.equal(result.keepalive, 6);
    });

    it('limits response bodies with maxResponseBytes', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin }) => {
        const client = new WasmClient({ baseUrl: origin, maxResponseBytes: 1000 });
        const kinds = {};
        const describe = (e) => `${e.kind} ${e.maxResponseBytes}`;
        kinds.declared = await client.get('/large').then(() => 'OK', describe);
        const streamed = await client.get('/large', { responseType: 'stream' });
        // Read directly: Response#arrayBuffer() replaces a stream's error with its own TypeError
        const reader = streamed.body.getReader();
        kinds.streamed = await (async () => {
          for (;;) if ((await reader.read()).done) return 'OK';
        })().catch(describe);
        // Chunked, without a Content-Length: counted as it arrives
        kinds.chunked = await client.get('/stream', { maxResponseBytes: 5 }).then(() => 'OK', describe);
        kinds.unlimited = (await client.get('/large', { maxResponseBytes: null })).body.length;
        return kinds;
      });
      assert.deepEqual(result, { declared: 'NetworkError 1000', streamed: 'NetworkError 1000', chunked: 'NetworkError 5', unlimited: 2 * 1024 * 1024 });
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

    it('enforces header, idle and body deadlines while ignoring unobservable connect timing', async () => {
      const out = await inPage(page, async ({ WasmClient }, { origin }) => {
        const c = new WasmClient({ baseUrl: origin });
        const failure = async (promise) => { try { await promise; return null; } catch (e) { return [e.kind ?? String(e), e.phase, e.timeoutMs]; } };
        const response = await failure(c.get('/slow', { responseTimeoutMs: 25 }));
        const idle = await failure(c.get('/stream', { idleTimeoutMs: 25 }));
        const id = `${Date.now()}-${Math.random()}`;
        const streamed = await c.get(`/deadline-hold?id=${id}`, { responseType: 'stream', deadlineMs: 40 });
        await new Promise((r) => setTimeout(r, 80));
        let cancelled = false;
        for (let i = 0; i < 100 && !cancelled; i++) {
          cancelled = (await c.get(`/deadline-check?id=${id}`)).body.closed;
          if (!cancelled) await new Promise((r) => setTimeout(r, 10));
        }
        const deadline = await failure((async () => { const reader = streamed.body.getReader(); while (!(await reader.read()).done) {} })());
        const ignored = (await c.get('/echo', { connectTimeoutMs: 0.001 })).status;
        let xhrCount = 0;
        const Original = globalThis.XMLHttpRequest;
        globalThis.XMLHttpRequest = class extends Original { constructor() { super(); xhrCount++; } };
        const uploads = [];
        try { await c.put('/echo', { body: new Uint8Array(32), responseTimeoutMs: 1000, idleTimeoutMs: 1000, onUploadProgress: (p) => uploads.push(p.loaded) }); }
        finally { globalThis.XMLHttpRequest = Original; }
        return { response, idle, deadline, cancelled, ignored, xhrCount, uploads };
      });
      assert.deepEqual(out, { response: ['TimeoutError', 'response', 25], idle: ['TimeoutError', 'idle', 25], deadline: ['TimeoutError', 'total', 40], cancelled: true, ignored: 200, xhrCount: 0, uploads: [32] });
    });

    it('ends the SSE reconnect delay at the original logical deadline', async () => {
      const out = await inPage(page, async ({ WasmClient }, { origin }) => {
        const errors = [];
        const stream = new WasmClient({ baseUrl: origin }).events('/sse', { deadlineMs: 60, reconnect: { initialDelayMs: 1000, jitter: false }, onError: (e) => errors.push([e.kind, e.phase, e.timeoutMs]) });
        await stream.opened;
        await stream.closed;
        return errors.at(-1);
      });
      assert.deepEqual(out, ['TimeoutError', 'total', 60]);
    });

    it('replaces retry policies per request, including streaming, uploads and SSE', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin }) => {
        const c = new WasmClient({ baseUrl: origin, retries: { maxRetries: 1, initialDelayMs: 0 } });
        const path = () => `/flaky?id=${crypto.randomUUID()}`;
        const disabledPath = path();
        const disabled = await c.get(disabledPath, { retries: 0 }).catch((e) => e.kind);
        const afterDisabled = (await c.get(disabledPath)).body.attempts;
        const inherited = (await c.get(path())).body.attempts;
        const enabled = (await new WasmClient({ baseUrl: origin }).get(path(), { retries: 1 })).body.attempts;
        const custom = new WasmClient({ baseUrl: origin, retries: { maxRetries: 0, retryOn: [409], retryNonIdempotent: true } });
        const defaults = (await custom.get(`${path()}&failures=3`, { retries: {} })).body.attempts;
        const post = await custom.post(path(), { body: 'x', retries: {} }).catch((e) => e.kind);
        const upload = (await custom.post(path(), {
          body: 'x', onUploadProgress() {}, retries: { maxRetries: 1, retryNonIdempotent: true },
        })).body.attempts;
        const stream = await custom.get(path(), { responseType: 'stream', retries: 1 });
        const streamed = (await new Response(stream.body).json()).attempts;
        const events = c.events('/status?code=503', { retries: 0, reconnect: false });
        const sse = await events.opened.catch((e) => e.kind);
        await events.closed;
        const invalid = await c.get(path(), { retries: -1 }).catch((e) => [e.kind, e.parameter]);
        return { disabled, afterDisabled, inherited, enabled, defaults, post, upload, streamed, sse, invalid };
      });
      assert.deepEqual(result, {
        disabled: 'HttpError', afterDisabled: 2, inherited: 2, enabled: 2, defaults: 4,
        post: 'HttpError', upload: 2, streamed: 2, sse: 'HttpError', invalid: ['InvalidInputError', 'retries'],
      });
    });

    it('reuses generated and explicit idempotency keys on POST/PATCH retries', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin }) => {
        const c = new WasmClient({ baseUrl: origin, retries: { maxRetries: 1, initialDelayMs: 0 }, idempotencyKey: true });
        const path = () => `/flaky?keys&id=${crypto.randomUUID()}`;
        const post = (await c.post(path(), { body: 'x' })).body.keys;
        const patch = (await c.patch(path(), { body: 'y' })).body.keys;
        const custom = (await c.post(`${path()}&keyHeader=x-key`, { idempotencyKey: 'order-42', idempotencyHeader: 'X-Key' })).body.keys;
        const upload = (await c.post(path(), { body: 'z', onUploadProgress() {} })).body.keys;
        const streamed = await c.post(path(), { body: 's', responseType: 'stream' });
        const stream = (await new Response(streamed.body).json()).keys;
        const disabled = await c.post(path(), { idempotencyKey: false }).catch((e) => e.kind);
        return { post, patch, custom, upload, stream, disabled };
      });
      for (const keys of [result.post, result.patch, result.upload, result.stream]) {
        assert.equal(keys.length, 2);
        assert.match(keys[0], /^[0-9a-f-]{36}$/);
        assert.equal(keys[0], keys[1]);
      }
      assert.notEqual(result.post[0], result.patch[0]);
      assert.deepEqual(result.custom, ['order-42', 'order-42']);
      assert.equal(result.disabled, 'HttpError');
    });

    it('queues requests under concurrency/rate limits and releases streams on cancellation', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin }) => {
        const c = new WasmClient({ baseUrl: origin, maxConcurrent: 1 });
        const held = await c.get('/stream', { responseType: 'stream' });
        let settled = false;
        const controller = new AbortController();
        const cancelled = c.get('/echo', { signal: controller.signal }).catch((e) => e.kind);
        const queued = c.get('/echo', { timeoutMs: 100 }).then((r) => { settled = true; return r.status; });
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const wasQueued = !settled;
        await held.body.cancel();
        const status = await queued;
        const rate = new WasmClient({ baseUrl: origin, rateLimit: { requests: 1, perMs: 70 } });
        await rate.get('/echo');
        const start = performance.now();
        await rate.get('/echo');
        return { wasQueued, status, cancelled: await cancelled, gap: performance.now() - start };
      });
      assert.equal(result.wasQueued, true);
      assert.equal(result.status, 200);
      assert.equal(result.cancelled, 'CancelledError');
      assert.ok(result.gap >= 40, `rate gap ${result.gap}`);
    });

    it('opens per-origin circuits and probes failed and successful recovery', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin }) => {
        const changes = [];
        const c = new WasmClient({ baseUrl: origin, circuitBreaker: { failureThreshold: 1, resetAfterMs: 200 }, onCircuitChange: (e) => changes.push([e.from, e.to]) });
        const path = `/flaky?id=${crypto.randomUUID()}&failures=2&status=503`;
        const fail = () => c.get(path).then(() => 'ok', (e) => e.kind);
        const first = await fail();
        const blocked = await fail();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const probe = await fail();
        const blockedAgain = await fail();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const recovered = (await c.get(path)).body.attempts;
        return { first, blocked, probe, blockedAgain, recovered, changes };
      });
      assert.deepEqual(result, {
        first: 'HttpError', blocked: 'CircuitOpenError', probe: 'HttpError', blockedAgain: 'CircuitOpenError', recovered: 3,
        changes: [['closed', 'open'], ['open', 'half-open'], ['half-open', 'open'], ['open', 'half-open'], ['half-open', 'closed']],
      });
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

    it('preserves security defaults, redaction and lifecycle validation under diagnostics', async () => {
      const result = await inPage(page, async ({ WasmClient }, { origin, wsBase }) => {
        const errors = [], lifecycle = [];
        for (const name of ['events', 'websocket']) {
          const baseUrl = name === 'events' ? origin : wsBase;
          const path = name === 'events' ? '/sse' : '/live';
          const client = new WasmClient({ baseUrl });
          const invalid = (options) => {
            try { const connection = client[name](baseUrl + path, options); connection.close(); errors.push('accepted'); }
            catch (error) { errors.push(error.kind + ':' + error.parameter); }
          };
          for (const hook of ['onOpen', 'onError', 'onClose', 'onReconnect']) {
            invalid({ [hook]: 0 });
            invalid(Object.create({ [hook]: 0 }));
          }
          invalid(Object.create({ allowAbsoluteUrls: false }));
          const options = JSON.parse('{"__proto__":{"allowAbsoluteUrls":true}}');
          Object.setPrototypeOf(options, { allowAbsoluteUrls: false });
          invalid(options);
          let opens = 0, closes = 0;
          const defaults = Object.freeze({ reconnect: false, onOpen: () => opens++, onClose: () => closes++ });
          const connection = client[name](path, Object.create(defaults));
          await connection.opened;
          if (name === 'websocket') connection.close();
          await connection.closed;
          lifecycle.push([opens, closes]);
        }
        const redacted = [];
        for (const placement of ['client', 'request']) {
          const entries = [];
          const options = Object.assign(Object.create({ sensitiveHeaders: ['x-api-key'] }), { headers: [['X-Api-Key', 'browser-secret']] });
          const config = { baseUrl: origin, debug: (entry) => entries.push(entry) };
          const client = new WasmClient(placement === 'client' ? Object.assign(options, config) : config);
          await client.get('/echo', placement === 'request' ? options : undefined);
          redacted.push(entries.find((entry) => entry.type === 'request').headers['x-api-key'] === '[REDACTED]' && !JSON.stringify(entries).includes('browser-secret'));
        }
        return { errors, lifecycle, redacted };
      });
      const expected = ['onOpen', 'onError', 'onClose', 'onReconnect'].flatMap((hook) => ['InvalidInputError:' + hook, 'InvalidInputError:' + hook]);
      expected.push('InvalidInputError:url', 'InvalidInputError:url');
      assert.deepEqual(result.errors, [...expected, ...expected]);
      assert.deepEqual(result.lifecycle, [[1, 1], [1, 1]]);
      assert.deepEqual(result.redacted, [true, true]);
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
