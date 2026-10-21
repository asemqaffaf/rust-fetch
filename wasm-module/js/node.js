// Node.js entry point (selected through the "node" export condition).
//
// Browsers load the .wasm file with fetch(), which Node.js can't do for
// file: URLs. Here the module is compiled synchronously on import instead, so
// the API is ready to use immediately; calling `init()` is optional and
// returns the already-initialized module.
import { readFileSync } from 'node:fs';
import { initSync } from './rust_fetch.js';

initSync({ module: readFileSync(new URL('./rust_fetch_bg.wasm', import.meta.url)) });

export { default } from './rust_fetch.js';
export * from './rust_fetch.js';
