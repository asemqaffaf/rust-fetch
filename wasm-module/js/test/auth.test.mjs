// The `auth` client option (#70): bearer and Basic credentials, scoped to the client's origins, with a single-flight refresh on 401.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import init, { WasmClient } from '../../pkg/node.js';
import { json, rejection, sleep, startServer } from './helpers.mjs';

let server, other;
const seen = [];
let valid = 'Bearer new';
before(async () => {
  await init();
  server = await startServer(async (req, res) => {
    if (req.url.startsWith('/protected-slow')) await sleep(80);
    seen.push({ url: req.url, authorization: req.headers.authorization });
    if (req.url.startsWith('/protected')) {
      if (req.headers.authorization !== valid) return json(res, { error: 'expired' }, { status: 401 });
      return json(res, { ok: true, auth: req.headers.authorization });
    }
    if (req.url.startsWith('/forbidden')) return json(res, {}, { status: 403 });
    json(res, { auth: req.headers.authorization ?? null });
  });
  other = await startServer((req, res) => json(res, { auth: req.headers.authorization ?? null }));
});
after(async () => { await server.close(); await other.close(); });

const base = () => server.url('').replace(/\/$/, '');

describe('auth option', () => {
  it('adds a bearer token (a string, or a sync or async function evaluated per request)', async () => {
    assert.equal((await new WasmClient({ baseUrl: base(), auth: { bearer: 'abc' } }).get('/a')).body.auth, 'Bearer abc');
    let n = 0;
    const c = new WasmClient({ baseUrl: base(), auth: { bearer: async () => `t${++n}` } });
    assert.equal((await c.get('/a')).body.auth, 'Bearer t1');
    assert.equal((await c.get('/a')).body.auth, 'Bearer t2');
    assert.equal((await new WasmClient({ baseUrl: base(), auth: { bearer: () => undefined } }).get('/a')).body.auth, null);
  });

  it('adds Basic credentials, UTF-8 safe', async () => {
    const c = new WasmClient({ baseUrl: base(), auth: { basic: { username: 'zoë', password: 'p:ss' } } });
    const header = (await c.get('/a')).body.auth;
    assert.equal(Buffer.from(header.replace('Basic ', ''), 'base64').toString(), 'zoë:p:ss');
  });

  it('works for every method and for events()', async () => {
    const c = new WasmClient({ baseUrl: base(), auth: { bearer: 'abc' } });
    for (const call of [() => c.post('/a', { body: {} }), () => c.put_json('/a', {}), () => c.delete('/a'), () => c.fetch('/a'), () => c.request('GET', '/a', undefined, undefined, {})]) {
      assert.equal((await call()).body.auth, 'Bearer abc');
    }
  });

  it('never sends credentials to another origin, absolute URLs included', async () => {
    const c = new WasmClient({ baseUrl: base(), auth: { bearer: 'secret' } });
    assert.equal((await c.get(other.url('/x'))).body.auth, null);
    const allowed = new WasmClient({ baseUrl: base(), auth: { bearer: 'secret', origins: [other.url('/')] } });
    assert.equal((await allowed.get(other.url('/x'))).body.auth, 'Bearer secret');
    const fixed = new WasmClient({ auth: { bearer: 'secret', origins: [base()] } });
    assert.equal((await fixed.get(server.url('/x'))).body.auth, 'Bearer secret');
    assert.equal((await fixed.get(other.url('/x'))).body.auth, null);
  });

  it('keeps an Authorization header the request sets itself', async () => {
    const c = new WasmClient({ baseUrl: base(), auth: { bearer: 'default' } });
    assert.equal((await c.get('/a', { headers: { Authorization: 'Custom 1' } })).body.auth, 'Custom 1');
  });

  it('refuses invalid options', () => {
    for (const [auth, parameter] of [
      ['x', 'auth'], [{}, 'auth'], [{ bearer: 'a', basic: { username: 'a', password: 'b' } }, 'auth'], [{ bearer: 5 }, 'auth.bearer'],
      [{ basic: { username: 'a' } }, 'auth.basic'], [{ bearer: 'a', refresh: 'no' }, 'auth.refresh'], [{ basic: { username: 'a', password: 'b' }, refresh() {} }, 'auth.refresh'],
      [{ bearer: 'a', origins: 'https://x.test' }, 'auth.origins'], [{ bearer: 'a', origins: ['nope'] }, 'auth.origins'],
    ]) {
      assert.throws(() => new WasmClient({ baseUrl: base(), auth }), (e) => e.kind === 'InvalidInputError' && e.parameter === parameter, JSON.stringify(auth));
    }
    // credentials need a place to go
    assert.throws(() => new WasmClient({ auth: { bearer: 'a' } }), (e) => e.kind === 'InvalidInputError' && e.parameter === 'auth');
  });

  it('survives clearInterceptors() and extend()', async () => {
    const c = new WasmClient({ baseUrl: base(), auth: { bearer: 'abc' } });
    c.addRequestInterceptor((r) => { r.headers['x-extra'] = '1'; });
    c.clearInterceptors();
    assert.equal((await c.get('/a')).body.auth, 'Bearer abc');
    assert.equal((await c.extend({ timeoutMs: 5000 }).get('/a')).body.auth, 'Bearer abc');
    assert.equal((await c.extend({ auth: { bearer: 'child' } }).get('/a')).body.auth, 'Bearer child');
  });
});

