import initWasm from 'wasm-module';

const wasmPromise = initWasm();

export const initializeWasm = async () => {
  await wasmPromise;
};

(async () => {
  initializeWasm();
})();

export default initWasm;
export * from 'wasm-module';
