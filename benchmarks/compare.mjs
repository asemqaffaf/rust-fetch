// Compares two builds of the package (e.g. a pull request against main) on
// the same machine: throughput for small JSON (sequential and 50 concurrent)
// and an 8 MB body, startup, for both Node.js transports, and bundle size.
//
// Usage: node benchmarks/compare.mjs <base pkg dir> [<head pkg dir>]
//   head defaults to wasm-module/pkg. BENCH_ROUNDS (default 5) and
//   BENCH_SECONDS (per measurement, default 1.5) tune the run.
//
// Every measurement runs in a fresh process against a server in this one,
// alternating base and head in each round to cancel drift on shared CI
// runners. A change counts as a regression only when the median is more than
// 10% worse and head lost to base in most rounds. With GITHUB_STEP_SUMMARY set
// the table goes to the job summary, and regressions become warnings; the
// exit code is 0 (a noisy runner should never block a merge), unless
// BENCH_STRICT=1, which fails on a regression (used before publishing).
// BENCH_TITLE replaces the report's heading.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const [baseArg, headArg] = process.argv.slice(2);
if (!baseArg) {
  console.error('Usage: node benchmarks/compare.mjs <base pkg dir> [<head pkg dir>]');
  process.exit(2);
}
const builds = {
  base: resolve(baseArg),
  head: resolve(headArg ?? fileURLToPath(new URL('../wasm-module/pkg/', import.meta.url))),
};
const rounds = Number(process.env.BENCH_ROUNDS ?? 5);
const seconds = Number(process.env.BENCH_SECONDS ?? 1.5);
const THRESHOLD = 0.1;

// --- Worker: one measurement in a fresh process --------------------------------

if (process.env.BENCH_WORKER) {
  const { pkg, url, scenario } = JSON.parse(process.env.BENCH_WORKER);
  if (scenario === 'overhead') {
    // rust-fetch's own cost per request, with a transport that answers at
    // once: no network, server or decoding, so it's steady on a busy runner
    const response = { status: 200, statusText: 'OK', ok: true, url: 'http://x/', headers: {}, body: { ok: true } };
    globalThis[Symbol.for('rust-fetch.transport')] = () => Object.assign(Promise.resolve(response), { cancel() {} });
    const m = await import(pathToFileURL(resolve(pkg, 'rust_fetch.js')).href);
    m.initSync({ module: readFileSync(resolve(pkg, 'rust_fetch_bg.wasm')) });
    const client = new m.WasmClient();
    for (let i = 0; i < 20_000; i++) await client.get('http://x/');
    const start = performance.now();
    let count = 0;
    while (performance.now() - start < seconds * 1000) {
      await client.get('http://x/');
      count++;
    }
    console.log(JSON.stringify({ startup: 0, value: -((performance.now() - start) * 1000) / count }));
    process.exit(0);
  }
  const t0 = performance.now();
  const { WasmClient } = await import(pathToFileURL(resolve(pkg, 'node.js')).href);
  const client = new WasmClient({ timeoutMs: 0 });
  await client.get(`${url}/small`);
  const startup = performance.now() - t0;
  const path = scenario === 'large' ? '/large' : '/small';
  const concurrency = scenario === 'concurrent' ? 50 : 1;
  const run = async (ms) => {
    let count = 0;
    const end = performance.now() + ms;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (performance.now() < end) {
          // Small JSON the most common way, with no options object (2.5.0's
          // regression only showed there); the 8 MB body as bytes
          if (scenario === 'large') await client.get(`${url}${path}`, { responseType: 'binary' });
          else await client.get(`${url}${path}`);
          count++;
        }
      }),
    );
    return count;
  };
  await run(300); // warm up: connections, JIT tiers
  const start = performance.now();
  const count = await run(seconds * 1000);
  const rate = count / ((performance.now() - start) / 1000);
  console.log(JSON.stringify({ startup, value: scenario === 'large' ? (rate * 8) : rate }));
  process.exit(0);
}

// --- Coordinator -----------------------------------------------------------------

for (const [name, dir] of Object.entries(builds)) {
  if (!existsSync(resolve(dir, 'node.js'))) throw new Error(`${name}: no built package in ${dir}`);
}

const small = Buffer.from(JSON.stringify({ id: 1, name: 'Zoë', tags: ['a', 'b'], nested: { ok: true } }));
const large = Buffer.alloc(8 * 1024 * 1024, 7);
const server = http.createServer((req, res) => {
  const body = req.url === '/large' ? large : small;
  res.writeHead(200, { 'content-type': req.url === '/large' ? 'application/octet-stream' : 'application/json', 'content-length': body.length });
  res.end(body);
});
server.keepAliveTimeout = 30_000;
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;

const scenarios = [
  ['sequential', 'Small JSON, sequential', 'req/s'],
  ['concurrent', 'Small JSON, 50 concurrent', 'req/s'],
  ['large', '8 MB body, sequential', 'MB/s'],
];
const transports = [
  ['node:http', { RUST_FETCH_NATIVE: '0' }],
  ['native', {}],
];
const hasNative = (dir) => existsSync(resolve(dir, `rust-fetch-native.${process.platform}-${process.arch}.node`));

