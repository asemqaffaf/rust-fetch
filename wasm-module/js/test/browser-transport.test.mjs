// The browser transports, run in Node.js: the browser entry (rust_fetch.js)
// without the Node entry's transport, so requests go through fetch(), or
// through XMLHttpRequest for upload progress. Node.js has no XMLHttpRequest,
// so `FakeXMLHttpRequest` stands in for it, carrying requests over node:http
// and firing the same events a browser does.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { WasmClient, initSync } from '../../pkg/rust_fetch.js';
import { json, rejection, sleep, startServer, startWebSocketServer } from './helpers.mjs';

initSync({ module: readFileSync(new URL('../../pkg/rust_fetch_bg.wasm', import.meta.url)) });

class FakeXMLHttpRequest {
  static instances = [];
  upload = { onprogress: null };
  onload = null;
  onerror = null;
  onprogress = null;
  responseType = '';
  status = 0;
  response = null;
  responseURL = '';
  aborted = false;
  #headers = {};
  #rawHeaders = [];
  #request;

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method, url, async) {
    assert.equal(async, true);
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    if (/[^!#$%&'*+.^_`|~0-9a-z-]/i.test(name)) throw new SyntaxError(`'${name}' is not a valid header name`);
    this.#headers[name] = value;
  }

  getAllResponseHeaders() {
    let block = '';
    for (let i = 0; i < this.#rawHeaders.length; i += 2) block += `${this.#rawHeaders[i]}: ${this.#rawHeaders[i + 1]}\r\n`;
    return block;
  }

  send(body) {
    assert.equal(this.responseType, 'arraybuffer');
    const request = http.request(this.url, { method: this.method, headers: this.#headers }, (response) => {
      this.status = response.statusCode;
      this.#rawHeaders = response.rawHeaders;
      const total = Number(response.headers['content-length']);
      const chunks = [];
      let loaded = 0;
      response.on('data', (chunk) => {
        chunks.push(chunk);
        loaded += chunk.length;
        this.onprogress?.({ loaded, total: total || 0, lengthComputable: total > 0 });
      });
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
        this.responseURL = this.url;
        this.onload?.({});
      });
    });
    request.on('error', () => this.aborted || this.onerror?.({}));
    this.#request = request;
    // Upload progress after each chunk, like a browser's progress events
    const bytes = body ? Buffer.from(body.buffer, body.byteOffset, body.byteLength) : Buffer.alloc(0);
    let sent = 0;
    const next = () => {
      if (sent >= bytes.length) return request.end();
      const chunk = bytes.subarray(sent, sent + 16 * 1024);
      request.write(chunk, () => {
        sent += chunk.length;
        this.upload.onprogress?.({ loaded: sent, total: bytes.length, lengthComputable: true });
        next();
      });
    };
    next();
  }

  abort() {
    this.aborted = true;
    this.#request?.destroy();
  }
}

let server;

before(async () => {
  server = await startServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    switch (url.pathname) {
      case '/echo': {
        const body = JSON.stringify({ method: req.method, headers: req.headers, length: req.body.length });
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-twice': ['a', 'b'] });
        return res.end(body);
      }
      case '/busy':
        res.writeHead(429, { 'content-type': 'text/plain', 'retry-after': '0' });
        return res.end('slow down');
      case '/slow':
        await sleep(2000);
        return json(res, {});
      case '/bytes':
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(Buffer.from([1, 2, 3]));
      case '/big': {
        // 64 kB, declared or chunked
        const big = Buffer.alloc(64 * 1024, 7);
        if (url.searchParams.has('chunked')) {
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.write(big.subarray(0, 1000));
          return res.end(big.subarray(1000));
        }
        res.writeHead(url.searchParams.has('error') ? 500 : 200, { 'content-type': 'application/octet-stream', 'content-length': big.length });
        return res.end(big);
      }
      case '/moved':
        res.writeHead(302, { location: '/echo', 'content-type': 'text/plain' });
        return res.end('see /echo');
      default:
        res.writeHead(404);
        return res.end();
    }
  });
});

after(() => server.close());

beforeEach(() => {
  delete globalThis.XMLHttpRequest;
  FakeXMLHttpRequest.instances = [];
});

describe('upload progress without XMLHttpRequest (fetch())', () => {
  it('reports the upload once the response arrives', async () => {
    const uploads = [];
    const downloads = [];
    const res = await new WasmClient().post(server.url('/echo'), {
      body: 'x'.repeat(1000),
      onUploadProgress: (p) => uploads.push(p),
      onDownloadProgress: (p) => downloads.push(p),
    });
    assert.equal(res.body.length, 1000);
    assert.equal(res.headers['x-twice'], 'a, b');
    assert.deepEqual(uploads, [{ loaded: 1000, total: 1000 }]);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].loaded, downloads[0].total);
  });

  it('reports nothing without a body', async () => {
    let called = false;
    await new WasmClient().get(server.url('/echo'), { onUploadProgress: () => (called = true) });
    assert.equal(called, false);
  });
});

