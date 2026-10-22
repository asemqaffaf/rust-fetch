// The Node.js transport (node:http/node:https) replaces fetch() in Node.js, so
// it must reproduce what fetch() did for us: redirects, decompression, default
// headers and connection reuse.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { WasmClient } from '../../pkg/node.js';
import { json, rejection, startServer } from './helpers.mjs';

let server;
let other; // a second origin (different port)
const sockets = new Set();

before(async () => {
  other = await startServer((req, res) => json(res, { origin: 'other', headers: req.headers, method: req.method, body: req.body.toString() }));
  server = await startServer((req, res) => {
    sockets.add(req.socket);
    const url = new URL(req.url, 'http://x');
    const echo = () => json(res, { method: req.method, url: req.url, headers: req.headers, body: req.body.toString() });
    switch (url.pathname) {
      case '/echo':
        return echo();
      case '/redirect': {
        const status = Number(url.searchParams.get('status') ?? 302);
        res.writeHead(status, { location: url.searchParams.get('to') ?? '/echo' });
        return res.end();
      }
      case '/bad-location':
        res.writeHead(302, { location: 'http://[not-a-host' });
        return res.end();
      case '/encoded': {
        // An encoding we can't (or can, for zstd where Node supports it) decode
        const encoding = url.searchParams.get('encoding');
        const payload = Buffer.from('raw bytes');
        const body = encoding === 'zstd' && zlib.zstdCompressSync ? zlib.zstdCompressSync(payload) : payload;
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': encoding });
        return res.end(body);
      }
      case '/loop':
        res.writeHead(302, { location: '/loop' });
        return res.end();
      case '/compressed': {
        const payload = Buffer.from(JSON.stringify({ compressed: true, text: 'Zoë'.repeat(100) }));
        const encoding = url.searchParams.get('encoding');
        const encoded = {
          gzip: () => zlib.gzipSync(payload),
          'x-gzip': () => zlib.gzipSync(payload),
          deflate: () => zlib.deflateSync(payload),
          'raw-deflate': () => zlib.deflateRawSync(payload),
          br: () => zlib.brotliCompressSync(payload),
          'gzip, br': () => zlib.brotliCompressSync(zlib.gzipSync(payload)),
          identity: () => payload,
        }[encoding]();
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-encoding': encoding === 'raw-deflate' ? 'deflate' : encoding,
          'content-length': encoded.length,
        });
        return res.end(encoded);
      }
      default:
        res.writeHead(404);
        return res.end();
    }
  });
});

after(async () => {
  await server.close();
  await other.close();
});

const client = () => new WasmClient();

