// End-to-end tests of the built package (wasm-module/pkg) against a local server.
// Run `npm run build` first, then `npm run test:js`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import init, {
  WasmClient,
  create_client,
  fetch_json,
  fetch_json_promise,
  fetch_text,
  fetch_with_options,
  fetch_wasm_api,
  fetch_wasm_html,
  fetch_wasm_json,
  fetch_wasm_map,
} from '../../pkg/node.js';
import { json, rejection, sleep, startServer } from './helpers.mjs';

let server;
const failedOnce = new Set();

before(async () => {
  server = await startServer(async (req, res, ctx) => {
    const url = new URL(req.url, 'http://x');
    switch (url.pathname) {
      case '/json':
        return json(res, '{"user":{"id":12345678901234567890,"name":"Zoë"},"tags":["a","b"]}');
      case '/problem':
        return json(res, { title: 'Invalid' }, { status: 200, type: 'application/problem+json' });
      case '/mislabelled':
        return json(res, 'not json at all', { type: 'application/json' });
      case '/text':
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('﻿hello wörld');
      case '/html':
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<html><body>hi</body></html>');
      case '/binary':
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(Buffer.from([0, 1, 2, 255]));
      case '/decode':
        res.writeHead(200, { 'content-type': url.searchParams.get('type') ?? 'text/plain' });
        return res.end(Buffer.from(url.searchParams.get('hex') ?? '', 'hex'));
      case '/cookies':
        res.writeHead(200, { 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'], 'content-type': 'text/plain' });
        return res.end('cookies');
      case '/raw-json-text':
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('{"raw":true}');
      case '/empty':
        res.writeHead(204);
        return res.end();
      case '/echo':
      case '/api/v1/items':
        return json(res, {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: req.body.toString('utf8'),
          bytes: [...req.body],
        });
      case '/status': {
        const code = Number(url.searchParams.get('code'));
        res.writeHead(code, { 'content-type': 'text/plain', ...(code === 429 ? { 'retry-after': '0' } : {}) });
        return res.end(url.searchParams.get('body') ?? `status ${code}`);
      }
      case '/huge-error':
        res.writeHead(500, { 'content-type': 'text/html' });
        return res.end('<html>' + 'x'.repeat(5000) + '</html>');
      case '/redirect':
        res.writeHead(302, { location: '/json' });
        return res.end();
      case '/slow':
        await sleep(Number(url.searchParams.get('ms') ?? 2000));
        return json(res, { slow: true });
      case '/stream': {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('first,');
        await sleep(300);
        res.write('second,');
        await sleep(Number(url.searchParams.get('pause') ?? 0));
        return res.end('third');
      }
      case '/auth':
        if (req.headers.authorization !== 'Bearer fresh') {
          res.writeHead(401, { 'content-type': 'text/plain' });
          return res.end('token expired');
        }
        return json(res, { secret: 42 });
      case '/fails-once': {
        // 503 for the first request with each id, then an echo of the body length
        const id = url.searchParams.get('id');
        if (!failedOnce.has(id)) {
          failedOnce.add(id);
          res.writeHead(503, { 'content-type': 'text/plain' });
          return res.end('try again');
        }
        return json(res, { received: req.body.length });
      }
      case '/ndjson': {
        // Lines split across writes, a CRLF, an empty line and no final newline
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write('{"n":1}\n{"n"');
        await sleep(10);
        res.write(':2}\r\n\n{"text":"Zo');
        await sleep(10);
        return res.end('ë 🦀"}');
      }
      case '/ndjson-bad':
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        return res.end('{"ok":true}\nnot json\n{"ok":false}\n');
      case '/large': {
        const size = Number(url.searchParams.get('mb')) * 1024 * 1024;
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size });
        const buf = Buffer.alloc(size);
        for (let i = 0; i < size; i++) buf[i] = i % 251;
        return res.end(buf);
      }
      default:
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('no route ' + url.pathname);
    }
  });
});

after(() => server.close());

const client = () => new WasmClient();
const echo = async (promise) => (await promise).body;

describe('initialization', () => {
  it('needs no init() in Node.js, and init() stays callable', async () => {
    const exports = await init();
    assert.ok(exports.memory instanceof WebAssembly.Memory);
    await init(); // repeated calls are no-ops
    assert.equal((await client().get(server.url('/json'))).status, 200);
  });
});

