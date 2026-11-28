// Fails if the built package grows past its size budget. Run after `npm run build`.
// Raise a budget only deliberately, and note the growth in the changelog.
//
// Budgets are for builds with current stable Rust, as in CI and releases;
// older toolchains produce a larger module (Rust 1.88: about +11 kB brotli).
// The WebAssembly module's brotli target from #61 is 180 kB.
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const budgets = {
  // gzip is what browsers download; raw size matters for Node.js and parsing
  'rust_fetch_bg.wasm': { raw: 160_000, gzip: 68_000, brotli: 58_000 }, // lowered after moving browser fetch/XHR transport, WebSocketConnection, EventStream (keeping fuzzed Rust __SseParser), stream/NDJSON finalizer, zero-copy JS body encoder, and request/response interceptors out of Wasm glue into rust_fetch.js, plus wasm-opt -Oz --one-caller-inline-max-function-size=100 --low-memory-unused --converge --strip-producers
  'rust_fetch.js': { raw: 75_500, gzip: 27_500, brotli: 24_500 }, // unified JS runtime: browser transport (fetch/XHR/stream/NDJSON/body encoder), WebSocketConnection, EventStream, upload streams, single-hop WasmClient middleware (verbs, interceptors, observability, blob, transport, auth, dedupe, httpCache, schema, resume, extend, paginate), and error guards; net combined browser bundle is ~194 kB raw / ~59 kB brotli smaller than v2.8.2
  'node.js': { raw: 60_500, gzip: 19_400, brotli: 16_950 }, // Node transports, prototype-pollution hardening (#191), the compact native entry with a full-policy fallback (#181), and the certificate policy (#244); not loaded by browsers.
};

const pkg = new URL('../wasm-module/pkg/', import.meta.url);
const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
let failed = false;

for (const [file, budget] of Object.entries(budgets)) {
  const contents = readFileSync(new URL(file, pkg));
  const size = {
    raw: contents.length,
    gzip: gzipSync(contents, { level: 9 }).length,
    brotli: brotliCompressSync(contents, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
  const over = ['raw', 'gzip', 'brotli'].filter((kind) => size[kind] > budget[kind]);
  failed ||= over.length > 0;
  console.log(
    `${over.length ? '✗' : '✓'} ${file.padEnd(20)} raw ${kb(size.raw).padStart(9)} / ${kb(budget.raw).padStart(9)}` +
      `   gzip ${kb(size.gzip).padStart(9)} / ${kb(budget.gzip).padStart(9)}   brotli ${kb(size.brotli).padStart(9)} / ${kb(budget.brotli).padStart(9)}`,
  );
}

if (failed) {
  console.error('\nSize budget exceeded. Reduce the size, or raise the budget in scripts/check-size.mjs on purpose.');
  process.exit(1);
}