describe('Node.js transport', () => {
  it('is used instead of fetch() in Node.js, with fetch-like default headers', async () => {
    const { headers } = (await client().get(server.url('/echo'))).body;
    assert.equal(headers['user-agent'], 'rust-fetch');
    assert.equal(headers.accept, '*/*');
    assert.match(headers['accept-encoding'], /^gzip, deflate, br/);

    const custom = (await client().get(server.url('/echo'), { headers: { accept: 'application/json', 'user-agent': 'my-app/1.0' } })).body;
    assert.equal(custom.headers.accept, 'application/json');
    assert.equal(custom.headers['user-agent'], 'my-app/1.0');
  });

  it('sends repeated request headers and an exact Content-Length', async () => {
    const res = await client().post(server.url('/echo'), {
      body: 'héllo',
      headers: [['x-multi', 'a'], ['x-multi', 'b']],
    });
    assert.equal(res.body.headers['x-multi'], 'a, b');
    assert.equal(res.body.headers['content-length'], String(Buffer.byteLength('héllo')));
    assert.equal(res.body.body, 'héllo');
  });

  it('rejects URLs it cannot parse (the client validates them first)', async () => {
    const transport = globalThis[Symbol.for('rust-fetch.transport')];
    const error = await rejection(transport({ method: 'GET', url: 'not a url', headers: {}, timeout: 1000, bodyType: 0 }));
    assert.equal(error.code, 'ERR_INVALID_URL');
  });

  it('reuses connections (keep-alive)', async () => {
    sockets.clear();
    const c = client();
    for (let i = 0; i < 30; i++) await c.get(server.url('/echo'));
    assert.ok(sockets.size <= 2, `used ${sockets.size} sockets for 30 sequential requests`);
  });

  describe('connection pool', () => {
    let slow;
    const slowSockets = new Set();
    before(async () => {
      slow = await startServer(async (req, res) => {
        slowSockets.add(req.socket);
        await new Promise((r) => setTimeout(r, 20));
        json(res, {});
      });
    });
    after(() => slow.close());

    const burst = (c, n) => Promise.all(Array.from({ length: n }, () => c.get(slow.url())));

    it('caps connections per origin and keeps them for the next burst', async () => {
      // Node's default agent opens one socket per request here and closes
      // all but 256 afterwards, which exhausts ephemeral ports under load
      slowSockets.clear();
      const c = client();
      await burst(c, 600);
      const first = new Set(slowSockets);
      assert.ok(first.size <= 256, `opened ${first.size} sockets for 600 concurrent requests`);
      await burst(c, 600);
      const opened = [...slowSockets].filter((s) => !first.has(s)).length;
      assert.equal(opened, 0, `opened ${opened} new sockets for the second burst`);
    });

    it('uses an agent the application installed as globalAgent', async () => {
      const original = http.globalAgent;
      let used = 0;
      class ProxyAgent extends http.Agent {
        addRequest(...args) {
          used++;
          return super.addRequest(...args);
        }
      }
      try {
        http.globalAgent = new ProxyAgent({ keepAlive: true });
        await client().get(slow.url());
        assert.equal(used, 1);

        // A plain Agent with its own limit is respected too
        http.globalAgent = new http.Agent({ keepAlive: true, maxSockets: 2 });
        slowSockets.clear();
        await burst(client(), 20);
        assert.ok(slowSockets.size <= 2, `opened ${slowSockets.size} sockets with maxSockets: 2`);
      } finally {
        http.globalAgent.destroy();
        http.globalAgent = original;
      }
    });
  });

  describe('redirects', () => {
    it('follows relative and absolute redirects and reports the final URL', async () => {
      const res = await client().get(server.url('/redirect?' + new URLSearchParams({ to: '/echo?x=1' })));
      assert.equal(res.url, server.url('/echo?x=1'));
      assert.equal(res.body.url, '/echo?x=1');
    });

    it('turns POST into a bodiless GET on 301, 302 and 303', async () => {
      for (const status of [301, 302, 303]) {
        const res = await client().post(server.url(`/redirect?status=${status}`), { body: { a: 1 } });
        assert.equal(res.body.method, 'GET', String(status));
        assert.equal(res.body.body, '', String(status));
        assert.equal(res.body.headers['content-type'], undefined, String(status));
      }
    });

    it('keeps the method and body on 307 and 308', async () => {
      for (const status of [307, 308]) {
        const res = await client().put(server.url(`/redirect?status=${status}`), { body: { a: 1 } });
        assert.equal(res.body.method, 'PUT', String(status));
        assert.equal(res.body.body, '{"a":1}', String(status));
      }
    });

    it('drops credentials when redirected to another origin', async () => {
      const to = other.url('/');
      const res = await client().get(server.url('/redirect?' + new URLSearchParams({ to })), {
        headers: { authorization: 'Bearer secret', cookie: 'session=1', 'x-keep': 'yes' },
      });
      assert.equal(res.body.origin, 'other');
      assert.equal(res.body.headers.authorization, undefined);
      assert.equal(res.body.headers.cookie, undefined);
      assert.equal(res.body.headers['x-keep'], 'yes');

      const same = await client().get(server.url('/redirect'), { headers: { authorization: 'Bearer secret' } });
      assert.equal(same.body.headers.authorization, 'Bearer secret');
    });

    it('fails on an unparseable redirect location', async () => {
      const error = await rejection(client().get(server.url('/bad-location')));
      assert.equal(error.kind, 'NetworkError');
      assert.match(error.message, /Invalid redirect location/);
    });

    it('fails on redirect loops and unsupported schemes', async () => {
      const loop = await rejection(client().get(server.url('/loop')));
      assert.equal(loop.kind, 'NetworkError');
      assert.match(loop.message, /Too many redirects/);

      const ftp = await rejection(client().get(server.url('/redirect?' + new URLSearchParams({ to: 'ftp://example.com/' }))));
      assert.equal(ftp.kind, 'NetworkError');
    });
  });

  describe('decompression', () => {
    for (const encoding of ['gzip', 'x-gzip', 'deflate', 'raw-deflate', 'br', 'gzip, br', 'identity']) {
      it(`decodes ${encoding}`, async () => {
        const res = await client().get(server.url('/compressed?' + new URLSearchParams({ encoding })));
        assert.equal(res.body.compressed, true);
        assert.equal(res.body.text, 'Zoë'.repeat(100));
      });
    }

    it('decodes zstd where Node supports it, and passes unknown encodings through', async () => {
      for (const encoding of ['zstd', 'compress']) {
        const res = await client().get(server.url('/encoded?' + new URLSearchParams({ encoding })));
        assert.equal(Buffer.from(res.body).toString(), 'raw bytes', encoding);
      }
    });

    it('reports corrupt compressed bodies as NetworkError', async () => {
      const s = await startServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
        res.end('not gzip');
      });
      try {
        const error = await rejection(client().get(s.url()));
        assert.equal(error.kind, 'NetworkError');
      } finally {
        await s.close();
      }
    });
  });
});
