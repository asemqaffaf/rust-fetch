// Regression tests for vulnerability classes found in other HTTP clients,
// each named after the advisories it covers, so a change that reintroduces
// one fails CI. Runs on the native transport when it's built, and on
// node:http (security-js.test.mjs). README "Security" summarizes them, and
// benchmarks/security-compare.mjs runs the same probes against fetch() and axios.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { WasmClient } from '../../pkg/node.js';
import { json, rejection, startServer } from './helpers.mjs';

const SECRETS = { authorization: 'Bearer SECRET', cookie: 'sid=SECRET', 'proxy-authorization': 'Basic SECRET' };

let api;
let attacker;
// 256 MB of zeros, compressed once up front (about 250 kB)
const bomb = zlib.gzipSync(Buffer.alloc(256 * 1024 * 1024));

before(async () => {
  attacker = await startServer((req, res) => json(res, { attacker: true }));
  api = await startServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const to = url.searchParams.get('to');
    if (to) {
      res.writeHead(Number(url.searchParams.get('status') ?? 302), { location: to });
      return res.end();
    }
    if (url.pathname === '/bomb') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' });
      return res.end(bomb);
    }
    if (url.pathname === '/loop') {
      res.writeHead(302, { location: '/loop' });
      return res.end();
    }
    json(res, { path: url.pathname });
  });
});

after(async () => {
  await api.close();
  await attacker.close();
});

const leaked = () => attacker.requests.flatMap((r) => Object.keys(SECRETS).filter((name) => r.headers[name]));

describe('credentials on redirects (node-fetch CVE-2022-0235; follow-redirects CVE-2022-0536, CVE-2024-28849; undici CVE-2023-45143, CVE-2024-24758)', () => {
  for (const status of [301, 302, 303, 307, 308]) {
    it(`drops Authorization, Cookie and Proxy-Authorization on a cross-origin ${status}`, async () => {
      attacker.requests.length = 0;
      const to = attacker.url('/collect').replace('127.0.0.1', 'localhost');
      await new WasmClient({ headers: SECRETS }).get(api.url('/?' + new URLSearchParams({ to, status })));
      assert.equal(attacker.requests.length, 1);
      assert.deepEqual(leaked(), []);
    });
  }

  it('drops them when only the port differs (another origin on the same host)', async () => {
    attacker.requests.length = 0;
    await new WasmClient({ headers: SECRETS }).get(api.url('/?' + new URLSearchParams({ to: attacker.url('/collect') })));
    assert.deepEqual(leaked(), []);
  });
});

describe('header injection (CRLF; undici CVE-2022-31150, CVE-2022-35948)', () => {
  for (const headers of [{ 'x-a': 'value\r\nx-injected: 1' }, { 'x-a': 'value\nx-injected: 1' }, { 'x-a\r\nx-injected': 'value' }]) {
    it(`rejects ${JSON.stringify(headers)} before sending`, async () => {
      const before = api.requests.length;
      const error = await rejection(new WasmClient().get(api.url('/'), { headers }));
      assert.equal(error.kind, 'InvalidInputError');
      assert.equal(api.requests.length, before, 'nothing was sent');
    });
  }
});

describe('base URL confusion (axios CVE-2024-39338, CVE-2025-27152)', () => {
  it('keeps path-relative and protocol-relative-looking paths on the base host', async () => {
    attacker.requests.length = 0;
    const client = new WasmClient({ baseUrl: api.url('/v1'), headers: SECRETS });
    const host = new URL(attacker.url('/')).host;
    for (const path of [`//${host}/x`, `/\\${host}/x`, `\\\\${host}/x`, `/%2f%2f${host}/x`]) await client.get(path).catch(() => {});
    assert.equal(attacker.requests.length, 0);
  });

  it('with allowAbsoluteUrls: false, an absolute URL never reaches another host', async () => {
    attacker.requests.length = 0;
    const client = new WasmClient({ baseUrl: api.url('/v1'), headers: SECRETS, allowAbsoluteUrls: false });
    const error = await rejection(client.get(attacker.url('/collect')));
    assert.equal(error.parameter, 'url');
    assert.equal(attacker.requests.length, 0);
  });
});

