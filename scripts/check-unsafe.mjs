// Fails when hand-written `unsafe` appears anywhere it has not been reviewed (#230).
// The inventory below is the list in docs/unsafe.md: a file and the number of
// `unsafe` keywords in it. A new or removed one changes the count, so a person has
// to update both this table and the invariants in the document.
// Run: node scripts/check-unsafe.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REVIEWED = {
  // 1 unsafe impl SystemAllocator, 1 unsafe impl Sync, 1 unsafe impl GlobalAlloc, 4 unsafe fn
  'wasm-module/src/wasm/alloc.rs': 7,
};
// Crates that must deny `unsafe_code`, so the compiler stops what this script cannot see (macros, cfg'd code)
const MUST_DENY = ['wasm-module/src/lib.rs', 'native/src/lib.rs'];

/** Source without comments, string and character literals */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/r(#*)"[\s\S]*?"\1/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

const files = execFileSync('git', ['ls-files', '*.rs'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const found = {};
for (const file of files) {
  const count = (code(readFileSync(file, 'utf8')).match(/\bunsafe\b/g) ?? []).length;
  if (count > 0) found[file] = count;
}

const problems = [];
for (const [file, count] of Object.entries(found)) {
  if (!(file in REVIEWED)) problems.push(`${file}: ${count} unreviewed \`unsafe\`. Remove it, or review it and add it to docs/unsafe.md and REVIEWED in scripts/check-unsafe.mjs`);
  else if (REVIEWED[file] !== count) problems.push(`${file}: ${count} \`unsafe\` keywords, the inventory says ${REVIEWED[file]}. Update docs/unsafe.md and REVIEWED`);
}
for (const file of Object.keys(REVIEWED)) if (!(file in found)) problems.push(`${file}: listed in the inventory but has no \`unsafe\` any more. Remove it from docs/unsafe.md and REVIEWED`);
const doc = readFileSync('docs/unsafe.md', 'utf8');
for (const file of Object.keys(REVIEWED)) if (!doc.includes(file)) problems.push(`docs/unsafe.md does not mention ${file}`);
for (const file of MUST_DENY) if (!/#!\[deny\(unsafe_code\)\]/.test(readFileSync(file, 'utf8'))) problems.push(`${file}: missing #![deny(unsafe_code)]`);

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`unsafe inventory matches: ${Object.entries(found).map(([file, count]) => `${file} (${count})`).join(', ')}`);
