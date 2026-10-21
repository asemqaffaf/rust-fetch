/// <reference lib="esnext.disposable" />
/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

export type ReadableStreamType = "bytes";

/** Headers as a plain object, a `Headers` instance, a `Map` or an array of `[name, value]` pairs. */
export type HeadersLike =
| Record<string, string | number | boolean | null | undefined>
| Headers
| Map<string, string>
| Array<[string, string]>;

/** Query parameters; arrays produce repeated keys, `null`/`undefined` values are skipped. */
export type QueryParams =
| Record<string, string | number | boolean | null | undefined | Array<string | number | boolean>>
| URLSearchParams;

/**
 * A request body:
 * - `string` is sent as-is (`text/plain` unless you set `Content-Type`)
 * - `Uint8Array` / `ArrayBuffer` / any `ArrayBufferView` is sent as bytes (`application/octet-stream`)
 * - `Blob` / `File` is sent as bytes with the blob's type
 * - `FormData` is sent as `multipart/form-data`, including files
 * - `URLSearchParams` is sent form-encoded (`application/x-www-form-urlencoded`)
 * - anything else is sent as JSON (`application/json`), like `JSON.stringify`
 */
export type RequestBody = string | Uint8Array | ArrayBuffer | ArrayBufferView | Blob | FormData | URLSearchParams | object | number | boolean | null;

/**
 * How to decode the response body:
 * - `auto` (default): JSON for `application/json` and `*+json`, text for `text/*` and XML, otherwise `Uint8Array`
 * - `json`: always `JSON.parse` (fails with a `ParseError` if the body isn't JSON)
 * - `text`: always a string
 * - `binary`: always a `Uint8Array`
 * - `stream`: a `ReadableStream<Uint8Array>`, returned as soon as the headers arrive
 *
 * Empty bodies are `null` for `auto`/`json`, `""` for `text` and an empty `Uint8Array` for `binary`.
 */
export type ResponseBodyType = 'auto' | 'json' | 'text' | 'binary' | 'stream';

/** Download progress; `total` comes from `Content-Length` and is `null` when unknown. */
export interface DownloadProgress {
    loaded: number;
    total: number | null;
}

export interface RetryOptions {
    /** Maximum number of retries after the first attempt. Default: 3 */
    maxRetries?: number;
    /** Delay before the first retry, in ms. Default: 100 */
    initialDelayMs?: number;
    /** Upper bound for any retry delay (including `Retry-After`), in ms. Default: 10000 */
    maxDelayMs?: number;
    /** Exponential backoff multiplier. Default: 2 */
    multiplier?: number;
    /** HTTP status codes to retry. Default: [408, 429, 500, 502, 503, 504] */
    retryOn?: number[];
    /** Retry on network errors. Default: true */
    retryOnNetworkError?: boolean;
    /** Retry on timeouts. Default: true */
    retryOnTimeout?: boolean;
    /** Also retry POST and PATCH requests, which may not be safe to repeat. Default: false */
    retryNonIdempotent?: boolean;
}

export interface ClientOptions {
    /** Base URL that relative request URLs are appended to, e.g. `https://api.example.com/v1` */
    baseUrl?: string;
    /** Headers sent with every request; per-request headers with the same name replace them */
    headers?: HeadersLike;
    /** Timeout for each attempt (sending + reading the body), in ms. `0` disables it. Default: 30000 */
    timeoutMs?: number;
    /** Retry failed requests: a maximum retry count, or detailed options. Default: no retries */
    retries?: number | RetryOptions;
}

export interface RequestOptions {
    headers?: HeadersLike;
    params?: QueryParams;
    /** Overrides the client timeout for this request, in ms. `0` disables it. */
    timeoutMs?: number;
    responseType?: ResponseBodyType;
    /**
     * Cancels the request (including pending retries) when aborted; rejects with a `CancelledError`.
     * For `responseType: 'stream'` it also errors the body stream.
     */
    signal?: AbortSignal;
    /** Called after each received chunk of a successful response */
    onDownloadProgress?: (progress: DownloadProgress) => void;
}

