// The transport conformance suite: every case in cases.mjs on every adapter,
// and the behaviour matrix (CONFORMANCE.md). Exits 1 on any observation that
// is neither the expected one nor a documented difference.
//
// Usage: npm run build && npm run build:native && npm run test:conformance
//   --write    update CONFORMANCE.md (otherwise it's checked to be current)
//   --only <adapter,...>   run some adapters (the matrix isn't checked then)
// Adapters: node:http, native, fetch() (the browser build in Node.js), and
// chromium, firefox, webkit (through Playwright). An adapter that isn't
// available (no native addon, a browser not installed) fails the run unless
// CONFORMANCE_OPTIONAL lists it, so CI can't skip one silently.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cases, HELPERS } from './cases.mjs';
import { startServers } from './server.mjs';

const root = new URL('../../../../', import.meta.url);
const pkg = new URL('wasm-module/pkg/', root);
const matrixFile = new URL('CONFORMANCE.md', root);
const ADAPTERS = ['node:http', 'native', 'fetch()', 'chromium', 'firefox', 'webkit'];
const LABELS = { 'node:http': 'node:http', native: 'native', 'fetch()': 'fetch() in Node.js', chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' };

/** Compare observations whatever their key order */
const canonical = (value) =>
  JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

/** The source a case is evaluated from: the helpers, then its `run` */
const source = (testCase) => `${HELPERS}\nreturn (${testCase.run})(rf, ctx);`;

// --- In a child process: run every case on one Node.js adapter ------------------------
if (process.env.CONFORMANCE_CHILD) {
  const { adapter, ctx } = JSON.parse(process.env.CONFORMANCE_CHILD);
  let rf;
  if (adapter === 'fetch()') {
    rf = await import(new URL('rust_fetch.js', pkg).href);
    rf.initSync({ module: readFileSync(new URL('rust_fetch_bg.wasm', pkg)) });
  } else {
    rf = await import(new URL('node.js', pkg).href);
  }
  const results = {};
  for (const testCase of cases) {
    const context = { ...ctx, id: (name) => `${adapter}:${name}` };
    try {
      // eslint-disable-next-line no-new-func
      results[testCase.id] = await new Function('rf', 'ctx', source(testCase))(rf, context);
    } catch (error) {
      results[testCase.id] = { harness: String(error?.stack ?? error) };
    }
  }
  console.log(JSON.stringify(results));
  process.exit(0);
}

// --- Coordinator ----------------------------------------------------------------------
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : ADAPTERS;
const optional = (process.env.CONFORMANCE_OPTIONAL ?? '').split(',').filter(Boolean);

const servers = await startServers((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>rust-fetch conformance</title>');
    return true;
  }
  if (path === '/rust_fetch.js' || path === '/rust_fetch_bg.wasm') {
    res.writeHead(200, { 'content-type': path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    res.end(readFileSync(new URL(path.slice(1), pkg)));
    return true;
  }
  return false;
});
// A port nothing listens on
const closed = await new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(`http://127.0.0.1:${port}/`));
  });
});
const ctx = { a: servers.a, b: servers.b, closed };

const nativeAddon = new URL(`rust-fetch-native.${process.platform}-${process.arch}.node`, pkg);

async function runNode(adapter) {
  if (adapter === 'native' && !existsSync(nativeAddon)) return { unavailable: 'no native addon built (npm run build:native)' };
  const env = { ...process.env, CONFORMANCE_CHILD: JSON.stringify({ adapter, ctx }) };
  if (adapter === 'node:http') env.RUST_FETCH_NATIVE = '0';
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], { env, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  return { results: JSON.parse(stdout.trim().split('\n').pop()) };
}

