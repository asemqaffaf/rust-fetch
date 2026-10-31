// Diagnostic companion to compare.mjs; it does not change the release gate.
// Usage: STARTUP_SAMPLES=40 RUST_FETCH_NATIVE=0 node benchmarks/startup-breakdown.mjs label=/path/to/pkg ...
// Omit RUST_FETCH_NATIVE to exercise locally built addons. Results include all
// raw samples, alternating build order, and fresh processes for every sample.
import { execFile } from 'node:child_process';
import { cpus, release } from 'node:os';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

if (process.env.STARTUP_WORKER) {
  const { pkg, url } = JSON.parse(process.env.STARTUP_WORKER);
  const wasm = { compileMs: 0, instantiateMs: 0 };
  for (const [name, field] of [['Module', 'compileMs'], ['Instance', 'instantiateMs']]) {
    const original = WebAssembly[name];
    WebAssembly[name] = new Proxy(original, {
      construct(target, args) {
        const start = performance.now();
        try { return Reflect.construct(target, args); }
        finally { wasm[field] += performance.now() - start; }
      },
    });
  }
  const cpuStart = process.cpuUsage();
  const beforeImportMs = performance.now();
  const { WasmClient } = await import(pathToFileURL(resolve(pkg, 'node.js')).href);
  const imported = performance.now();
  const client = new WasmClient({ timeoutMs: 0 });
  const constructed = performance.now();
  await client.get(url);
  const received = performance.now();
  const cpu = process.cpuUsage(cpuStart);
  console.log(JSON.stringify({
    beforeImportMs,
    importMs: imported - beforeImportMs,
    wasmCompileMs: wasm.compileMs,
    wasmInstantiateMs: wasm.instantiateMs,
    clientConstructionMs: constructed - imported,
    firstRequestMs: received - constructed,
    importAndFirstRequestMs: received - beforeImportMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    rssMiB: process.memoryUsage().rss / 1048576,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
  }));
  process.exit(0);
}

const builds = process.argv.slice(2).map((arg) => {
  const equal = arg.indexOf('=');
  if (equal < 1 || equal === arg.length - 1) throw Error('Expected label=/path/to/pkg');
  const pkg = resolve(arg.slice(equal + 1));
  const manifest = JSON.parse(readFileSync(resolve(pkg, 'package.json'), 'utf8'));
  return { label: arg.slice(0, equal), pkg, version: manifest.version };
});
const count = Number(process.env.STARTUP_SAMPLES ?? 40);
if (!builds.length || new Set(builds.map((b) => b.label)).size !== builds.length || !Number.isSafeInteger(count) || count < 1) {
  throw Error('Supply distinct build labels and a positive integer STARTUP_SAMPLES');
}
const payload = Buffer.from('{"ok":true}');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': payload.length });
  res.end(payload);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
const raw = Object.fromEntries(builds.map(({ label }) => [label, []]));
try {
  for (let round = 0; round < count; round++) {
    for (let index = 0; index < builds.length; index++) {
      const { label, pkg } = builds[(index + round) % builds.length];
      const started = performance.now();
      const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, STARTUP_WORKER: JSON.stringify({ pkg, url }) }, timeout: 30000,
      });
      raw[label].push({ ...JSON.parse(stdout), processWallMs: performance.now() - started });
    }
  }
} finally {
  server.closeAllConnections();
  server.close();
}
const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p, low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};
const summary = Object.fromEntries(builds.map(({ label }) => [label,
  Object.fromEntries(Object.keys(raw[label][0]).map((key) => {
    const values = raw[label].map((sample) => sample[key]);
    return [key, { median: quantile(values, .5), p10: quantile(values, .1), p90: quantile(values, .9) }];
  })),
]));
console.log(JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch, os: release(), cpu: cpus()[0]?.model },
  samplesPerBuild: count,
  transport: process.env.RUST_FETCH_NATIVE === '0' ? 'node:http' : 'addon when available',
  notes: 'Import includes JS loading and runtime initialization. Wasm compile/instantiate are instrumented subsets of import. Before-import includes Node/script bootstrap. Process wall includes spawn, bootstrap, one request and exit. CPU covers import through first response. This instrumented diagnostic is separate from the unchanged release benchmark.',
  builds, summary, raw,
}, null, 2));