describe('responses', () => {
  it('keeps buffered decoding equivalent to the incremental progress path', async () => {
    const c = client();
    const fixtures = [
      ['', 'application/json'],
      ['efbbbf', 'text/plain'],
      ['efbbbf', 'application/json'],
      ['efbbbf', 'application/octet-stream'],
      ['efbbbf7b2261223a317d', 'application/json'],
      ['6680', 'text/plain; charset=iso-8859-1'],
      ['7b2261223a2280227d', 'application/json'],
      ['7b', 'application/json'],
      ['00ff0102', 'application/octet-stream'],
    ];
    for (const [hex, type] of fixtures) {
      const url = server.url('/decode?' + new URLSearchParams({ hex, type }));
      for (const responseType of ['auto', 'json', 'text', 'binary']) {
        const outcome = async (options) => {
          try {
            return { body: (await c.get(url, options)).body };
          } catch (error) {
            return { error: error.kind };
          }
        };
        const buffered = await outcome({ responseType });
        const incremental = await outcome({ responseType, onDownloadProgress() {} });
        assert.deepEqual(buffered, incremental, `${hex}, ${type}, ${responseType}`);
      }
    }
    const bom = server.url('/decode?' + new URLSearchParams({ hex: 'efbbbf', type: 'application/json' }));
    assert.equal((await c.get(bom)).body, '');
    assert.equal((await rejection(c.get(bom, { responseType: 'json' }))).kind, 'ParseError');
  });

  it('keeps repeated response headers when using the buffered path', async () => {
    const c = client();
    const buffered = await c.get(server.url('/cookies'));
    const incremental = await c.get(server.url('/cookies'), { onDownloadProgress() {} });
    assert.equal(buffered.headers['set-cookie'], 'a=1; Path=/, b=2; Path=/');
    assert.equal(buffered.headers['set-cookie'], incremental.headers['set-cookie']);
  });

  it('parses JSON into plain objects, keeping big integers as numbers', async () => {
    const res = await client().get(server.url('/json'));
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
    assert.equal(res.statusText, 'OK');
    assert.equal(Object.getPrototypeOf(res.body), Object.prototype);
    assert.equal(res.body.user.name, 'Zoë');
    assert.equal(res.body.user.id, 12345678901234567890);
    assert.deepEqual(res.body.tags, ['a', 'b']);
    assert.equal(res.headers['content-type'], 'application/json');
    assert.equal(res.url, server.url('/json'));
  });

  it('auto-detects +json, text, html and binary', async () => {
    const c = client();
    assert.deepEqual((await c.get(server.url('/problem'))).body, { title: 'Invalid' });
    assert.equal((await c.get(server.url('/text'))).body, 'hello wörld');
    assert.match((await c.get(server.url('/html'))).body, /<body>hi/);
    const binary = (await c.get(server.url('/binary'))).body;
    assert.ok(binary instanceof Uint8Array);
    assert.deepEqual([...binary], [0, 1, 2, 255]);
    assert.equal((await c.get(server.url('/mislabelled'))).body, 'not json at all');
  });

  it('honours responseType', async () => {
    const c = client();
    assert.deepEqual((await c.get(server.url('/raw-json-text'), { responseType: 'json' })).body, { raw: true });
    assert.equal((await c.get(server.url('/json'), { responseType: 'text' })).body.startsWith('{"user"'), true);
    assert.ok((await c.get(server.url('/text'), { responseType: 'binary' })).body instanceof Uint8Array);
    assert.equal((await c.get(server.url('/text'), { responseType: 'auto' })).body, 'hello wörld');
    const error = await rejection(c.get(server.url('/text'), { responseType: 'json' }));
    assert.equal(error.kind, 'ParseError');
  });

  it('returns null / "" / empty bytes for empty bodies', async () => {
    const c = client();
    assert.equal((await c.get(server.url('/empty'))).body, null);
    assert.equal((await c.get(server.url('/empty'), { responseType: 'json' })).body, null);
    assert.equal((await c.get(server.url('/empty'), { responseType: 'text' })).body, '');
    assert.equal((await c.get(server.url('/empty'), { responseType: 'binary' })).body.length, 0);
    assert.equal((await c.head(server.url('/json'))).body, null);
  });

  it('follows redirects and reports the final URL', async () => {
    const res = await client().get(server.url('/redirect'));
    assert.equal(res.url, server.url('/json'));
    assert.equal(res.body.user.name, 'Zoë');
  });

  it('handles large bodies', async () => {
    const res = await client().get(server.url('/large?mb=16'), { timeoutMs: 30000 });
    assert.equal(res.body.length, 16 * 1024 * 1024);
    assert.equal(res.body[1000], 1000 % 251);
  });
});

describe('per-request overhead', () => {
  // 2.5.0 read an option with Reflect.get even without an options object,
  // which throws on undefined: an exception per request, +91% client
  // overhead (fixed in 2.5.1). No lookup may target a non-object.
  it('makes no option lookup that throws, with or without options', async () => {
    const original = Reflect.get;
    let throwing = 0;
    Reflect.get = function (target, ...rest) {
      if (target === null || (typeof target !== 'object' && typeof target !== 'function')) throwing++;
      return original.call(this, target, ...rest);
    };
    try {
      const c = client();
      for (let i = 0; i < 20; i++) await c.get(server.url('/echo'));
      for (let i = 0; i < 20; i++) await c.get(server.url('/echo'), { responseType: 'json' });
    } finally {
      Reflect.get = original;
    }
    assert.equal(throwing, 0);
  });
});

describe('allowAbsoluteUrls', () => {
  it('keeps absolute URLs, and the client credentials, from replacing baseUrl', async () => {
    const other = await startServer((req, res) => json(res, { other: true }));
    try {
      const c = new WasmClient({ baseUrl: server.url('/api/v1'), headers: { authorization: 'Bearer SECRET' }, allowAbsoluteUrls: false });
      for (const run of [() => c.get(other.url('/steal')), () => c.get(other.url('/steal'), { responseType: 'stream' }), () => c.fetch(other.url('/steal'), { method: 'POST', body: 'x' })]) {
        const error = await rejection(run());
        assert.equal(error.kind, 'InvalidInputError');
        assert.equal(error.parameter, 'url');
        assert.match(error.message, /absolute URL/);
      }
      assert.throws(() => c.events(other.url('/steal')), (error) => error.kind === 'InvalidInputError' && error.parameter === 'url');
      assert.equal(other.requests.length, 0, 'nothing reaches the other host');
      // Paths stay under baseUrl; a request can opt in
      assert.equal((await c.get('/items')).body.url, '/api/v1/items');
      const relative = await rejection(c.get('//elsewhere.example/x'));
      assert.match(relative.body, /no route \/api\/v1\/elsewhere\.example\/x/); // answered by the base host
      assert.deepEqual((await c.get(other.url('/'), { allowAbsoluteUrls: true })).body, { other: true });
      // On by default, as before
      assert.deepEqual((await new WasmClient({ baseUrl: server.url('/api/v1') }).get(other.url('/'))).body, { other: true });
    } finally {
      await other.close();
    }
  });

  it('is validated', async () => {
    assert.throws(() => new WasmClient({ allowAbsoluteUrls: 'no' }), (error) => error.kind === 'InvalidInputError' && error.parameter === 'allowAbsoluteUrls');
    const error = await rejection(client().get(server.url('/echo'), { allowAbsoluteUrls: 1 }));
    assert.equal(error.parameter, 'allowAbsoluteUrls');
    assert.throws(() => client().events(server.url('/echo'), { allowAbsoluteUrls: 1 }), (e) => e.parameter === 'allowAbsoluteUrls');
  });
});

