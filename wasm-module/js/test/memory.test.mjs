// What a pending request costs in WebAssembly memory, with a budget. Under
// sustained overload without maxPendingRequests every pending request is
// kept, and before #140 a backlog of about 600,000 brought Node.js to its heap
// limit, where garbage collection stalled it for minutes. Halving this cost
// moved that point past 50,000 requests per second offered in the README's
// test; this keeps it from creeping back.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { WasmClient } from '../../pkg/node.js';
import { initSync } from '../../pkg/rust_fetch.js';
import { sleep } from './helpers.mjs';

// The module node.js already initialized: initSync returns its exports
const wasm = initSync({ module: readFileSync(new URL('../../pkg/rust_fetch_bg.wasm', import.meta.url)) });
const BUDGET = 4.5 * 1024; // bytes of WebAssembly memory per pending request (3.7 KB measured)

let server;
before(async () => {
  server = http.createServer(() => {}); // never answers
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});
after(() => {
  server.closeAllConnections();
  server.close();
});

describe('memory per pending request', () => {
  it(`stays within ${BUDGET / 1024} KB of WebAssembly memory`, async () => {
    const client = new WasmClient({ timeoutMs: 0 });
    const url = `http://127.0.0.1:${server.address().port}/`;
    // Warm up, so the allocator's first growth steps don't count
    const warm = Array.from({ length: 2000 }, () => client.get(url, { signal: AbortSignal.timeout(100) }).catch(() => {}));
    await Promise.all(warm);
    const before = wasm.memory.buffer.byteLength;
    const controller = new AbortController();
    const count = 20_000;
    const pending = Array.from({ length: count }, () => client.get(url, { signal: controller.signal }).catch(() => {}));
    await sleep(1000); // all started, each waiting for a connection or a response
    const perRequest = (wasm.memory.buffer.byteLength - before) / count;
    controller.abort();
    await Promise.all(pending);
    assert.ok(perRequest <= BUDGET, `${(perRequest / 1024).toFixed(2)} KB per pending request`);
  });
});

describe('completed requests release timer and signal closures', () => {
  it('does not retain JS heap across sequential deadlineMs and signal requests', { timeout: 60_000 }, async () => {
    const okServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise((resolve) => okServer.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${okServer.address().port}/`;
    const nodeEntry = new URL('../../pkg/node.js', import.meta.url).href;
    const script = `
      import { WasmClient } from ${JSON.stringify(nodeEntry)};
      const url = ${JSON.stringify(target)};
      const measure = async (label, client, makeOpts) => {
        for (let i = 0; i < 1000; i++) await client.get(url, makeOpts());
        gc(); gc();
        const base = process.memoryUsage().heapUsed;
        const count = 15_000;
        for (let i = 0; i < count; i++) await client.get(url, makeOpts());
        gc(); gc();
        const perReq = (process.memoryUsage().heapUsed - base) / count;
        return { label, perReq };
      };
      const deadlineClient = new WasmClient({ timeoutMs: 3000, deadlineMs: 5000, retries: 0 });
      const signalClient = new WasmClient({ timeoutMs: 3000, retries: 0 });
      const results = [
        await measure('deadlineMs', deadlineClient, () => ({ responseType: 'json' })),
        await measure('signal', signalClient, () => ({ responseType: 'json', signal: new AbortController().signal })),
      ];
      console.log(JSON.stringify(results));
    `;
    try {
      const { code, stdout, stderr } = await new Promise((resolve) => {
        const child = spawn(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 55_000,
        });
        let out = '', err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('exit', (code) => resolve({ code, stdout: out.trim(), stderr: err }));
      });
      assert.equal(code, 0, stderr);
      const results = JSON.parse(stdout);
      for (const { label, perReq } of results) {
        assert.ok(perReq < 200, `${label} retained ${perReq.toFixed(1)} bytes/req after forced GC`);
      }
    } finally {
      okServer.closeAllConnections();
      await new Promise((resolve) => okServer.close(resolve));
    }
  });
});
