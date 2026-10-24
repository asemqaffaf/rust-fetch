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

/**
 * A client-wide limit on retries, so a failing upstream doesn't get every request retried at once. Retries may
 * add `ratio` of the first attempts in the last `windowMs`, plus `minPerSecond` per second of the window.
 */
export interface RetryBudgetOptions {
    /** Retries allowed per first attempt in the window, on top of the minimum. Default: 0.2 */
    ratio?: number;
    /** Retries allowed per second of the window whatever the traffic. Default: 10 */
    minPerSecond?: number;
    /** How far back first attempts and retries count, in ms; the budget refills as it slides. Default: 10000 */
    windowMs?: number;
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
    /**
     * Limit retries across this client, for all origins: `true` for the defaults, or options. First attempts are
     * always sent. The budget is checked before waiting to retry and spent when the retry is sent, so cancelling
     * while waiting spends nothing. A refused retry rejects with the attempt's own error, with
     * `retryBudgetExhausted: true`; `client.retriesRefused` counts refusals. Default: no budget
     */
    retryBudget?: boolean | RetryBudgetOptions;
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
     * Reject a request at once while this client already has this many started and not yet settled, in flight or
     * waiting (retries included), so a caller that can't keep up sheds load instead of queuing requests without bound. A streamed
     * response counts until its headers arrive. Rejects with a `NetworkError` whose `maxPendingRequests` is the
     * limit, before anything is sent. Applies on every transport. Default: no limit
     */
    maxPendingRequests?: number;
    /**
     * Header names that carry credentials (case-insensitive), e.g. `['x-api-key']`. On a redirect to another origin,
     * Node.js requests drop them along with `Authorization`, `Cookie` and `Proxy-Authorization`. Browsers follow
     * redirects themselves, so this doesn't apply there. Default: none
     */
    sensitiveHeaders?: string[];
    /**
     * Whether to follow a redirect from `https:` to `http:`, which sends the request (and a 307/308 body) unencrypted.
     * With `false`, such a redirect rejects with a `NetworkError` (Node.js; browsers apply their own rules). Default: `true`
     */
    allowInsecureRedirects?: boolean;
    /**
     * Reject a line longer than this many bytes (line break excluded) in `responseType: 'ndjson'` responses and
     * `events()` streams, before it's buffered, so a server can't grow one line without bound. The stream errors
     * with a `NetworkError` whose `maxLineBytes` is the limit, and the connection is closed; an event stream isn't
     * reconnected. For events, each line (a `data:` line, a comment…) is checked, not an event's total. Default: no limit
     */
    maxLineBytes?: number;
    /**
     * Node.js: with `false`, requests whose host resolves to a private or reserved address (loopback, RFC 1918,
     * link-local including cloud metadata at 169.254.169.254, CGNAT, unique-local and link-local IPv6, multicast…)
     * reject with a `NetworkError` before connecting. The resolved address is checked when connecting, on every
     * redirect, so DNS rebinding can't get past it. For servers that fetch user-supplied URLs (SSRF). Through a
     * proxy, only IP-literal hosts are checked (the proxy resolves names). Browsers have their own rules. Default: `true`
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
    /** Overrides the client's `sensitiveHeaders` */
    sensitiveHeaders?: string[];
    /** Overrides the client's `allowInsecureRedirects` */
    allowInsecureRedirects?: boolean;
    /** `responseType: 'ndjson'`: overrides the client's `maxLineBytes`; `null` removes the limit for this request */
    maxLineBytes?: number | null;
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
    /** NetworkError for a request refused by `maxPendingRequests`: the limit */
    maxPendingRequests?: number;
    /** NetworkError for a streamed line longer than `maxLineBytes`: the limit */
    maxLineBytes?: number;
    /** `true` when the client's `retryBudget` refused to retry this failure (the error is the last attempt's) */
    retryBudgetExhausted?: boolean;
    /** NetworkError from `WebSocketConnection.send()` with a full queue: the limit reached */
    maxQueuedMessages?: number;
    /** NetworkError from `WebSocketConnection.send()` with a full queue: the limit reached */
    maxQueuedBytes?: number;
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
    /** Overrides the client's `maxLineBytes`; `null` removes the limit for this stream */
    maxLineBytes?: number | null;
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
    /**
     * Node.js: overrides the client's `allowPrivateNetwork`. With `false`, an IP address that is private or reserved
     * throws a `NetworkError` from `websocket()`, and a host name is checked on every connection, reconnections
     * included (a blocked one fails the attempt with "Blocked: …"). Can't be combined with `dispatcher`, and fails
     * while another undici global dispatcher is installed. Browsers have their own rules.
     */
    allowPrivateNetwork?: boolean;
    /**
     * The most messages `send()` queues while the connection isn't open yet (connecting or reconnecting). One more
     * throws a `NetworkError` whose `maxQueuedMessages` is the limit, and isn't queued. Default: no limit
     */
    maxQueuedMessages?: number;
    /**
     * The most bytes (UTF-8 for text, `byteLength` or `size` otherwise) `send()` queues while the connection isn't
     * open yet. A message that would go over throws a `NetworkError` whose `maxQueuedBytes` is the limit, and isn't
     * queued. Once open, messages go to the runtime's socket: watch `bufferedAmount` there. Default: no limit
     */
    maxQueuedBytes?: number;
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
    /**
     * Retries the client's `retryBudget` has refused so far (0 without a budget)
     */
    readonly retriesRefused: number;
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

export interface InitOutput { /* wasm exports */ }

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