describe('maxPendingRequests', () => {
  const slow = async () =>
    startServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/fail') {
        res.writeHead(503);
        return res.end('busy');
      }
      if (url.pathname !== '/hang') await sleep(200);
      if (url.pathname !== '/hang') json(res, { path: url.pathname });
    });

  it('refuses a request beyond the limit at once, without sending it', async () => {
    const s = await slow();
    try {
      const c = new WasmClient({ maxPendingRequests: 2 });
      const first = [c.get(s.url('/a')), c.get(s.url('/b'), { responseType: 'stream' })];
      const started = performance.now();
      const error = await rejection(c.get(s.url('/c')));
      assert.ok(performance.now() - started < 100, 'refused at once');
      assert.equal(error.kind, 'NetworkError');
      assert.equal(error.maxPendingRequests, 2);
      assert.match(error.message, /Too many pending requests \(maxPendingRequests is 2\)/);
      await Promise.all(first);
      assert.deepEqual(s.requests.map((r) => r.url).sort(), ['/a', '/b'], 'the refused request was never sent');
      // Settled requests free their places
      assert.deepEqual((await Promise.all([c.get(s.url('/d')), c.get(s.url('/e'))])).map((r) => r.body.path), ['/d', '/e']);
      // Other clients have their own count
      assert.equal((await new WasmClient().get(s.url('/f'))).body.path, '/f');
    } finally {
      await s.close();
    }
  });

  it('frees a place when a request fails, times out or is cancelled', async () => {
    const s = await slow();
    try {
      const c = new WasmClient({ maxPendingRequests: 1 });
      assert.equal((await rejection(c.get(s.url('/fail')))).kind, 'HttpError');
      assert.equal((await rejection(c.get(s.url('/hang'), { timeoutMs: 50 }))).kind, 'TimeoutError');
      const controller = new AbortController();
      const cancelled = c.get(s.url('/hang'), { signal: controller.signal });
      assert.equal((await rejection(c.get(s.url('/x')))).maxPendingRequests, 1);
      controller.abort();
      assert.equal((await rejection(cancelled)).kind, 'CancelledError');
      assert.equal((await c.get(s.url('/after'))).body.path, '/after');
    } finally {
      await s.close();
    }
  });

  it('counts a request once across its retries', async () => {
    const s = await slow();
    try {
      const c = new WasmClient({ maxPendingRequests: 1, retries: { maxRetries: 2, initialDelayMs: 100 } });
      const retrying = rejection(c.get(s.url('/fail')));
      await sleep(50);
      assert.equal((await rejection(c.get(s.url('/x')))).maxPendingRequests, 1, 'still pending between attempts');
      assert.equal((await retrying).kind, 'HttpError');
      assert.equal(s.requests.filter((r) => r.url === '/fail').length, 3);
      assert.equal((await c.get(s.url('/after'))).body.path, '/after');
    } finally {
      await s.close();
    }
  });

  it('is validated', () => {
    for (const value of [0, -1, 1.5, '2', Infinity]) {
      assert.throws(
        () => new WasmClient({ maxPendingRequests: value }),
        (error) => error.kind === 'InvalidInputError' && error.parameter === 'maxPendingRequests',
        String(value),
      );
    }
  });
});

describe('browser fetch() options in Node.js', () => {
  const valid = {
    credentials: 'include',
    mode: 'same-origin',
    cache: 'no-store',
    keepalive: true,
    priority: 'high',
    referrer: '',
    referrerPolicy: 'no-referrer',
    integrity: '',
  };

  it('are accepted on the client and per request, and ignored', async () => {
    const res = await new WasmClient(valid).get(server.url('/echo'), valid);
    assert.equal(res.body.method, 'GET');
    const events = [];
    const stream = new WasmClient(valid).events(server.url('/echo'), { ...valid, reconnect: false, onError: (e) => events.push(e.kind) });
    await stream.closed;
    assert.deepEqual(events, ['ParseError']); // /echo isn't an event stream; the request itself went through
  });

  it('are validated', async () => {
    const invalid = {
      credentials: 'all',
      mode: 'navigate',
      cache: 'none',
      keepalive: 'yes',
      priority: 1,
      referrer: 1,
      referrerPolicy: 'never',
      integrity: 42,
    };
    for (const [parameter, value] of Object.entries(invalid)) {
      assert.throws(() => new WasmClient({ [parameter]: value }), (error) => error.kind === 'InvalidInputError' && error.parameter === parameter);
      const error = await rejection(client().get(server.url('/echo'), { [parameter]: value }));
      assert.equal(error.kind, 'InvalidInputError', parameter);
      assert.equal(error.parameter, parameter);
    }
    const error = await rejection(client().get(server.url('/echo'), { cache: 'none' }));
    assert.match(error.message, /must be one of 'default', 'no-store'/);
  });
});

