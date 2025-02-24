/* tslint:disable */
/* eslint-disable */
export function greet(name: string): string;
export function fetch_wasm_json_new(url: string): Promise<Promise<any>>;
export function fetch_wasm_json(url: string): Promise<any>;
export function fetch_wasm_map(url: string): Promise<any>;
export function fetch_wasm_html(url: string): Promise<string>;
export function fetch_wasm_api(): Promise<any>;
export function add(a: number, b: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly greet: (a: number, b: number) => [number, number];
  readonly fetch_wasm_json_new: (a: number, b: number) => any;
  readonly fetch_wasm_json: (a: number, b: number) => any;
  readonly fetch_wasm_map: (a: number, b: number) => any;
  readonly fetch_wasm_html: (a: number, b: number) => any;
  readonly fetch_wasm_api: () => any;
  readonly add: (a: number, b: number) => number;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_4: WebAssembly.Table;
  readonly __wbindgen_export_5: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly closure96_externref_shim: (a: number, b: number, c: any) => void;
  readonly closure119_externref_shim: (a: number, b: number, c: any, d: any) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
