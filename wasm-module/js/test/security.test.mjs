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
// Connections closed by the client: endless redirect bodies, and requests left hanging
const closed = { endless: 0, hang: 0 };
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
    if (url.pathname === '/endless-redirect') {
      // A redirect whose body never ends
      res.writeHead(302, { location: url.searchParams.get('next') ?? '/after-redirect' });
      res.on('close', () => closed.endless++);
      const chunk = Buffer.alloc(64 * 1024);
      const pump = () => {
        while (!res.destroyed && res.write(chunk));
        if (!res.destroyed) res.once('drain', pump);
      };
      return pump();
    }
    if (url.pathname === '/hang') {
      res.on('close', () => closed.hang++);
      return;
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

  // An endless body can't go back to the pool: it's drained up to 64 KiB, then its connection closes
  const until = async (done) => {
    for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    return done();
  };

  it('follows a redirect with an endless body promptly, and closes its connection', async () => {
    const before = closed.endless;
    const started = performance.now();
    const response = await new WasmClient({ timeoutMs: 5000 }).get(api.url('/endless-redirect'));
    assert.equal(response.body.path, '/after-redirect');
    assert.ok(performance.now() - started < 2000, 'did not wait for the redirect body');
    assert.ok(await until(() => closed.endless === before + 1), 'the redirect connection was closed');
  });

  it('50 redirects with endless bodies close every connection and keep memory bounded', async () => {
    const client = new WasmClient({ timeoutMs: 5000 });
    const before = closed.endless;
    global.gc?.();
    const rss = process.memoryUsage().rss;
    for (let i = 0; i < 50; i++) assert.equal((await client.get(api.url('/endless-redirect'))).body.path, '/after-redirect');
    assert.ok(await until(() => closed.endless === before + 50), `closed ${closed.endless - before} of 50 connections`);
    assert.ok(process.memoryUsage().rss - rss < 64 * 1024 * 1024, 'memory stayed bounded');
    assert.equal((await client.get(api.url('/still-works'))).body.path, '/still-works');
  });

  it('a redirect-limit error closes the endless connection too', async () => {
    const before = closed.endless;
    const error = await rejection(new WasmClient({ timeoutMs: 5000, maxRedirects: 0 }).get(api.url('/endless-redirect')));
    assert.match(error.message, /Redirect not allowed/);
    assert.ok(await until(() => closed.endless === before + 1), 'the redirect connection was closed');
  });

  it('cancelling after an endless redirect closes both connections', async () => {
    const before = { ...closed };
    const controller = new AbortController();
    const pending = new WasmClient({ timeoutMs: 5000 }).get(api.url('/endless-redirect?next=/hang'), { signal: controller.signal });
    assert.ok(await until(() => api.requests.some((r) => r.url === '/hang') && closed.hang === before.hang && closed.endless > before.endless));
    controller.abort();
    assert.equal((await rejection(pending)).kind, 'CancelledError');
    assert.ok(await until(() => closed.hang === before.hang + 1), 'the hanging request was closed');
  });

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
  it('rechecks every redirect hop: a public IP address through a proxy, redirected to a private address or a name', async () => {
    // The proxy answers the first hop with a redirect, which must be checked like a request:
    // to an IP-literal private address it is blocked, to a name it is refused (the proxy would resolve it unchecked)
    let proxied = 0;
    let location = api.url('/internal');
    const proxy = http.createServer((req, res) => {
      proxied++;
      res.writeHead(302, { location });
      res.end();
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    try {
      const before = api.requests.length;
      const client = new WasmClient({ allowPrivateNetwork: false, proxy: `http://127.0.0.1:${proxy.address().port}` });
      const error = await rejection(client.get('http://93.184.216.34/redirect'));
      assert.match(error.message, /Blocked: 127\.0\.0\.1/);
      assert.equal(proxied, 1, 'the first hop reached the proxy');
      assert.equal(api.requests.length, before, 'the redirect target was never contacted');
      location = 'http://internal.example/admin';
      assert.match((await rejection(client.get('http://93.184.216.34/redirect'))).message, /can't check internal\.example through a proxy/);
      assert.equal(proxied, 2, 'the redirect to a name was not followed');
      // A name as the first hop is refused before anything is sent
      assert.match((await rejection(client.get('http://public-fixture.invalid/redirect'))).message, /can't check public-fixture\.invalid through a proxy/);
      assert.equal(proxied, 2);
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
