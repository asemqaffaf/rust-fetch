// The `dedupe` option (#46): identical in-flight GET and HEAD requests share one request.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import init, { WasmClient } from '../../pkg/node.js';
import { json, rejection, sleep, startServer } from './helpers.mjs';

let server;
let hits;
before(async () => {
  await init();
  server = await startServer(async (req, res) => {
    hits.push({ url: req.url, method: req.method, language: req.headers['accept-language'] });
    const url = new URL(req.url, 'http://x');
    await sleep(Number(url.searchParams.get('ms') ?? 60));
    if (url.pathname === '/fail') return json(res, {}, { status: 500 });
    json(res, { path: url.pathname, n: hits.length, list: [1, 2, 3] });
  });
});
after(() => server.close());

const client = (options = {}) => new WasmClient({ baseUrl: server.url('').replace(/\/$/, ''), retries: 0, ...options });

describe('dedupe', () => {
  it('sends one request for identical requests in flight, and gives each caller its own response', async () => {
    hits = [];
    const c = client({ dedupe: true });
    const [a, b, d] = await Promise.all([c.get('/me'), c.get('/me'), c.get('/me')]);
    assert.equal(hits.length, 1);
    assert.deepEqual([a.body, b.body, d.body].map((x) => x.path), ['/me', '/me', '/me']);
    assert.notEqual(a, b);
    assert.notEqual(a.body, b.body);
    b.body.list.push(99); // a caller changing its copy does not change the others'
    assert.deepEqual(a.body.list, [1, 2, 3]);
    assert.deepEqual(d.body.list, [1, 2, 3]);
    assert.notEqual(b.headers, d.headers);
  });

  it('shares only while the request is in flight', async () => {
    hits = [];
    const c = client({ dedupe: true });
    await c.get('/me?ms=5');
    await c.get('/me?ms=5');
    assert.equal(hits.length, 2);
  });

  it('is off by default, and per request with dedupe: true or false', async () => {
    hits = [];
    await Promise.all([client().get('/x'), client().get('/x')]);
    assert.equal(hits.length, 2);
    hits = [];
    const plain = client();
    await Promise.all([plain.get('/x'), plain.get('/x')]);
    assert.equal(hits.length, 2);
    hits = [];
    await Promise.all([plain.get('/x', { dedupe: true }), plain.get('/x', { dedupe: true })]);
    assert.equal(hits.length, 1);
    hits = [];
    const on = client({ dedupe: true });
    await Promise.all([on.get('/x', { dedupe: false }), on.get('/x', { dedupe: false }), on.get('/x')]);
    assert.equal(hits.length, 3 - 0);
  });

  it('does not share across different URLs, headers, params, methods or clients', async () => {
    hits = [];
    const c = client({ dedupe: true });
    await Promise.all([
      c.get('/a'), c.get('/b'), c.get('/a', { headers: { 'Accept-Language': 'de' } }), c.get('/a', { headers: { 'Accept-Language': 'fr' } }),
      c.get('/a', { params: { q: 1 } }), c.head('/a'), client({ dedupe: true }).get('/a'),
    ]);
    assert.equal(hits.length, 7);
    hits = [];
    await Promise.all([c.get('/a', { headers: { 'Accept-Language': 'de' } }), c.get('/a', { headers: { 'accept-language': 'de' } })]);
    assert.equal(hits.length, 1); // header names are case-insensitive
  });

  it('never shares writes', async () => {
    hits = [];
    const c = client({ dedupe: true });
    await Promise.all([c.post('/w', { body: {} }), c.post('/w', { body: {} })]);
    assert.equal(hits.length, 2);
  });

  it('propagates an error to every caller', async () => {
    hits = [];
    const c = client({ dedupe: true });
    const errors = await Promise.all([rejection(c.get('/fail')), rejection(c.get('/fail'))]);
    assert.equal(hits.length, 1);
    assert.deepEqual(errors.map((e) => [e.kind, e.status]), [['HttpError', 500], ['HttpError', 500]]);
  });

  it('cancels one caller without cancelling the others, and the request when all cancel', async () => {
    hits = [];
    const c = client({ dedupe: true });
    const one = new AbortController();
    const first = c.get('/slow?ms=200', { signal: one.signal });
    const second = c.get('/slow?ms=200');
    setTimeout(() => one.abort('leaving'), 20);
    const error = await rejection(first);
    assert.deepEqual([error.kind, error.reason], ['CancelledError', 'leaving']);
    assert.equal((await second).body.path, '/slow');
    assert.equal(hits.length, 1);

    // all callers cancel: the request is cancelled too
    const a = new AbortController();
    const b = new AbortController();
    const started = Date.now();
    const both = [c.get('/slow2?ms=3000', { signal: a.signal }), c.get('/slow2?ms=3000', { signal: b.signal })];
    setTimeout(() => { a.abort(); b.abort(); }, 20);
    const settled = await Promise.allSettled(both);
    assert.ok(settled.every((r) => r.status === 'rejected' && r.reason.kind === 'CancelledError'));
    assert.ok(Date.now() - started < 1000);
    // a new request after that starts afresh
    assert.equal((await c.get('/slow2?ms=5')).body.path, '/slow2');
  });

  it('rejects an already-aborted signal without sending anything', async () => {
    hits = [];
    const error = await rejection(client({ dedupe: true }).get('/x', { signal: AbortSignal.abort('early') }));
    assert.deepEqual([error.kind, error.reason], ['CancelledError', 'early']);
    assert.equal(hits.length, 0);
  });

  it('leaves streamed responses and callbacks alone', async () => {
    hits = [];
    const c = client({ dedupe: true });
    await Promise.all([c.get('/s', { responseType: 'stream' }).then((r) => r.body.cancel()), c.get('/s', { responseType: 'stream' }).then((r) => r.body.cancel())]);
    assert.equal(hits.length, 2);
    hits = [];
    await Promise.all([c.get('/p', { onDownloadProgress() {} }), c.get('/p', { onDownloadProgress() {} })]);
    assert.equal(hits.length, 2);
  });

  it('validates the option and keeps working on a derived client', async () => {
    assert.throws(() => new WasmClient({ dedupe: 'yes' }), (e) => e.kind === 'InvalidInputError' && e.parameter === 'dedupe');
    assert.equal((await rejection(client().get('/x', { dedupe: 1 }))).parameter, 'dedupe');
    hits = [];
    const child = client({ dedupe: true }).extend({ headers: { 'x-a': '1' } });
    await Promise.all([child.get('/d'), child.get('/d')]);
    assert.equal(hits.length, 1);
  });
});