async function measure(pkg, scenario, env) {
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url), 'worker'], {
    env: { ...process.env, ...env, BENCH_WORKER: JSON.stringify({ pkg, url, scenario }) },
  });
  return JSON.parse(stdout);
}

const results = new Map(); // key -> { base: [], head: [] }
const record = (key, side, value) => {
  if (!results.has(key)) results.set(key, { base: [], head: [] });
  results.get(key)[side].push(value);
};

for (let round = 0; round < rounds; round++) {
  // Alternate which build goes first
  const order = round % 2 ? ['head', 'base'] : ['base', 'head'];
  for (const side of order) {
    const { value } = await measure(builds[side], 'overhead', {});
    record('overhead|client', side, value); // negative: lower is better
  }
  for (const [scenario] of scenarios) {
    for (const [transport, env] of transports) {
      if (transport === 'native' && !(hasNative(builds.base) && hasNative(builds.head))) continue;
      for (const side of order) {
        const { startup, value } = await measure(builds[side], scenario, env);
        record(`${scenario}|${transport}`, side, value);
        record(`startup|${transport}`, side, -startup); // negative: higher is better everywhere
      }
    }
  }
  process.stderr.write(`round ${round + 1}/${rounds} done\n`);
}
server.close();

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const rows = [];
const warnings = [];
const labels = Object.fromEntries(scenarios.map(([key, label, unit]) => [key, [label, unit]]));
labels.startup = ['Startup: import + first request', 'ms'];
labels.overhead = ['Client overhead per request (instant transport)', 'µs'];
// Throughput first, startup last
const ordered = [...results].sort(([a], [b]) => /^(startup|overhead)\|/.test(a) - /^(startup|overhead)\|/.test(b));
for (const [key, { base, head }] of ordered) {
  const [scenario, transport] = key.split('|');
  const [label, unit] = labels[scenario];
  const lowerIsBetter = scenario === 'startup' || scenario === 'overhead';
  const sign = lowerIsBetter ? -1 : 1;
  const [b, h] = [median(base) * sign, median(head) * sign];
  // Relative change where positive is better
  const change = lowerIsBetter ? (b - h) / b : (h - b) / b;
  const losses = base.filter((value, i) => head[i] < value).length;
  const regression = change < -THRESHOLD && losses > base.length / 2;
  const name = scenario === 'overhead' ? label : `${label} (${transport})`;
  if (regression) warnings.push(`${name}: ${(change * 100).toFixed(1)}%, worse in ${losses} of ${base.length} rounds`);
  const format = (value) => (unit === 'ms' || unit === 'µs' ? value.toFixed(1) : Math.round(value).toLocaleString('en-US'));
  rows.push(`| ${name} | ${format(b)} ${unit} | ${format(h)} ${unit} | ${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}% | ${regression ? '⚠️ regression' : ''} |`);
}

const size = (dir) => {
  const total = { raw: 0, gzip: 0, brotli: 0 };
  for (const file of ['rust_fetch_bg.wasm', 'rust_fetch.js']) {
    const bytes = readFileSync(resolve(dir, file));
    total.raw += bytes.length;
    total.gzip += gzipSync(bytes, { level: 9 }).length;
    total.brotli += brotliCompressSync(bytes).length;
  }
  return total;
};
const [baseSize, headSize] = [size(builds.base), size(builds.head)];
for (const kind of ['brotli', 'gzip']) {
  const [b, h] = [baseSize[kind] / 1000, headSize[kind] / 1000];
  rows.push(`| Browser bundle, ${kind} (.wasm + JS glue) | ${b.toFixed(1)} kB | ${h.toFixed(1)} kB | ${h >= b ? '+' : ''}${(h - b).toFixed(1)} kB | |`);
}

const report = [
  `## ${process.env.BENCH_TITLE ?? 'Benchmarks: this PR against the base branch'}`,
  '',
  `Median of ${rounds} interleaved rounds, ${seconds} s each, fresh process per measurement, Node.js ${process.versions.node} (${process.platform} ${process.arch}). Change: positive is better. Flagged when more than ${THRESHOLD * 100}% worse in the median *and* in most rounds.`,
  '',
  '| Benchmark | Base | This PR | Change | |',
  '| --- | ---: | ---: | ---: | --- |',
  ...rows,
  '',
  warnings.length ? `**Possible regressions:** ${warnings.join('; ')}. Shared runners are noisy: rerun the job, or reproduce locally (see README *Benchmarks*).` : 'No regressions above the threshold.',
  '',
].join('\n');

console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (process.env.GITHUB_ACTIONS) for (const warning of warnings) console.log(`::warning title=Benchmark regression::${warning}`);
if (process.env.BENCH_STRICT === '1' && warnings.length) process.exit(1);
