// Compares rust-fetch with the runtime's native fetch() against a local server.
// Usage: npm run build && npm run bench
import http from 'node:http';
import os from 'node:os';
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
  return { perSecond: (runs / elapsed) * 1000, meanMs: (elapsed / runs) * concurrency };
}

console.log(`Node ${process.version} on ${os.cpus()[0].model}, ${os.platform()} ${os.arch()}\n`);
const rows = [];
for (const scenario of scenarios) {
  const results = {};
  for (const [name, contender] of Object.entries(contenders)) {
    results[name] = await measure(scenario.op, contender, scenario.runs, scenario.concurrency);
  }
  const native = results['native fetch'];
  const ours = results['rust-fetch'];
  rows.push({
    scenario: scenario.name,
    'native fetch (req/s)': native.perSecond.toFixed(0),
    'rust-fetch (req/s)': ours.perSecond.toFixed(0),
    'rust-fetch vs native': `${((ours.perSecond / native.perSecond) * 100).toFixed(0)}%`,
  });
}
console.table(rows);
server.close();
