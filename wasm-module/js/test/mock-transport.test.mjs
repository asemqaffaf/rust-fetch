// The `transport` option and createMockTransport() (#47): no server involved.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import init, { WasmClient } from '../../pkg/node.js';
import { createMockTransport } from '../../pkg/testing.js';
import { json, rejection, startServer } from './helpers.mjs';

before(() => init());

const client = (mock, options = {}) => new WasmClient({ baseUrl: 'https://api.test', transport: mock, retries: 0, ...options });

describe('createMockTransport()', () => {
  it('answers routes by method and path, with static and function responses', async () => {
    const mock = createMockTransport()
      .on('GET', '/users/42', { status: 200, body: { id: 42 } })
      .on('post', '/users', ({ body }) => ({ status: 201, body: { id: 1, ...body }, headers: { 'X-Made': 'yes' } }))
      .on('GET', /^\/search/, ({ query }) => ({ body: { q: query.q } }))
      .on('GET', 'https://api.test/absolute', { body: 'text' })
      .onAny({ status: 503 });
    const c = client(mock);
    const user = await c.get('/users/42');
    assert.deepEqual([user.status, user.ok, user.body, user.url], [200, true, { id: 42 }, 'https://api.test/users/42']);
    const created = await c.post('/users', { body: { name: 'Ada' } });
    assert.deepEqual([created.status, created.body, created.headers['x-made']], [201, { id: 1, name: 'Ada' }, 'yes']);
    assert.deepEqual((await c.get('/search?q=rust')).body, { q: 'rust' });
    assert.equal((await c.get('/absolute')).body, 'text');
    const fallback = await rejection(c.get('/nothing-matches'));
    assert.deepEqual([fallback.kind, fallback.status], ['HttpError', 503]);
  });

  it('records every call', async () => {
    const mock = createMockTransport().onAny({ body: { ok: true } });
    const c = client(mock, { headers: { 'X-Client': 'a' } });
    await c.get('/one?x=1');
    await c.post('/two', { body: { n: 2 }, headers: { 'X-Req': 'b' } });
    await c.post('/three', { body: 'plain text', headers: { 'content-type': 'text/plain' } });
    assert.equal(mock.calls.length, 3);
    assert.deepEqual([mock.calls[0].method, mock.calls[0].path, mock.calls[0].query], ['GET', '/one', { x: '1' }]);
    assert.equal(mock.calls[1].headers['x-client'], 'a');
    assert.equal(mock.calls[1].headers['x-req'], 'b');
    assert.deepEqual(mock.calls[1].body, { n: 2 });
    assert.equal(mock.calls[2].body, 'plain text');
    mock.reset();
    assert.equal(mock.calls.length, 0);
    await assert.rejects(client(mock).get('/x'), (e) => e.kind === 'NetworkError' && /No mock response/.test(e.message));
  });

  it('encodes bodies and decodes them for the response type', async () => {
    const mock = createMockTransport()
      .on('GET', '/json', { body: { a: 1 } })
      .on('GET', '/text', { body: 'hello' })
      .on('GET', '/bytes', { body: new Uint8Array([1, 2, 3]) })
      .on('GET', '/empty', { status: 204 })
      .on('GET', '/bad-json', { body: 'not json', headers: { 'content-type': 'application/json' } });
    const c = client(mock);
    assert.deepEqual((await c.get('/json')).body, { a: 1 });
    assert.equal((await c.get('/json', { responseType: 'text' })).body, '{"a":1}');
    assert.equal((await c.get('/text')).body, 'hello');
    assert.deepEqual([...(await c.get('/bytes')).body], [1, 2, 3]);
    assert.deepEqual([...(await c.get('/json', { responseType: 'binary' })).body], [...Buffer.from('{"a":1}')]);
    assert.equal((await c.get('/empty')).body, null);
    assert.equal((await c.get('/bad-json')).body, 'not json'); // mislabelled: falls back to text, as on the network
    assert.equal((await rejection(c.get('/bad-json', { responseType: 'json' }))).kind, 'ParseError');
  });

  it('runs the real retry policy against it', async () => {
    let hits = 0;
    const mock = createMockTransport().on('GET', '/flaky', () => (++hits < 3 ? { status: 503, headers: { 'retry-after': '0' } } : { body: { hits } }));
    const c = client(mock, { retries: { maxRetries: 3, initialDelayMs: 1 } });
    const response = await c.get('/flaky');
    assert.deepEqual([response.body.hits, mock.calls.length], [3, 3]);
    const failing = createMockTransport().onAny({ status: 500 });
    await rejection(client(failing, { retries: { maxRetries: 2, initialDelayMs: 1 } }).get('/x'));
    assert.equal(failing.calls.length, 3);
    // POST without an idempotency key is not retried
    await rejection(client(failing, { retries: 2 }).post('/x', { body: {} }));
    assert.equal(failing.calls.length, 4);
  });

  it('turns an error into a NetworkError, and a slow answer into a TimeoutError', async () => {
    const mock = createMockTransport()
      .on('GET', '/down', { error: 'connection refused' })
      .on('GET', '/thrown', () => { throw new Error('handler failed'); })
      .on('GET', '/slow', { delayMs: 2000, body: 'late' });
    const c = client(mock);
    const down = await rejection(c.get('/down'));
    assert.equal(down.kind, 'NetworkError');
    assert.match(down.message, /connection refused/);
    assert.equal((await rejection(c.get('/thrown'))).kind, 'NetworkError');
    const started = Date.now();
    const slow = await rejection(c.get('/slow', { timeoutMs: 50 }));
    assert.equal(slow.kind, 'TimeoutError');
    assert.ok(Date.now() - started < 1000);
    const response = await rejection(c.get('/slow', { responseTimeoutMs: 40 }));
    assert.deepEqual([response.kind, response.phase], ['TimeoutError', 'response']);
  });

  it('is cancelled by an abort signal, with the reason', async () => {
    const mock = createMockTransport().onAny({ delayMs: 5000 });
    const controller = new AbortController();
    const pending = client(mock).get('/hang', { signal: controller.signal });
    setTimeout(() => controller.abort('stop'), 20);
    const started = Date.now();
    const error = await rejection(pending);
    assert.deepEqual([error.kind, error.reason], ['CancelledError', 'stop']);
    assert.ok(Date.now() - started < 1000);
  });

  it('does not support streamed responses, and says so', async () => {
    const mock = createMockTransport().onAny({ body: 'x' });
    const error = await rejection(client(mock).get('/s', { responseType: 'stream' }));
    assert.equal(error.kind, 'NetworkError');
    assert.match(error.message, /streamed/);
  });

  it('is kept by extend() and used by every request method', async () => {
    const mock = createMockTransport().onAny(({ method }) => ({ body: { method } }));
    const c = client(mock).extend({ headers: { 'X-D': '1' } });
    for (const [method, call] of [['GET', () => c.get('/m')], ['HEAD', () => c.head('/m')], ['DELETE', () => c.delete('/m')], ['PUT', () => c.put('/m', { body: {} })], ['PATCH', () => c.patch('/m', { body: {} })],
      ['POST', () => c.post_json('/m', { a: 1 })], ['PUT', () => c.put_json('/m', { a: 1 })], ['PATCH', () => c.patch_json('/m', { a: 1 })], ['GET', () => c.fetch('/m')], ['OPTIONS', () => c.request('OPTIONS', '/m', undefined, undefined, {})]]) {
      await call();
      assert.equal(mock.calls.at(-1).method, method);
    }
    assert.equal(mock.calls.at(-1).headers['x-d'], '1');
  });

  it('rejects a transport that is not a function', () => {
    for (const bad of ['x', 1, {}, true]) {
      assert.throws(() => new WasmClient({ transport: bad }), (e) => e.kind === 'InvalidInputError' && e.parameter === 'transport');
    }
  });
});

describe('the transport option and the real network', () => {
  let server;
  before(async () => { server = await startServer((req, res) => json(res, { real: true })); });
  after(() => server.close());

  it('leaves clients without a transport on the network, even if Object.prototype is polluted', async () => {
    const hijack = () => { throw new Error('hijacked'); };
    Object.prototype.__transport = hijack;
    try {
      const response = await new WasmClient().get(server.url('/real'));
      assert.deepEqual(response.body, { real: true });
      class Options { responseType = 'json'; }
      assert.deepEqual((await new WasmClient().get(server.url('/real'), new Options())).body, { real: true });
    } finally {
      delete Object.prototype.__transport;
    }
  });
});