// Node's fetch() returns the redirect itself with redirect: 'manual';
// browsers return an opaque redirect (browsers.test.mjs)
describe('redirect modes through fetch()', () => {
  it("returns the redirect with redirect: 'manual'", async () => {
    const res = await new WasmClient({ redirect: 'manual' }).get(server.url('/moved'));
    assert.equal(res.status, 302);
    assert.equal(res.ok, false);
    assert.equal(res.headers.location, '/echo');
    assert.equal(res.body, 'see /echo');
    assert.equal(res.url, server.url('/moved'));
    const followed = await new WasmClient().get(server.url('/moved'));
    assert.equal(followed.body.method, 'GET');
  });

  it("rejects redirects with redirect: 'error'", async () => {
    const error = await rejection(new WasmClient().get(server.url('/moved'), { redirect: 'error' }));
    assert.equal(error.kind, 'NetworkError');
    assert.match(error.message, /Redirect not allowed: 302 to \/echo/);
    const res = await new WasmClient({ redirect: 'error' }).get(server.url('/echo'));
    assert.equal(res.status, 200);
  });

  it('uses fetch() instead of XMLHttpRequest, which always follows redirects', async () => {
    globalThis.XMLHttpRequest = FakeXMLHttpRequest;
    const uploads = [];
    const res = await new WasmClient().post(server.url('/moved'), {
      body: 'abc',
      redirect: 'manual',
      onUploadProgress: (p) => uploads.push(p),
    });
    assert.equal(res.status, 302);
    assert.equal(FakeXMLHttpRequest.instances.length, 0);
    assert.deepEqual(uploads, [{ loaded: 3, total: 3 }]);
  });
});

describe('browser fetch() options', () => {
  /** Run `fn` with fetch() wrapped to record each Request it sends */
  async function capture(fn) {
    const original = globalThis.fetch;
    const requests = [];
    globalThis.fetch = (request) => {
      requests.push(request);
      return original(request);
    };
    try {
      await fn();
    } finally {
      globalThis.fetch = original;
    }
    return requests;
  }
  const fields = (r) => ({ credentials: r.credentials, mode: r.mode, cache: r.cache, keepalive: r.keepalive, referrerPolicy: r.referrerPolicy, integrity: r.integrity });

  it('are passed to fetch(), with request options overriding the client', async () => {
    const client = new WasmClient({ credentials: 'include', cache: 'no-store', referrerPolicy: 'origin' });
    const [defaults, overridden, untouched] = await capture(async () => {
      await client.get(server.url('/echo'));
      await client.post(server.url('/echo'), { body: 'x', cache: 'reload', keepalive: true, integrity: '' });
      await new WasmClient().get(server.url('/echo'));
    });
    assert.deepEqual(fields(defaults), { credentials: 'include', mode: 'cors', cache: 'no-store', keepalive: false, referrerPolicy: 'origin', integrity: '' });
    assert.deepEqual(fields(overridden), { credentials: 'include', mode: 'cors', cache: 'reload', keepalive: true, referrerPolicy: 'origin', integrity: '' });
    assert.deepEqual(fields(untouched), { credentials: 'same-origin', mode: 'cors', cache: 'default', keepalive: false, referrerPolicy: '', integrity: '' });
  });

  it('apply to streamed responses and Server-Sent Events', async () => {
    const client = new WasmClient({ credentials: 'omit' });
    const requests = await capture(async () => {
      const res = await client.get(server.url('/bytes'), { responseType: 'stream', cache: 'no-cache' });
      await new Response(res.body).arrayBuffer();
      await client.events(server.url('/echo'), { reconnect: false }).closed;
    });
    assert.deepEqual(requests.map((r) => [r.credentials, r.cache]), [['omit', 'no-cache'], ['omit', 'default']]);
  });

  it('keep XMLHttpRequest for upload progress only when it can apply them', async () => {
    globalThis.XMLHttpRequest = FakeXMLHttpRequest;
    const upload = (options) => new WasmClient().post(server.url('/echo'), { body: 'abc', onUploadProgress: () => {}, ...options });
    await upload({ credentials: 'include' });
    await upload({ credentials: 'same-origin' });
    assert.deepEqual(FakeXMLHttpRequest.instances.map((xhr) => xhr.withCredentials ?? false), [true, false]);
    // XMLHttpRequest can't omit credentials or apply the other options
    const requests = await capture(async () => {
      await upload({ credentials: 'omit' });
      await upload({ cache: 'no-store' });
    });
    assert.equal(FakeXMLHttpRequest.instances.length, 2);
    assert.deepEqual(requests.map((r) => [r.credentials, r.cache]), [['omit', 'default'], ['same-origin', 'no-store']]);
  });
});

