// The `httpCache` option (#45): RFC 9111 behaviour for a private cache.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import init, { WasmClient } from '../../pkg/node.js';
import { json, rejection, sleep, startServer } from './helpers.mjs';

let server;
let log;
before(async () => {
  await init();
  server = await startServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    log.push({ path: url.pathname, query: url.search, method: req.method, inm: req.headers['if-none-match'], ims: req.headers['if-modified-since'], lang: req.headers['accept-language'] });
    const send = (headers, body = { path: url.pathname, n: log.length }, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(status === 304 ? undefined : JSON.stringify(body)); };
    switch (url.pathname) {
      case '/fresh': return send({ 'cache-control': 'max-age=60' });
      case '/short': return send({ 'cache-control': 'max-age=1' });
      case '/etag':
        if (req.headers['if-none-match'] === '"v1"') return send({ etag: '"v1"', 'cache-control': 'max-age=0' }, undefined, 304);
        return send({ etag: '"v1"', 'cache-control': 'max-age=0' });
      case '/lastmod':
        if (req.headers['if-modified-since'] === 'Wed, 01 Jan 2025 00:00:00 GMT') return send({}, undefined, 304);
        return send({ 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT', 'cache-control': 'max-age=0' });
      case '/changes': // new content each time, with a validator that never matches
        return send({ etag: `"c${log.length}"`, 'cache-control': 'max-age=0' });
      case '/nostore': return send({ 'cache-control': 'no-store, max-age=60' });
      case '/nocache':
        if (req.headers['if-none-match'] === '"nc"') return send({ etag: '"nc"', 'cache-control': 'no-cache' }, undefined, 304);
        return send({ etag: '"nc"', 'cache-control': 'no-cache, max-age=60' });
      case '/private': return send({ 'cache-control': 'private, max-age=60' });
      case '/expires': return send({ expires: new Date(Date.now() + 60_000).toUTCString(), date: new Date().toUTCString() });
      case '/expired': return send({ expires: new Date(Date.now() - 1000).toUTCString(), date: new Date().toUTCString() });
      case '/nofresh': return send({});
      case '/vary': return send({ 'cache-control': 'max-age=60', vary: 'Accept-Language' }, { lang: req.headers['accept-language'] ?? null });
      case '/vary-star': return send({ 'cache-control': 'max-age=60', vary: '*' });
      case '/age': return send({ 'cache-control': 'max-age=60', age: '55' });
      case '/big': return send({ 'cache-control': 'max-age=60' }, { blob: 'x'.repeat(2000) });
      case '/error': return send({ 'cache-control': 'max-age=60' }, {}, 500);
      default: return send({ 'cache-control': 'max-age=60' });
    }
  });
});
after(() => server.close());
beforeEach(() => { log = []; });

const client = (httpCache = true, options = {}) => new WasmClient({ baseUrl: server.url('').replace(/\/$/, ''), retries: 0, httpCache, ...options });

describe('httpCache: freshness', () => {
  it('serves a fresh response from memory, marked cached', async () => {
    const c = client();
    const first = await c.get('/fresh');
    const second = await c.get('/fresh');
    assert.deepEqual([first.cached, first.revalidated, second.cached, second.revalidated], [false, false, true, false]);
    assert.equal(log.length, 1);
    assert.deepEqual(second.body, first.body);
    assert.equal(second.status, 200);
    assert.equal(second.url, first.url);
    assert.ok(Number(second.headers.age) >= 0);
  });

  it('is off by default and per request with httpCache: false', async () => {
    const plain = new WasmClient({ baseUrl: server.url('').replace(/\/$/, ''), retries: 0 });
    await plain.get('/fresh'); await plain.get('/fresh');
    assert.equal(log.length, 2);
    assert.equal('cached' in (await plain.get('/fresh')), false);
    log = [];
    const c = client();
    await c.get('/fresh'); await c.get('/fresh', { httpCache: false }); await c.get('/fresh');
    assert.equal(log.length, 2);
  });

  it('uses max-age, Expires, and expires entries', async () => {
    const c = client();
    await c.get('/expires'); await c.get('/expires');
    assert.equal(log.length, 1);
    await c.get('/expired'); await c.get('/expired');
    assert.equal(log.length, 3);
    await c.get('/short');
    await sleep(1200);
    await c.get('/short');
    assert.equal(log.length, 5);
  });

  it('adds the Age of the stored response', async () => {
    const c = client();
    await c.get('/age');
    assert.ok(Number((await c.get('/age')).headers.age) >= 55);
  });

  it('does not store no-store responses, responses without freshness or validator, Vary: *, errors, or oversized ones', async () => {
    const c = client({ maxEntryBytes: 1000 });
    for (const path of ['/nostore', '/nofresh', '/vary-star', '/big']) {
      log = [];
      await c.get(path); await c.get(path);
      assert.equal(log.length, 2, path);
    }
    log = [];
    await rejection(c.get('/error')); await rejection(c.get('/error'));
    assert.equal(log.length, 2);
  });

  it('honours request no-store and no-cache, and a caller\'s own conditional headers', async () => {
    const c = client();
    await c.get('/fresh');
    await c.get('/fresh', { headers: { 'Cache-Control': 'no-store' } });
    assert.equal(log.length, 2);
    await c.get('/fresh', { headers: { 'Cache-Control': 'no-cache' } }); // no validator: refetched
    assert.equal(log.length, 3);
    await c.get('/fresh', { headers: { 'If-None-Match': '"x"' } });
    assert.equal(log.length, 4);
  });

  it('keeps private responses (it is a private cache)', async () => {
    const c = client();
    await c.get('/private'); await c.get('/private');
    assert.equal(log.length, 1);
  });
});

