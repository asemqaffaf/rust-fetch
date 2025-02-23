import * as path from 'path';
import { readFileSync } from 'fs';

import initWasm from 'wasm-module';
const wasmPath = path.join(process.cwd(), 'node_modules', 'rust-fetch', 'wasm-module', 'pkg', 'wasm_module_bg.wasm');
export const wasmBuffer = readFileSync(wasmPath);

(async () => {
  await initWasm(wasmBuffer);
})();

export default initWasm;
export * from 'wasm-module';
