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
  'rust_fetch_bg.wasm': { raw: 440_000, gzip: 165_000, brotli: 133_000 }, // 129.2 kB since #93 parses URLs with the runtime's URL (188.5 kB with the url crate and its Unicode tables)
  'rust_fetch.js': { raw: 72_000, gzip: 12_000, brotli: 10_500 }, // the JS glue; #93 added the URL bindings
  'node.js': { raw: 39_000, gzip: 13_000, brotli: 11_500 }, // the Node.js transports, request queue, proxies, SSRF guards (requests and WebSockets), the V8 crash workaround and the native addon's loader (not loaded by browsers)
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
