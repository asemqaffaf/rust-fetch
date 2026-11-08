// Sets the release version everywhere it is stored, in one step:
//   node scripts/bump-version.mjs 2.9.0
// Found by the security release drill (#234): a release changes eight files in three
// ecosystems, and a hand-written `sed` edit can silently change nothing. Every place
// must match exactly as expected or no file is written. CHANGELOG.md and the
// "Latest patch" column of SECURITY.md stay by hand.
import { readFileSync, writeFileSync } from 'node:fs';

const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) {
  console.error('usage: node scripts/bump-version.mjs X.Y.Z');
  process.exit(2);
}

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const current = JSON.parse(read('package.json')).version;
const cur = current.replaceAll('.', '\\.');
const pending = [];
let failed = false;

// Replace `pattern` in a file; it must match exactly `count` times
function edit(path, pattern, count = 1) {
  const before = read(path);
  const all = new RegExp(pattern.source, 'g');
  const found = before.match(all)?.length ?? 0;
  if (found !== count) {
    console.error(`✗ ${path}: expected ${count} match(es) of ${pattern}, found ${found}`);
    failed = true;
    return;
  }
  pending.push([path, before.replace(all, `$1${next}$2`)]);
}

const re = (text) => new RegExp(text.replace('VERSION', cur));
edit('package.json', re('(\\n  "version": ")VERSION(")'));
edit('package-lock.json', re('(\\n(?: {2}| {6})"version": ")VERSION(")'), 2);
edit('examples/package-lock.json', re('("name": "rust-fetch",\\n\\s+"version": ")VERSION(")'));
edit('wasm-module/Cargo.toml', re('(name = "rust-fetch"\\nversion = ")VERSION(")'));
edit('native/Cargo.toml', re('(name = "rust-fetch-native"\\nversion = ")VERSION(")'));
edit('wasm-module/Cargo.lock', re('(name = "rust-fetch"\\nversion = ")VERSION(")'));
edit('wasm-module/fuzz/Cargo.lock', re('(name = "rust-fetch"\\nversion = ")VERSION(")'));
edit('native/Cargo.lock', re('(name = "rust-fetch-native"\\nversion = ")VERSION(")'));
edit('README.md', re('(\\*\\*On npm \\()VERSION(\\):)'));
edit('docs/guide/getting-started.md', re('(\\*\\*On npm \\()VERSION(\\):)'));

if (failed) {
  console.error('\nNo file was changed. Fix the patterns or the files and run it again.');
  process.exit(1);
}
for (const [path, contents] of pending) {
  writeFileSync(new URL(path, root), contents);
  console.log(`✓ ${path}`);
}
console.log(`\n${current} -> ${next}. Still by hand: CHANGELOG.md and the SECURITY.md table. After \`npm run build\`, commit the regenerated files in wasm-module/pkg with the release.`);
