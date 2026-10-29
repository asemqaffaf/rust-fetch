import { readFileSync } from 'node:fs';
// Deterministic, offline validation against actual Wasm bindings.
const rf = await import('../wasm-module/pkg/rust_fetch.js');
rf.initSync({ module: readFileSync(new URL('../wasm-module/pkg/rust_fetch_bg.wasm', import.meta.url)) });
let seed = Number(process.env.FUZZ_SEED ?? 270067) >>> 0;
const initial = seed, count = Number(process.env.FUZZ_CASES ?? 2000);
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const pick = (xs) => xs[Math.floor(random() * xs.length)];
const values = [undefined, null, false, true, -1, 0, 1, NaN, Infinity, '', '\0\r\n', '__proto__', {}, [], ['x', 'y'], { nested: {} }, 1n];
const previous = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new TypeError('offline fuzz transport'));
try {
  for (let i = 0; i < count; i++) {
    const options = { retries: 0, timeoutMs: 5, deadlineMs: 10 };
    options[pick(['headers', 'params', 'responseType', 'maxResponseBytes', 'signal', 'connectTimeoutMs', 'allowPrivateNetwork', 'maxLineBytes'])] = pick(values);
    let client;
    try {
      client = new rf.WasmClient({ retries: 0, timeoutMs: 5 });
      await client.request(pick(['GET', 'POST', 'CONNECT', 'TRACE', '__proto__', '\r\n', '😀']), pick(['http://fuzz.invalid/', '//evil.invalid', 'file:///etc/passwd', 'http://[::1', '\0', 'https://u:p@fuzz.invalid/?secret=x']), pick(values), pick(values), options);
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) throw new Error('Wasm trap at seed ' + initial + ', case ' + i, { cause: error });
    } finally { client?.free(); }
  }
  console.log(JSON.stringify({ seed: initial, cases: count, result: 'no Wasm traps', network: 'stubbed' }));
} finally { globalThis.fetch = previous; }
