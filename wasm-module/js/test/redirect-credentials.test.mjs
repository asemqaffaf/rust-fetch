// Redirects and credentials (#226). Whether a hop keeps `Authorization`,
// `Cookie`, `Proxy-Authorization` and `sensitiveHeaders` must follow the WHATWG
// definition of "same origin", whatever way `Location` spells the target. The
// expected answer comes from Node's `URL`, not from a list, so a Location that
// is written oddly is judged the way a browser would judge it.
// Also checked: which methods and bodies survive each status, and loops.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const pkg = process.env.RUST_FETCH_PKG ? pathToFileURL(`${process.env.RUST_FETCH_PKG}/`).href : new URL('../../pkg/', import.meta.url).href;
const { WasmClient } = await import(new URL('node.js', pkg).href);

const SECRET_HEADERS = { authorization: 'Bearer S', cookie: 'sid=S', 'proxy-authorization': 'Basic S', 'x-api-key': 'S' };
const PLAIN_HEADER = { 'x-plain': 'p' };

/** Two servers on different ports: same host, different origins. Each records the requests it gets. */
async function listen(onRequest) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
      seen.push(record);
      onRequest(req, res, record);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, seen, port: server.address().port };
}

let a;
let b;
before(async () => {
  // a answers /r<status>?to=<location> with that redirect and /hop with 200; b answers 200
  a = await listen((req, res) => {
    const match = req.url.match(/^\/r(\d+)\?to=(.*)$/s);
    if (match) {
      res.statusCode = Number(match[1]);
      res.setHeader('location', decodeURIComponent(match[2]));
      res.end();
    } else if (req.url.startsWith('/loop')) {
      res.statusCode = 302;
      res.setHeader('location', '/loop');
      res.end();
    } else res.end('a');
  });
  b = await listen((req, res) => res.end('b'));
});
after(() => { a.server.closeAllConnections?.(); b.server.closeAllConnections?.(); a.server.close(); b.server.close(); });

const clear = () => { a.seen.length = 0; b.seen.length = 0; };
const lastHop = () => [...a.seen, ...b.seen].filter((record) => !/^\/r\d+\?/.test(record.url) && !record.url.startsWith('/loop')).pop();
const client = (options = {}) => new WasmClient({ retries: 0, timeoutMs: 3000, headers: { ...SECRET_HEADERS, ...PLAIN_HEADER }, sensitiveHeaders: ['x-api-key'], ...options });

/** Follow `status` from a to `location` and return the request that finally arrived */
async function follow(status, location, method = 'POST', options) {
  clear();
  const url = `http://127.0.0.1:${a.port}/r${status}?to=${encodeURIComponent(location)}`;
  const init = method === 'GET' || method === 'HEAD' || method === 'DELETE' ? {} : { body: { n: 1 } };
  await client(options)[method.toLowerCase()](url, init);
  return lastHop();
}
// Which of the client's own credentials arrived. Compared by value: a URL with user info becomes a Basic
// `Authorization` of its own once the client's one has been dropped, which is not the client's secret.
const kept = (record) => Object.keys(SECRET_HEADERS).filter((name) => record.headers[name] === SECRET_HEADERS[name]);