describe('requests', () => {
  it('sends every HTTP method', async () => {
    const c = client();
    const methods = [
      await echo(c.get(server.url('/echo'))),
      await echo(c.delete(server.url('/echo'))),
      await echo(c.post(server.url('/echo'))),
      await echo(c.put(server.url('/echo'))),
      await echo(c.patch(server.url('/echo'))),
      await echo(c.fetch(server.url('/echo'), { method: 'options' })),
    ].map((r) => r.method);
    assert.deepEqual(methods, ['GET', 'DELETE', 'POST', 'PUT', 'PATCH', 'OPTIONS']);
    for (const forbidden of ['TRACE', 'connect']) {
      const error = await rejection(c.request(forbidden, server.url('/echo')));
      assert.equal(error.parameter, 'method');
      assert.match(error.message, /not supported by fetch/);
    }
    assert.equal((await c.fetch(server.url('/echo'))).body.method, 'GET');
    assert.equal((await c.head(server.url('/echo'))).status, 200);
  });

  it('encodes each body type with a matching Content-Type', async () => {
    const c = client();
    const cases = [
      ['text', 'plain', 'text/plain', 'plain'],
      ['object', { a: 1, d: new Date(0) }, 'application/json', '{"a":1,"d":"1970-01-01T00:00:00.000Z"}'],
      ['array', [1, 'two'], 'application/json', '[1,"two"]'],
      ['number', 42, 'application/json', '42'],
      ['boolean', false, 'application/json', 'false'],
      ['form', new URLSearchParams({ q: 'a b', x: '1' }), 'application/x-www-form-urlencoded;charset=UTF-8', 'q=a+b&x=1'],
    ];
    for (const [name, body, type, text] of cases) {
      const res = await echo(c.post(server.url('/echo'), { body }));
      assert.equal(res.headers['content-type'], type, name);
      assert.equal(res.body, text, name);
    }

    const bytes = new Uint8Array([9, 1, 2, 3, 9]);
    for (const body of [bytes, bytes.buffer, new DataView(bytes.buffer, 1, 3), Buffer.from(bytes)]) {
      const res = await echo(c.put(server.url('/echo'), { body }));
      assert.equal(res.headers['content-type'], 'application/octet-stream');
      assert.ok(res.bytes.length === 5 || res.bytes.length === 3);
    }
    const view = await echo(c.put(server.url('/echo'), { body: new DataView(bytes.buffer, 1, 3) }));
    assert.deepEqual(view.bytes, [1, 2, 3]);
  });

  it('keeps an explicit Content-Type and never duplicates it', async () => {
    const res = await echo(
      fetch_with_options(server.url('/echo'), 'POST', { 'Content-Type': 'application/json' }, '{"q":1}'),
    );
    assert.equal(res.headers['content-type'], 'application/json');
    assert.equal(res.body, '{"q":1}');

    const custom = await echo(
      client().post(server.url('/echo'), { body: { a: 1 }, headers: { 'content-type': 'application/vnd.api+json' } }),
    );
    assert.equal(custom.headers['content-type'], 'application/vnd.api+json');
  });

  it('*_json methods always send JSON', async () => {
    const c = client();
    assert.equal((await echo(c.post_json(server.url('/echo'), 'str'))).body, '"str"');
    assert.equal((await echo(c.put_json(server.url('/echo'), { a: [1] }))).body, '{"a":[1]}');
    assert.equal((await echo(c.patch_json(server.url('/echo'), null))).body, 'null');
  });

  it('accepts every headers shape and lets request headers override defaults', async () => {
    const c = new WasmClient({ headers: { Authorization: 'Bearer default', 'X-Client': 'rust-fetch' } });
    const shapes = [
      { 'X-Test': 'object', 'X-Num': 1 },
      new Headers({ 'X-Test': 'headers', 'X-Num': '1' }),
      new Map([['X-Test', 'map'], ['X-Num', '1']]),
      [['X-Test', 'array'], ['X-Num', '1']],
    ];
    for (const headers of shapes) {
      const res = await echo(c.get(server.url('/echo'), { headers }));
      assert.ok(['object', 'headers', 'map', 'array'].includes(res.headers['x-test']));
      assert.equal(res.headers['x-num'], '1');
      assert.equal(res.headers['x-client'], 'rust-fetch');
    }
    const overridden = await echo(c.get(server.url('/echo'), { headers: { authorization: 'Bearer mine' } }));
    assert.equal(overridden.headers.authorization, 'Bearer mine');
    const legacy = await echo(c.request('GET', server.url('/echo'), { 'X-Legacy': 'yes' }));
    assert.equal(legacy.headers['x-legacy'], 'yes');
  });

  it('appends query params', async () => {
    const c = client();
    const res = await echo(
      c.get(server.url('/echo?keep=1'), { params: { q: 'a b&c', page: 2, ok: true, tags: ['x', 'y'], skip: null } }),
    );
    assert.equal(res.url, '/echo?keep=1&q=a+b%26c&page=2&ok=true&tags=x&tags=y');
    const fromSearchParams = await echo(c.get(server.url('/echo'), { params: new URLSearchParams('a=1&a=2') }));
    assert.equal(fromSearchParams.url, '/echo?a=1&a=2');
  });

  it('joins baseUrl with relative URLs; absolute URLs win', async () => {
    const c = new WasmClient({ baseUrl: server.url('/api/') });
    assert.equal((await echo(c.get('/v1/items'))).url, '/api/v1/items');
    assert.equal((await echo(c.get('v1/items'))).url, '/api/v1/items');
    assert.equal((await echo(c.get(server.url('/echo')))).url, '/echo');
  });

  it('runs many requests concurrently', async () => {
    const c = client();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => c.get(server.url(`/echo?i=${i}`))),
    );
    results.forEach((res, i) => assert.equal(res.body.url, `/echo?i=${i}`));
  });
});

describe('errors', () => {
  it('rejects non-2xx responses with an HttpError', async () => {
    const error = await rejection(client().get(server.url('/status?code=404&body=no%20such%20user')));
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'HttpError');
    assert.equal(error.kind, 'HttpError');
    assert.equal(error.status, 404);
    assert.equal(error.statusText, 'Not Found');
    assert.equal(error.body, 'no such user');
    assert.equal(error.message, 'HTTP error 404: Not Found - no such user');
    assert.ok(error.stack);
  });

  it('truncates huge error bodies in the message but keeps the full body', async () => {
    const error = await rejection(client().get(server.url('/huge-error')));
    assert.ok(error.message.length < 300);
    assert.equal(error.body.length, 5013);
  });

  it('reports network failures as NetworkError', async () => {
    const closed = await startServer(() => {});
    const url = closed.url('/');
    await closed.close();
    const error = await rejection(client().get(url));
    assert.equal(error.kind, 'NetworkError');
  });

  it('validates input before sending anything', async () => {
    const before = server.requests.length;
    const c = client();
    const cases = [
      [c.get('/no-base-url'), 'url'],
      [c.get('ftp://example.com'), 'url'],
      [c.request('BREW', server.url('/echo')), 'method'],
      [c.get(server.url('/echo'), { responseType: 'xml' }), 'responseType'],
      [c.get(server.url('/echo'), { timeoutMs: -5 }), 'timeoutMs'],
      [c.get(server.url('/echo'), { signal: 'nope' }), 'signal'],
      [c.get(server.url('/echo'), { headers: { 'bad header': 'x' } }), 'request'],
      [c.get(server.url('/echo'), { headers: { 'x-ok': 'line\nbreak' } }), 'request'],
      [c.post(server.url('/echo'), { body: new ReadableStream() }), 'body'],
      [c.post(server.url('/echo'), { body: 10n }), 'body'],
    ];
    for (const [promise, parameter] of cases) {
      const error = await rejection(promise);
      assert.equal(error.kind, 'InvalidInputError', parameter);
      assert.equal(error.parameter, parameter);
    }
    assert.equal(server.requests.length, before);
  });

  it('throws synchronously for invalid client options', () => {
    for (const options of [{ baseUrl: 'example.com' }, { timeoutMs: 'soon' }, { retries: -1 }, { headers: 5 }]) {
      assert.throws(() => new WasmClient(options), (e) => e instanceof Error && e.kind === 'InvalidInputError');
    }
  });
});

describe('timeouts', () => {
  it('keeps the timeout active while collecting a response body', async () => {
    const error = await rejection(client().get(server.url('/stream'), { timeoutMs: 50 }));
    assert.equal(error.kind, 'TimeoutError');
    assert.equal(error.timeoutMs, 50);
  });

  it('fails slow requests with a TimeoutError', async () => {
    const c = new WasmClient({ timeoutMs: 100 });
    const started = Date.now();
    const error = await rejection(c.get(server.url('/slow?ms=3000')));
    assert.equal(error.kind, 'TimeoutError');
    assert.equal(error.timeoutMs, 100);
    assert.ok(Date.now() - started < 1500);
  });

  it('per-request timeoutMs overrides the client default, 0 disables it', async () => {
    const c = new WasmClient({ timeoutMs: 50 });
    assert.equal((await c.get(server.url('/slow?ms=200'), { timeoutMs: 2000 })).body.slow, true);
    assert.equal((await c.get(server.url('/slow?ms=200'), { timeoutMs: 0 })).body.slow, true);
    const quick = await rejection(client().get(server.url('/slow?ms=500'), { timeoutMs: 50 }));
    assert.equal(quick.timeoutMs, 50);
  });
});

