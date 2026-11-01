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

// wasm-streams builds its ReadableStream from a source object and a strategy that
// inherit from Object.prototype, and the constructor reads `type`, `start`,
// `autoAllocateChunkSize` and `size` from them by inheritance: with one of those
// names polluted, every call returning a stream threw. The source gets them as own
// properties and the strategy becomes a prototype-free copy.
const streamsGlueUrl = new URL('rust_fetch.js', pkgDir);
const construct = 'new ReadableStream(IntoUnderlyingSource.__wrap(arg0), arg1)';
const streamsGlue = readFileSync(streamsGlueUrl, 'utf8');
if (streamsGlue.split(construct).length !== 2) {
  throw new Error('postbuild: expected exactly one ReadableStream construction from wasm-streams in rust_fetch.js');
}
// reqwest creates the init object of the requests it sends through fetch() itself; fetch() reads
// credentials, mode, cache, body and more from it by inheritance, so it loses its prototype too
const requestConstruct = 'new Request(getStringFromWasm0(arg0, arg1), arg2)';
if (streamsGlue.split(requestConstruct).length !== 2) {
  throw new Error('postbuild: expected exactly one Request construction in rust_fetch.js');
}
writeFileSync(
  streamsGlueUrl,
  `${streamsGlue
    .replace(construct, 'new ReadableStream(streamSource(IntoUnderlyingSource.__wrap(arg0)), streamStrategy(arg1))')
    .replace(requestConstruct, 'new Request(getStringFromWasm0(arg0, arg1), requestInit(arg2))')}
// Added by scripts/postbuild.mjs
function streamSource(source) {
  for (const name of ['type', 'autoAllocateChunkSize', 'start']) Object.defineProperty(source, name, { value: undefined });
  return source;
}
function streamStrategy(strategy) {
  return new CountQueuingStrategy({ highWaterMark: strategy.highWaterMark });
}
function requestInit(init) {
  return Object.setPrototypeOf(init, null);
}
`,
);

writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(`postbuild: prepared ${manifest.name}@${manifest.version}`);
