// Startup cost: how long until the first response, from a fresh process (Node.js)
// or a fresh page (browsers), compared with the runtime's own fetch().
// Usage: npm run build && npm run bench:cold
//
// Node.js: each sample is a new process. `import` is the time to import the
// package (which compiles the WebAssembly module); `first request` is the
// first get() of a small JSON response from a local server.
// Browsers (Playwright; skipped if not installed): `cold` is a new browser
// context (empty HTTP cache), `cached` a reload of the same page, so the
// .wasm comes from the HTTP cache (and, in Chromium, its compiled code).
import { execFile } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const samples = Number(process.env.BENCH_SAMPLES ?? 7);
const pkg = new URL('../wasm-module/pkg/', import.meta.url);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const ms = (value) => `${value.toFixed(1)} ms`;

const server = http.createServer((req, res) => {
  const files = { '/rust_fetch.js': 'text/javascript', '/rust_fetch_bg.wasm': 'application/wasm' };
  if (files[req.url]) {
    res.writeHead(200, { 'content-type': files[req.url], 'cache-control': 'max-age=3600' });
    return res.end(readFileSync(new URL(req.url.slice(1), pkg)));
  }
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>cold start</title>');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// --- Node.js -------------------------------------------------------------------

const nodeScript = (mode) => `
const t0 = performance.now();
${mode === 'fetch' ? '' : `const { WasmClient } = await import(${JSON.stringify(fileURLToPath(new URL('node.js', pkg)))});`}
const t1 = performance.now();
${mode === 'fetch' ? `await (await fetch('${origin}/json')).json();` : `await new WasmClient().get('${origin}/json');`}
const t2 = performance.now();
console.log(JSON.stringify({ import: t1 - t0, first: t2 - t1 }));`;

// Each sample is a module file run as the main module, like a real program
// (an `-e` script would also time the ES module loader's startup).
// Asynchronously, so this process's server can answer.
const scripts = mkdtempSync(join(tmpdir(), 'rust-fetch-cold-'));
async function nodeSamples(mode, env = {}) {
  const script = join(scripts, `${mode}.mjs`);
  writeFileSync(script, nodeScript(mode));
  const runs = [];
  for (let i = 0; i < samples; i++) {
    const { stdout } = await promisify(execFile)(process.execPath, [script], { env: { ...process.env, ...env } });
    runs.push(JSON.parse(stdout));
  }
  const imp = median(runs.map((r) => r.import));
  const first = median(runs.map((r) => r.first));
  return { import: imp, first, total: median(runs.map((r) => r.import + r.first)) };
}

const rows = [];
const node = `Node.js ${process.versions.node}`;
for (const [name, mode, env] of [
  ['fetch()', 'fetch', {}],
  ['rust-fetch, node:http', 'rust', { RUST_FETCH_NATIVE: '0' }],
  ['rust-fetch, native', 'rust', {}],
]) {
  const r = await nodeSamples(mode, env);
  rows.push({ runtime: node, client: name, import: mode === 'fetch' ? '—' : ms(r.import), 'first request': ms(r.first), total: ms(r.total) });
}

// --- Browsers --------------------------------------------------------------------

let playwright;
try {
  playwright = await import('playwright');
} catch {}

async function browserSample(page) {
  return page.evaluate(async () => {
    const t0 = performance.now();
    const rf = await import('/rust_fetch.js');
    await rf.default();
    const t1 = performance.now();
    await new rf.WasmClient().get('/json');
    const t2 = performance.now();
    await (await fetch('/json?fetch')).json();
    const t3 = performance.now();
    return { init: t1 - t0, first: t2 - t1, fetch: t3 - t2 };
  });
}

for (const name of ['chromium', 'firefox', 'webkit']) {
  const engine = playwright?.[name];
  try {
    readFileSync(engine.executablePath());
  } catch {
    continue;
  }
  const browser = await engine.launch();
  const cold = [];
  const cached = [];
  for (let i = 0; i < samples; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    cold.push(await browserSample(page));
    await page.reload();
    cached.push(await browserSample(page));
    await context.close();
  }
  await browser.close();
  for (const [label, runs] of [['cold', cold], ['cached', cached]]) {
    rows.push({
      runtime: `${name} (${label})`,
      client: 'rust-fetch',
      import: ms(median(runs.map((r) => r.init))),
      'first request': ms(median(runs.map((r) => r.first))),
      total: ms(median(runs.map((r) => r.init + r.first))),
    });
  }
}

server.close();
rmSync(scripts, { recursive: true, force: true });
console.log(`Median of ${samples} samples; ${process.platform} ${process.arch}`);
console.table(rows);
