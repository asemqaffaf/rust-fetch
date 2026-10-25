// What a pending request costs in WebAssembly memory, with a budget. Under
// sustained overload without maxPendingRequests every pending request is
// kept, and before #140 a backlog of about 600,000 brought Node.js to its heap
// limit, where garbage collection stalled it for minutes. Halving this cost
// moved that point past 50,000 requests per second offered in the README's
// test; this keeps it from creeping back.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