describe('retries', () => {
  const flaky = async (failures, status = 503, extraHeaders = {}) =>
    startServer((req, res, ctx) => {
      if (ctx.count < failures) {
        res.writeHead(status, extraHeaders);
        return res.end('fail ' + ctx.count);
      }
      json(res, { attempt: ctx.count });
    });

  it('reports truncated bodies as NetworkError and retries them when configured', async () => {
    const s = await startServer((req, res, ctx) => {
      if (ctx.count < 2) {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' });
        res.write('incomplete');
        setTimeout(() => res.destroy(), 10);
      } else {
        json(res, { complete: true });
      }
    });
    try {
      const error = await rejection(client().get(s.url()));
      assert.equal(error.kind, 'NetworkError');
      const c = new WasmClient({ retries: { maxRetries: 1, initialDelayMs: 1 } });
      assert.deepEqual((await c.get(s.url())).body, { complete: true });
      assert.equal(s.requests.length, 3);
    } finally {
      await s.close();
    }
  });

  it('retries retryable statuses with backoff, then succeeds', async () => {
    const s = await flaky(2);
    const c = new WasmClient({ retries: { maxRetries: 3, initialDelayMs: 10 } });
    assert.equal((await c.get(s.url())).body.attempt, 2);
    assert.equal(s.requests.length, 3);
    await s.close();
  });

  it('gives up after maxRetries with the last error', async () => {
    const s = await flaky(10, 502);
    const c = new WasmClient({ retries: { maxRetries: 2, initialDelayMs: 5 } });
    const error = await rejection(c.get(s.url()));
    assert.equal(error.status, 502);
    assert.equal(error.body, 'fail 2');
    assert.equal(s.requests.length, 3);
    await s.close();
  });

  it('honours Retry-After, capped at maxDelayMs', async () => {
    const s = await flaky(1, 429, { 'retry-after': '120' });
    const c = new WasmClient({ retries: { maxRetries: 1, maxDelayMs: 100 } });
    const started = Date.now();
    assert.equal((await c.get(s.url())).status, 200);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 90 && elapsed < 2000, `elapsed ${elapsed}ms`);
    await s.close();
  });

  it('does not retry POST unless retryNonIdempotent is set', async () => {
    const s = await flaky(1);
    const error = await rejection(new WasmClient({ retries: 3 }).post(s.url(), { body: 'x' }));
    assert.equal(error.status, 503);
    assert.equal(s.requests.length, 1);
    const c = new WasmClient({ retries: { maxRetries: 3, initialDelayMs: 5, retryNonIdempotent: true } });
    assert.equal((await c.post(s.url(), { body: 'x' })).status, 200);
    await s.close();
  });

  it('only retries configured statuses', async () => {
    const s = await flaky(1, 409);
    const error = await rejection(new WasmClient({ retries: 3 }).get(s.url()));
    assert.equal(error.status, 409);
    const c = new WasmClient({ retries: { retryOn: [409], initialDelayMs: 5 } });
    assert.equal((await c.get(s.url())).status, 200);
    await s.close();
  });

  it('retries timeouts', async () => {
    const s = await startServer(async (req, res, ctx) => {
      if (ctx.count === 0) await sleep(1000);
      json(res, { attempt: ctx.count });
    });
    const c = new WasmClient({ timeoutMs: 100, retries: { maxRetries: 1, initialDelayMs: 5 } });
    assert.equal((await c.get(s.url())).body.attempt, 1);
    await s.close();
  });
});

describe('retryBudget', () => {
  // Always 503, except paths starting with /once, which fail once each and then succeed
  const upstream = async () => {
    const seen = new Set();
    return startServer((req, res) => {
      if (req.url.startsWith('/once') && seen.has(req.url)) return json(res, { ok: true });
      seen.add(req.url);
      res.writeHead(503);
      res.end('busy');
    });
  };
  const retries = { maxRetries: 3, initialDelayMs: 1 };

  it('limits retries against a failing upstream, keeps the error, and refills', async () => {
    const s = await upstream();
    try {
      // One retry per 500 ms window, whatever the traffic
      const c = new WasmClient({ retries, retryBudget: { ratio: 0, minPerSecond: 2, windowMs: 500 } });
      const first = await rejection(c.get(s.url('/fail')));
      assert.equal(first.kind, 'HttpError');
      assert.equal(first.status, 503, 'the attempt’s own error');
      assert.equal(first.retryBudgetExhausted, true);
      assert.equal(s.requests.length, 2, 'the first attempt and one retry');
      const second = await rejection(c.get(s.url('/fail')));
      assert.equal(second.retryBudgetExhausted, true);
      assert.equal(s.requests.length, 3, 'first attempts are always sent');
      assert.equal(c.retriesRefused, 2);
      // A failure that wasn't going to be retried isn't marked
      assert.equal((await rejection(c.post(s.url('/fail'), { body: 'x' }))).retryBudgetExhausted, undefined);
      // The window moves on and the budget refills
      await sleep(600);
      assert.deepEqual((await c.get(s.url('/once-a'))).body, { ok: true });
      assert.equal(c.retriesRefused, 2);
    } finally {
      await s.close();
    }
  });

  it('spends nothing for a request cancelled while waiting to retry', async () => {
    const s = await upstream();
    try {
      // One retry per 10 s window
      const c = new WasmClient({ retries: { maxRetries: 1, initialDelayMs: 300 }, retryBudget: { ratio: 0, minPerSecond: 0.1 } });
      const controller = new AbortController();
      const cancelled = c.get(s.url('/once-a'), { signal: controller.signal });
      await sleep(100); // the first attempt failed; waiting 300 ms to retry
      controller.abort();
      assert.equal((await rejection(cancelled)).kind, 'CancelledError');
      assert.deepEqual((await c.get(s.url('/once-b'))).body, { ok: true }, 'the window’s one retry was still there');
      assert.equal(c.retriesRefused, 0);
    } finally {
      await s.close();
    }
  });

  it('is off by default, true takes the defaults, and options are validated', async () => {
    const s = await upstream();
    try {
      assert.equal(new WasmClient().retriesRefused, 0);
      const error = await rejection(new WasmClient({ retries }).get(s.url('/fail')));
      assert.equal(error.retryBudgetExhausted, undefined);
      assert.equal(s.requests.length, 4, 'no budget: every retry');
      assert.equal((await rejection(new WasmClient({ retries, retryBudget: true }).get(s.url('/fail')))).retryBudgetExhausted, undefined, 'the default minimum allows these retries');
      new WasmClient({ retryBudget: false });
    } finally {
      await s.close();
    }
    const invalid = (retryBudget, parameter) =>
      assert.throws(() => new WasmClient({ retryBudget }), (e) => e.kind === 'InvalidInputError' && e.parameter === parameter, parameter);
    invalid('yes', 'retryBudget');
    invalid({ ratio: -1 }, 'retryBudget.ratio');
    invalid({ ratio: 'x' }, 'retryBudget.ratio');
    invalid({ minPerSecond: Infinity }, 'retryBudget.minPerSecond');
    invalid({ windowMs: 0 }, 'retryBudget.windowMs');
    invalid({ windowMs: -1 }, 'retryBudget.windowMs');
  });
});

