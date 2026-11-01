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
 * - `ndjson`: a `ReadableStream` of parsed JSON values, one per line of newline-delimited JSON, returned as soon as the headers arrive
 *
 * Empty bodies are `null` for `auto`/`json`, `""` for `text` and an empty `Uint8Array` for `binary`.
 */
export type ResponseBodyType = 'auto' | 'json' | 'text' | 'binary' | 'stream' | 'ndjson';

/**
 * What to do when the server redirects (301, 302, 303, 307 or 308), like `fetch()`'s `redirect`:
 * - `follow`: follow it, up to `maxRedirects`
 * - `manual`: resolve with the redirect response and its `Location` header. In browsers,
 *   `fetch()` hides redirects from scripts: the response has `status: 0` and no headers.
 * - `error`: reject with a `NetworkError`
 */
export type RedirectMode = 'follow' | 'manual' | 'error';

/**
 * `fetch()` options for browsers, Web Workers and other `fetch()` runtimes (Deno, Bun).
 * Node.js requests don't use them; they're still validated there.
 */
export interface BrowserRequestOptions {
    /** Send cookies and HTTP authentication: `same-origin` (default), `include` (also cross-origin) or `omit` */
    credentials?: 'omit' | 'same-origin' | 'include';
    /** `cors` (default), `same-origin`, or `no-cors`, which resolves with an opaque response (`status: 0`, no headers, no body) */
    mode?: 'cors' | 'no-cors' | 'same-origin';
    /** How the browser's HTTP cache is used */
    cache?: 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
    /** Let the request outlive the page, e.g. for analytics on unload (bodies up to 64 KB) */
    keepalive?: boolean;
    /** Fetch priority, where the browser supports it */
    priority?: 'high' | 'low' | 'auto';
    /** A same-origin URL, `''` for none, or `about:client` (default) */
    referrer?: string;
    referrerPolicy?: '' | 'no-referrer' | 'no-referrer-when-downgrade' | 'same-origin' | 'origin' | 'strict-origin' | 'origin-when-cross-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';
    /** Subresource integrity metadata, e.g. `sha384-…` */
    integrity?: string;
}

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

export interface ClientOptions extends BrowserRequestOptions {
    /** Base URL that relative request URLs are appended to, e.g. `https://api.example.com/v1` */
    baseUrl?: string;
    /** Headers sent with every request; per-request headers with the same name replace them */
    headers?: HeadersLike;
    /** Timeout for each attempt (sending + reading the body), in ms. `0` disables it. Default: 30000 */
    timeoutMs?: number;
    /** Retry failed requests: a maximum retry count, or detailed options. Default: no retries */
    retries?: number | RetryOptions;
    /** What to do when the server redirects. Default: `follow` */
    redirect?: RedirectMode;
    /** Maximum number of redirects to follow. Browsers apply their own limit (20) instead. Default: 20 */
    maxRedirects?: number;
    /**
     * Node.js: send requests through an HTTP(S) proxy, either a URL (`http://user:pass@proxy:8080`) or `'env'`
     * for `HTTPS_PROXY` / `HTTP_PROXY` with `NO_PROXY`. `NODE_USE_ENV_PROXY=1` is the same as `'env'`.
     * Browsers use the system's proxy settings. Default: none
     */
    proxy?: 'env' | (string & {});
    /**
     * With a `baseUrl`, whether an absolute request URL may replace it. An absolute URL also receives the
     * client's headers (e.g. `Authorization`), so set `false` when paths come from user input: absolute URLs
     * then reject with an `InvalidInputError`. Default: `true`
     */
    allowAbsoluteUrls?: boolean;
    /**
     * Reject responses whose body, after decompression, is larger than this many bytes, reading no more than that:
     * checked against `Content-Length` first, then counted as the body arrives and while it's decompressed, so a
     * decompression bomb never expands in memory. Rejects with a `NetworkError` whose `maxResponseBytes` is the
     * limit. Applies to error responses and streamed bodies too. Default: no limit
     */
    maxResponseBytes?: number;
    /**
     * Node.js: with `false`, requests whose host resolves to a private or reserved address (loopback, RFC 1918,
     * link-local including cloud metadata at 169.254.169.254, CGNAT, unique-local and link-local IPv6, multicast…)
     * reject with a `NetworkError` before connecting. The resolved address is checked when connecting, on every
     * redirect, so DNS rebinding can't get past it. For servers that fetch user-supplied URLs (SSRF). Through a
     * proxy, which resolves names itself, IP addresses are checked and host names are refused. Browsers have their own rules. Default: `true`
     */
    allowPrivateNetwork?: boolean;
}

/** Per request; `BrowserRequestOptions` set here override the client's one by one */
export interface RequestOptions extends BrowserRequestOptions {
    headers?: HeadersLike;
    params?: QueryParams;
    /** Overrides the client timeout for this request, in ms. `0` disables it. */
    timeoutMs?: number;
    responseType?: ResponseBodyType;
    /** Overrides the client's `redirect` */
    redirect?: RedirectMode;
    /** Overrides the client's `maxRedirects` */
    maxRedirects?: number;
    /** Overrides the client's `allowAbsoluteUrls` */
    allowAbsoluteUrls?: boolean;
    /** Overrides the client's `maxResponseBytes`; `null` removes the limit for this request */
    maxResponseBytes?: number | null;
    /** Overrides the client's `allowPrivateNetwork` */
    allowPrivateNetwork?: boolean;
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
    /** `true` for 2xx responses (other statuses reject with an `HttpError`); `false` for a redirect resolved with `redirect: 'manual'` */
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
    /** NetworkError for a response larger than `maxResponseBytes`: the limit */
    maxResponseBytes?: number;
}



