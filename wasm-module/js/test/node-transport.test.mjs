// The Node.js transports (the native addon, or node:http/node:https where it
// isn't available) replace fetch() in Node.js, so they must reproduce what
// fetch() did for us: redirects, decompression, default headers and connection
// reuse. node-transport-js.test.mjs runs these tests without the addon.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
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
      case '/moved':
        res.writeHead(301, { location: '/echo', 'content-type': 'text/plain' });
        return res.end('see /echo');
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

const addon = new URL(`../../pkg/rust-fetch-native.${process.platform}-${process.arch}.node`, import.meta.url);
const nativeExpected = process.env.RUST_FETCH_NATIVE !== '0' && existsSync(addon);

describe(`Node.js transport (${nativeExpected ? 'native' : 'node:http'})`, () => {
  it(nativeExpected ? 'uses the native addon' : 'uses node:http without the native addon', async () => {
    // node:http adds `connection: keep-alive`; the native transport doesn't need to
    const { headers } = (await client().get(server.url('/echo'))).body;
    assert.equal(headers.connection, nativeExpected ? undefined : 'keep-alive');
  });

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

  it('lets the process exit as soon as requests finish', async () => {
    const script = `import { WasmClient } from ${JSON.stringify(new URL('../../pkg/node.js', import.meta.url).href)};
      const c = new WasmClient();
      await c.get(${JSON.stringify(server.url('/echo'))});
      await c.get(${JSON.stringify(server.url('/echo'))}, { signal: new AbortController().signal });
      globalThis.started = performance.now();
      process.on('exit', () => console.log(performance.now() - globalThis.started));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]);
    assert.ok(Number(stdout) < 1000, `took ${stdout}ms to exit`);
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
      const c = client();
      const before = slow.connections();
      await burst(c, 600);
      const first = slow.connections() - before;
      assert.ok(first <= 256, `opened ${first} connections for 600 concurrent requests`);
      await burst(c, 600);
      const opened = slow.connections() - before - first;
      assert.equal(opened, 0, `opened ${opened} new connections for the second burst`);
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

  describe('HTTPS', () => {
    let secure;
    let misnamed; // serves a certificate for example.com
    let dir;
    before(async () => {
      // A self-signed certificate for 127.0.0.1, trusted by nothing by default
      dir = mkdtempSync(join(tmpdir(), 'rust-fetch-tls-'));
      const certificate = (name, subjectAltName) =>
        execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
          '-subj', `/CN=${name}`, '-addext', `subjectAltName=${subjectAltName}`, '-keyout', join(dir, name), '-out', join(dir, `${name}.crt`)], { stdio: 'ignore' });
      certificate('127.0.0.1', 'IP:127.0.0.1');
      certificate('example.com', 'DNS:example.com');
      const serve = (name) => https.createServer({ key: readFileSync(join(dir, name)), cert: readFileSync(join(dir, `${name}.crt`)) }, (req, res) => json(res, { headers: req.headers }));
      secure = serve('127.0.0.1');
      misnamed = serve('example.com');
      await Promise.all([secure, misnamed].map((s) => new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))));
    });
    after(() => {
      for (const s of [secure, misnamed]) {
        s.closeAllConnections();
        s.close();
      }
      rmSync(dir, { recursive: true, force: true });
    });

    const url = (s = secure) => `https://127.0.0.1:${s.address().port}/`;

    /** Request a URL from a new process (the TLS settings are read at startup) */
    async function getInProcess(env, target = url()) {
      const script = `import { WasmClient } from ${JSON.stringify(new URL('../../pkg/node.js', import.meta.url).href)};
        const res = await new WasmClient({ timeoutMs: 5000 }).get(${JSON.stringify(target)}).catch((e) => ({ body: { error: e.kind } }));
        console.log(JSON.stringify(res.body.headers ?? res.body));`;
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ...env } });
      return JSON.parse(stdout);
    }

    it('rejects a certificate that is not trusted', async () => {
      const error = await rejection(client().get(url()));
      assert.equal(error.kind, 'NetworkError');
    });

    it('trusts certificates from NODE_EXTRA_CA_CERTS', async () => {
      const headers = await getInProcess({ NODE_EXTRA_CA_CERTS: join(dir, '127.0.0.1.crt') });
      assert.equal(headers.connection, nativeExpected ? undefined : 'keep-alive');
    });

    it('still checks the name of a trusted certificate', async () => {
      const result = await getInProcess({ NODE_EXTRA_CA_CERTS: join(dir, 'example.com.crt') }, url(misnamed));
      assert.deepEqual(result, { error: 'NetworkError' });
    });

    it('skips verification with NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
      const headers = await getInProcess({ NODE_TLS_REJECT_UNAUTHORIZED: '0' });
      assert.equal(headers.connection, nativeExpected ? undefined : 'keep-alive');
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

    it("returns redirects with redirect: 'manual'", async () => {
      const manual = new WasmClient({ redirect: 'manual' });
      const res = await manual.get(server.url('/moved'));
      assert.equal(res.status, 301);
      assert.equal(res.statusText, 'Moved Permanently');
      assert.equal(res.ok, false);
      assert.equal(res.headers.location, '/echo');
      assert.equal(res.body, 'see /echo');
      assert.equal(res.url, server.url('/moved'));

      // Per request, and decoded like any response
      const binary = await client().get(server.url('/moved'), { redirect: 'manual', responseType: 'binary' });
      assert.deepEqual(binary.body, new TextEncoder().encode('see /echo'));
      // A request can still follow them
      const followed = await manual.get(server.url('/moved'), { redirect: 'follow' });
      assert.equal(followed.body.url, '/echo');
      // Only redirects resolve; other errors are unchanged
      const missing = await rejection(manual.get(server.url('/missing')));
      assert.equal(missing.kind, 'HttpError');
      assert.equal(missing.status, 404);
    });

    it("rejects any redirect with redirect: 'error'", async () => {
      const error = await rejection(client().get(server.url('/moved'), { redirect: 'error' }));
      assert.equal(error.kind, 'NetworkError');
      assert.match(error.message, /Redirect not allowed: 301 to \/echo/);
      // maxRedirects: 0 is the same
      const zero = await rejection(new WasmClient({ maxRedirects: 0 }).get(server.url('/moved')));
      assert.match(zero.message, /Redirect not allowed/);
      // Requests without redirects are unaffected
      const res = await new WasmClient({ redirect: 'error' }).get(server.url('/echo'));
      assert.equal(res.status, 200);
    });

    it('follows at most maxRedirects redirects', async () => {
      const twice = server.url('/redirect?' + new URLSearchParams({ to: '/redirect?to=/echo' }));
      const limited = new WasmClient({ maxRedirects: 1 });
      const error = await rejection(limited.get(twice));
      assert.equal(error.kind, 'NetworkError');
      assert.match(error.message, /Too many redirects \(more than 1\)/);
      assert.equal((await limited.get(twice, { maxRedirects: 2 })).body.url, '/echo');
      assert.equal((await client().get(twice)).body.url, '/echo');
    });

    it('validates redirect and maxRedirects', async () => {
      for (const options of [{ redirect: 'nope' }, { redirect: 1 }, { maxRedirects: -1 }, { maxRedirects: 1.5 }, { maxRedirects: '2' }]) {
        const parameter = Object.keys(options)[0];
        assert.throws(() => new WasmClient(options), (error) => error.kind === 'InvalidInputError' && error.parameter === parameter);
        const error = await rejection(client().get(server.url('/echo'), options));
        assert.equal(error.kind, 'InvalidInputError', JSON.stringify(options));
        assert.equal(error.parameter, parameter);
      }
    });

    it('applies redirect to streamed responses', async () => {
      const manual = await client().get(server.url('/moved'), { redirect: 'manual', responseType: 'stream' });
      assert.equal(manual.status, 301);
      assert.equal(manual.headers.location, '/echo');
      assert.equal(await new Response(manual.body).text(), 'see /echo');
      const error = await rejection(client().get(server.url('/moved'), { redirect: 'error', responseType: 'ndjson' }));
      assert.equal(error.kind, 'NetworkError');
      assert.match(error.message, /Redirect not allowed: 301 to \/echo/);
      const followed = await client().get(server.url('/moved'), { responseType: 'stream' });
      assert.equal(followed.url, server.url('/echo'));
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
