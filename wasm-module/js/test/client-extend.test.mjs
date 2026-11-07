// client.extend() (#69): option merging, interceptor isolation, validation.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import init, { WasmClient } from '../../pkg/node.js';
import { json, rejection, startServer } from './helpers.mjs';

let server;
before(async () => {
  await init();
  server = await startServer((req, res) => {
    if (req.url.startsWith('/boom')) {
      res.writeHead(500);
      return res.end();
    }
    json(res, { path: req.url, headers: req.headers });
  });
});
after(() => server.close());

const base = () => server.url('').replace(/\/$/, '');

describe('client.extend()', () => {
  it('merges headers by name, case-insensitively, and replaces every other option', async () => {
    const parent = new WasmClient({ baseUrl: base(), headers: { 'X-Keep': 'parent', 'X-Over': 'parent', Authorization: 'Bearer parent' }, retries: 0, timeoutMs: 5000 });
    const child = parent.extend({ headers: { 'x-over': 'child', 'X-New': 'child' }, baseUrl: `${base()}/v2` });
    const { body } = await child.get('/users');
    assert.equal(body.path, '/v2/users');
    assert.equal(body.headers['x-keep'], 'parent');
    assert.equal(body.headers['x-over'], 'child');
    assert.equal(body.headers['x-new'], 'child');
    assert.equal(body.headers.authorization, 'Bearer parent');

    const unchanged = await parent.get('/users');
    assert.equal(unchanged.body.path, '/users');
    assert.equal(unchanged.body.headers['x-over'], 'parent');
    assert.equal(unchanged.body.headers['x-new'], undefined);
  });

  it('accepts Headers-like inputs and ignores undefined overrides', async () => {
    const parent = new WasmClient({ baseUrl: base(), headers: new Map([['X-A', '1']]), retries: 2 });
    const child = parent.extend({ headers: [['X-B', '2']], retries: undefined, timeoutMs: undefined });
    const { body } = await child.get('/h');
    assert.equal(body.headers['x-a'], '1');
    assert.equal(body.headers['x-b'], '2');
    // retries: 2 was kept (undefined means "no override"), so a 500 is attempted three times
    const hits = [];
    const counting = await startServer((req, res) => { hits.push(req.url); res.writeHead(500); res.end(); });
    const flaky = new WasmClient({ baseUrl: counting.url('').replace(/\/$/, ''), retries: { maxRetries: 2, initialDelayMs: 1 } }).extend({ timeoutMs: 5000 });
    await rejection(flaky.get('/x'));
    assert.equal(hits.length, 3);
    await counting.close();
  });

  it('replaces retries instead of merging them', async () => {
    const hits = [];
    const counting = await startServer((req, res) => { hits.push(req.url); res.writeHead(500); res.end(); });
    const parent = new WasmClient({ baseUrl: counting.url('').replace(/\/$/, ''), retries: { maxRetries: 4, initialDelayMs: 1 } });
    await rejection(parent.extend({ retries: 0 }).get('/x'));
    assert.equal(hits.length, 1);
    await counting.close();
  });

  it('starts with the parent interceptors in order, and keeps the two sets apart', async () => {
    const parent = new WasmClient({ baseUrl: base() });
    const order = [];
    parent.addRequestInterceptor((r) => { order.push('parent-1'); r.headers['x-p1'] = '1'; });
    const ejected = parent.addRequestInterceptor(() => { order.push('ejected'); });
    parent.addResponseInterceptor((res) => { order.push('parent-response'); return res; });
    parent.ejectInterceptor(ejected);
    const child = parent.extend();
    child.addRequestInterceptor((r) => { order.push('child-only'); r.headers['x-child'] = '1'; });

    const fromChild = await child.get('/c');
    assert.deepEqual(order, ['parent-1', 'child-only', 'parent-response']);
    assert.equal(fromChild.body.headers['x-p1'], '1');
    assert.equal(fromChild.body.headers['x-child'], '1');

    order.length = 0;
    const fromParent = await parent.get('/p');
    assert.deepEqual(order, ['parent-1', 'parent-response']);
    assert.equal(fromParent.body.headers['x-child'], undefined);

    // interceptors added to the parent afterwards do not reach the child
    parent.addRequestInterceptor(() => order.push('late'));
    order.length = 0;
    await child.get('/c');
    assert.equal(order.includes('late'), false);
  });

  it('follows ejectInterceptor and clearInterceptors on the parent', async () => {
    const parent = new WasmClient({ baseUrl: base() });
    const calls = [];
    parent.addRequestInterceptor(() => calls.push('a'));
    parent.addResponseInterceptor((res) => { calls.push('b'); return res; });
    const first = parent.extend();
    parent.clearInterceptors();
    const second = parent.extend();
    await first.get('/1');
    await second.get('/2');
    assert.deepEqual(calls, ['a', 'b']);
  });

  it('chains: a grandchild gets the whole line', async () => {
    const a = new WasmClient({ baseUrl: base(), headers: { 'X-A': 'a' } });
    const c = a.extend({ headers: { 'X-B': 'b' } }).extend({ headers: { 'X-C': 'c' } });
    const { body } = await c.get('/g');
    assert.deepEqual([body.headers['x-a'], body.headers['x-b'], body.headers['x-c']], ['a', 'b', 'c']);
  });

  it('is an instance of the same class and rejects bad input', () => {
    const parent = new WasmClient();
    assert.ok(parent.extend() instanceof WasmClient);
    for (const bad of ['x', 1, true]) {
      assert.throws(() => parent.extend(bad), (e) => e.kind === 'InvalidInputError' && e.parameter === 'options');
    }
    assert.throws(() => parent.extend({ timeoutMs: 'soon' }), (e) => e.kind === 'InvalidInputError');
    assert.throws(() => parent.extend({ headers: 5 }), (e) => e.kind === 'InvalidInputError');
  });

  it('does not share state it cannot share: the child has its own circuit breaker', async () => {
    const parent = new WasmClient({ baseUrl: base(), retries: 0, circuitBreaker: { failureThreshold: 1, resetAfterMs: 60_000 } });
    await rejection(parent.get('/boom'));
    const open = await rejection(parent.get('/boom'));
    assert.equal(open.kind, 'CircuitOpenError');
    const child = parent.extend();
    assert.equal((await rejection(child.get('/boom'))).kind, 'HttpError');
  });
});