async function runBrowser(name) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return { unavailable: 'playwright is not installed' };
  }
  let browser;
  try {
    browser = await playwright[name].launch();
  } catch (error) {
    return { unavailable: `${name} is not installed (npx playwright install ${name})` };
  }
  try {
    const page = await browser.newPage();
    await page.goto(`${servers.a}/`);
    const results = await page.evaluate(
      async ({ list, ctx, adapter }) => {
        const rf = await import('/rust_fetch.js');
        await rf.default();
        const results = {};
        for (const { id, source } of list) {
          const context = { ...ctx, id: (name) => `${adapter}:${name}` };
          try {
            // eslint-disable-next-line no-new-func
            results[id] = await new Function('rf', 'ctx', source)(rf, context);
          } catch (error) {
            results[id] = { harness: String(error?.stack ?? error) };
          }
        }
        return results;
      },
      { list: cases.map((c) => ({ id: c.id, source: source(c) })), ctx, adapter: name },
    );
    return { results };
  } finally {
    await browser.close();
  }
}

const runs = {};
for (const adapter of only) {
  runs[adapter] = ['chromium', 'firefox', 'webkit'].includes(adapter) ? await runBrowser(adapter) : await runNode(adapter);
}
servers.close();

// --- Compare, and the matrix ----------------------------------------------------------
const failures = [];
const notes = [];
const cell = (testCase, adapter) => {
  const run = runs[adapter];
  if (!run || run.unavailable) return '–';
  const observed = run.results[testCase.id];
  const difference = testCase.differs?.[adapter];
  // A documented difference may accept several observations (anyOf), where a
  // platform's own behaviour varies (e.g. by operating system)
  const accepted = difference ? (difference.anyOf ?? [difference.expect]) : [testCase.expect];
  const expected = accepted.length === 1 ? accepted[0] : { anyOf: accepted };
  if (accepted.some((option) => canonical(observed) === canonical(option))) {
    if (!difference) return '✓';
    let n = notes.indexOf(difference.why) + 1;
    if (!n) n = notes.push(difference.why);
    return `differs (${n})`;
  }
  failures.push(`${testCase.id} on ${adapter}:\n    expected ${canonical(expected)}\n    observed ${canonical(observed)}`);
  return '**✗**';
};

const shown = ADAPTERS.filter((adapter) => only.includes(adapter));
const lines = [
  '# Transport conformance',
  '',
  'Each behaviour below runs the same test code on every adapter rust-fetch has: both Node.js transports, `fetch()` in Node.js (the browser build without the Node.js entry), and real browsers. ✓ is the expected behaviour; "differs" is a documented difference, explained under the table. Generated by `npm run test:conformance` (`wasm-module/js/test/conformance/`), which fails CI on any other difference. The Rust client is covered by its own integration tests.',
];
let area;
for (const testCase of cases) {
  if (testCase.area !== area) {
    area = testCase.area;
    lines.push('', `## ${area}`, '', `| Behaviour | ${shown.map((a) => LABELS[a]).join(' | ')} |`, `| --- |${shown.map(() => ' :---: |').join('')}`);
  }
  lines.push(`| ${testCase.title} | ${shown.map((a) => cell(testCase, a)).join(' | ')} |`);
}
lines.push('', '## Documented differences', '', ...notes.map((note, i) => `${i + 1}. ${note}`), '');
const matrix = lines.join('\n');

for (const [adapter, run] of Object.entries(runs)) {
  if (run.unavailable) {
    const message = `${adapter} unavailable: ${run.unavailable}`;
    if (optional.includes(adapter)) console.warn(`(skipped) ${message}`);
    else failures.push(message);
  }
}

if (args.includes('--write')) {
  writeFileSync(matrixFile, matrix);
  console.log(`wrote ${fileURLToPath(matrixFile)}`);
} else if (only === ADAPTERS && !optional.length) {
  const committed = existsSync(matrixFile) ? readFileSync(matrixFile, 'utf8') : '';
  if (committed !== matrix) failures.push('CONFORMANCE.md is out of date: run `npm run test:conformance -- --write` and commit it');
}

const total = cases.length * shown.filter((a) => !runs[a].unavailable).length;
if (failures.length) {
  console.error(`\n${failures.length} conformance failure(s):\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`${cases.length} behaviours on ${shown.filter((a) => !runs[a].unavailable).join(', ')}: ${total} observations as expected`);
