// Turns wasm-pack's output in wasm-module/pkg into the published npm package:
// adds the Node.js entry point, conditional exports and package metadata.
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pkgDir = new URL('wasm-module/pkg/', root);

copyFileSync(new URL('wasm-module/js/node.js', root), new URL('node.js', pkgDir));
copyFileSync(new URL('README.md', root), new URL('README.md', pkgDir));
for (const license of ['LICENSE-MIT', 'LICENSE-APACHE']) {
  copyFileSync(new URL(license, root), new URL(license, pkgDir));
}
rmSync(new URL('.gitignore', pkgDir), { force: true });

// wasm-bindgen declares `[Symbol.dispose]()` on exported classes; pull in the
// lib that defines it so consumers type-check without `skipLibCheck` (TS 5.2+)
const typesUrl = new URL('rust_fetch.d.ts', pkgDir);
const types = readFileSync(typesUrl, 'utf8');
const disposable = '/// <reference lib="esnext.disposable" />\n';
if (types.includes('Symbol.dispose') && !types.startsWith(disposable)) {
  writeFileSync(typesUrl, disposable + types);
}

const manifestUrl = new URL('package.json', pkgDir);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

manifest.files = ['rust_fetch_bg.wasm', 'rust_fetch_bg.wasm.d.ts', 'rust_fetch.js', 'rust_fetch.d.ts', 'node.js', 'LICENSE-MIT', 'LICENSE-APACHE'];
manifest.exports = {
  '.': {
    types: './rust_fetch.d.ts',
    node: './node.js',
    default: './rust_fetch.js',
  },
  './rust_fetch.js': {
    types: './rust_fetch.d.ts',
    default: './rust_fetch.js',
  },
  './rust_fetch_bg.wasm': './rust_fetch_bg.wasm',
  './package.json': './package.json',
};
manifest.engines = { node: '>=20' };
manifest.homepage = 'https://github.com/asemqaffaf/rust-fetch#readme';
manifest.bugs = { url: 'https://github.com/asemqaffaf/rust-fetch/issues' };

writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(`postbuild: prepared ${manifest.name}@${manifest.version}`);