export interface FetchInit extends RequestOptions {
    /** HTTP method. Default: `GET` */
    method?: string;
    body?: RequestBody;
}

/** What request interceptors see and may change (headers include per-request headers, not client defaults). */
export interface InterceptedRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: RequestBody;
}

/** Return a (possibly new) request, or nothing to keep the mutated one. */
export type RequestInterceptor = (request: InterceptedRequest) => InterceptedRequest | void | Promise<InterceptedRequest | void>;
/** Return a response (possibly replaced), or throw to reject. */
export type ResponseFulfilledInterceptor = (response: HttpResponse) => HttpResponse | Promise<HttpResponse>;
/** Return a response to recover, or throw (e.g. rethrow) to keep rejecting. */
export type ResponseRejectedInterceptor = (error: RustFetchError) => HttpResponse | Promise<HttpResponse>;

export interface HttpResponse<T = any> {
    status: number;
    statusText: string;
    /** Always `true`: non-2xx responses reject with an `HttpError` */
    ok: boolean;
    /** Final URL after redirects */
    url: string;
    /** Lower-cased header names; repeated headers are joined with `, ` */
    headers: Record<string, string>;
    body: T;
}

/** Every rejection is an `Error` with `name` and `kind` set to one of these. */
export type RustFetchErrorKind =
| 'NetworkError'
| 'HttpError'
| 'ParseError'
| 'TimeoutError'
| 'InvalidInputError'
| 'JsInteropError'
| 'CancelledError';

export interface RustFetchError extends Error {
    name: RustFetchErrorKind;
    kind: RustFetchErrorKind;
    /** HttpError: response status */
    status?: number;
    /** HttpError: response status text */
    statusText?: string;
    /** HttpError: response body as text */
    body?: string;
    /** TimeoutError: the timeout that was exceeded */
    timeoutMs?: number;
    /** InvalidInputError: the offending parameter */
    parameter?: string;
}



export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

/**
 * HTTP client for JavaScript
 */
