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

/** Upload progress: bytes of the request body sent so far, and the body's size. */
export interface UploadProgress {
    loaded: number;
    total: number;
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
    /**
     * Called as the request body is sent; starts again from 0 if the request is retried.
     * Browsers send these requests with `XMLHttpRequest` (cross-origin ones are preflighted).
     * Can't be combined with `responseType: 'stream'`.
     */
    onUploadProgress?: (progress: UploadProgress) => void;
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



/** Reconnection after a connection fails or drops, with jittered exponential backoff. */
export interface ReconnectOptions {
    /** Reconnection attempts in a row before giving up; reset once a connection opens. Default: unlimited */
    maxRetries?: number;
    /** Delay before the first attempt, in ms. Default: 1000 */
    initialDelayMs?: number;
    /** Upper bound for any delay, in ms. Default: 30000 */
    maxDelayMs?: number;
    /** Exponential backoff multiplier. Default: 2 */
    multiplier?: number;
}

/** What `send()` accepts; use `sendJson()` for other values. */
export type WebSocketData = string | ArrayBuffer | ArrayBufferView | Blob;

export type WebSocketState = 'connecting' | 'open' | 'reconnecting' | 'closing' | 'closed';

export interface WebSocketCloseInfo {
    code: number;
    reason: string;
    wasClean: boolean;
}

export interface WebSocketReconnectInfo {
    /** 1 for the first attempt after a failure */
    attempt: number;
    delayMs: number;
    /** Why the previous connection failed or dropped */
    error: RustFetchError;
}

export interface WebSocketOptions {
    /** Subprotocols to offer */
    protocols?: string | string[];
    params?: QueryParams;
    /**
     * Handshake headers, merged over the client's headers. Node.js only: browsers don't allow
     * WebSocket headers, so there this rejects with an `InvalidInputError` (client headers are skipped).
     */
    headers?: HeadersLike;
    /** Time allowed for each connection attempt, in ms. `0` disables it. Default: the client's `timeoutMs` */
    timeoutMs?: number;
    /**
     * Reconnect when a connection fails or drops unexpectedly (close codes 1001, 1006, 1011-1014):
     * `true` for the defaults, a maximum number of attempts in a row, or options. Default: off
     */
    reconnect?: boolean | number | ReconnectOptions;
    /** Closes the connection and stops reconnecting when aborted */
    signal?: AbortSignal;
    /** `auto` (default): text messages as strings, binary ones as `Uint8Array`. `json`: text messages parsed as JSON */
    messageType?: 'auto' | 'json';
    /** Called each time a connection opens, including after reconnecting */
    onOpen?: () => void;
    onMessage?: (data: any) => void;
    /** Called on every failure: a failed or timed-out attempt, an unexpected drop, a message that isn't JSON */
    onError?: (error: RustFetchError) => void;
    /** Called before waiting to reconnect */
    onReconnect?: (info: WebSocketReconnectInfo) => void;
    /** Called once, when the connection is closed for good */
    onClose?: (info: WebSocketCloseInfo) => void;
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
    delete<T = any>(url: string, options?: RequestOptions | null): Promise<HttpResponse<T>>;
    /**
     * Remove an interceptor; returns whether it was registered
     */
    ejectInterceptor(id: number): boolean;
    /**
     * Make a request described by a `fetch`-style init object
     */
    fetch<T = any>(url: string, init?: FetchInit | null): Promise<HttpResponse<T>>;
    /**
     * Make a GET request
     */
    get<T = any>(url: string, options?: RequestOptions | null): Promise<HttpResponse<T>>;
    /**
     * Make a HEAD request
     */
    head<T = any>(url: string, options?: RequestOptions | null): Promise<HttpResponse<T>>;
    /**
     * Create a new client
     */
    constructor(options?: ClientOptions | null);
    /**
     * Make a PATCH request; the body is taken from `init.body`
     */
    patch<T = any>(url: string, init?: FetchInit | null): Promise<HttpResponse<T>>;
    /**
     * Make a PATCH request with a JSON body
     */
    patch_json<T = any>(url: string, body: any, options?: RequestOptions | null): Promise<HttpResponse<T>>;
    /**
     * Make a POST request; the body is taken from `init.body`
     */
    post<T = any>(url: string, init?: FetchInit | null): Promise<HttpResponse<T>>;
    /**
     * Make a POST request with a JSON body
     */
    post_json<T = any>(url: string, body: any, options?: RequestOptions | null): Promise<HttpResponse<T>>;
    /**
     * Make a PUT request; the body is taken from `init.body`
     */
    put<T = any>(url: string, init?: FetchInit | null): Promise<HttpResponse<T>>;
    /**
     * Make a PUT request with a JSON body
     */
    put_json<T = any>(url: string, body: any, options?: RequestOptions | null): Promise<HttpResponse<T>>;
    /**
     * Make a request with any method, headers and body
     */
    request<T = any>(method: string, url: string, headers?: HeadersLike | null, body?: RequestBody | null, options?: RequestOptions | null): Promise<HttpResponse<T>>;
    /**
     * Open a WebSocket connection. Relative URLs are resolved against the
     * base URL, with `http:` and `https:` becoming `ws:` and `wss:`.
     */
    websocket(url: string, options?: WebSocketOptions | null): WebSocketConnection;
}

/**
 * A WebSocket connection created by `WasmClient.websocket()`
 */
export class WebSocketConnection {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Close the connection and stop reconnecting. `code` is 1000 (the
     * default) or 3000-4999; `reason` is at most 123 bytes of UTF-8.
     */
    close(code?: number | null, reason?: string | null): void;
    /**
     * Send a value as JSON text
     */
    sendJson(value: any): void;
    /**
     * Send a message. Before the connection opens (or while reconnecting),
     * messages are queued and sent once it does.
     */
    send(data: WebSocketData): void;
    /**
     * Bytes queued by the socket but not yet sent
     */
    readonly bufferedAmount: number;
    /**
     * Resolves with the close code and reason once the connection is closed for good
     */
    readonly closed: Promise<WebSocketCloseInfo>;
    /**
     * Resolves when the first connection opens; rejects if it never does
     */
    readonly opened: Promise<void>;
    /**
     * The subprotocol the server selected, or `""`
     */
    readonly protocol: string;
    /**
     * `connecting`, `open`, `reconnecting`, `closing` or `closed`
     */
    readonly state: WebSocketState;
    /**
     * The connection URL (`ws:` or `wss:`)
     */
    readonly url: string;
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
    readonly __wbg_websocketconnection_free: (a: number, b: number) => void;
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
    readonly wasmclient_websocket: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly websocketconnection_buffered_amount: (a: number) => number;
    readonly websocketconnection_close: (a: number, b: number, c: number, d: number) => [number, number];
    readonly websocketconnection_closed: (a: number) => any;
    readonly websocketconnection_opened: (a: number) => any;
    readonly websocketconnection_protocol: (a: number) => [number, number];
    readonly websocketconnection_send: (a: number, b: any) => [number, number];
    readonly websocketconnection_sendJson: (a: number, b: any) => [number, number];
    readonly websocketconnection_state: (a: number) => any;
    readonly websocketconnection_url: (a: number) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h39ac090089444320: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hb74f2302669dffe9: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h1dc388a5dfa52d7a: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hee4dc590ff76ee6a: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h5f968e02a5abe20b: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
