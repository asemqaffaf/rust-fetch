/* tslint:disable */
/* eslint-disable */
/**
 * Simple fetch function for JSON data
 */
export function fetch_json(url: string): Promise<any>;
/**
 * Fetch JSON data and return as a Promise
 */
export function fetch_json_promise(url: string): Promise<any>;
/**
 * Simple fetch function for text/HTML data
 */
export function fetch_text(url: string): Promise<string>;
/**
 * Advanced fetch function with full options
 */
export function fetch_with_options(url: string, method: string, headers: any, body?: string): Promise<any>;
/**
 * Create a configured HTTP client (exported for advanced use)
 */
export function create_client(): WasmClient;
/**
 * Fetch JSON data (deprecated, use fetch_json instead)
 */
export function fetch_wasm_json(url: string): Promise<any>;
/**
 * Fetch HTML data (deprecated, use fetch_text instead)
 */
export function fetch_wasm_html(url: string): Promise<string>;
/**
 * Fetch data and return as map (deprecated, use fetch_json instead)
 */
export function fetch_wasm_map(url: string): Promise<any>;
/**
 * Fetch API data (deprecated, use fetch_json instead)
 */
export function fetch_wasm_api(url: string): Promise<any>;
/**
 * WASM bindings for the client
 */
export class WasmClient {
  free(): void;
  /**
   * Create a new client
   */
  constructor();
  /**
   * Make a GET request
   */
  get(url: string): Promise<any>;
  /**
   * Make a POST request with JSON body
   */
  post_json(url: string, body: any): Promise<any>;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly fetch_json: (a: number, b: number) => any;
  readonly fetch_json_promise: (a: number, b: number) => any;
  readonly fetch_text: (a: number, b: number) => any;
  readonly fetch_with_options: (a: number, b: number, c: number, d: number, e: any, f: number, g: number) => any;
  readonly create_client: () => [number, number, number];
  readonly fetch_wasm_json: (a: number, b: number) => any;
  readonly fetch_wasm_html: (a: number, b: number) => any;
  readonly fetch_wasm_map: (a: number, b: number) => any;
  readonly fetch_wasm_api: (a: number, b: number) => any;
  readonly __wbg_wasmclient_free: (a: number, b: number) => void;
  readonly wasmclient_new: () => [number, number, number];
  readonly wasmclient_get: (a: number, b: number, c: number) => any;
  readonly wasmclient_post_json: (a: number, b: number, c: number, d: any) => any;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_4: WebAssembly.Table;
  readonly __wbindgen_export_5: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly closure243_externref_shim: (a: number, b: number, c: any) => void;
  readonly closure265_externref_shim: (a: number, b: number, c: any, d: any) => void;
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
