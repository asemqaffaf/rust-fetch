// Fails if the built package grows past its size budget. Run after `npm run build`.
// Raise a budget only deliberately, and note the growth in the changelog.
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const budgets = {
  // gzip is what browsers download; raw size matters for Node.js and parsing
  'rust_fetch_bg.wasm': { raw: 640_000, gzip: 250_000 },
  'rust_fetch.js': { raw: 66_000, gzip: 11_500 },
  'node.js': { raw: 26_000, gzip: 9_000 }, // includes the Node.js transports and the native addon's loader
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
  const over = ['raw', 'gzip'].filter((kind) => size[kind] > budget[kind]);
  failed ||= over.length > 0;
  console.log(
    `${over.length ? '✗' : '✓'} ${file.padEnd(20)} raw ${kb(size.raw).padStart(9)} / ${kb(budget.raw).padStart(9)}` +
      `   gzip ${kb(size.gzip).padStart(9)} / ${kb(budget.gzip).padStart(9)}   brotli ${kb(size.brotli).padStart(9)}`,
  );
}

if (failed) {
  console.error('\nSize budget exceeded. Reduce the size, or raise the budget in scripts/check-size.mjs on purpose.');
  process.exit(1);
}