/** One Server-Sent Event */
export interface ServerSentEvent<T = any> {
    /** The `event:` field; `'message'` when the server didn't set one */
    event: string;
    /** The `data:` lines joined with `\n`, or parsed JSON with `messageType: 'json'` */
    data: T;
    /** The last event ID (`id:` field) in effect, or `''` */
    id: string;
}

export type EventStreamState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface EventStreamOptions extends BrowserRequestOptions {
    /** HTTP method. Default: `GET` */
    method?: string;
    /** Request body, as for other requests; sent again on each reconnection */
    body?: RequestBody;
    headers?: HeadersLike;
    params?: QueryParams;
    /** Time allowed for each connection attempt until the response headers arrive, in ms. Default: the client's `timeoutMs` */
    timeoutMs?: number;
    /**
     * Reconnect after the stream ends or a connection fails, sending `Last-Event-ID` and honouring the
     * server's `retry:` field. Default: on for `GET`, off for other methods (which would resend the body).
     */
    reconnect?: boolean | number | ReconnectOptions;
    /** `auto` (default): `data` is a string. `json`: `data` is parsed JSON */
    messageType?: 'auto' | 'json';
    /** Close the stream normally when an event's raw `data` equals this. Default: `'[DONE]'` with `messageType: 'json'`, otherwise none */
    end?: string | null;
    /** Overrides the client's `allowAbsoluteUrls` */
    allowAbsoluteUrls?: boolean;
    /** Closes the stream and stops reconnecting when aborted */
    signal?: AbortSignal;
    /** Called each time a connection opens, including after reconnecting */
    onOpen?: () => void;
    /** Called for each event. Without it, events are buffered for `for await … of stream` */
    onEvent?: (event: ServerSentEvent) => void;
    /** Called on every failure: a failed attempt, a dropped stream, a `data` that isn't JSON */
    onError?: (error: RustFetchError) => void;
    /** Called before waiting to reconnect */
    onReconnect?: (info: WebSocketReconnectInfo) => void;
    /** Called once, when the stream is closed for good */
    onClose?: () => void;
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
    /**
     * Node.js only: an undici dispatcher for the connection, e.g. `new ProxyAgent('http://proxy:3128')` from
     * the `undici` package to connect through a proxy. Node's WebSocket doesn't use the client's `proxy` option.
     */
    dispatcher?: object;
    /** Time allowed for each connection attempt, in ms. `0` disables it. Default: the client's `timeoutMs` */
    timeoutMs?: number;
    /**
     * Reconnect when a connection fails or drops unexpectedly (close codes 1001, 1006, 1011-1014):
     * `true` for the defaults, a maximum number of attempts in a row, or options. Default: off
     */
    reconnect?: boolean | number | ReconnectOptions;
    /** Overrides the client's `allowAbsoluteUrls` */
    allowAbsoluteUrls?: boolean;
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



/**
 * A Server-Sent Events stream created by `WasmClient.events()`; also an async iterator of events
 */
export class EventStream {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    [Symbol.asyncIterator](): AsyncIterator<ServerSentEvent>;
    /**
     * Close the stream and stop reconnecting
     */
    close(): void;
    /**
     * The next buffered event (async iterator protocol)
     */
    next(): Promise<IteratorResult<ServerSentEvent>>;
    /**
     * Stop iterating: closes the stream (async iterator protocol, e.g. `break`)
     */
    return(): Promise<IteratorResult<ServerSentEvent>>;
    /**
     * Resolves once the stream is closed for good
     */
    readonly closed: Promise<void>;
    /**
     * The last event ID received, sent as `Last-Event-ID` when reconnecting
     */
    readonly lastEventId: string;
    /**
     * Resolves when the first connection opens; rejects if it never does
     */
    readonly opened: Promise<void>;
    /**
     * `connecting`, `open`, `reconnecting` or `closed`
     */
    readonly state: EventStreamState;
    /**
     * The stream's URL, resolved against the client's base URL
     */
    readonly url: string;
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
     * Open a Server-Sent Events stream. Relative URLs are resolved against the base URL.
     */
    events(url: string, options?: EventStreamOptions | null): EventStream;
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
    readonly __wbg_eventstream_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly __wbg_wasmclient_free: (a: number, b: number) => void;
    readonly __wbg_websocketconnection_free: (a: number, b: number) => void;
    readonly create_client: () => [number, number, number];
    readonly eventstream_close: (a: number) => void;
    readonly eventstream_closed: (a: number) => any;
    readonly eventstream_last_event_id: (a: number) => [number, number];
    readonly eventstream_next: (a: number) => any;
    readonly eventstream_opened: (a: number) => any;
    readonly eventstream_return: (a: number) => any;
    readonly eventstream_state: (a: number) => any;
    readonly eventstream_url: (a: number) => [number, number];
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
    readonly wasmclient_events: (a: number, b: number, c: number, d: number) => [number, number, number];
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
    readonly wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___wasm_bindgen_9d298ef7e71c0d11___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_9d298ef7e71c0d11___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___wasm_bindgen_9d298ef7e71c0d11___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___web_sys_e9a7b01c56fed3da___features__gen_ProgressEvent__ProgressEvent______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke_______true_: (a: number, b: number) => void;
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