describe('redirects to other schemes and redirect loops', () => {
  for (const to of ['file:///etc/passwd', 'data:text/plain,hi', 'ftp://example.com/', 'javascript:alert(1)']) {
    it(`refuses a redirect to ${to.split(':')[0]}:`, async () => {
      const error = await rejection(new WasmClient().get(api.url('/?' + new URLSearchParams({ to }))));
      assert.equal(error.kind, 'NetworkError');
    });
  }

  it('stops redirect loops after 20 redirects', async () => {
    const error = await rejection(new WasmClient().get(api.url('/loop')));
    assert.match(error.message, /Too many redirects \(more than 20\)/);
    assert.equal(api.requests.filter((r) => r.url === '/loop').length, 21);
  });
});

describe('decompression bombs (CWE-409)', () => {
  it('a body exactly at maxResponseBytes is accepted; one byte more is not', async () => {
    const size = Buffer.byteLength(JSON.stringify({ path: '/exact' }));
    assert.equal((await new WasmClient({ maxResponseBytes: size }).get(api.url('/exact'))).body.path, '/exact');
    assert.equal((await rejection(new WasmClient({ maxResponseBytes: size - 1 }).get(api.url('/exact')))).maxResponseBytes, size - 1);
  });

  it('with maxResponseBytes, a 256 MB gzip bomb fails without expanding in memory', async () => {
    global.gc?.();
    const before = process.memoryUsage().rss;
    const error = await rejection(new WasmClient({ maxResponseBytes: 1024 * 1024 }).get(api.url('/bomb'), { responseType: 'binary' }));
    assert.equal(error.maxResponseBytes, 1024 * 1024);
    assert.ok(process.memoryUsage().rss - before < 64 * 1024 * 1024, 'memory stayed bounded');
  });
});

describe('server-side request forgery (CWE-918)', () => {
  const guarded = new WasmClient({ allowPrivateNetwork: false });

  // The next two checks come from an independent evaluation of 2.5.0 (aakjp/stress-test)
  it('rechecks every redirect hop: a public name through a proxy, redirected to a private address', async () => {
    // Through a proxy, names aren't checked (the proxy resolves them), so the first hop goes out;
    // the proxy answers with a redirect to an IP-literal private address, which must be blocked
    let proxied = 0;
    const proxy = http.createServer((req, res) => {
      proxied++;
      res.writeHead(302, { location: api.url('/internal') });
      res.end();
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    try {
      const before = api.requests.length;
      const client = new WasmClient({ allowPrivateNetwork: false, proxy: `http://127.0.0.1:${proxy.address().port}` });
      const error = await rejection(client.get('http://public-fixture.invalid/redirect'));
      assert.match(error.message, /Blocked: 127\.0\.0\.1/);
      assert.equal(proxied, 1, 'the first hop reached the proxy');
      assert.equal(api.requests.length, before, 'the redirect target was never contacted');
    } finally {
      proxy.close();
    }
  });

  it('never reuses a connection an unchecked request made to a private address', async () => {
    const url = api.url('/pooled').replace('127.0.0.1', 'localhost');
    const client = new WasmClient({ allowPrivateNetwork: false });
    assert.equal((await client.get(url, { allowPrivateNetwork: true })).status, 200);
    const before = api.requests.length;
    assert.match((await rejection(client.get(url))).message, /Blocked: /);
    assert.equal(api.requests.length, before);
  });

  for (const url of ['http://127.0.0.1:9/', 'http://localhost:9/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:9/', 'http://[::ffff:169.254.169.254]/', 'http://10.0.0.1/', 'http://[fd00::1]/']) {
    it(`with allowPrivateNetwork: false, blocks ${url}`, async () => {
      const error = await rejection(guarded.get(url));
      assert.match(error.message, /Blocked: /);
    });
  }

});
