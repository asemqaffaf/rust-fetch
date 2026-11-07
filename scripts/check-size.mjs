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
  'rust_fetch_bg.wasm': { raw: 453_500, gzip: 182_500, brotli: 148_000 }, // includes opt-in observability and WebSocket idle timers; lowered after #179 and #180; raised by 8.5 kB raw for the wasm-bindgen 0.2.130 and ICU 2.4 updates
  'rust_fetch.js': { raw: 102_000, gzip: 20_100, brotli: 17_200 }, // raised by 1.4 kB for the wasm-bindgen 0.2.130 glue; includes timings, tracing, redaction and bounded metrics; raised from 98.5 kB for the null-prototype upload, diagnostics and stream records (#191) // raised by 0.6 kB for redacting the error cause chain (#239)
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
