// Compares rust-fetch with the runtime's native fetch() against a local server.
// Usage: npm run build && npm run bench
import http from 'node:http';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WasmClient } from '../wasm-module/pkg/node.js';

const small = JSON.stringify({ id: 1, name: 'Zoë', tags: ['a', 'b'], nested: { ok: true } });
const largeJson = JSON.stringify(
  Array.from({ length: 10_000 }, (_, i) => ({ id: i, name: `item ${i}`, price: i * 1.5, tags: ['x', 'y'] })),
);
const binary = Buffer.alloc(8 * 1024 * 1024, 7);

const server = http.createServer((req, res) => {
  const [body, type] =
    req.url === '/large' ? [largeJson, 'application/json'] :
    req.url === '/binary' ? [binary, 'application/octet-stream'] :
    [small, 'application/json'];
  res.writeHead(200, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const client = new WasmClient();
const rounds = Number(process.env.BENCH_ROUNDS ?? 5);
if (!Number.isSafeInteger(rounds) || rounds < 2) throw new Error('BENCH_ROUNDS must be an integer >= 2');

const contenders = {
  'native fetch': {
    json: async (path) => (await fetch(base + path)).json(),
    bytes: async (path) => new Uint8Array(await (await fetch(base + path)).arrayBuffer()),
  },
  'rust-fetch': {
    json: async (path) => (await client.get(base + path)).body,
    bytes: async (path) => (await client.get(base + path)).body,
  },
};

// Point at a saved build to compare before/after in the same process and runs.
if (process.env.BENCH_BASELINE) {
  const { WasmClient: BaselineClient } = await import(pathToFileURL(process.env.BENCH_BASELINE).href);
  const baseline = new BaselineClient();
  contenders['baseline rust-fetch'] = {
    json: async (path) => (await baseline.get(base + path)).body,
    bytes: async (path) => (await baseline.get(base + path)).body,
  };
}

const scenarios = [
  { name: 'small JSON, sequential', runs: 2000, concurrency: 1, op: (c) => c.json('/small') },
  { name: 'small JSON, 50 concurrent', runs: 5000, concurrency: 50, op: (c) => c.json('/small') },
  { name: `JSON ${(largeJson.length / 1024 / 1024).toFixed(1)} MB`, runs: 100, concurrency: 1, op: (c) => c.json('/large') },
  { name: 'binary 8 MB', runs: 40, concurrency: 1, op: (c) => c.bytes('/binary') },
];

async function measure(op, contender, runs, concurrency) {
  for (let i = 0; i < Math.min(50, runs); i++) await op(contender); // warm-up
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next++ < runs) await op(contender);
    }),
  );
  const elapsed = performance.now() - started;
  return (runs / elapsed) * 1000;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
console.log(`Node ${process.version} on ${os.cpus()[0].model}, ${os.platform()} ${os.arch()}; ${rounds} alternating rounds\n`);
const rows = [];
const samples = [];
try {
  for (const scenario of scenarios) {
    const names = Object.keys(contenders);
    const results = Object.fromEntries(names.map((name) => [name, []]));
    for (let round = 0; round < rounds; round++) {
      // Rotate the first contender and alternate direction to reduce order bias.
      const order = names.slice(round % names.length).concat(names.slice(0, round % names.length));
      if (round % 2) order.reverse();
      for (const name of order) {
        results[name].push(await measure(scenario.op, contenders[name], scenario.runs, scenario.concurrency));
      }
    }
    samples.push({ scenario: scenario.name, requests: scenario.runs, concurrency: scenario.concurrency, samples: results });
    const native = median(results['native fetch']);
    const ours = median(results['rust-fetch']);
    const row = {
      scenario: scenario.name,
      'native fetch (req/s)': native.toFixed(0),
      'rust-fetch (req/s)': ours.toFixed(0),
      'rust-fetch vs native': `${((ours / native) * 100).toFixed(0)}%`,
    };
    if (results['baseline rust-fetch']) {
      const baseline = median(results['baseline rust-fetch']);
      row['baseline (req/s)'] = baseline.toFixed(0);
      row['change vs baseline'] = `${((ours / baseline - 1) * 100).toFixed(1)}%`;
    }
    rows.push(row);
  }
  console.table(rows);
  if (process.env.BENCH_OUTPUT) {
    writeFileSync(process.env.BENCH_OUTPUT, JSON.stringify({ node: process.version, cpu: os.cpus()[0].model, rounds, results: samples }, null, 2) + '\n');
  }
} finally {
  server.close();
}
