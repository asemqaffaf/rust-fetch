// Regression tests for vulnerability classes found in other HTTP clients,
// each named after the advisories it covers, so a change that reintroduces
// one fails CI. Runs on the native transport when it's built, and on
// node:http (security-js.test.mjs). README "Security" summarizes them, and
// benchmarks/security-compare.mjs runs the same probes against fetch() and axios.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  for (const url of ['http://127.0.0.1:9/', 'http://localhost:9/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:9/', 'http://[::ffff:169.254.169.254]/', 'http://10.0.0.1/', 'http://[fd00::1]/']) {
    it(`with allowPrivateNetwork: false, blocks ${url}`, async () => {
      const error = await rejection(guarded.get(url));
      assert.match(error.message, /Blocked: /);
    });
  }

});