describe('auth.refresh', () => {
  const fresh = () => {
    valid = 'Bearer new';
    seen.length = 0;
    const state = { token: 'old', refreshes: 0 };
    const client = new WasmClient({
      baseUrl: base(),
      retries: 0,
      auth: {
        bearer: () => state.token,
        refresh: async () => { state.refreshes++; await sleep(30); state.token = 'new'; },
      },
    });
    return { state, client };
  };

  it('refreshes once for concurrent 401s and replays each request once', async () => {
    const { state, client } = fresh();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => client.get(`/protected?i=${i}`)));
    assert.equal(state.refreshes, 1);
    assert.ok(results.every((r) => r.body.ok && r.body.auth === 'Bearer new'));
    assert.equal(seen.filter((s) => s.authorization === 'Bearer old').length, 8);
    assert.equal(seen.filter((s) => s.authorization === 'Bearer new').length, 8);
  });

  it('uses the outcome of a refresh that settled while a request was in flight, instead of refreshing again', async () => {
    const { state, client } = fresh();
    const early = client.get('/protected-slow'); // sent with the old token; answered 401 after the other request has refreshed
    await sleep(10);
    await client.get('/protected'); // 401 at once, refreshes, replays
    assert.equal(state.refreshes, 1);
    const response = await early;
    assert.equal(response.body.auth, 'Bearer new');
    assert.equal(state.refreshes, 1);
  });

  it('rejects with the HttpError on a second 401, and does not refresh again', async () => {
    const { state, client } = fresh();
    valid = 'Bearer never';
    const error = await rejection(client.get('/protected'));
    assert.deepEqual([error.kind, error.status], ['HttpError', 401]);
    assert.equal(state.refreshes, 1);
    assert.equal(seen.length, 2);
  });

  it('rejects with the HttpError and the cause when the refresh fails, and tries again next time', async () => {
    valid = 'Bearer new';
    let calls = 0;
    const client = new WasmClient({ baseUrl: base(), retries: 0, auth: { bearer: 'old', refresh: async () => { calls++; throw new Error('refresh denied'); } } });
    const [a, b] = await Promise.all([rejection(client.get('/protected?a')), rejection(client.get('/protected?b'))]);
    assert.deepEqual([a.status, b.status, calls], [401, 401, 1]);
    assert.match(a.cause.message, /refresh denied/);
    await rejection(client.get('/protected?c'));
    assert.equal(calls, 2);
  });

  it('leaves other errors, other origins and stream bodies alone', async () => {
    const { state, client } = fresh();
    assert.equal((await rejection(client.get('/forbidden'))).status, 403);
    assert.equal((await client.get(other.url('/protected'))).status, 200); // another origin: no credentials, no refresh
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x')); c.close(); } });
    const error = await rejection(client.post('/protected', { body }));
    assert.equal(error.status, 401);
    assert.equal(state.refreshes, 0);
  });

  it('does nothing without refresh (a 401 is just an error)', async () => {
    valid = 'Bearer new';
    const error = await rejection(new WasmClient({ baseUrl: base(), retries: 0, auth: { bearer: 'old' } }).get('/protected'));
    assert.equal(error.status, 401);
  });
});
