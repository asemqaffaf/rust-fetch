// Compares the package's public TypeScript API with the committed snapshot in
// api/rust-fetch.d.ts, so API changes are always deliberate and reviewed.
//   node scripts/check-api.mjs           check (CI)
//   node scripts/check-api.mjs --update  accept the current API
import { readFileSync, writeFileSync } from 'node:fs';

const built = new URL('../wasm-module/pkg/rust_fetch.d.ts', import.meta.url);
const snapshot = new URL('../api/rust-fetch.d.ts', import.meta.url);

// `InitOutput` lists the raw wasm exports, which change with any internal
// refactor; everything else in the file is public API.
const publicApi = (source) =>
  source
    .replace(/export interface InitOutput \{[\s\S]*?\n\}\n/, 'export interface InitOutput { /* wasm exports */ }\n')
    .replace(/\r\n/g, '\n')
    .trimEnd() + '\n';

const current = publicApi(readFileSync(built, 'utf8'));

if (process.argv.includes('--update')) {
  writeFileSync(snapshot, current);
  console.log('Updated api/rust-fetch.d.ts');
  process.exit(0);
}

let expected;
try {
  expected = readFileSync(snapshot, 'utf8');
} catch {
  console.error('Missing api/rust-fetch.d.ts; run `npm run api:update` to create it.');
  process.exit(1);
}

if (current === expected) {
  console.log('✓ Public TypeScript API matches api/rust-fetch.d.ts');
  process.exit(0);
}

const a = expected.split('\n');
const b = current.split('\n');
let first = 0;
while (first < a.length && a[first] === b[first]) first++;
console.error('✗ The public TypeScript API changed.\n');
console.error(`First difference at line ${first + 1}:`);
console.error(`  snapshot: ${a[first] ?? '(end of file)'}`);
console.error(`  built:    ${b[first] ?? '(end of file)'}\n`);
console.error('If this is intended: run `npm run api:update`, commit api/rust-fetch.d.ts, and note the change in');
console.error('CHANGELOG.md. Removing or changing anything is a breaking change and needs a new major version.');
process.exit(1);
