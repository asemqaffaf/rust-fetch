// V8 before 13 (Node.js 20 to 23) aborted the process with "Fatal error …
// unreachable code" when a burst of cancelled requests deoptimized
// WasmClient.get during its call into WebAssembly, about one run in three on
// Node.js 20. node.js turns off the inlining that triggers it. Each run is a
// separate process, since the crash takes the whole process down.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// The load that crashed: requests cancelled together, in bursts
const script = `
import http from 'node:http';
import { WasmClient } from ${JSON.stringify(new URL('../../pkg/node.js', import.meta.url).href)};
const server = http.createServer(() => {});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';
const client = new WasmClient({ timeoutMs: 0 });
await Promise.all(Array.from({ length: 2000 }, () => client.get(url, { signal: AbortSignal.timeout(100) }).catch(() => {})));
const controller = new AbortController();
const pending = Array.from({ length: 20000 }, () => client.get(url, { signal: controller.signal }).catch(() => {}));
await new Promise((resolve) => setTimeout(resolve, 500));
controller.abort();
await Promise.all(pending);
server.closeAllConnections();
server.close();
`;

function run() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000 });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('exit', (code, signal) => resolve({ code, signal, stderr }));
  });
}

describe('V8 deoptimization crash', () => {
  it('survives bursts of cancelled requests', { timeout: 60_000 }, async () => {
    const runs = await Promise.all(Array.from({ length: 6 }, run));
    for (const { code, signal, stderr } of runs) {
      assert.equal(signal, null, `the process was killed by ${signal}: ${stderr.slice(0, 300)}`);
      assert.equal(code, 0, stderr.slice(0, 300));
    }
  });
});
