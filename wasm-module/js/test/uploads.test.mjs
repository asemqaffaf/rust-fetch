import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import init, { WasmClient } from '../../pkg/node.js';
import { rejection, sleep } from './helpers.mjs';

let server, base;
const sockets = new Set();
const counts = new Map();
const clients = [];
const client = (options = {}) => { const c = new WasmClient({ timeoutMs: 5000, retries: 0, ...options }); clients.push(c); return c; };
const body = () => Readable.from(['hello ', new Uint8Array([119, 111, 114, 108, 100])]);
let nativeSends = 0;
let addon, originalSend;
before(async () => {
  await init();
  const binary = new URL(`../../pkg/rust-fetch-native.${process.platform}-${process.arch}.node`, import.meta.url);
  if (process.env.RUST_FETCH_NATIVE !== '0' && existsSync(binary)) {
    addon = createRequire(import.meta.url)(binary.pathname);
    originalSend = addon.send;
    addon.send = (...args) => { if (args[0].uploadNext) nativeSends++; return originalSend(...args); };
  }
  server = http.createServer((req, res) => {
    req.on('error', () => {});
    const url = new URL(req.url, 'http://x');
    const count = (counts.get(req.url) ?? 0) + 1;
    counts.set(req.url, count);
    if (url.pathname === '/hold') return;
    if (url.pathname === '/early') { res.writeHead(503); res.end('busy'); return; }
    if (url.pathname === '/redirect-active') { req.pause(); setTimeout(() => { res.writeHead(307, { location: '/echo' }); res.end(); }, 20); return; }
    if (url.pathname === '/redirect') { res.writeHead(Number(url.searchParams.get('status') ?? 307), { location: '/echo' }); res.end(); return; }
    let size = 0;
    const hash = createHash('sha256');
    req.on('data', (chunk) => {
      size += chunk.length;
      if (url.pathname !== '/large') hash.update(chunk);
      if (url.pathname === '/slow') { req.pause(); setTimeout(() => req.resume(), 2); }
    });
    req.on('end', () => {
      if (url.pathname === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(count === 1 ? 'data: 1\n\n' : 'data: [DONE]\n\n'); return; }
      const response = JSON.stringify({ size, hash: hash.digest('hex'), method: req.method, headers: req.headers });
      res.writeHead(url.pathname === '/retry' && count === 1 ? 503 : 200, { __proto__: null, 'content-type': 'application/json', 'content-length': Buffer.byteLength(response) });
      res.end(response);
    });
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (addon) addon.send = originalSend;
  for (const c of clients) c.free();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
});

describe('streaming request bodies', () => {
  it('sends Node Readable, web streams and factories without serializing them', async () => {
    const c = client();
    const beforeNative = nativeSends;
    const sources = [body(), new ReadableStream({ start(c) { c.enqueue('hello world'); c.close(); } }), body, async () => body()];
    for (const source of sources) {
      const { body: result } = await c.post(base + '/echo', { body: source });
      assert.equal(result.size, 11);
      assert.equal(result.hash, createHash('sha256').update('hello world').digest('hex'));
      assert.equal(result.headers['content-type'], 'application/octet-stream');
      assert.equal(result.headers['transfer-encoding'], 'chunked');
    }
    if (addon) assert.equal(nativeSends - beforeNative, sources.length, 'exercise the real native addon');
  });
  it('preserves byte views and producer reuse of a buffer', async () => {
    const expected = createHash('sha256');
    async function* source() {
      const bytes = new Uint8Array(65538);
      for (let i = 0; i < 64; i++) {
        bytes.fill(i);
        const view = new DataView(bytes.buffer, 1, 65536);
        expected.update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        yield view;
      }
    }
    assert.equal((await client().put(base + '/echo', { body: source() })).body.hash, expected.digest('hex'));
  });
  it('reports monotonic transport progress with known and unknown totals', async () => {
    for (const headers of [undefined, { 'Content-Length': '11' }]) {
      const progress = [];
      const result = await client().post(base + '/echo', { body: body(), headers, onUploadProgress: (p) => progress.push(p) });
      assert.equal(result.body.size, 11);
      assert.equal(progress.at(-1).loaded, 11);
      assert.ok(progress.every((p, i) => p.loaded >= (progress[i - 1]?.loaded ?? 0) && p.total === (headers ? 11 : 0)));
    }
  });
  it('validates Content-Length before sending excess bytes', async () => {
    const c = client();
    for (const length of ['0', '1', '10', '12', '-1', '1e1']) {
      const error = await rejection(c.post(base + '/echo', { body: body(), headers: { 'content-length': length } }));
      assert.equal(error.kind, 'InvalidInputError', `${length}: ${error.message}`);
      assert.equal(error.parameter, 'body');
    }
    assert.equal((await rejection(c.post(base + '/echo', { body: async function* () { yield new Uint8Array(131072); }, headers: { 'content-length': '65536' } }))).kind, 'InvalidInputError');
    assert.equal((await rejection(c.post(base + '/echo', { body: body(), headers: { 'transfer-encoding': 'identity' } }))).kind, 'InvalidInputError');
    assert.equal((await c.post(base + '/echo', { body: async function* () {}, headers: { 'content-length': '0' } })).body.size, 0);
  });
  it('ignores inherited framing and credential headers', async () => {
    // Keep the server's Node internals outside the polluted client realm.
    const worker = new Worker(`
      const { parentPort } = require('node:worker_threads');
      const server = require('node:http').createServer((req, res) => {
        let size = 0; req.on('data', c => size += c.length);
        req.on('end', () => {
          const body = JSON.stringify({ size, headers: req.headers });
          parentPort.postMessage('received');
          parentPort.once('message', () => { res.setHeader('content-type', 'application/json'); res.end(body); });
        });
      });
      server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
    `, { eval: true });
    const port = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    Object.prototype['content-length'] = '1';
    Object.prototype['transfer-encoding'] = 'identity';
    Object.prototype.authorization = 'inherited-secret';
    try {
      const received = new Promise((resolve) => worker.once('message', resolve));
      const pending = client().put(`http://127.0.0.1:${port}/`, { body: body() });
      await received;
      delete Object.prototype['content-length']; delete Object.prototype['transfer-encoding']; delete Object.prototype.authorization;
      worker.postMessage('respond');
      const result = await pending;
      assert.equal(result.body.size, 11);
      assert.equal(Object.hasOwn(result.body.headers, 'authorization'), false);
      assert.equal(result.body.headers['transfer-encoding'], 'chunked');
    } finally {
      delete Object.prototype['content-length']; delete Object.prototype['transfer-encoding']; delete Object.prototype.authorization;
      await worker.terminate();
    }
  });
  it('never retries a one-shot source even when non-idempotent retries are enabled', async () => {
    const c = client({ retries: { maxRetries: 2, initialDelayMs: 0, retryNonIdempotent: true } });
    const url = base + '/retry?oneshot';
    assert.equal((await rejection(c.post(url, { body: body() }))).kind, 'HttpError');
    assert.equal(counts.get('/retry?oneshot'), 1);
  });
  it('opens a fresh factory for each retry and retains normal method retry rules', async () => {
    const c = client({ retries: { maxRetries: 1, initialDelayMs: 0 } });
    let opens = 0;
    assert.equal((await c.put(base + '/retry?factory', { body: () => { opens++; return body(); } })).body.size, 11);
    assert.equal(opens, 2);
    await rejection(c.post(base + '/retry?unsafe', { body }));
    assert.equal(counts.get('/retry?unsafe'), 1);
  });
  it('replays factory redirects and rejects one-shot redirects that preserve the body', async () => {
    const c = client();
    assert.equal((await rejection(c.post(base + '/redirect', { body: body() }))).kind, 'InvalidInputError');
    let opens = 0;
    const result = await c.post(base + '/redirect', { body: () => { opens++; return body(); } });
    assert.equal(result.body.size, 11);
    assert.ok(opens >= 1 && opens <= 2, 'an early redirect may precede the first body pull');
    const rewritten = await c.post(base + '/redirect?status=303', { body: body() });
    assert.equal(rewritten.body.method, 'GET');
    assert.equal(rewritten.body.size, 0);
    assert.equal(rewritten.body.headers['content-type'], undefined);
  });
  it('does not let cancellation of an old redirect upload cancel its replacement', async () => {
    let opens = 0;
    const chunk = new Uint8Array(65536);
    const factory = () => {
      if (++opens > 1) return body();
      return (async function* () { for (;;) yield chunk; })();
    };
    const response = await client().put(base + '/redirect-active', { body: factory });
    assert.equal(opens, 2); assert.equal(response.body.size, 11);
  });
  it('returns an early HTTP error and closes a stalled producer', async () => {
    let cancelled = false;
    const source = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const error = await rejection(client().post(base + '/early', { body: source }));
    assert.equal(error.kind, 'HttpError');
    assert.equal(error.status, 503);
    for (let i = 0; i < 20 && !cancelled; i++) await sleep(5);
    assert.equal(cancelled, true);
  });
  it('cancels a stalled source on abort and total deadline, without continuing progress', async () => {
    for (const deadline of [false, true]) {
      let cancelled = false;
      const source = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(64)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
      const controller = new AbortController();
      const pending = client().put(base + '/echo', { body: source, signal: controller.signal, deadlineMs: deadline ? 40 : 0 });
      if (!deadline) setTimeout(() => controller.abort(), 40);
      const error = await rejection(pending);
      assert.equal(error.kind, deadline ? 'TimeoutError' : 'CancelledError');
      for (let i = 0; i < 20 && !cancelled; i++) await sleep(5);
      assert.equal(cancelled, true);
    }
  });
  it('reports source failures and invalid chunks and rejects a consumed one-shot source', async () => {
    const c = client();
    for (const source of [async function* () { yield 42; }, () => 42]) assert.equal((await rejection(c.put(base + '/echo', { body: source }))).kind, 'InvalidInputError');
    const error = await rejection(c.put(base + '/echo', { body: async function* () { throw new Error('producer failed'); } }));
    assert.equal(error.kind, 'NetworkError');
    assert.match(error.message, /producer failed/);
    const one = body();
    await c.put(base + '/echo', { body: one });
    assert.equal((await rejection(c.put(base + '/echo', { body: one }))).kind, 'InvalidInputError');
  });
  it('rejects concurrent reuse without cancelling the source owned by the first request', async () => {
    let cancelled = false;
    const source = new ReadableStream({ start(c) { c.enqueue('abc'); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const controller = new AbortController();
    const c = client();
    const first = c.put(base + '/echo?first-owner', { body: source, signal: controller.signal });
    const finished = rejection(first);
    await sleep(15);
    assert.equal((await rejection(c.put(base + '/echo?second-owner', { body: source }))).kind, 'InvalidInputError');
    assert.equal(cancelled, false);
    controller.abort(); await finished;
    for (let i = 0; i < 20 && !cancelled; i++) await sleep(5);
    assert.equal(cancelled, true);
  });
  it('sends a slow source and supports a streamed response with upload progress', async () => {
    let pulled = 0;
    const result = await client().put(base + '/slow', { body: async function* () { for (let i = 0; i < 10; i++) { await sleep(2); pulled++; yield 'abc'; } }, responseType: 'stream', onUploadProgress() {} });
    assert.equal(pulled, 10);
    const reader = result.body.getReader();
    let text = '';
    for (;;) { const step = await reader.read(); if (step.done) break; text += new TextDecoder().decode(step.value); }
    assert.equal(JSON.parse(text).size, 30);
  });
  it('requires a factory for SSE reconnects and regenerates each connection body', async () => {
    const c = client();
    assert.throws(() => c.events(base + '/events', { method: 'POST', body: body(), reconnect: true }), (e) => e.kind === 'InvalidInputError' && e.parameter === 'reconnect');
    let opens = 0;
    const events = c.events(base + '/events', { method: 'POST', body: () => { opens++; return body(); }, messageType: 'json', reconnect: { maxRetries: 1, initialDelayMs: 0 } });
    const values = [];
    for await (const event of events) values.push(event.data);
    assert.deepEqual(values, [1]);
    assert.equal(opens, 2);
    events.free();
  });
  it('cancels queued one-shot sources without opening factories', async () => {
    const c = client({ maxConcurrent: 1 });
    const first = new AbortController();
    const held = c.get(base + '/hold', { signal: first.signal });
    const heldError = rejection(held);
    while (!counts.has('/hold')) await sleep(1);
    let cancelled = false, pulls = 0, opens = 0;
    const second = new AbortController();
    const pending = c.put(base + '/echo?queued', { body: new ReadableStream({ pull() { pulls++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), signal: second.signal });
    await sleep(10); second.abort();
    assert.equal((await rejection(pending)).kind, 'CancelledError');
    assert.equal(cancelled, true); assert.equal(pulls, 0);
    const third = new AbortController();
    const factory = c.put(base + '/echo?queued-factory', { body: () => { opens++; return body(); }, signal: third.signal });
    await sleep(10); third.abort(); await rejection(factory);
    assert.equal(opens, 0);
    first.abort(); await heldError;
  });
  it('bounds memory for a generated 3 GiB upload and applies backpressure', { timeout: 120000 }, async () => {
    const size = 3 * 1024 ** 3;
    const chunk = new Uint8Array(64 * 1024);
    let produced = 0;
    let peak = process.memoryUsage().rss;
    const initial = peak;
    async function* source() {
      while (produced < size) {
        produced += chunk.length;
        if (produced % (16 * 1024 ** 2) === 0) peak = Math.max(peak, process.memoryUsage().rss);
        yield chunk;
      }
    }
    const result = await client({ timeoutMs: 0 }).put(base + '/large', { body: source() });
    assert.equal(result.body.size, size);
    assert.ok(peak - initial < 192 * 1024 ** 2, `RSS grew ${(peak - initial) / 1024 ** 2} MiB`);
    // A paused receiver must stop pulling a producer, rather than buffering its body.
    let pulls = 0;
    const controller = new AbortController();
    const pause = http.createServer((req) => { req.pause(); req.on('error', () => {}); });
    const localSockets = new Set();
    pause.on('connection', (s) => { localSockets.add(s); s.on('close', () => localSockets.delete(s)); });
    await new Promise((r) => pause.listen(0, '127.0.0.1', r));
    try {
      const pending = client().put(`http://127.0.0.1:${pause.address().port}`, { body: async function* () { for (;;) { pulls++; yield chunk; } }, signal: controller.signal });
      await sleep(150);
      assert.ok(pulls < 256, `pulled ${pulls} chunks while receiver was paused`);
      controller.abort();
      await rejection(pending);
    } finally { controller.abort(); for (const s of localSockets) s.destroy(); await new Promise((r) => pause.close(r)); }
  });
});
