// Bundler compatibility (#71): build a small app that imports rust-fetch with Vite and webpack,
// then load the build in a real browser and make requests. Loading the .wasm next to an ES module
// is where bundlers differ, so the build output is what is tested, not just the import.
//
// Run `npm run build` first, then `npm run test:browsers`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
