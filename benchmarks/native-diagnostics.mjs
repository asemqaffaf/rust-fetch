import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const directory = resolve(process.env.NATIVE_PROFILE_DIR ?? 'native-profiles');
mkdirSync(directory, { recursive: true });
const payload = Buffer.from(JSON.stringify({ id: 1, name: 'Zoë', tags: ['a', 'b'], nested: { ok: true } }));
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-length': payload.length }); res.end(payload); });
server.keepAliveTimeout = 30000;
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const results = {};
try {
  for (const argument of process.argv.slice(2)) {
    const equal = argument.indexOf('='), label = argument.slice(0, equal), pkg = resolve(argument.slice(equal + 1));
    if (equal < 1 || !/^[a-z0-9_-]+$/i.test(label)) throw Error('Expected label=package-path');
    const name = `${label}.cpuprofile`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--cpu-prof', `--cpu-prof-dir=${directory}`, `--cpu-prof-name=${name}`, fileURLToPath(new URL('./compare.mjs', import.meta.url)), 'worker'], {
      env: { ...process.env, BENCH_SECONDS: '4', BENCH_WORKER: JSON.stringify({ pkg, url, scenario: 'concurrent' }) }, timeout: 30000,
    });
    const measurement = JSON.parse(stdout);
    const profile = JSON.parse(readFileSync(resolve(directory, name)));
    const frames = new Map(profile.nodes.map(n => [n.id, n.callFrame])), totals = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const frame = frames.get(profile.samples[i]);
      const key = frame.url.startsWith('wasm:') ? 'Wasm' : `${frame.functionName || '(anonymous)'} ${frame.url.split('/').at(-1)}:${frame.lineNumber + 1}`;
      totals.set(key, (totals.get(key) ?? 0) + profile.timeDeltas[i]);
    }
    results[label] = { ...measurement, topSelfTimeMs: [...totals].sort((a,b) => b[1] - a[1]).slice(0, 30).map(([frame, us]) => ({ frame, ms: us / 1000 })) };
    console.log(label, JSON.stringify(results[label], null, 2));
  }
} finally { server.closeAllConnections(); server.close(); }
writeFileSync(resolve(directory, 'summary.json'), JSON.stringify({ environment: { node: process.version, cpu: cpus()[0].model, os: release() }, results }, null, 2));