describe('httpCache: revalidation', () => {
  it('revalidates a stale response with If-None-Match and serves the stored body on 304', async () => {
    const c = client();
    const first = await c.get('/etag');
    const second = await c.get('/etag');
    assert.equal(log.length, 2);
    assert.equal(log[1].inm, '"v1"');
    assert.deepEqual([second.cached, second.revalidated, second.status], [true, true, 200]);
    assert.deepEqual(second.body, first.body);
  });

  it('uses If-Modified-Since when there is no ETag', async () => {
    const c = client();
    await c.get('/lastmod');
    const second = await c.get('/lastmod');
    assert.equal(log[1].ims, 'Wed, 01 Jan 2025 00:00:00 GMT');
    assert.deepEqual([second.cached, second.revalidated], [true, true]);
  });

  it('replaces the stored response when the server sends a new one', async () => {
    const c = client();
    const first = await c.get('/changes');
    const second = await c.get('/changes');
    assert.equal(second.cached, false);
    assert.notEqual(second.body.n, first.body.n);
    assert.equal(log[1].inm, `"c1"`);
  });

  it('always revalidates no-cache responses, even within max-age', async () => {
    const c = client();
    await c.get('/nocache');
    const second = await c.get('/nocache');
    assert.equal(log.length, 2);
    assert.equal(second.revalidated, true);
  });

  it('propagates a failing revalidation', async () => {
    const own = await startServer((req, res) => { res.writeHead(200, { etag: '"x"', 'cache-control': 'max-age=0', 'content-type': 'application/json' }); res.end('{}'); });
    const c = new WasmClient({ baseUrl: own.url('').replace(/\/$/, ''), retries: 0, httpCache: true });
    await c.get('/etag');
    await own.close();
    const error = await rejection(c.get('/etag'));
    assert.equal(error.kind, 'NetworkError');
  });
});

describe('httpCache: Vary, keys and invalidation', () => {
  it('stores one response per URL and checks the Vary headers', async () => {
    const c = client();
    const de = await c.get('/vary', { headers: { 'Accept-Language': 'de' } });
    assert.deepEqual(de.body, { lang: 'de' });
    assert.equal((await c.get('/vary', { headers: { 'accept-language': 'de' } })).cached, true);
    const fr = await c.get('/vary', { headers: { 'Accept-Language': 'fr' } });
    assert.deepEqual([fr.cached, fr.body], [false, { lang: 'fr' }]);
    assert.equal(log.length, 2);
  });

  it('keys by URL including query params, and not across clients', async () => {
    const c = client();
    await c.get('/fresh?a=1'); await c.get('/fresh', { params: { a: 1 } }); await c.get('/fresh?a=2');
    assert.equal(log.length, 2);
    await client().get('/fresh?a=1');
    assert.equal(log.length, 3);
  });

  it('is invalidated by a successful unsafe request to the same URL', async () => {
    const c = client();
    await c.get('/fresh');
    await c.post('/fresh', { body: {} });
    await c.get('/fresh');
    assert.equal(log.filter((l) => l.method === 'GET').length, 2);
    log = [];
    await c.get('/fresh'); // stored again by the GET above: from memory
    await c.delete('/fresh');
    await c.get('/fresh'); // the DELETE invalidated it
    assert.deepEqual(log.map((l) => l.method), ['DELETE', 'GET']);
  });

  it('gives each caller its own copy of the body', async () => {
    const c = client();
    const first = await c.get('/fresh');
    first.body.path = 'mutated';
    const second = await c.get('/fresh');
    second.body.path = 'mutated again';
    assert.equal((await c.get('/fresh')).body.path, '/fresh');
  });

  it('is bounded by maxEntries and maxBytes, least recently used first', async () => {
    const c = client({ maxEntries: 2 });
    await c.get('/e1'); await c.get('/e2'); await c.get('/e1'); await c.get('/e3'); // e2 is the least recently used
    log = [];
    await c.get('/e1'); await c.get('/e3');
    assert.equal(log.length, 0);
    await c.get('/e2');
    assert.equal(log.length, 1);
    const tiny = client({ maxBytes: 600 });
    await tiny.get('/e1'); await tiny.get('/e2');
    log = [];
    await tiny.get('/e1');
    assert.equal(log.length, 1);
  });

  it('works with HEAD, streams and derived clients, and validates its options', async () => {
    const c = client();
    await c.head('/fresh'); await c.head('/fresh');
    assert.equal(log.length, 2);
    log = [];
    for (let i = 0; i < 2; i++) (await c.get('/fresh', { responseType: 'stream' })).body.cancel();
    assert.equal(log.length, 2);
    log = [];
    const child = c.extend({ headers: { 'x-d': '1' } });
    await child.get('/fresh'); assert.equal((await child.get('/fresh')).cached, true);
    for (const bad of ['yes', 5, null, { maxEntries: 0 }, { maxBytes: 1.5 }, { unknown: 1 }]) {
      assert.throws(() => new WasmClient({ httpCache: bad }), (e) => e.kind === 'InvalidInputError' && /^httpCache/.test(e.parameter), JSON.stringify(bad));
    }
    assert.equal((await rejection(c.get('/fresh', { httpCache: 'no' }))).parameter, 'httpCache');
  });
});