describe('cancellation', () => {
  it('cancels while collecting a response body after headers arrive', async () => {
    const error = await rejection(client().get(server.url('/stream'), { signal: AbortSignal.timeout(50) }));
    assert.equal(error.kind, 'CancelledError');
  });

  it('rejects with CancelledError when the signal aborts mid-request', async () => {
    const controller = new AbortController();
    const promise = client().get(server.url('/slow?ms=3000'), { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const started = Date.now();
    const error = await rejection(promise);
    assert.equal(error.kind, 'CancelledError');
    assert.equal(error.name, 'CancelledError');
    assert.ok(Date.now() - started < 1000);
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const before = server.requests.length;
    const error = await rejection(client().get(server.url('/json'), { signal: AbortSignal.abort() }));
    assert.equal(error.kind, 'CancelledError');
    assert.equal(server.requests.length, before);
  });

  it('cancels during retry backoff', async () => {
    const s = await startServer((req, res) => {
      res.writeHead(503);
      res.end();
    });
    const c = new WasmClient({ retries: { maxRetries: 5, initialDelayMs: 5000 } });
    const started = Date.now();
    const error = await rejection(c.get(s.url(), { signal: AbortSignal.timeout(100) }));
    assert.equal(error.kind, 'CancelledError');
    assert.ok(Date.now() - started < 2000);
    assert.equal(s.requests.length, 1);
    await s.close();
  });

  it('works with fetch-style init', async () => {
    const error = await rejection(
      client().fetch(server.url('/slow?ms=3000'), { method: 'POST', body: { a: 1 }, signal: AbortSignal.timeout(50) }),
    );
    assert.equal(error.kind, 'CancelledError');
  });
});

describe('top-level functions', () => {
  it('fetch_json parses JSON regardless of Content-Type', async () => {
    assert.equal((await fetch_json(server.url('/json'))).user.name, 'Zoë');
    assert.deepEqual(await fetch_json(server.url('/raw-json-text')), { raw: true });
    assert.equal(await fetch_json(server.url('/empty')), null);
    assert.deepEqual(await fetch_json_promise(server.url('/raw-json-text')), { raw: true });
    const error = await rejection(fetch_json(server.url('/html')));
    assert.equal(error.kind, 'ParseError');
  });

  it('fetch_text returns text for any Content-Type', async () => {
    assert.equal(await fetch_text(server.url('/text')), 'hello wörld');
    assert.match(await fetch_text(server.url('/json')), /"Zoë"/);
    assert.equal(await fetch_text(server.url('/empty')), '');
  });

  it('fetch_with_options returns the full response', async () => {
    const res = await fetch_with_options(server.url('/echo'), 'put', null, 'body');
    assert.equal(res.status, 200);
    assert.equal(res.body.method, 'PUT');
    assert.equal(res.body.body, 'body');
    const error = await rejection(fetch_with_options(server.url('/echo'), 'BREW', null, null));
    assert.equal(error.parameter, 'method');
  });

  it('create_client and deprecated aliases still work', async () => {
    assert.equal((await create_client().get(server.url('/json'))).status, 200);
    for (const fn of [fetch_wasm_json, fetch_wasm_map, fetch_wasm_api]) {
      assert.equal((await fn(server.url('/json'))).user.name, 'Zoë');
    }
    assert.match(await fetch_wasm_html(server.url('/html')), /<body>/);
  });
});

describe('streaming and progress', () => {
  it('hands over each streamed chunk as a Uint8Array that owns its whole buffer, with or without a size limit', async () => {
    // Without progress or a limit, chunks pass through from the transport; with them, they're copied
    for (const options of [{}, { maxResponseBytes: 10 * 1024 * 1024 }, { onDownloadProgress: () => {} }]) {
      const res = await client().get(server.url('/large?mb=2'), { responseType: 'stream', ...options });
      let total = 0;
      for await (const chunk of res.body) {
        assert.equal(Object.getPrototypeOf(chunk), Uint8Array.prototype, 'a plain Uint8Array');
        assert.equal(chunk.byteOffset, 0);
        assert.equal(chunk.byteLength, chunk.buffer.byteLength, 'the chunk is its whole buffer');
        total += chunk.byteLength;
      }
      assert.equal(total, 2 * 1024 * 1024, JSON.stringify(Object.keys(options)));
    }
  });

  it("responseType 'stream' resolves at the headers and streams the body", async () => {
    const started = Date.now();
    const res = await client().get(server.url('/stream'), { responseType: 'stream' });
    assert.ok(Date.now() - started < 250, 'resolved before the body finished');
    assert.ok(res.body instanceof ReadableStream);
    assert.equal(res.headers['content-type'], 'text/plain');

    const chunks = [];
    for await (const chunk of res.body) {
      assert.ok(chunk instanceof Uint8Array);
      chunks.push(Buffer.from(chunk).toString());
    }
    assert.equal(chunks.join(''), 'first,second,third');
    assert.ok(chunks.length >= 2);
  });

  it('aborting the signal errors an in-progress stream', async () => {
    const controller = new AbortController();
    const res = await client().get(server.url('/stream?pause=5000'), { responseType: 'stream', signal: controller.signal });
    const reader = res.body.getReader();
    assert.equal(Buffer.from((await reader.read()).value).toString(), 'first,');
    controller.abort();
    let error;
    try {
      while (!(await reader.read()).done);
    } catch (e) {
      error = e;
    }
    assert.equal(error?.kind, 'CancelledError');
  });

  it('cancelling the stream from JS stops the download', async () => {
    const res = await client().get(server.url('/stream?pause=5000'), { responseType: 'stream' });
    const reader = res.body.getReader();
    await reader.read();
    await reader.cancel();
  });

  it('streams error statuses as HttpError like other requests', async () => {
    const error = await rejection(client().get(server.url('/status?code=500'), { responseType: 'stream' }));
    assert.equal(error.kind, 'HttpError');
  });

  it('reports download progress', async () => {
    const events = [];
    const res = await client().get(server.url('/large?mb=4'), { onDownloadProgress: (p) => events.push(p) });
    assert.equal(res.body.length, 4 * 1024 * 1024);
    assert.ok(events.length > 1);
    assert.deepEqual(events.at(-1), { loaded: 4 * 1024 * 1024, total: 4 * 1024 * 1024 });
    assert.ok(events.every((e, i) => i === 0 || e.loaded > events[i - 1].loaded));

    const streamed = [];
    const stream = await client().get(server.url('/stream'), { responseType: 'stream', onDownloadProgress: (p) => streamed.push(p) });
    for await (const _ of stream.body);
    assert.deepEqual(streamed.at(-1), { loaded: 18, total: null });

    // A throwing callback doesn't break the request
    const ok = await client().get(server.url('/json'), { onDownloadProgress: () => { throw new Error('ignored'); } });
    assert.equal(ok.status, 200);
  });
});

describe('maxLineBytes', () => {
  // Reads an NDJSON body to the end, or to its error
  const read = async (res) => {
    const values = [];
    try {
      for await (const value of res.body) values.push(value);
    } catch (error) {
      return { values, error };
    }
    return { values };
  };

  it('accepts a line at the limit and errors one byte over, whatever the line break or chunking', async () => {
    // '"abcdef"' is 8 bytes; "ë" is 2 bytes in UTF-8, so '"ëëë"' is 8 too
    const s = await startServer(async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      if (req.url === '/ok') {
        for (const part of ['"abcdef"\r', '\n"ëë', 'ë"\n\n"abcdef"']) {
          res.write(part);
          await sleep(5);
        }
        return res.end();
      }
      res.end('"abcdef"\n"abcdefg"\n"never"\n');
    });
    try {
      const c = new WasmClient({ maxLineBytes: 8 });
      assert.deepEqual(await read(await c.get(s.url('/ok'), { responseType: 'ndjson' })), { values: ['abcdef', 'ëëë', 'abcdef'] });
      const { values, error } = await read(await c.get(s.url('/over'), { responseType: 'ndjson' }));
      assert.deepEqual(values, ['abcdef']);
      assert.equal(error.kind, 'NetworkError');
      assert.equal(error.maxLineBytes, 8);
      assert.match(error.message, /Line longer than maxLineBytes \(8 bytes\)/);
      // Per request: a different limit, or none
      assert.equal((await read(await c.get(s.url('/over'), { responseType: 'ndjson', maxLineBytes: 9 }))).values.length, 3);
      assert.equal((await read(await c.get(s.url('/over'), { responseType: 'ndjson', maxLineBytes: null }))).values.length, 3);
      assert.equal((await read(await new WasmClient().get(s.url('/over'), { responseType: 'ndjson' }))).values.length, 3, 'no limit by default');
    } finally {
      await s.close();
    }
  });

  it('stops an endless line at the limit and closes the connection', async () => {
    let closed = false;
    let written = 0;
    const s = await startServer(async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.on('close', () => (closed = true));
      const chunk = Buffer.alloc(1024, 'x');
      while (!res.destroyed) {
        written += chunk.length;
        if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve).once('close', resolve));
      }
    });
    try {
      const res = await new WasmClient({ maxLineBytes: 64 * 1024 }).get(s.url('/'), { responseType: 'ndjson' });
      const { error } = await read(res);
      assert.equal(error.maxLineBytes, 64 * 1024);
      for (let i = 0; i < 100 && !closed; i++) await sleep(10);
      assert.ok(closed, 'the connection was closed');
      assert.ok(written < 16 * 1024 * 1024, `the server wrote ${written} bytes`);
    } finally {
      await s.close();
    }
  });

  it('is validated', async () => {
    for (const value of [0, -1, 1.5, '8']) {
      assert.throws(() => new WasmClient({ maxLineBytes: value }), (e) => e.kind === 'InvalidInputError' && e.parameter === 'maxLineBytes', String(value));
      assert.equal((await rejection(client().get(server.url('/ndjson'), { responseType: 'ndjson', maxLineBytes: value }))).parameter, 'maxLineBytes');
      assert.throws(() => client().events(server.url('/ndjson'), { maxLineBytes: value }), (e) => e.parameter === 'maxLineBytes');
    }
  });
});

