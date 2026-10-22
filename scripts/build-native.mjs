// Builds the native Node.js transport (native/) and puts it next to the
// package's Node.js entry as rust-fetch-native.<platform>-<arch>.node, where
// wasm-module/pkg/node.js looks for it.
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const nativeDir = new URL('native/', root);

execFileSync('cargo', ['build', '--release'], { cwd: nativeDir, stdio: 'inherit' });

const library = {
  darwin: 'librust_fetch_native.dylib',
  win32: 'rust_fetch_native.dll',
}[process.platform] ?? 'librust_fetch_native.so';
const target = `rust-fetch-native.${process.platform}-${process.arch}.node`;
copyFileSync(new URL(`target/release/${library}`, nativeDir), new URL(`wasm-module/pkg/${target}`, root));
console.log(`build-native: wasm-module/pkg/${target}`);
