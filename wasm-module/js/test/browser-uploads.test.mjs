import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import http2 from 'node:http2';
import http from 'node:http';
import { chromium, firefox, webkit } from 'playwright';

let server, origin, http1, http1Origin;
const sessions = new Set();
const requests = new Map();
const received = new Map(); // upload bytes per URL, counted as they arrive
before(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rust-fetch-upload-tls-'));
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const handler = (req, res) => {
    req.on('error', () => {});
    if (req.url === '/') { res.end('<!doctype html><title>Streaming uploads</title>'); return; }
    if (req.url === '/rust_fetch.js' || req.url === '/rust_fetch_bg.wasm') {
      res.setHeader('content-type', req.url.endsWith('wasm') ? 'application/wasm' : 'text/javascript');
      res.end(readFileSync(new URL('../../pkg' + req.url, import.meta.url))); return;
    }
    if (req.url === '/redirect') { res.writeHead(307, { location: '/upload' }); res.end(); return; }
    let size = 0;
    req.on('data', (chunk) => { size += chunk.length; received.set(req.url, (received.get(req.url) ?? 0) + chunk.length); });
    req.on('end', () => {
      const count = (requests.get(req.url) ?? 0) + 1; requests.set(req.url, count);
      res.writeHead(req.url.startsWith('/retry?') && count === 1 ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ size, protocol: req.httpVersionMajor }));
    });
  };
  server = http2.createSecureServer({ key: readFileSync(key), cert: readFileSync(cert), allowHTTP1: true }, handler);
  http1 = http.createServer(handler);
  await new Promise((resolve) => http1.listen(0, '127.0.0.1', resolve));
  http1Origin = `http://127.0.0.1:${http1.address().port}`;
  server.on('session', (session) => { sessions.add(session); session.on('close', () => sessions.delete(session)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${server.address().port}`;
});
after(async () => { for (const session of sessions) session.destroy(); server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); http1.closeAllConnections(); await new Promise((resolve) => http1.close(resolve)); });
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  // WebKit's Soup network backend explicitly rejects pending-stream bodies,
  // although its Request constructor accepts them. Cocoa supports uploads.
  const networkStreams = name !== 'firefox' && !(name === 'webkit' && process.platform === 'linux');
  let available = true;
  try { readFileSync(engine.executablePath()); } catch { available = false; }
  describe(`${name} streaming uploads over HTTP/2`, { skip: !available, timeout: 30000 }, () => {
    let browser, page;
    before(async () => { browser = await engine.launch(); page = await browser.newPage({ ignoreHTTPSErrors: true }); await page.goto(origin); });
    after(async () => browser?.close());
    it('sends incrementally where supported, otherwise rejects explicitly', async () => {
      const path = `/upload?engine=${name}`;
      const result = await page.evaluate(async (path) => {
        const { default: init, WasmClient } = await import('/rust_fetch.js'); await init();
        const c = new WasmClient({ retries: 0, timeoutMs: 5000 });
        const control = (await c.get('/protocol')).body.protocol;
        let pulls = 0;
        let cancelled = false;
        const progress = [];
        try {
          const response = await c.post(path, { body: new ReadableStream({ async pull(controller) {
            await new Promise((r) => setTimeout(r, 1));
            if (pulls++ === 64) controller.close(); else controller.enqueue(new Uint8Array(65536));
          }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), onUploadProgress: (p) => progress.push(p) });
          return { ok: true, body: response.body, progress, pulls, control };
        } catch (error) {
          const pullsAtRejection = pulls;
          // A rejected upload must stop the producer, not keep draining it
          await new Promise((r) => setTimeout(r, 50));
          return { ok: false, kind: error.kind, parameter: error.parameter, message: error.message, pulls, pullsAtRejection, cancelled, control };
        }
        finally { c.free(); }
      }, path);
      if (name === 'firefox') {
        assert.equal(result.kind, 'InvalidInputError', JSON.stringify(result));
        assert.equal(result.parameter, 'body');
        assert.equal(result.pulls, 0);
      } else if (!networkStreams) {
        assert.equal(result.control, 2, 'ordinary fetch still uses the HTTP/2 server');
        assert.equal(result.kind, 'NetworkError', JSON.stringify(result));
        // Soup rejects the body in the network process; WebKit may read the
        // first chunk before that rejection arrives, so that is timing, not
        // behaviour. What must hold: nothing is sent, and the producer stops.
        assert.ok(result.pulls <= 1, `at most the chunk WebKit reads before rejecting: ${JSON.stringify(result)}`);
        assert.equal(result.pulls, result.pullsAtRejection, 'no pulls after the rejection');
        assert.equal(result.cancelled, true, 'the producer is cancelled');
        assert.equal(received.get(path) ?? 0, 0, 'no upload bytes reach the server');
      } else {
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.body.size, 64 * 65536);
        assert.equal(result.body.protocol, 2);
        assert.equal(result.progress.at(-1).loaded, result.body.size);
        assert.ok(result.progress.every((p, i) => p.total === 0 && p.loaded >= (result.progress[i - 1]?.loaded ?? 0)));
      }
    });
    it('cancels a pending producer and rejects body-preserving fetch redirects', { skip: !networkStreams }, async () => {
      const result = await page.evaluate(async () => {
        const { WasmClient } = await import('/rust_fetch.js');
        const c = new WasmClient({ retries: 0, timeoutMs: 2000 });
        let cancelled = false;
        let progress = 0;
        const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(64)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
        let kind;
        try { await c.put('/upload', { body, deadlineMs: 40, onUploadProgress() { progress++; } }); } catch (error) { kind = error.kind; }
        const lastProgress = progress;
        await new Promise((r) => setTimeout(r, 20));
        let redirect;
        try { await c.post('/redirect', { body: () => new ReadableStream({ start(c) { c.enqueue('abc'); c.close(); } }) }); } catch (error) { redirect = error.kind; }
        c.free();
        return { cancelled, kind, redirect, progress, lastProgress };
      });
      assert.equal(result.kind, 'TimeoutError');
      assert.equal(result.cancelled, true);
      assert.equal(result.progress, result.lastProgress);
      assert.equal(result.redirect, 'NetworkError');
    });
    it('retries fresh factories and keeps one-shot bodies single-use', { skip: !networkStreams }, async () => {
      const result = await page.evaluate(async (name) => {
        const { WasmClient } = await import('/rust_fetch.js');
        const c = new WasmClient({ retries: { maxRetries: 1, initialDelayMs: 0, retryNonIdempotent: true }, timeoutMs: 2000 });
        let opens = 0, status;
        const factory = () => { opens++; return new ReadableStream({ start(c) { c.enqueue('abc'); c.close(); } }); };
        const response = await c.put('/retry?factory=' + name, { body: factory });
        try { await c.put('/retry?once=' + name, { body: factory() }); } catch (error) { status = error.status; }
        c.free(); return { size: response.body.size, opens, status };
      }, name);
      assert.equal(result.size, 3); assert.equal(result.opens, 3); assert.equal(result.status, 503);
    });
    it('keeps invalid producer errors typed', { skip: name === 'firefox' }, async () => {
      const result = await page.evaluate(async () => {
        const { WasmClient } = await import('/rust_fetch.js');
        const c = new WasmClient({ retries: 0, timeoutMs: 2000 });
        const errors = [];
        for (const body of [async function* () { yield 17; }, () => 42, async function* () { throw new Error('producer failure'); }]) {
          try { await c.put('/upload', { body }); } catch (error) { errors.push({ kind: error.kind, parameter: error.parameter, message: error.message }); }
        }
        c.free(); return errors;
      });
      assert.equal(result[0].kind, 'InvalidInputError'); assert.equal(result[0].parameter, 'body');
      assert.equal(result[1].kind, 'InvalidInputError');
      assert.equal(result[2].kind, 'NetworkError'); assert.match(result[2].message, /producer failure/);
    });
    it('keeps HTTP/1.1 streaming failures explicit', { skip: name === 'firefox' }, async (t) => {
      await page.goto(http1Origin);
      const result = await page.evaluate(async () => {
        const { default: init, WasmClient } = await import('/rust_fetch.js'); await init();
        const c = new WasmClient({ retries: 0, timeoutMs: 2000 });
        try { return { body: (await c.post('/upload', { body: new ReadableStream({ start(c) { c.enqueue('abc'); c.close(); } }) })).body }; }
        catch (error) { return { kind: error.kind, message: error.message }; }
        finally { c.free(); }
      });
      t.diagnostic(JSON.stringify(result));
      assert.equal(result.kind, 'NetworkError');
    });
  });
}
