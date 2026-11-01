// The browser entry in real browsers with Object.prototype polluted: the
// RequestInit that reaches fetch() must not inherit method, headers, body,
// credentials, mode, cache, redirect, referrer, integrity, keepalive or signal.
// Run `npm run build` first. A browser that isn't installed is skipped.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const { chromium, firefox, webkit } = await import('playwright');
const pkg = new URL('../../pkg/', import.meta.url);

const seen = [];
let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>pollution</title>'); }
      if (url.pathname === '/rust_fetch.js' || url.pathname === '/rust_fetch_bg.wasm') {
        res.writeHead(200, { 'content-type': url.pathname.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
        return res.end(readFileSync(new URL(url.pathname.slice(1), pkg)));
      }
      const record = { method: req.method, authorization: req.headers.authorization ?? null, polluted: req.headers['x-polluted'] ?? null, size: Buffer.concat(chunks).length, cache: req.headers['cache-control'] ?? null, referer: req.headers.referer ?? null };
      seen.push(record);
      res.writeHead(url.pathname === '/redirect' ? 302 : 200, url.pathname === '/redirect' ? { location: '/echo' } : { 'content-type': 'application/json' });
      res.end(JSON.stringify(record));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

// Runs in the page: every requests' outcome, for a polluted name and value
async function pollute(names) {
  const { default: init, WasmClient } = await import('/rust_fetch.js');
  await init();
  const run = async () => {
    const out = {};
    for (const [label, request] of [
      ['get', () => new WasmClient({ retries: 0 }).get('/echo', { headers: { authorization: 'Bearer secret' } })],
      ['post', () => new WasmClient({ retries: 0 }).post('/echo', { body: 'hello' })],
      ['redirect', () => new WasmClient({ retries: 0 }).get('/redirect')],
    ]) {
      try { const r = await request(); out[label] = [r.status, r.body]; } catch (error) { out[label] = { error: String(error?.kind ?? error?.name ?? error) }; }
    }
    return JSON.stringify(out);
  };
  const baseline = await run();
  const problems = [];
  for (const [name, extra] of Object.entries(names)) {
    for (const value of [true, 1, 'x', {}, ['x'], ...extra.map((v) => (v === '$abort' ? AbortSignal.abort() : v))]) {
      Object.defineProperty(Object.prototype, name, { configurable: true, writable: true, enumerable: false, value });
      let result;
      try { result = await run(); } finally { delete Object.prototype[name]; }
      if (result !== baseline) problems.push(`${name}=${typeof value === 'object' && value instanceof AbortSignal ? 'aborted signal' : JSON.stringify(value)} changed the requests: ${result.slice(0, 140)}`);
    }
  }
  return { baseline, problems };
}

const NAMES = {
  method: ['DELETE'], headers: [{ authorization: 'Bearer attacker', 'x-polluted': '1' }], body: ['injected'], credentials: ['include', 'omit'], mode: ['no-cors', 'same-origin'],
  cache: ['no-store', 'only-if-cached'], redirect: ['error', 'manual'], referrer: ['http://attacker.invalid/', ''], referrerPolicy: ['unsafe-url'], integrity: ['sha256-AAAA'],
  keepalive: [true, false], signal: ['$abort'], priority: ['low'], window: [null], duplex: ['half'],
};

for (const [label, engine] of [['Chromium', chromium], ['Firefox', firefox], ['WebKit', webkit]]) {
  describe(`prototype pollution in ${label}`, () => {
    let browser;
    before(async () => { try { browser = await engine.launch(); } catch { browser = undefined; } });
    after(() => browser?.close());

    it('does not change the requests the browser entry makes', { timeout: 120_000 }, async (t) => {
      if (!browser) return t.skip(`${label} isn't installed`);
      const page = await browser.newPage();
      try {
        await page.goto(`${origin}/`);
        const { baseline, problems } = await page.evaluate(pollute, NAMES);
        assert.match(baseline, /"get":\[200/);
        assert.deepEqual(problems, []);
      } finally {
        await page.close();
      }
    });
  });
}