describe('maxResponseBytes through fetch()', () => {
  const check = (error) => {
    assert.equal(error.kind, 'NetworkError', error.message);
    assert.equal(error.maxResponseBytes, 1000);
  };

  it('rejects declared, chunked, error and streamed bodies over the limit', async () => {
    const c = new WasmClient({ maxResponseBytes: 1000 });
    for (const query of ['', '?chunked', '?error']) check(await rejection(c.get(server.url(`/big${query}`))));
    for (const query of ['', '?chunked']) {
      const res = await c.get(server.url(`/big${query}`), { responseType: 'stream' });
      check(await rejection(new Response(res.body).arrayBuffer()));
    }
    assert.equal((await c.get(server.url('/big?chunked'), { maxResponseBytes: null })).body.length, 64 * 1024);
  });

  it('uses fetch() instead of XMLHttpRequest, which cannot stop at a limit', async () => {
    globalThis.XMLHttpRequest = FakeXMLHttpRequest;
    const uploads = [];
    const error = await rejection(new WasmClient({ maxResponseBytes: 1000 }).post(server.url('/big?chunked'), { body: 'abc', onUploadProgress: (p) => uploads.push(p) }));
    check(error);
    assert.equal(FakeXMLHttpRequest.instances.length, 0);
  });
});

describe('upload progress with XMLHttpRequest', () => {
  beforeEach(() => {
    globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  });

  it('reports progress during the upload and decodes the response', async () => {
    const size = 100_000;
    const uploads = [];
    const downloads = [];
    const res = await new WasmClient({ headers: { 'x-client': '1' } }).put(server.url('/echo'), {
      body: new Uint8Array(size),
      onUploadProgress: (p) => uploads.push(p),
      onDownloadProgress: (p) => downloads.push(p),
    });
    assert.equal(FakeXMLHttpRequest.instances.length, 1);
    assert.equal(res.status, 200);
    assert.equal(res.statusText, 'OK');
    assert.equal(res.url, server.url('/echo'));
    assert.deepEqual(res.body, {
      method: 'PUT',
      length: size,
      headers: res.body.headers,
    });
    assert.equal(res.body.headers['x-client'], '1');
    assert.equal(res.body.headers['content-type'], 'application/octet-stream');
    assert.equal(res.headers['x-twice'], 'a, b');
    assert.ok(uploads.length > 1);
    assert.deepEqual(uploads.at(-1), { loaded: size, total: size });
    assert.equal(downloads.at(-1).loaded, downloads.at(-1).total);
  });

  it('decodes bodies by responseType', async () => {
    const res = await new WasmClient().post(server.url('/bytes'), { body: 'x', onUploadProgress() {} });
    assert.deepEqual([...res.body], [1, 2, 3]);
    const text = await new WasmClient().post(server.url('/echo'), { body: 'x', responseType: 'text', onUploadProgress() {} });
    assert.equal(typeof text.body, 'string');
  });

  it('rejects error statuses with HttpError and honours Retry-After', async () => {
    const downloads = [];
    const error = await rejection(
      new WasmClient({ retries: { maxRetries: 1, initialDelayMs: 5000 } }).put(server.url('/busy'), {
        body: 'x',
        onUploadProgress() {},
        onDownloadProgress: (p) => downloads.push(p),
      }),
    );
    assert.equal(error.kind, 'HttpError');
    assert.equal(error.status, 429);
    assert.equal(error.body, 'slow down');
    assert.equal(FakeXMLHttpRequest.instances.length, 2); // retried after Retry-After: 0
    assert.deepEqual(downloads, []); // only successful bodies report download progress
  });

  it('reports network failures as NetworkError', async () => {
    const closed = await startServer(() => {});
    const url = closed.url('/');
    await closed.close();
    const error = await rejection(new WasmClient().post(url, { body: 'x', onUploadProgress() {} }));
    assert.equal(error.kind, 'NetworkError');
  });

  it('aborts the XMLHttpRequest on timeout', async () => {
    const error = await rejection(new WasmClient({ timeoutMs: 100 }).post(server.url('/slow'), { body: 'x', onUploadProgress() {} }));
    assert.equal(error.kind, 'TimeoutError');
    assert.equal(FakeXMLHttpRequest.instances[0].aborted, true);
  });

  it('rejects invalid headers before sending', async () => {
    const error = await rejection(new WasmClient().post(server.url('/echo'), { body: 'x', headers: { 'bad header': '1' }, onUploadProgress() {} }));
    assert.equal(error.kind, 'InvalidInputError');
  });

  it('ignores exceptions from progress callbacks', async () => {
    const res = await new WasmClient().post(server.url('/echo'), {
      body: 'x',
      onUploadProgress() {
        throw new Error('ignored');
      },
    });
    assert.equal(res.status, 200);
  });
});

describe('websocket', { skip: typeof globalThis.WebSocket !== 'function' && 'no global WebSocket (Node.js 20)' }, () => {
  it("rejects handshake headers, which browsers don't allow, and skips client headers", async () => {
    const ws = await startWebSocketServer();
    try {
      const client = new WasmClient({ headers: { authorization: 'Bearer a' } });
      assert.throws(() => client.websocket(ws.url(), { headers: { a: '1' } }), (error) => error.kind === 'InvalidInputError' && error.parameter === 'headers');
      assert.throws(() => client.websocket(ws.url(), { dispatcher: {} }), (error) => error.kind === 'InvalidInputError' && error.parameter === 'dispatcher');
      const socket = client.websocket(ws.url());
      await socket.opened;
      assert.equal(ws.handshakes.at(-1).headers.authorization, undefined);
      socket.close();
      await socket.closed;
    } finally {
      await ws.close();
    }
  });
});