export class WasmClient {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Run `interceptor` on every request before it is sent; returns an id for `ejectInterceptor`
     */
    addRequestInterceptor(interceptor: RequestInterceptor): number;
    /**
     * Run handlers on every settled request, like `promise.then(onFulfilled, onRejected)`;
     * returns an id for `ejectInterceptor`
     */
    addResponseInterceptor(on_fulfilled?: ResponseFulfilledInterceptor | null, on_rejected?: ResponseRejectedInterceptor | null): number;
    /**
     * Remove all interceptors
     */
    clearInterceptors(): void;
    /**
     * Make a DELETE request
     */
    delete(url: string, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Remove an interceptor; returns whether it was registered
     */
    ejectInterceptor(id: number): boolean;
    /**
     * Make a request described by a `fetch`-style init object
     */
    fetch(url: string, init?: FetchInit | null): Promise<HttpResponse>;
    /**
     * Make a GET request
     */
    get(url: string, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Make a HEAD request
     */
    head(url: string, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Create a new client
     */
    constructor(options?: ClientOptions | null);
    /**
     * Make a PATCH request; the body is taken from `init.body`
     */
    patch(url: string, init?: FetchInit | null): Promise<HttpResponse>;
    /**
     * Make a PATCH request with a JSON body
     */
    patch_json(url: string, body: any, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Make a POST request; the body is taken from `init.body`
     */
    post(url: string, init?: FetchInit | null): Promise<HttpResponse>;
    /**
     * Make a POST request with a JSON body
     */
    post_json(url: string, body: any, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Make a PUT request; the body is taken from `init.body`
     */
    put(url: string, init?: FetchInit | null): Promise<HttpResponse>;
    /**
     * Make a PUT request with a JSON body
     */
    put_json(url: string, body: any, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Make a request with any method, headers and body
     */
    request(method: string, url: string, headers?: HeadersLike | null, body?: RequestBody | null, options?: RequestOptions | null): Promise<HttpResponse>;
}

/**
 * Create a configured HTTP client (exported for advanced use)
 */
export function create_client(): WasmClient;

/**
 * Fetch a URL and parse the body as JSON (whatever its Content-Type).
 * An empty body resolves to `null`.
 */
export function fetch_json(url: string): Promise<any>;

/**
 * Fetch JSON data and return as a Promise
 */
export function fetch_json_promise(url: string): Promise<any>;

/**
 * Fetch a URL and return the body as text
 */
export function fetch_text(url: string): Promise<string>;

/**
 * Fetch API data (deprecated, use fetch_json instead)
 */
export function fetch_wasm_api(url: string): Promise<any>;

/**
 * Fetch HTML data (deprecated, use fetch_text instead)
 */
export function fetch_wasm_html(url: string): Promise<string>;

/**
 * Fetch JSON data (deprecated, use fetch_json instead)
 */
export function fetch_wasm_json(url: string): Promise<any>;

/**
 * Fetch data and return as map (deprecated, use fetch_json instead)
 */
export function fetch_wasm_map(url: string): Promise<any>;

/**
 * Fetch with a method, headers and an optional string body.
 *
 * Resolves to `{ status, statusText, ok, url, headers, body }`.
 */
export function fetch_with_options(url: string, method: string, headers: any, body?: string | null): Promise<any>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly __wbg_wasmclient_free: (a: number, b: number) => void;
    readonly create_client: () => [number, number, number];
    readonly fetch_json: (a: number, b: number) => any;
    readonly fetch_json_promise: (a: number, b: number) => any;
    readonly fetch_text: (a: number, b: number) => any;
    readonly fetch_wasm_api: (a: number, b: number) => any;
    readonly fetch_wasm_html: (a: number, b: number) => any;
    readonly fetch_wasm_json: (a: number, b: number) => any;
    readonly fetch_wasm_map: (a: number, b: number) => any;
    readonly fetch_with_options: (a: number, b: number, c: number, d: number, e: any, f: number, g: number) => any;
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
    readonly intounderlyingbytesource_start: (a: number, b: any) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly intounderlyingsink_abort: (a: number, b: any) => any;
    readonly intounderlyingsink_close: (a: number) => any;
    readonly intounderlyingsink_write: (a: number, b: any) => any;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: any) => any;
    readonly wasmclient_addRequestInterceptor: (a: number, b: any) => number;
    readonly wasmclient_addResponseInterceptor: (a: number, b: number, c: number) => number;
    readonly wasmclient_clearInterceptors: (a: number) => void;
    readonly wasmclient_delete: (a: number, b: number, c: number, d: number) => any;
    readonly wasmclient_ejectInterceptor: (a: number, b: number) => number;
    readonly wasmclient_fetch: (a: number, b: number, c: number, d: number) => any;
    readonly wasmclient_get: (a: number, b: number, c: number, d: number) => any;
    readonly wasmclient_head: (a: number, b: number, c: number, d: number) => any;
    readonly wasmclient_new: (a: number) => [number, number, number];
    readonly wasmclient_patch: (a: number, b: number, c: number, d: number) => any;
    readonly wasmclient_patch_json: (a: number, b: number, c: number, d: any, e: number) => any;
    readonly wasmclient_post: (a: number, b: number, c: number, d: number) => any;
    readonly wasmclient_post_json: (a: number, b: number, c: number, d: any, e: number) => any;
    readonly wasmclient_put: (a: number, b: number, c: number, d: number) => any;
    readonly wasmclient_put_json: (a: number, b: number, c: number, d: any, e: number) => any;
    readonly wasmclient_request: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
    readonly wasm_bindgen__convert__closures_____invoke__h39ac090089444320: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hb74f2302669dffe9: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__hfe34282d295dccc2: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h7c6facf5d1a6a91a: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
