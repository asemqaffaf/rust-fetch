// Turns wasm-pack's output in wasm-module/pkg into the published npm package:
// adds the Node.js entry point, conditional exports and package metadata.
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pkgDir = new URL('wasm-module/pkg/', root);

copyFileSync(new URL('wasm-module/js/node.js', root), new URL('node.js', pkgDir));
copyFileSync(new URL('README.md', root), new URL('README.md', pkgDir));
copyFileSync(new URL('llms.txt', root), new URL('llms.txt', pkgDir));
for (const license of ['LICENSE-MIT', 'LICENSE-APACHE']) {
  copyFileSync(new URL(license, root), new URL(license, pkgDir));
}
rmSync(new URL('.gitignore', pkgDir), { force: true });

// wasm-bindgen declares `[Symbol.dispose]()` on exported classes; pull in the
// lib that defines it so consumers type-check without `skipLibCheck` (TS 5.2+)
const typesUrl = new URL('rust_fetch.d.ts', pkgDir);
let types = readFileSync(typesUrl, 'utf8');
const disposable = '/// <reference lib="esnext.disposable" />\n';
if (types.includes('Symbol.dispose') && !types.startsWith(disposable)) {
  types = disposable + types;
}

// wasm-bindgen can't declare generic methods, so its request methods resolve to
// `HttpResponse` (with `body: any`). Make them generic, `get<User>(…)` style;
// the `any` default keeps untyped calls as they were.
const generic = /^(\s+\w+)\((.*)\): Promise<HttpResponse>;$/gm;
const typedMethods = types.match(generic)?.length ?? 0;
if (typedMethods === 0 && !types.includes('Promise<HttpResponse<T>>')) {
  throw new Error('postbuild: no WasmClient request methods found to make generic');
}
types = types.replace(generic, '$1<T = any>($2): Promise<HttpResponse<T>>;');
writeFileSync(typesUrl, types);

const manifestUrl = new URL('package.json', pkgDir);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

manifest.files = ['rust_fetch_bg.wasm', 'rust_fetch_bg.wasm.d.ts', 'rust_fetch.js', 'rust_fetch.d.ts', 'node.js', 'llms.txt', 'LICENSE-MIT', 'LICENSE-APACHE'];
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
// crates.io allows five keywords (Cargo.toml); npm search uses as many as are relevant
manifest.keywords = [
  'http', 'http-client', 'fetch', 'fetch-api', 'request', 'rest', 'api-client', 'axios-alternative',
  'retry', 'retries', 'backoff', 'timeout', 'interceptors', 'typed-errors', 'abortcontroller',
  'upload-progress', 'download-progress', 'streaming', 'websocket', 'websockets', 'reconnect',
  'typescript', 'nodejs', 'browser', 'isomorphic', 'webassembly', 'wasm', 'rust', 'napi',
];
manifest.homepage = 'https://github.com/asemqaffaf/rust-fetch#readme';
manifest.bugs = { url: 'https://github.com/asemqaffaf/rust-fetch/issues' };

writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(`postbuild: prepared ${manifest.name}@${manifest.version}`);