describe('credential headers follow the WHATWG origin', () => {
  // Written against a's own port (pa) and b's (pb); each is a spelling of the same place or of another
  const spellings = (pa, pb) => ({
    'a relative path': '/hop',
    'a scheme-relative URL to the same port': `//127.0.0.1:${pa}/hop`,
    'the same origin with an upper-case scheme': `HTTP://127.0.0.1:${pa}/hop`,
    'the same origin with user info': `http://u:p@127.0.0.1:${pa}/hop`,
    'the same origin with a fragment': `http://127.0.0.1:${pa}/hop#frag`,
    'the same origin as a trailing-dot IPv4 host': `http://127.0.0.1.:${pa}/hop`,
    'the same origin as a decimal IPv4 host': `http://2130706433:${pa}/hop`,
    'the same origin as a hex IPv4 host': `http://0x7f.1:${pa}/hop`,
    'the same origin with a percent-encoded host': `http://127.0.0.%31:${pa}/hop`,
    'the same origin with a tab in the scheme': `ht\ttp://127.0.0.1:${pa}/hop`,
    'another port': `http://127.0.0.1:${pb}/hop`,
    'another port, scheme-relative': `//127.0.0.1:${pb}/hop`,
    'another port, written with backslashes': `http:\\\\127.0.0.1:${pb}\\hop`,
    'another port, behind a user name that looks like the first one': `http://127.0.0.1:${pa}@127.0.0.1:${pb}/hop`,
    'another port, with a backslash before an @ that looks like the first one': `http://127.0.0.1:${pb}\\@127.0.0.1:${pa}/hop`,
    'another port, with a tab in the host': `http://127.0.0.1\t:${pb}/hop`,
    'another port, trailing-dot host': `http://127.0.0.1.:${pb}/hop`,
    'another port, hex host': `http://0x7f.1:${pb}/hop`,
  });

  for (const status of [301, 302, 303, 307, 308]) {
    for (const [name, location] of Object.entries(spellings(1, 2))) {
      it(`${status} to ${name}`, async () => {
        const target = location.replaceAll(':1/', `:${a.port}/`).replaceAll(':1@', `:${a.port}@`).replaceAll(':1\\', `:${a.port}\\`).replaceAll(':2/', `:${b.port}/`).replaceAll(':2\\', `:${b.port}\\`);
        const here = new URL(`http://127.0.0.1:${a.port}/r${status}`);
        const expectedOrigin = new URL(target, here).origin;
        const sameOrigin = expectedOrigin === here.origin;
        const request = await follow(status, target);
        assert.ok(request, 'the redirect was not followed');
        assert.deepEqual(kept(request), sameOrigin ? Object.keys(SECRET_HEADERS) : [], `${sameOrigin ? 'same' : 'other'} origin (${expectedOrigin})`);
        assert.equal(request.headers['x-plain'], 'p', 'a header that is not a credential should follow the redirect');
      });
    }
  }
});

describe('methods and bodies through redirects', () => {
  // The Fetch rules: 303 changes everything but GET and HEAD to GET; 301 and 302 change POST to GET; 307 and 308 change nothing
  const expectedMethod = (status, method) => {
    if (status === 303) return method === 'HEAD' ? 'HEAD' : 'GET';
    if ((status === 301 || status === 302) && method === 'POST') return 'GET';
    return method;
  };
  for (const status of [301, 302, 303, 307, 308]) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      it(`${method} through a ${status}`, async () => {
        const request = await follow(status, `http://127.0.0.1:${b.port}/hop`, method);
        const want = expectedMethod(status, method);
        assert.equal(request.method, want);
        const hasBody = ['POST', 'PUT', 'PATCH'].includes(method) && want === method;
        assert.equal(request.body, hasBody ? '{"n":1}' : '', 'body');
        if (!hasBody) assert.equal(request.headers['content-type'], undefined, 'a request without a body keeps no Content-Type');
      });
    }
  }
});

describe('redirects the client refuses', () => {
  for (const location of ['file:///etc/passwd', 'ftp://127.0.0.1/x', 'javascript:alert(1)', 'data:text/plain,hi', 'blob:http://127.0.0.1/x', 'ws://127.0.0.1/x']) {
    it(`does not follow a redirect to ${location.split(':')[0]}:`, async () => {
      clear();
      const error = await client().get(`http://127.0.0.1:${a.port}/r302?to=${encodeURIComponent(location)}`).then(() => undefined, (caught) => caught);
      assert.ok(error, 'the redirect was followed');
      assert.equal(b.seen.length, 0);
    });
  }

  it('stops a redirect loop', async () => {
    clear();
    const error = await client({ maxRedirects: 5 }).get(`http://127.0.0.1:${a.port}/loop`).then(() => undefined, (caught) => caught);
    assert.match(error?.message ?? '', /redirects/i);
    assert.ok(a.seen.length <= 7, `${a.seen.length} requests`);
  });

  it('follows no redirect when maxRedirects is 0', async () => {
    clear();
    const error = await client({ maxRedirects: 0 }).get(`http://127.0.0.1:${a.port}/r302?to=${encodeURIComponent('/hop')}`).then(() => undefined, (caught) => caught);
    assert.ok(error);
    assert.equal(a.seen.filter((record) => record.url === '/hop').length, 0);
  });
});
