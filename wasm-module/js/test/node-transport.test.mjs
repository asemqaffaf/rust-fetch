// The Node.js transport (node:http/node:https) replaces fetch() in Node.js, so
// it must reproduce what fetch() did for us: redirects, decompression, default
// headers and connection reuse.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

  it('reuses connections (keep-alive)', async () => {
    sockets.clear();
    const c = client();
    for (let i = 0; i < 30; i++) await c.get(server.url('/echo'));
    assert.ok(sockets.size <= 2, `used ${sockets.size} sockets for 30 sequential requests`);
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