describe('newline-delimited JSON', () => {
  it("parses each line as it arrives with responseType: 'ndjson'", async () => {
    const res = await client().get(server.url('/ndjson'), { responseType: 'ndjson' });
    assert.ok(res.body instanceof ReadableStream);
    const values = [];
    for await (const value of res.body) values.push(value);
    assert.deepEqual(values, [{ n: 1 }, { n: 2 }, { text: 'Zoë 🦀' }]);
  });

  it('errors the stream on a line that is not JSON, with its line number', async () => {
    const res = await client().get(server.url('/ndjson-bad'), { responseType: 'ndjson' });
    const values = [];
    const error = await rejection((async () => {
      for await (const value of res.body) values.push(value);
    })());
    assert.deepEqual(values, [{ ok: true }]);
    assert.equal(error.kind, 'ParseError');
    assert.match(error.message, /line 2/);
  });

  it('rejects onUploadProgress with a streamed response type', async () => {
    const error = await rejection(client().post(server.url('/echo'), { body: 'x', responseType: 'ndjson', onUploadProgress() {} }));
    assert.equal(error.kind, 'InvalidInputError');
    assert.equal(error.parameter, 'onUploadProgress');
  });
});

describe('uploads', () => {
  it('sends FormData with files as multipart/form-data', async () => {
    const form = new FormData();
    form.append('title', 'Quarterly report');
    form.append('report', new File(['%PDF-1.7 contents'], 'report.pdf', { type: 'application/pdf' }));
    form.append('raw', new Blob([new Uint8Array([0, 255])]));

    const res = await echo(client().post(server.url('/echo'), { body: form }));
    const [, boundary] = res.headers['content-type'].match(/^multipart\/form-data; boundary=(.+)$/);
    assert.ok(res.body.includes(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nQuarterly report\r\n`));
    assert.ok(res.body.includes('name="report"; filename="report.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7 contents'));
    assert.ok(res.body.includes('name="raw"; filename="blob"\r\nContent-Type: application/octet-stream'));
    assert.ok(res.body.endsWith(`--${boundary}--\r\n`));

    // Round-trips through a real multipart parser
    const parsed = await new Response(Buffer.from(res.bytes), { headers: { 'content-type': res.headers['content-type'] } }).formData();
    assert.equal(parsed.get('title'), 'Quarterly report');
    assert.equal(await parsed.get('report').text(), '%PDF-1.7 contents');
    assert.equal(parsed.get('report').name, 'report.pdf');
    assert.deepEqual([...new Uint8Array(await parsed.get('raw').arrayBuffer())], [0, 255]);
  });

  it('reports upload progress as the body is sent', async () => {
    const size = 1024 * 1024 + 5;
    const body = new Uint8Array(size).fill(7);
    const events = [];
    const res = await client().put(server.url('/echo'), { body, onUploadProgress: (p) => events.push(p) });
    assert.equal(res.body.bytes.length, size);
    assert.ok(events.length > 1);
    assert.deepEqual(events.at(-1), { loaded: size, total: size });
    assert.ok(events.every((e, i) => e.total === size && (i === 0 || e.loaded > events[i - 1].loaded)));
  });

  it('reports upload and download progress on the same request', async () => {
    const uploads = [];
    const downloads = [];
    const res = await client().post(server.url('/echo'), {
      body: 'x'.repeat(200_000),
      onUploadProgress: (p) => uploads.push(p),
      onDownloadProgress: (p) => downloads.push(p),
    });
    assert.equal(res.body.body.length, 200_000);
    assert.deepEqual(uploads.at(-1), { loaded: 200_000, total: 200_000 });
    assert.ok(downloads.length > 0);
    assert.ok(downloads.at(-1).loaded > 200_000); // the JSON echo of the body
  });

  it('restarts upload progress when the request is retried', async () => {
    const events = [];
    const res = await new WasmClient({ retries: { maxRetries: 1, initialDelayMs: 0 } }).put(server.url('/fails-once?id=upload'), {
      body: 'abc',
      onUploadProgress: (p) => events.push(p),
    });
    assert.deepEqual(res.body, { received: 3 });
    assert.deepEqual(events, [{ loaded: 3, total: 3 }, { loaded: 3, total: 3 }]);
  });

  it('ignores exceptions from the upload progress callback', async () => {
    const res = await echo(client().post(server.url('/echo'), { body: 'ok', onUploadProgress: () => { throw new Error('ignored'); } }));
    assert.equal(res.body, 'ok');
    // No body, no progress
    let called = false;
    await client().get(server.url('/json'), { onUploadProgress: () => (called = true) });
    assert.equal(called, false);
  });

  it('rejects an invalid onUploadProgress', async () => {
    const notFunction = await rejection(client().post(server.url('/echo'), { body: 'x', onUploadProgress: 1 }));
    assert.equal(notFunction.kind, 'InvalidInputError');
    assert.equal(notFunction.parameter, 'onUploadProgress');
    const streamed = await rejection(client().post(server.url('/echo'), { body: 'x', responseType: 'stream', onUploadProgress() {} }));
    assert.equal(streamed.kind, 'InvalidInputError');
    assert.match(streamed.message, /stream/);
  });

  it('sends Blob and File bodies with their type', async () => {
    const res = await echo(client().put(server.url('/echo'), { body: new File(['{"a":1}'], 'a.json', { type: 'application/json' }) }));
    assert.equal(res.headers['content-type'], 'application/json');
    assert.equal(res.body, '{"a":1}');
  });
});

describe('interceptors', () => {
  it('request interceptors can add headers, rewrite URLs and run async', async () => {
    const c = new WasmClient({ baseUrl: server.url('/') });
    c.addRequestInterceptor((req) => {
      req.headers['x-request-id'] = 'abc';
    });
    c.addRequestInterceptor(async (req) => ({ ...req, url: req.url.replace('/old', '/echo') }));
    const res = await echo(c.get('/old', { headers: { 'x-existing': '1' } }));
    assert.equal(res.url, '/echo');
    assert.equal(res.headers['x-request-id'], 'abc');
    assert.equal(res.headers['x-existing'], '1');
  });

  it('response interceptors transform responses in order', async () => {
    const c = client();
    c.addResponseInterceptor((res) => ({ ...res, body: res.body.user }));
    c.addResponseInterceptor((res) => res.body.name);
    assert.equal(await c.get(server.url('/json')), 'Zoë');
  });

  it('onRejected can recover, e.g. refresh a token and retry', async () => {
    let token = 'stale';
    const c = client();
    c.addRequestInterceptor((req) => {
      req.headers.authorization = `Bearer ${token}`;
    });
    c.addResponseInterceptor(undefined, async (error) => {
      if (error.status !== 401) throw error;
      token = 'fresh';
      return c.get(server.url('/auth'));
    });
    assert.deepEqual((await c.get(server.url('/auth'))).body, { secret: 42 });

    const notFound = await rejection(c.get(server.url('/missing')));
    assert.equal(notFound.status, 404);
  });

  it('a throwing interceptor rejects the request with its error', async () => {
    const c = client();
    const id = c.addRequestInterceptor(() => {
      throw new TypeError('blocked');
    });
    const error = await rejection(c.get(server.url('/json')));
    assert.ok(error instanceof TypeError);
    assert.equal(error.message, 'blocked');

    assert.equal(c.ejectInterceptor(id), true);
    assert.equal((await c.get(server.url('/json'))).status, 200);

    c.addResponseInterceptor(() => Promise.reject(new RangeError('nope')));
    assert.ok((await rejection(c.get(server.url('/json')))) instanceof RangeError);
    c.clearInterceptors();
    assert.equal((await c.get(server.url('/json'))).status, 200);
  });

  it('interceptors added mid-flight only affect later requests', async () => {
    const c = client();
    const pending = c.get(server.url('/slow?ms=100'));
    c.addResponseInterceptor(() => 'intercepted');
    assert.equal((await pending).body.slow, true);
    assert.equal(await c.get(server.url('/json')), 'intercepted');
  });
});
