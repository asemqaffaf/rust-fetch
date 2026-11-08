// Bundler compatibility (#71): build a small app that imports rust-fetch with Vite, webpack and esbuild,
// then load the build in a real browser and make requests. Loading the .wasm next to an ES module
// is where bundlers differ, so the build output is what is tested, not just the import.
//
// Run `npm run build` first, then `npm run test:browsers`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const pkg = fileURLToPath(new URL('../../pkg/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' };

let work, api, browser;
const servers = [];

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Serve a directory as a static site */
async function serve(dir) {
  const server = await listen(async (req, res) => {
    let path = new URL(req.url, 'http://x').pathname;
    if (path.endsWith('/')) path += 'index.html';
    try {
      const file = await readFile(join(dir, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(file);
    } catch {
      res.writeHead(404).end();
    }
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function files(dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await files(join(dir, entry.name), found);
    else found.push(join(dir, entry.name));
  }
  return found;
}

/** Open the built app in Chromium and wait for it to report */
async function runInBrowser(site, page_ = '/') {
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
  try {
    await page.goto(`${site}${page_}?api=${encodeURIComponent(api)}`);
    await page.waitForFunction(() => document.body.dataset.result, undefined, { timeout: 20_000 });
    return { result: JSON.parse(await page.evaluate(() => document.body.dataset.result)), failures };
  } finally {
    await page.close();
  }
}

before(async () => {
  work = await mkdtemp(join(tmpdir(), 'rust-fetch-bundlers-'));
  api = await listen((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify(req.method === 'POST' ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : { hello: 'world' }));
    });
  }).then((server) => `http://127.0.0.1:${server.address().port}`);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  for (const server of servers) server.close();
  if (work) await rm(work, { recursive: true, force: true });
});

const expected = { status: 200, body: { hello: 'world' }, echoed: { n: 1 } };

describe('Vite', () => {
  it('builds the app, emits the .wasm as an asset, and it makes requests in the browser', async () => {
    const { build } = await import('vite');
    const root = join(work, 'vite');
    await cp(fixtures, root, { recursive: true });
    const outDir = join(work, 'vite-dist');
    await build({
      root,
      logLevel: 'warn',
      configFile: false,
      resolve: { alias: { 'rust-fetch': join(pkg, 'rust_fetch.js') } },
      build: { outDir, emptyOutDir: true, assetsInlineLimit: 0, rollupOptions: { input: join(root, 'vite-app', 'index.html') } },
      server: { fs: { strict: false } },
    });
    assert.ok((await files(outDir)).some((file) => file.endsWith('.wasm')), 'the .wasm is an emitted asset');
    const { result, failures } = await runInBrowser(await serve(outDir), '/vite-app/index.html');
    assert.deepEqual(result, expected);
    assert.deepEqual(failures, []);
  });

  it('serves the app in dev mode', async () => {
    const { createServer } = await import('vite');
    const server = await createServer({
      root: join(work, 'vite'),
      logLevel: 'warn',
      configFile: false,
      resolve: { alias: { 'rust-fetch': join(pkg, 'rust_fetch.js') } },
      optimizeDeps: { exclude: ['rust-fetch'] }, // wasm-bindgen glue must not be pre-bundled
      server: { port: 0, host: '127.0.0.1', fs: { strict: false } },
    });
    await server.listen();
    try {
      const { result, failures } = await runInBrowser(`http://127.0.0.1:${server.httpServer.address().port}`, '/vite-app/index.html');
      assert.deepEqual(result, expected);
      assert.deepEqual(failures, []);
    } finally {
      await server.close();
    }
  });
});

describe('webpack 5', () => {
  it('builds the app for production, emits the .wasm as an asset, and it makes requests in the browser', async () => {
    const { default: webpack } = await import('webpack');
    const outDir = join(work, 'webpack-dist');
    const compiler = webpack({
      mode: 'production',
      context: fixtures,
      entry: './app.js',
      output: { path: outDir, filename: 'main.js', publicPath: '' },
      resolve: { alias: { 'rust-fetch': join(pkg, 'rust_fetch.js') } },
      experiments: { topLevelAwait: true },
      performance: { hints: false },
    });
    const stats = await new Promise((resolve, reject) => compiler.run((error, result) => (error ? reject(error) : compiler.close(() => resolve(result)))));
    assert.equal(stats.hasErrors(), false, stats.toString({ errors: true }));
    await cp(join(fixtures, 'webpack-app', 'index.html'), join(outDir, 'index.html'));
    assert.ok((await files(outDir)).some((file) => file.endsWith('.wasm')), 'the .wasm is an emitted asset');
    const { result, failures } = await runInBrowser(await serve(outDir));
    assert.deepEqual(result, expected);
    assert.deepEqual(failures, []);
  });
});

describe('esbuild', () => {
  // esbuild leaves `new URL('rust_fetch_bg.wasm', import.meta.url)` alone and has no asset pipeline for it,
  // so the .wasm is copied next to the bundle (or passed to init() by URL). This documents that step.
  it('bundles the app to one ES module and, with the .wasm beside it, it makes requests in the browser', async () => {
    const { build } = await import('esbuild');
    const outDir = join(work, 'esbuild-dist');
    await build({
      entryPoints: [join(fixtures, 'app.js')],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      outfile: join(outDir, 'main.js'),
      alias: { 'rust-fetch': join(pkg, 'rust_fetch.js') },
      logLevel: 'warning',
    });
    await copyFile(join(pkg, 'rust_fetch_bg.wasm'), join(outDir, 'rust_fetch_bg.wasm'));
    await cp(join(fixtures, 'esbuild-app', 'index.html'), join(outDir, 'index.html'));
    const { result, failures } = await runInBrowser(await serve(outDir));
    assert.deepEqual(result, expected);
    assert.deepEqual(failures, []);
  });
});

describe('examples/browser-upload (Vite)', () => {
  // The example is built unchanged and driven like a person would: pick a file, press the button.
  const exampleDir = fileURLToPath(new URL('../../../examples/browser-upload/', import.meta.url));
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  let site;

  before(async () => {
    const { build } = await import('vite');
    const outDir = join(work, 'browser-upload-dist');
    await build({
      root: exampleDir,
      logLevel: 'warn',
      configFile: false,
      resolve: { alias: { 'rust-fetch': join(pkg, 'rust_fetch.js') } },
      build: { outDir, emptyOutDir: true, assetsInlineLimit: 0 },
      server: { fs: { strict: false } },
    });
    site = await serve(outDir);
  });

  /** An upload server that reads slowly (so progress arrives in steps) or not at all (so the upload can be cancelled) */
  async function uploadServer({ read }) {
    const stats = { received: 0 };
    const server = await listen((req, res) => {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
      if (!read) return; // never answers, never reads: the upload stalls
      req.on('data', (chunk) => {
        stats.received += chunk.length;
        req.pause();
        setTimeout(() => req.resume(), 8);
      });
      req.on('end', () => res.writeHead(200, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify({ received: stats.received })));
    });
    return { url: `http://127.0.0.1:${server.address().port}`, stats };
  }

  async function open(apiUrl) {
    const page = await browser.newPage();
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    // Record every value the progress bar takes
    await page.addInitScript(() => {
      window.__bar = [];
      new MutationObserver(() => {}).observe(document, { childList: true, subtree: true });
      const watch = () => {
        const bar = document.querySelector('#bar');
        if (!bar) return void requestAnimationFrame(watch);
        setInterval(() => { const v = bar.value / (bar.max || 1); if (window.__bar.at(-1) !== v) window.__bar.push(v); }, 5);
      };
      watch();
    });
    await page.goto(`${site}/?api=${encodeURIComponent(apiUrl)}`);
    await page.waitForFunction(() => document.querySelector('#send') && !document.querySelector('#send').disabled);
    return { page, failures };
  }

  it('uploads a file with a progress bar that moves in steps and ends full', async () => {
    const { url, stats } = await uploadServer({ read: true });
    const { page, failures } = await open(url);
    try {
      const size = 12 * 1024 * 1024;
      await page.setInputFiles('#file', { name: 'big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(size, 1) });
      await page.click('#send');
      await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Uploaded'), undefined, { timeout: 30_000 });
      const steps = await page.evaluate(() => window.__bar);
      assert.ok(new Set(steps).size >= 3, `the bar moved in several steps: ${JSON.stringify(steps)}`);
      assert.equal(steps.at(-1), 1, 'the bar ends full');
      assert.ok(stats.received >= size, `the server received every byte (${stats.received})`);
      assert.deepEqual(failures, []);
    } finally {
      await page.close();
    }
  });

  it('cancels an upload that has stalled', async () => {
    const { url } = await uploadServer({ read: false });
    const { page, failures } = await open(url);
    try {
      await page.setInputFiles('#file', { name: 'big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(40 * 1024 * 1024, 1) });
      await page.click('#send');
      await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Uploading'));
      await page.click('#cancel');
      await page.waitForFunction(() => document.querySelector('#status').textContent === 'Cancelled', undefined, { timeout: 10_000 });
      assert.deepEqual(failures, []);
    } finally {
      await page.close();
    }
  });
});
