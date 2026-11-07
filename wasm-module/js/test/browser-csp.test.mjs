// The browser build under a strict Content Security Policy, in real browsers (#233).
// The page is served with no 'unsafe-eval', no 'unsafe-inline' and, where the engine supports it,
// Trusted Types required for every script sink. The only allowance beyond 'self' is
// 'wasm-unsafe-eval', which compiling WebAssembly needs (docs/security.md, "Content Security Policy").
// The test loads the build, makes requests, and fails on any securitypolicyviolation event or
// uncaught error. Two controls prove the policy is enforced: eval() must be blocked, and in Chromium
// so must a string assigned to innerHTML.
//
// Run `npm run build` first, then `npm run test:browsers`. A browser that isn't installed is skipped.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const { chromium, firefox, webkit } = await import('playwright');
const pkg = new URL('../../pkg/', import.meta.url);

const POLICY = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'";

// An external module: the policy has no 'unsafe-inline', so the page itself cannot carry script
const PAGE_SCRIPT = `
const result = { violations: [], controls: {} };
window.__result = result;
// Controls first, before the listener: these two are meant to be blocked, and each fires a violation event
try { eval('1'); result.controls.evalBlocked = false; } catch { result.controls.evalBlocked = true; }
try { document.body.innerHTML = 'x'; result.controls.innerHtmlBlocked = false; } catch { result.controls.innerHtmlBlocked = true; }
// Violation events are queued as tasks: let the two the controls caused arrive before listening
await new Promise((resolve) => setTimeout(resolve, 100));
document.addEventListener('securitypolicyviolation', (e) => result.violations.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || '')));
window.addEventListener('error', (e) => result.violations.push('error ' + e.message));
window.addEventListener('unhandledrejection', (e) => result.violations.push('rejection ' + e.reason));
try {
  const { default: init, WasmClient } = await import('/rust_fetch.js');
  await init();
  const client = new WasmClient({ baseUrl: location.origin, timeoutMs: 10000 });
  const got = await client.get('/echo');
  const posted = await client.post('/echo', { body: { a: 1 } });
  const streamed = await client.get('/echo', { responseType: 'stream' });
  const reader = streamed.body.getReader();
  let text = '';
  for (let r = await reader.read(); !r.done; r = await reader.read()) text += new TextDecoder().decode(r.value);
  let failure = null;
  try { await client.get('/missing'); } catch (e) { failure = e.kind; }
  Object.assign(result, { ok: true, status: got.status, body: got.body, posted: posted.body, streamed: JSON.parse(text), failure });
} catch (e) {
  Object.assign(result, { ok: false, error: String(e && e.message || e) });
}
result.done = true;
`;

let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': POLICY });
      return res.end('<!doctype html><meta charset="utf-8"><title>csp</title><body><script type="module" src="/page.js"></script>');
    }
    if (path === '/page.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(PAGE_SCRIPT);
    }
    if (path === '/rust_fetch.js' || path === '/rust_fetch_bg.wasm') {
      res.writeHead(200, { 'content-type': path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
      return res.end(readFileSync(new URL(path.slice(1), pkg)));
    }
    if (path === '/echo') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, length: Buffer.concat(chunks).length }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  let available = true;
  try {
    readFileSync(engine.executablePath());
  } catch {
    available = false;
  }

  describe(`${name} with a strict Content Security Policy`, { skip: !available && `${name} isn't installed (npx playwright install ${name})`, timeout: 120_000 }, () => {
    it('loads, initializes and makes requests without a single violation', async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${origin}/`);
        await page.waitForFunction(() => window.__result?.done, null, { timeout: 60_000 });
        const result = await page.evaluate(() => window.__result);

        assert.equal(result.controls.evalBlocked, true, 'the policy is not enforced: eval() ran');
        if (name === 'chromium') assert.equal(result.controls.innerHtmlBlocked, true, 'Trusted Types is not enforced');
        assert.equal(result.ok, true, `the build failed under the policy: ${result.error}`);
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, { method: 'GET', length: 0 });
        assert.deepEqual(result.posted, { method: 'POST', length: 7 });
        assert.deepEqual(result.streamed, { method: 'GET', length: 0 });
        assert.equal(result.failure, 'HttpError');
        assert.deepEqual(result.violations, [], 'the page reported policy violations');
      } finally {
        await browser.close();
      }
    });
  });
}
