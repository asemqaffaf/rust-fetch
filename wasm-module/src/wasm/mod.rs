//! JavaScript bindings: `WasmClient` and conversions between JS values and
//! requests/responses.
//!
//! Everything in this module needs a JavaScript engine to run. It's tested
//! with `wasm-pack test --node` and the JS test suite in `js/test`.

#[cfg(target_arch = "wasm32")]
mod alloc;
#[cfg(target_arch = "wasm32")]
mod events;
pub(crate) mod futures;
#[cfg(target_arch = "wasm32")]
pub(crate) mod idempotency;
#[cfg(target_arch = "wasm32")]
pub(crate) mod transport;
pub(crate) mod upload;
#[cfg(target_arch = "wasm32")]
pub(crate) mod url;
#[cfg(target_arch = "wasm32")]
mod websocket;

use self::futures::{abortable, AbortableStream};
use crate::{
    client::{Client, RequestBuilder, StreamingResponse},
    error::{Error, Result},
    types::{Headers, Method, Multipart, Redirect, ResponseFormat, RetryConfig},
};
use futures_util::StreamExt;
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[wasm_bindgen(typescript_custom_section)]
const TYPESCRIPT_TYPES: &'static str = r#"
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
 * - `ReadableStream` / async iterable byte sources stream with backpressure; a factory permits replay
 * - anything else is sent as JSON (`application/json`), like `JSON.stringify`
 */
export type UploadChunk = string | ArrayBuffer | ArrayBufferView;
/** A one-shot byte source. Node Readable implements AsyncIterable. */
export type UploadBody = ReadableStream<UploadChunk> | AsyncIterable<UploadChunk>;
/** Called for every attempt; return a fresh source to allow retries. */
export type UploadBodyFactory = () => UploadBody | Promise<UploadBody>;
export type RequestBody = UploadBody | UploadBodyFactory | string | Uint8Array | ArrayBuffer | ArrayBufferView | Blob | FormData | URLSearchParams | object | number | boolean | null;

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

/** Upload progress: bytes handed to the transport, and body size (0 when unknown). */
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

/** A burst of `requests` attempts, continuously refilled over `perMs`. Retries spend tokens too. */
export interface RateLimitOptions {
  requests: number;
  perMs: number;
}

export interface CircuitBreakerOptions {
  /** Consecutive failed attempts (network errors, timeouts, 5xx) before opening. Default: 5 */
  failureThreshold?: number;
  /** Delay before allowing one recovery probe. Default: 30000 */
  resetAfterMs?: number;
}
export type CircuitState = 'closed' | 'open' | 'half-open';
export interface CircuitChange {
  origin: string;
  from: CircuitState;
  to: CircuitState;
}

export interface AttemptTimings {
  startMs: number;
  /** null when the runtime cannot observe headers separately. */
  ttfbMs: number | null;
  totalMs: number;
  status?: number;
  error?: RustFetchErrorKind;
  transport?: 'native' | 'node:http' | 'fetch' | 'XMLHttpRequest';
  connectMs?: number | null;
  tlsMs?: number | null;
  connectionReused?: boolean | null;
}
export interface RequestTimings {
  queuedMs: number;
  retryDelayMs: number;
  attempts: AttemptTimings[];
  totalMs: number;
}
export interface RequestLifecycle {
  type: string;
  method: string;
  /** Credentials, fragment and query are removed before hooks/loggers see it. */
  url: string;
  status?: number;
  error?: { kind?: RustFetchErrorKind; status?: number; phase?: string };
  timings?: RequestTimings;
}
export interface DebugEntry extends RequestLifecycle {
  headers?: Record<string, string>;
  attempt?: number;
  delayMs?: number;
  reason?: RustFetchErrorKind;
  retryAfterMs?: number;
  location?: string;
  totalMs?: number;
}
export interface TraceContext { traceparent: string; tracestate?: string }
export interface PoolStats {
  origin: string;
  opened: number;
  closed: number;
  idle: number;
  busy: number;
  queued?: number;
}
export interface ClientStats {
  requests: { started: number; completed: number; failed: number; active: number };
  attempts: number;
  retries: number;
  latency: { count: number; minMs: number | null; maxMs: number | null; meanMs: number | null; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; sampleCount: number };
  origins: Record<string, { started: number; completed: number; failed: number; active: number }>;
  /** Node pools are shared by clients in this adapter module. null in browsers. */
  pools: { queued: number; native: PoolStats[] | null; http: PoolStats[] } | null;
}
export interface WasmClient {
  /** Enable collection from this call onward (or configure metrics: true); returns a detached snapshot. */
  stats(): ClientStats;
}

export interface ClientOptions extends BrowserRequestOptions {
  /** Collect attempt and logical-request timings. Off by default. */
  timings?: boolean;
  /** Collect bounded per-client latency/count samples from construction. Off by default. */
  metrics?: boolean;
  onRequestStart?: (entry: RequestLifecycle) => void;
  onRequestEnd?: (entry: RequestLifecycle) => void;
  /** Structured, redacted logging; Node also supports DEBUG=rust-fetch. */
  debug?: boolean | ((entry: DebugEntry) => void);
  /** Apply a custom redactor to error URLs and already-sanitized hook/log URLs. */
  redactUrl?: (url: string) => string;
  /** Automatic W3C propagation is off unless explicitly enabled with an origin allowlist. */
  propagateTrace?: boolean;
  traceOrigins?: string[];
  traceContext?: () => TraceContext | undefined;

  /** Base URL that relative request URLs are appended to, e.g. `https://api.example.com/v1` */
  baseUrl?: string;
  /** Headers sent with every request; per-request headers with the same name replace them */
  headers?: HeadersLike;
  /** Timeout for each attempt (sending + reading the body), in ms. `0` disables it. Default: 30000 */
  timeoutMs?: number;
  /** Time until a connection is established, including TLS (Node.js); browsers cannot observe it. `0` disables. */
  connectTimeoutMs?: number;
  /** Time until final response headers arrive. `0` disables. */
  responseTimeoutMs?: number;
  /** Maximum wait for the next body chunk, including streams and SSE. `0` disables. */
  idleTimeoutMs?: number;
  /** Total logical-request deadline, including queueing, retries and reading the body. `0` disables. */
  deadlineMs?: number;

  /** Retry failed requests: a maximum retry count, or detailed options. Default: no retries */
  retries?: number | RetryOptions;
  /**
   * Limit retries across this client, for all origins: `true` for the defaults, or options. First attempts are
   * always sent. The budget is checked before waiting to retry and spent when the retry is sent, so cancelling
   * while waiting spends nothing. A refused retry rejects with the attempt's own error, with
   * `retryBudgetExhausted: true`; `client.retriesRefused` counts refusals. Default: no budget
   */
  retryBudget?: boolean | RetryBudgetOptions;
  /**
   * `true` generates a UUID per call; a string supplies a key. The key is reused on retries and enables
   * POST/PATCH retries under the retry policy. Requires server support for deduplication. Default: off.
   * An explicit client string is reused for every call; prefer `true` or per-request strings.
   */
  idempotencyKey?: boolean | string;
  /** Header carrying the key. Default: `Idempotency-Key` */
  idempotencyHeader?: string;
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
  /** Maximum attempts in flight. Streams/SSE hold a slot until their body ends or is cancelled. */
  maxConcurrent?: number;
  /** Opt-in per-origin circuit breaker. Off by default; counts failed attempts including retries. */
  circuitBreaker?: CircuitBreakerOptions;
  /** Observes transitions outside the state lock. Thrown exceptions are reported as unhandled rejections. */
  onCircuitChange?: (change: CircuitChange) => void;
  /** Client-side token bucket. First burst is immediate; retries re-enter FIFO admission. */
  rateLimit?: RateLimitOptions;
  /** Apply maxConcurrent/rateLimit independently to each origin. Default: false */
  limitsPerOrigin?: boolean;
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
   * `events()`: reject an event whose data (its `data:` lines, joined with `\n`) would be larger than this many
   * bytes, before it's buffered. `maxLineBytes` limits each line; this limits their total, which an event made of
   * many `data:` lines could otherwise grow without bound. The events before it are delivered, then the stream
   * errors with a `NetworkError` whose `maxEventBytes` is the limit, and isn't reconnected. Default: no limit
   */
  maxEventBytes?: number;
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
  /** Time until a connection is established, including TLS (Node.js); browsers cannot observe it. `0` disables. */
  connectTimeoutMs?: number;
  /** Time until final response headers arrive. `0` disables. */
  responseTimeoutMs?: number;
  /** Maximum wait for the next body chunk, including streams and SSE. `0` disables. */
  idleTimeoutMs?: number;
  /** Total logical-request deadline, including queueing, retries and reading the body. `0` disables. */
  deadlineMs?: number;

  /**
   * Replaces the client's retry policy for this request (also for `events()` connection attempts).
   * `0` disables retries. Omitted object fields use the standard defaults, not the client's values.
   * The client's shared `retryBudget` still applies. Separate from `events()`'s `reconnect`.
   */
  retries?: number | RetryOptions;
  /** Overrides the client's key policy. `true` generates a key for this call; `false` disables it. Requires server deduplication. */
  idempotencyKey?: boolean | string;
  /** Overrides the client's idempotency header name */
  idempotencyHeader?: string;
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
  /** Enabled by timings/hooks; streamed totals finalize at EOF/cancel. */
  timings?: RequestTimings;
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
  | 'CircuitOpenError'
  | 'NetworkError'
  | 'HttpError'
  | 'ParseError'
  | 'TimeoutError'
  | 'InvalidInputError'
  | 'JsInteropError'
  | 'CancelledError';

export interface RustFetchError extends Error {
  method?: string;
  url?: string;
  attempts?: number;
  cause?: unknown;
  timings?: RequestTimings;
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
  /** NetworkError for a Server-Sent Event larger than `maxEventBytes`: the limit */
  maxEventBytes?: number;
  /** `true` when the client's `retryBudget` refused to retry this failure (the error is the last attempt's) */
  retryBudgetExhausted?: boolean;
  /** CircuitOpenError: the origin whose circuit refused the request */
  origin?: string;
  /** CircuitOpenError: milliseconds until recovery may be probed */
  retryAfterMs?: number;
  /** TimeoutError: which timer expired (deadlineMs uses total) */
  phase?: 'connect' | 'response' | 'idle' | 'total';
  /** NetworkError from `WebSocketConnection.send()` with a full queue: the limit reached */
  maxQueuedMessages?: number;
  /** NetworkError from `WebSocketConnection.send()` with a full queue: the limit reached */
  maxQueuedBytes?: number;
}
"#;

#[wasm_bindgen]
extern "C" {
    /// `ClientOptions` (see TypeScript definitions)
    #[wasm_bindgen(typescript_type = "ClientOptions")]
    pub type ClientOptions;

    /// `RequestOptions` (see TypeScript definitions)
    #[wasm_bindgen(typescript_type = "RequestOptions")]
    pub type RequestOptions;

    /// `FetchInit` (see TypeScript definitions)
    #[wasm_bindgen(typescript_type = "FetchInit")]
    pub type FetchInit;

    /// `HeadersLike` (see TypeScript definitions)
    #[wasm_bindgen(typescript_type = "HeadersLike")]
    pub type HeadersLike;

    /// `RequestBody` (see TypeScript definitions)
    #[wasm_bindgen(typescript_type = "RequestBody")]
    pub type RequestBody;

    /// `Promise<HttpResponse>`
    #[wasm_bindgen(typescript_type = "Promise<HttpResponse>")]
    pub type ResponsePromise;

    /// `RequestInterceptor`
    #[wasm_bindgen(typescript_type = "RequestInterceptor")]
    pub type RequestInterceptor;

    /// `ResponseFulfilledInterceptor`
    #[wasm_bindgen(typescript_type = "ResponseFulfilledInterceptor")]
    pub type ResponseFulfilledInterceptor;

    /// `ResponseRejectedInterceptor`
    #[wasm_bindgen(typescript_type = "ResponseRejectedInterceptor")]
    pub type ResponseRejectedInterceptor;
}

/// Registered interceptors, in the order they run
#[derive(Default)]
struct Interceptors {
    next_id: u32,
    request: Vec<(u32, js_sys::Function)>,
    response: Vec<(u32, Option<js_sys::Function>, Option<js_sys::Function>)>,
}

/// HTTP client for JavaScript
#[wasm_bindgen]
pub struct WasmClient {
    inner: Client,
    interceptors: Rc<RefCell<Interceptors>>,
}

#[wasm_bindgen]
impl WasmClient {
    /// Create a new client
    #[wasm_bindgen(constructor)]
    pub fn new(options: Option<ClientOptions>) -> Result<WasmClient> {
        let mut builder = Client::builder();
        #[cfg(target_arch = "wasm32")]
        if let Some(options) = &options {
            builder = builder.idempotency(idempotency::Defaults::parse(&Options::new(
                options.as_ref(),
            ))?);
        }

        if let Some(options) = options {
            let options: &JsValue = options.as_ref();
            if let Some(phases) =
                parse_phase_options(&Options::new(options), &crate::PhaseTimeouts::default())?
            {
                builder = builder.phase_timeouts(phases);
            }
            if let Some(base_url) = prop(options, "baseUrl") {
                builder = builder.base_url(
                    base_url
                        .as_string()
                        .ok_or_else(|| invalid("baseUrl", "must be a string"))?,
                );
            }
            if let Some(headers) = prop(options, "headers") {
                builder = builder.default_headers(parse_headers(&headers)?);
            }
            if let Some(timeout) = prop(options, "timeoutMs") {
                builder = match parse_timeout(&timeout)? {
                    Some(timeout) => builder.timeout(timeout),
                    None => builder.no_timeout(),
                };
            }
            if let Some(retries) = prop(options, "retries") {
                builder = builder.retry_config(parse_retries(&retries)?);
            }
            if let Some(budget) = prop(options, "retryBudget") {
                if let Some(budget) = parse_retry_budget(&budget)? {
                    builder = builder.retry_budget(budget);
                }
            }
            if let Some(redirect) = prop(options, "redirect") {
                builder = builder.redirect(parse_redirect(&redirect)?);
            }
            if let Some(max) = prop(options, "maxRedirects") {
                builder = builder.max_redirects(parse_max_redirects(&max)?);
            }
            if let Some(circuit) = prop(options, "circuitBreaker") {
                if !circuit.is_object() {
                    return Err(invalid("circuitBreaker", "must be an options object"));
                }
                let threshold = prop(&circuit, "failureThreshold")
                    .map(|value| positive_u32(&value, "circuitBreaker.failureThreshold"))
                    .transpose()?
                    .unwrap_or(5);
                let reset = prop(&circuit, "resetAfterMs")
                    .map(|value| parse_delay(&value, "circuitBreaker.resetAfterMs"))
                    .transpose()?
                    .unwrap_or(Duration::from_secs(30));
                builder = builder.circuit_breaker(crate::CircuitBreaker::new(
                    u32::try_from(threshold).unwrap(),
                    reset,
                ));
            }
            #[cfg(target_arch = "wasm32")]
            if let Some(callback) = callback_option(options, "onCircuitChange")? {
                builder = builder.on_circuit_change(move |change: crate::CircuitChange| {
                    let value = js_sys::Object::new();
                    let _ = set(&value, "origin", &change.origin.into());
                    let _ = set(&value, "from", &change.from.as_str().into());
                    let _ = set(&value, "to", &change.to.as_str().into());
                    if let Err(error) = callback.call1(&JsValue::UNDEFINED, &value) {
                        let _ = js_sys::Promise::reject(&error);
                    }
                });
            }
            if let Some(max) = prop(options, "maxConcurrent") {
                builder = builder.max_concurrent(positive_u32(&max, "maxConcurrent")?);
            }
            if let Some(limit) = prop(options, "rateLimit") {
                let requests = prop(&limit, "requests")
                    .ok_or_else(|| invalid("rateLimit.requests", "is required"))?;
                let per = prop(&limit, "perMs")
                    .ok_or_else(|| invalid("rateLimit.perMs", "is required"))?;
                builder = builder.rate_limit(crate::RateLimit::new(
                    u32::try_from(positive_u32(&requests, "rateLimit.requests")?).unwrap(),
                    parse_delay(&per, "rateLimit.perMs")?,
                ));
            }
            if let Some(per_origin) = prop(options, "limitsPerOrigin") {
                builder = builder.limits_per_origin(parse_bool(&per_origin, "limitsPerOrigin")?);
            }
            if let Some(max) = prop(options, "maxPendingRequests") {
                builder = builder.max_pending_requests(parse_max_pending_requests(&max)?);
            }
            if let Some(max) = prop(options, "maxLineBytes") {
                builder = builder.max_line_bytes(positive_u32(&max, "maxLineBytes")?);
            }
            if let Some(max) = prop(options, "maxEventBytes") {
                builder = builder.max_event_bytes(positive_u32(&max, "maxEventBytes")?);
            }
            if let Some(names) = prop(options, "sensitiveHeaders") {
                builder = builder.sensitive_headers(parse_header_names(&names)?);
            }
            if let Some(allow) = prop(options, "allowInsecureRedirects") {
                builder =
                    builder.allow_insecure_redirects(parse_bool(&allow, "allowInsecureRedirects")?);
            }
            #[cfg(target_arch = "wasm32")]
            {
                builder = builder.fetch_options(parse_fetch_options(&Options::new(options), None)?);
                if let Some(allow) = prop(options, "allowAbsoluteUrls") {
                    builder = builder.allow_absolute_urls(parse_bool(&allow, "allowAbsoluteUrls")?);
                }
                if let Some(limit) = prop(options, "maxResponseBytes") {
                    builder = builder.max_response_bytes(parse_max_response_bytes(&limit)?);
                }
                if let Some(allow) = prop(options, "allowPrivateNetwork") {
                    builder =
                        builder.allow_private_network(parse_bool(&allow, "allowPrivateNetwork")?);
                }
                if let Some(proxy) = prop(options, "proxy") {
                    builder = builder.proxy(Some(parse_proxy(&proxy)?));
                }
            }
        }

        Ok(WasmClient {
            inner: builder.build()?,
            interceptors: Rc::default(),
        })
    }

    /// Run `interceptor` on every request before it is sent; returns an id for `ejectInterceptor`
    #[wasm_bindgen(js_name = addRequestInterceptor)]
    pub fn add_request_interceptor(&self, interceptor: RequestInterceptor) -> u32 {
        let mut interceptors = self.interceptors.borrow_mut();
        interceptors.next_id += 1;
        let id = interceptors.next_id;
        interceptors
            .request
            .push((id, interceptor.unchecked_into()));
        id
    }

    /// Run handlers on every settled request, like `promise.then(onFulfilled, onRejected)`;
    /// returns an id for `ejectInterceptor`
    #[wasm_bindgen(js_name = addResponseInterceptor)]
    pub fn add_response_interceptor(
        &self,
        on_fulfilled: Option<ResponseFulfilledInterceptor>,
        on_rejected: Option<ResponseRejectedInterceptor>,
    ) -> u32 {
        let mut interceptors = self.interceptors.borrow_mut();
        interceptors.next_id += 1;
        let id = interceptors.next_id;
        interceptors.response.push((
            id,
            on_fulfilled.map(JsCast::unchecked_into),
            on_rejected.map(JsCast::unchecked_into),
        ));
        id
    }

    /// Remove an interceptor; returns whether it was registered
    #[wasm_bindgen(js_name = ejectInterceptor)]
    pub fn eject_interceptor(&self, id: u32) -> bool {
        let mut interceptors = self.interceptors.borrow_mut();
        let before = interceptors.request.len() + interceptors.response.len();
        interceptors.request.retain(|(i, _)| *i != id);
        interceptors.response.retain(|(i, _, _)| *i != id);
        before != interceptors.request.len() + interceptors.response.len()
    }

    /// Retries the client's `retryBudget` has refused so far (0 without a budget)
    #[wasm_bindgen(getter = retriesRefused)]
    pub fn retries_refused(&self) -> f64 {
        #[allow(clippy::cast_precision_loss)]
        let refused = self.inner.retries_refused() as f64;
        refused
    }

    /// Remove all interceptors
    #[wasm_bindgen(js_name = clearInterceptors)]
    pub fn clear_interceptors(&self) {
        let mut interceptors = self.interceptors.borrow_mut();
        interceptors.request.clear();
        interceptors.response.clear();
    }

    /// Make a GET request
    pub fn get(&self, url: String, options: Option<RequestOptions>) -> ResponsePromise {
        self.perform(
            Method::Get,
            url,
            JsValue::UNDEFINED,
            BodyMode::Auto(JsValue::UNDEFINED),
            into_js(options),
        )
    }

    /// Make a HEAD request
    pub fn head(&self, url: String, options: Option<RequestOptions>) -> ResponsePromise {
        self.perform(
            Method::Head,
            url,
            JsValue::UNDEFINED,
            BodyMode::Auto(JsValue::UNDEFINED),
            into_js(options),
        )
    }

    /// Make a DELETE request
    pub fn delete(&self, url: String, options: Option<RequestOptions>) -> ResponsePromise {
        self.perform(
            Method::Delete,
            url,
            JsValue::UNDEFINED,
            BodyMode::Auto(JsValue::UNDEFINED),
            into_js(options),
        )
    }

    /// Make a POST request; the body is taken from `init.body`
    pub fn post(&self, url: String, init: Option<FetchInit>) -> ResponsePromise {
        self.perform_init(Method::Post, url, into_js(init))
    }

    /// Make a PUT request; the body is taken from `init.body`
    pub fn put(&self, url: String, init: Option<FetchInit>) -> ResponsePromise {
        self.perform_init(Method::Put, url, into_js(init))
    }

    /// Make a PATCH request; the body is taken from `init.body`
    pub fn patch(&self, url: String, init: Option<FetchInit>) -> ResponsePromise {
        self.perform_init(Method::Patch, url, into_js(init))
    }

    /// Make a POST request with a JSON body
    pub fn post_json(
        &self,
        url: String,
        body: JsValue,
        options: Option<RequestOptions>,
    ) -> ResponsePromise {
        self.perform(
            Method::Post,
            url,
            JsValue::UNDEFINED,
            BodyMode::Json(body),
            into_js(options),
        )
    }

    /// Make a PUT request with a JSON body
    pub fn put_json(
        &self,
        url: String,
        body: JsValue,
        options: Option<RequestOptions>,
    ) -> ResponsePromise {
        self.perform(
            Method::Put,
            url,
            JsValue::UNDEFINED,
            BodyMode::Json(body),
            into_js(options),
        )
    }

    /// Make a PATCH request with a JSON body
    pub fn patch_json(
        &self,
        url: String,
        body: JsValue,
        options: Option<RequestOptions>,
    ) -> ResponsePromise {
        self.perform(
            Method::Patch,
            url,
            JsValue::UNDEFINED,
            BodyMode::Json(body),
            into_js(options),
        )
    }

    /// Make a request with any method, headers and body
    pub fn request(
        &self,
        method: String,
        url: String,
        headers: Option<HeadersLike>,
        body: Option<RequestBody>,
        options: Option<RequestOptions>,
    ) -> ResponsePromise {
        match parse_method(&method) {
            Ok(method) => self.perform(
                method,
                url,
                into_js(headers),
                BodyMode::Auto(into_js(body)),
                into_js(options),
            ),
            Err(error) => js_sys::Promise::reject(&error_context(error.into(), &method, &url, 0))
                .unchecked_into(),
        }
    }

    /// Make a request described by a `fetch`-style init object
    pub fn fetch(&self, url: String, init: Option<FetchInit>) -> ResponsePromise {
        let init = into_js(init);
        let method = match prop(&init, "method") {
            None => Ok(Method::Get),
            Some(method) => method
                .as_string()
                .ok_or_else(|| invalid("method", "must be a string"))
                .and_then(|m| parse_method(&m)),
        };
        match method {
            Ok(method) => self.perform_init(method, url, init),
            Err(error) => js_sys::Promise::reject(&error_context(
                error.into(),
                &prop(&init, "method")
                    .and_then(|v| v.as_string())
                    .unwrap_or_default(),
                &url,
                0,
            ))
            .unchecked_into(),
        }
    }
}

impl WasmClient {
    fn perform_init(&self, method: Method, url: String, init: JsValue) -> ResponsePromise {
        let body = prop(&init, "body").unwrap_or(JsValue::UNDEFINED);
        self.perform(method, url, JsValue::UNDEFINED, BodyMode::Auto(body), init)
    }

    fn perform(
        &self,
        method: Method,
        url: String,
        headers: JsValue,
        body: BodyMode,
        options: JsValue,
    ) -> ResponsePromise {
        let client = self.inner.clone();
        let context_url = url.clone();
        let context_method = method.to_reqwest();
        let deadline = match request_deadline(&options, client.config.phases.deadline) {
            Ok(deadline) => deadline.map(Box::new),
            Err(error) => {
                return js_sys::Promise::reject(&error_context(
                    error.into(),
                    context_method.as_str(),
                    &context_url,
                    0,
                ))
                .unchecked_into()
            }
        };
        // Snapshot, so interceptors added while a request is in flight don't affect it
        let (request_interceptors, response_interceptors) = {
            let interceptors = self.interceptors.borrow();
            (interceptors.request.clone(), interceptors.response.clone())
        };
        futures::promise(async move {
            let absolute = deadline.as_deref().copied();
            let result = async {
                let mut request = JsRequest::new(method, url, &headers, body, &options)?;
                for (_, interceptor) in &request_interceptors {
                    request = request.intercept(interceptor).await?;
                }
                request.deadline = deadline;
                // Without interceptors the outer error fallback already owns
                // this URL. Copy only when an interceptor could have changed it.
                let intercepted_url =
                    (!request_interceptors.is_empty()).then(|| request.url.clone());
                send(
                    &client,
                    request,
                    &options,
                    intercepted_url.as_deref().unwrap_or(&context_url),
                )
                .await
                .map_err(JsValue::from)
            };
            use futures_util::FutureExt;
            let result = crate::timeouts::with_deadline(absolute, result.map(Ok::<_, Error>))
                .await
                .unwrap_or_else(|error| Err(JsValue::from(error)));

            let mut result = result;
            for (_, on_fulfilled, on_rejected) in &response_interceptors {
                result = match (result, on_fulfilled, on_rejected) {
                    (Ok(response), Some(handler), _) => call_async(handler, &response).await,
                    (Err(error), _, Some(handler)) => call_async(handler, &error).await,
                    (unhandled, _, _) => unhandled,
                };
            }
            result.map_err(|error| error_context(error, context_method.as_str(), &context_url, 0))
        })
        .unchecked_into()
    }
}

/// Call a JS function and await its result if it returns a promise
async fn call_async(
    function: &js_sys::Function,
    argument: &JsValue,
) -> std::result::Result<JsValue, JsValue> {
    let value = function.call1(&JsValue::UNDEFINED, argument)?;
    wasm_bindgen_futures::JsFuture::from(js_sys::Promise::resolve(&value)).await
}

/// A request from JavaScript, before it is turned into a [`RequestBuilder`]
pub(crate) struct JsRequest {
    method: Method,
    url: String,
    /// Per-request headers (the `headers` argument, then `options.headers`)
    headers: Headers,
    body: BodyMode,
    deadline: Option<Box<crate::timeouts::Deadline>>,
}

impl JsRequest {
    pub(crate) fn new(
        method: Method,
        url: String,
        headers: &JsValue,
        body: BodyMode,
        options: &JsValue,
    ) -> Result<Self> {
        let mut merged = parse_headers(headers)?;
        if let Some(extra) = prop(options, "headers") {
            for (name, values) in parse_headers(&extra)?.iter() {
                merged.remove(name);
                for value in values {
                    merged.insert(name.clone(), value.clone());
                }
            }
        }
        Ok(Self {
            method,
            url,
            headers: merged,
            body,
            deadline: None,
        })
    }

    /// Let a request interceptor inspect and change the request
    async fn intercept(self, interceptor: &js_sys::Function) -> std::result::Result<Self, JsValue> {
        let info = js_sys::Object::new();
        let headers = js_sys::Object::new();
        for (name, values) in self.headers.iter() {
            set(&headers, name, &values.join(", ").into())?;
        }
        set(&info, "method", &self.method.to_reqwest().as_str().into())?;
        set(&info, "url", &self.url.as_str().into())?;
        set(&info, "headers", &headers)?;
        let (body, force_json) = match self.body {
            BodyMode::Auto(body) => (body, false),
            BodyMode::Json(body) => (body, true),
        };
        set(&info, "body", &body)?;

        let returned = call_async(interceptor, &info).await?;
        let info = if returned.is_object() {
            returned
        } else {
            info.into()
        };

        let method = prop(&info, "method")
            .and_then(|m| m.as_string())
            .ok_or_else(|| {
                JsValue::from(invalid(
                    "method",
                    "a request interceptor must leave `method` a string",
                ))
            })?;
        let url = prop(&info, "url")
            .and_then(|u| u.as_string())
            .ok_or_else(|| {
                JsValue::from(invalid(
                    "url",
                    "a request interceptor must leave `url` a string",
                ))
            })?;
        let headers = parse_headers(&prop(&info, "headers").unwrap_or(JsValue::UNDEFINED))?;
        let body = js_sys::Reflect::get(&info, &"body".into())?;
        Ok(Self {
            deadline: self.deadline,
            method: parse_method(&method)?,
            url,
            headers,
            body: if force_json {
                BodyMode::Json(body)
            } else {
                BodyMode::Auto(body)
            },
        })
    }
}

/// How to interpret a JS request body
#[derive(Clone)]
pub(crate) enum BodyMode {
    /// Infer from the value's type (see `RequestBody` in the TypeScript definitions)
    Auto(JsValue),
    /// Always serialize with `JSON.stringify`
    Json(JsValue),
}

/// Response body decoding requested from JS. The discriminants are shared
/// with the Node transport (`bodyType` in `js/node.js`).
#[derive(Clone, Copy)]
pub(crate) enum BodyType {
    Auto = 0,
    Json = 1,
    Text = 2,
    Binary = 3,
    Stream = 4,
    Ndjson = 5,
}

/// A request's options object, read with as few calls into JS as possible:
/// each property lookup is one, and a request checks over a dozen options,
/// most of them unset. The names that are set are read once, so lookups of
/// the others cost nothing. Objects that may inherit options from a
/// prototype (anything but a plain object) are looked up as before.
pub(crate) struct Options<'a> {
    value: &'a JsValue,
    /// The own property names, or `None` to look every option up
    names: Option<Vec<String>>,
}

thread_local! {
    static OBJECT_PROTOTYPE: JsValue = js_sys::Object::get_prototype_of(&js_sys::Object::new()).into();
}

impl<'a> Options<'a> {
    pub(crate) fn new(value: &'a JsValue) -> Self {
        let names = if !value.is_object() {
            Some(Vec::new())
        } else {
            let prototype: JsValue = js_sys::Object::get_prototype_of(value).into();
            let plain = prototype.is_null() || OBJECT_PROTOTYPE.with(|object| *object == prototype);
            plain.then(|| {
                js_sys::Object::keys(value.unchecked_ref::<js_sys::Object>())
                    .iter()
                    .filter_map(|name| name.as_string())
                    .collect()
            })
        };
        Self { value, names }
    }

    fn has(&self, name: &str) -> bool {
        self.names
            .as_ref()
            .map_or(true, |names| names.iter().any(|n| n == name))
    }

    /// The option, unless it's unset, `null` or `undefined`
    pub(crate) fn get(&self, name: &str) -> Option<JsValue> {
        if self.has(name) {
            prop(self.value, name)
        } else {
            None
        }
    }

    /// The option as it is, `null` included (`undefined` when unset)
    fn raw(&self, name: &str) -> JsValue {
        if self.has(name) {
            js_sys::Reflect::get(self.value, &name.into()).unwrap_or(JsValue::UNDEFINED)
        } else {
            JsValue::UNDEFINED
        }
    }

    /// An optional callback, which must be a function when set
    fn callback(&self, name: &str) -> Result<Option<js_sys::Function>> {
        self.get(name)
            .map(|callback| {
                callback
                    .dyn_into()
                    .map_err(|_| invalid(name, "must be a function"))
            })
            .transpose()
    }
}

#[derive(Default)]
pub(crate) struct RequestState {
    pub(crate) refused: std::sync::atomic::AtomicBool,
    pub(crate) attempts: std::sync::atomic::AtomicU32,
    pub(crate) url: RefCell<Option<String>>,
    pub(crate) cause: RefCell<Option<JsValue>>,
}

impl RequestState {
    pub(crate) fn remember_cause(&self, error: &JsValue) {
        *self.cause.borrow_mut() = Some(error.clone());
    }

    pub(crate) fn with_cause(&self, error: JsValue) -> JsValue {
        if let Some(cause) = self.cause.borrow().as_ref() {
            let _ = js_sys::Reflect::set(&error, &"cause".into(), cause);
        }
        error
    }
}

pub(crate) struct DestinationGuard<'a> {
    pub(crate) state: Option<&'a RequestState>,
    pub(crate) url: &'a str,
    pub(crate) success: bool,
}
impl Drop for DestinationGuard<'_> {
    fn drop(&mut self) {
        if !self.success {
            if let Some(state) = self.state {
                let mut url = state.url.borrow_mut();
                if url.is_none() {
                    *url = Some(self.url.to_owned());
                }
            }
        }
    }
}

fn error_context(error: JsValue, method: &str, url: &str, attempts: u32) -> JsValue {
    if error.is_object() {
        for (name, value) in [
            ("method", method.into()),
            ("url", url.into()),
            ("attempts", attempts.into()),
        ] {
            if !js_sys::Object::has_own(error.unchecked_ref::<js_sys::Object>(), &name.into()) {
                let _ = js_sys::Reflect::set(&error, &name.into(), &value);
            }
        }
    }
    error
}

/// Build, send and convert a request coming from JavaScript; an error says
/// whether the retry budget refused to retry it (`retryBudgetExhausted`)
pub(crate) fn send<'a>(
    client: &'a Client,
    request: JsRequest,
    options: &'a JsValue,
    original_url: &'a str,
) -> impl std::future::Future<Output = std::result::Result<JsValue, JsValue>> + 'a {
    use futures_util::TryFutureExt;
    let refused = std::sync::Arc::new(RequestState::default());
    let method = request.method.to_reqwest();
    send_request(client, request, options, &refused).map_err(move |error| {
        let error = refused.with_cause(JsValue::from(error));
        if refused.refused.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = js_sys::Reflect::set(&error, &"retryBudgetExhausted".into(), &true.into());
        }
        let resolved = refused.url.borrow();
        error_context(
            error,
            method.as_str(),
            resolved.as_deref().unwrap_or(original_url),
            refused.attempts.load(std::sync::atomic::Ordering::Relaxed),
        )
    })
}

pub(crate) fn send_request<'a>(
    client: &'a Client,
    request: JsRequest,
    options: &'a JsValue,
    #[allow(unused_variables)] refused: &std::sync::Arc<RequestState>,
) -> impl std::future::Future<Output = Result<JsValue>> + 'a {
    use futures_util::future::Either;
    let options = Options::new(options);
    let (mut builder, body) = match request_builder(client, request, &options) {
        Ok(prepared) => prepared,
        Err(error) => return Either::Left(std::future::ready(Err(error))),
    };
    #[cfg(target_arch = "wasm32")]
    {
        builder.retry_refused = Some(std::sync::Arc::clone(refused));
        builder.observer = options.get("__observe").and_then(|v| v.dyn_into().ok());
    }
    let deadline = builder.effective_deadline();
    builder.deadline = deadline.map(Box::new);
    Either::Right(crate::timeouts::with_deadline(
        deadline,
        send_prepared(client, builder, body, options),
    ))
}

async fn send_prepared(
    client: &Client,
    mut builder: RequestBuilder,
    body: BodyMode,
    options: Options<'_>,
) -> Result<JsValue> {
    let body_type = match options.get("responseType") {
        Some(value) => parse_body_type(&value)?,
        None => BodyType::Auto,
    };
    let signal = match options.get("signal") {
        Some(signal) if js_sys::Reflect::has(&signal, &"aborted".into()).unwrap_or(false) => {
            Some(signal.unchecked_into::<web_sys::AbortSignal>())
        }
        Some(_) => return Err(invalid("signal", "must be an AbortSignal")),
        None => None,
    };
    let progress = options.callback("onDownloadProgress")?;
    if let Some(callback) = &progress {
        builder = with_progress(builder, callback.clone());
    }
    let upload_progress = options.callback("onUploadProgress")?;
    if let Some(redirect) = options.get("redirect") {
        builder = builder.redirect(parse_redirect(&redirect)?);
    }
    if let Some(max) = options.get("maxRedirects") {
        builder = builder.max_redirects(parse_max_redirects(&max)?);
    }

    builder = apply_body(builder, body).await?;
    #[cfg(target_arch = "wasm32")]
    builder.apply_trace(options.get("__trace").and_then(|v| v.dyn_into().ok()))?;
    #[cfg(target_arch = "wasm32")]
    crate::client::observe_text(
        builder.observer.as_ref(),
        "method",
        builder.config.method.to_reqwest().as_str(),
    );
    if let BodyType::Stream | BodyType::Ndjson = body_type {
        #[cfg(target_arch = "wasm32")]
        let has_upload = builder.upload.is_some();
        #[cfg(not(target_arch = "wasm32"))]
        let has_upload = false;
        if upload_progress.is_some() && !has_upload {
            return Err(invalid(
                "onUploadProgress",
                "can't be combined with a streamed responseType ('stream' or 'ndjson')",
            ));
        }
        #[cfg(target_arch = "wasm32")]
        if let (Some(upload), Some(callback)) = (&builder.upload, &upload_progress) {
            upload.progress(callback)?;
        }
        let max_line_bytes = parse_stream_limit(
            &options.raw("maxLineBytes"),
            client.config.max_line_bytes,
            "maxLineBytes",
        )?;
        // This path is opt-in. Keep its larger header/body state out of
        // every ordinary buffered request's inline future.
        let response = Box::pin(abortable(signal.clone(), builder.send_streaming())).await?;
        if let BodyType::Ndjson = body_type {
            return ndjson_response_to_js(response, signal, max_line_bytes);
        }
        return streaming_response_to_js(response, signal);
    }
    #[cfg(target_arch = "wasm32")]
    {
        let callbacks = transport::ProgressCallbacks {
            upload: upload_progress,
            download: progress,
            observer: builder.observer.clone(),
            request_state: builder.retry_refused.clone(),
        };
        abortable(signal, builder.send_js(body_type, callbacks)).await
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = upload_progress;
        let response = abortable(signal, builder.send()).await?;
        response_to_js(response, body_type)
    }
}

/// Merge set phase fields; an omitted/null value inherits and zero disables.
pub(crate) fn parse_phase_options(
    options: &Options,
    base: &crate::PhaseTimeouts,
) -> Result<Option<crate::PhaseTimeouts>> {
    let names = [
        "connectTimeoutMs",
        "responseTimeoutMs",
        "idleTimeoutMs",
        "deadlineMs",
    ];
    if !names.iter().any(|name| options.has(name)) {
        return Ok(None);
    }
    let mut phases = *base;
    for (name, target) in [
        ("connectTimeoutMs", &mut phases.connect),
        ("responseTimeoutMs", &mut phases.response),
        ("idleTimeoutMs", &mut phases.idle),
        ("deadlineMs", &mut phases.deadline),
    ] {
        if let Some(value) = options.get(name) {
            *target = parse_phase_duration(&value, name)?;
        }
    }
    Ok(Some(phases))
}

fn parse_phase_duration(value: &JsValue, name: &str) -> Result<Option<Duration>> {
    let duration = parse_delay(value, name)?;
    Ok((!duration.is_zero()).then_some(duration))
}

pub(crate) fn request_deadline(
    options: &JsValue,
    base: Option<Duration>,
) -> Result<Option<crate::timeouts::Deadline>> {
    if !options.is_object() {
        return Ok(base.map(crate::timeouts::Deadline::new));
    }
    // Match Options' inheritance rules without building another key cache:
    // plain options ignore polluted Object.prototype defaults.
    let prototype: JsValue = js_sys::Object::get_prototype_of(options).into();
    let plain = prototype.is_null() || OBJECT_PROTOTYPE.with(|object| *object == prototype);
    let value = if plain
        && !js_sys::Object::has_own(
            options.unchecked_ref::<js_sys::Object>(),
            &"deadlineMs".into(),
        ) {
        None
    } else {
        prop(options, "deadlineMs")
    };
    let duration = match value {
        Some(value) => parse_phase_duration(&value, "deadlineMs")?,
        None => base,
    };
    Ok(duration.map(crate::timeouts::Deadline::new))
}

/// An optional callback option, which must be a function when set
fn callback_option(options: &JsValue, name: &str) -> Result<Option<js_sys::Function>> {
    prop(options, name)
        .map(|callback| {
            callback
                .dyn_into()
                .map_err(|_| invalid(name, "must be a function"))
        })
        .transpose()
}

/// A request's method, URL, headers, query parameters and timeout; the body
/// is returned separately, to attach once the other options are validated
pub(crate) fn request_builder(
    client: &Client,
    request: JsRequest,
    options: &Options,
) -> Result<(RequestBuilder, BodyMode)> {
    let JsRequest {
        method,
        url,
        headers,
        body,
        deadline,
    } = request;
    let mut builder = client
        .request_owned(method, url)
        // Decode here rather than in Rust, so JSON is parsed by the JS engine
        .response_format(ResponseFormat::Binary)
        .headers(headers);

    if let Some(phases) = parse_phase_options(options, &client.config.phases)? {
        builder = builder.phase_timeouts(phases);
    }
    if let Some(deadline) = deadline {
        builder.deadline = Some(deadline);
    }
    if let Some(params) = options.get("params") {
        builder = builder.query(parse_params(&params)?);
    }
    if let Some(allow) = options.get("allowAbsoluteUrls") {
        builder = builder.allow_absolute_urls(parse_bool(&allow, "allowAbsoluteUrls")?);
    }
    if let Some(names) = options.get("sensitiveHeaders") {
        builder = builder.sensitive_headers(parse_header_names(&names)?);
    }
    if let Some(allow) = options.get("allowInsecureRedirects") {
        builder = builder.allow_insecure_redirects(parse_bool(&allow, "allowInsecureRedirects")?);
    }
    // `null` removes the client's limit for this request
    match options.raw("maxResponseBytes") {
        value if value.is_null() => builder = builder.max_response_bytes(None),
        value if !value.is_undefined() => {
            builder = builder.max_response_bytes(Some(parse_max_response_bytes(&value)?));
        }
        _ => {}
    }
    if let Some(retries) = options.get("retries") {
        builder = builder.retry_config(parse_retries(&retries)?);
    }
    if let Some(timeout) = options.get("timeoutMs") {
        builder = match parse_timeout(&timeout)? {
            Some(timeout) => builder.timeout(timeout),
            None => builder.no_timeout(),
        };
    }
    #[cfg(target_arch = "wasm32")]
    {
        builder = idempotency::apply(builder, options, &client.config.idempotency)?;
        builder.fetch_options = parse_fetch_options(options, builder.fetch_options.as_ref())?;
        if let Some(allow) = options.get("allowPrivateNetwork") {
            builder.allow_private_network = parse_bool(&allow, "allowPrivateNetwork")?;
        }
    }
    Ok((builder, body))
}

/// `BrowserRequestOptions`, validated and merged over the client's. Node.js
/// requests don't use them, so there they're only validated.
#[cfg(target_arch = "wasm32")]
fn parse_fetch_options(
    options: &Options,
    base: Option<&js_sys::Object>,
) -> Result<Option<js_sys::Object>> {
    const NAMES: [&str; 8] = [
        "credentials",
        "mode",
        "cache",
        "priority",
        "referrerPolicy",
        "referrer",
        "integrity",
        "keepalive",
    ];
    // Most requests set none of these (see `Options`)
    if !NAMES.iter().any(|name| options.has(name)) {
        return Ok(if transport::is_node() {
            None
        } else {
            base.cloned()
        });
    }
    const CHOICES: [(&str, &[&str]); 5] = [
        ("credentials", &["omit", "same-origin", "include"]),
        ("mode", &["cors", "no-cors", "same-origin"]),
        (
            "cache",
            &[
                "default",
                "no-store",
                "reload",
                "no-cache",
                "force-cache",
                "only-if-cached",
            ],
        ),
        ("priority", &["high", "low", "auto"]),
        (
            "referrerPolicy",
            &[
                "",
                "no-referrer",
                "no-referrer-when-downgrade",
                "same-origin",
                "origin",
                "strict-origin",
                "origin-when-cross-origin",
                "strict-origin-when-cross-origin",
                "unsafe-url",
            ],
        ),
    ];
    let mut merged: Option<js_sys::Object> = None;
    let mut add = |name: &str, value: &JsValue| {
        let target = merged.get_or_insert_with(|| {
            js_sys::Object::assign(
                &js_sys::Object::new(),
                base.unwrap_or(&js_sys::Object::new()),
            )
        });
        set(target, name, value)
    };
    for (name, allowed) in CHOICES {
        if let Some(value) = options.get(name) {
            if !value
                .as_string()
                .is_some_and(|v| allowed.contains(&v.as_str()))
            {
                let choices = allowed.join("', '");
                return Err(invalid(name, &format!("must be one of '{choices}'")));
            }
            add(name, &value)?;
        }
    }
    for name in ["referrer", "integrity"] {
        if let Some(value) = options.get(name) {
            if !value.is_string() {
                return Err(invalid(name, "must be a string"));
            }
            add(name, &value)?;
        }
    }
    if let Some(value) = options.get("keepalive") {
        add("keepalive", &parse_bool(&value, "keepalive")?.into())?;
    }
    if transport::is_node() {
        return Ok(None);
    }
    Ok(merged.or_else(|| base.cloned()))
}

/// Report download progress to a JS callback (`{ loaded, total }`).
/// Exceptions thrown by the callback are ignored.
#[cfg(target_arch = "wasm32")]
fn with_progress(builder: RequestBuilder, callback: js_sys::Function) -> RequestBuilder {
    builder.on_download_progress(move |progress| {
        let event = js_sys::Object::new();
        #[allow(clippy::cast_precision_loss)]
        let total = progress
            .total
            .map_or(JsValue::NULL, |t| JsValue::from_f64(t as f64));
        #[allow(clippy::cast_precision_loss)]
        let _ = set(&event, "loaded", &JsValue::from_f64(progress.loaded as f64));
        let _ = set(&event, "total", &total);
        let _ = callback.call1(&JsValue::UNDEFINED, &event);
    })
}

/// JS callbacks can't be `Send`, which native progress callbacks require;
/// the bindings only run inside a JS engine anyway.
#[cfg(not(target_arch = "wasm32"))]
fn with_progress(builder: RequestBuilder, _callback: js_sys::Function) -> RequestBuilder {
    builder
}

/// Attach a JS body to a request, choosing a Content-Type if none was set
async fn apply_body(request: RequestBuilder, body: BodyMode) -> Result<RequestBuilder> {
    let (value, force_json) = match body {
        BodyMode::Auto(value) => (value, false),
        BodyMode::Json(value) => (value, true),
    };
    if !force_json && (value.is_null() || value.is_undefined()) {
        return Ok(request);
    }

    if !force_json {
        if let Some(text) = value.as_string() {
            return Ok(request.text(text));
        }
        if let Some(bytes) = js_bytes(&value) {
            return Ok(request.bytes(bytes));
        }
        if is_instance_of_global(&value, "URLSearchParams") {
            let encoded = String::from(value.unchecked_ref::<js_sys::Object>().to_string());
            return Ok(with_default_content_type(
                request,
                "application/x-www-form-urlencoded;charset=UTF-8",
            )
            .text(encoded));
        }
        if is_instance_of_global(&value, "FormData") {
            return Ok(request.multipart(&form_data_to_multipart(&value).await?));
        }
        if is_instance_of_global(&value, "Blob") {
            let content_type =
                blob_type(&value).unwrap_or_else(|| "application/octet-stream".to_string());
            let bytes = blob_bytes(&value).await?;
            return Ok(with_default_content_type(request, &content_type).bytes(bytes));
        }
        #[cfg(target_arch = "wasm32")]
        if let Some(upload) = upload::Upload::from_value(&value)? {
            if matches!(request.config.method, Method::Get | Method::Head) {
                return Err(invalid("body", "GET and HEAD cannot have streaming bodies"));
            }
            let mut request = with_default_content_type(request, "application/octet-stream");
            upload.activate();
            request.upload = Some(upload);
            return Ok(request);
        }
    }

    let json = js_sys::JSON::stringify(&value).map_err(|e| {
        invalid(
            "body",
            &format!("could not be serialized to JSON: {}", js_error_message(&e)),
        )
    })?;
    let json = json
        .as_string()
        .ok_or_else(|| invalid("body", "could not be serialized to JSON"))?;
    Ok(with_default_content_type(request, "application/json").text(json))
}

/// Encode a `FormData` (strings and files) as `multipart/form-data`
async fn form_data_to_multipart(form_data: &JsValue) -> Result<Multipart> {
    let mut form = Multipart::new();
    let entries: Vec<JsValue> = js_sys::try_iter(form_data)?
        .ok_or_else(|| invalid("body", "FormData is not iterable"))?
        .collect::<std::result::Result<_, _>>()?;
    for entry in entries {
        let entry = js_sys::Array::from(&entry);
        let name = entry.get(0).as_string().unwrap_or_default();
        let value = entry.get(1);
        form = match value.as_string() {
            Some(text) => form.text(name, text),
            None => {
                // FormData converts every non-string value to a File; a bare Blob gets the name "blob"
                let filename = js_sys::Reflect::get(&value, &"name".into())?
                    .as_string()
                    .unwrap_or_else(|| "blob".to_string());
                let content_type = blob_type(&value);
                form.file(name, filename, content_type, blob_bytes(&value).await?)
            }
        };
    }
    Ok(form)
}

/// A Blob's MIME type, if it has one
fn blob_type(blob: &JsValue) -> Option<String> {
    js_sys::Reflect::get(blob, &"type".into())
        .ok()
        .and_then(|t| t.as_string())
        .filter(|t| !t.is_empty())
}

/// Read a Blob's contents
async fn blob_bytes(blob: &JsValue) -> Result<Vec<u8>> {
    let array_buffer: js_sys::Function =
        js_sys::Reflect::get(blob, &"arrayBuffer".into())?.unchecked_into();
    let promise: js_sys::Promise = array_buffer.call0(blob)?.unchecked_into();
    let buffer = wasm_bindgen_futures::JsFuture::from(promise).await?;
    Ok(js_sys::Uint8Array::new(&buffer).to_vec())
}

fn with_default_content_type(mut request: RequestBuilder, content_type: &str) -> RequestBuilder {
    if !request.config.headers.contains("content-type") {
        request.config.headers.set("content-type", content_type);
    }
    request
}

/// Copy the bytes out of an `ArrayBuffer` or any `ArrayBufferView`
fn js_bytes(value: &JsValue) -> Option<Vec<u8>> {
    if value.is_instance_of::<js_sys::ArrayBuffer>() {
        return Some(js_sys::Uint8Array::new(value).to_vec());
    }
    if js_sys::ArrayBuffer::is_view(value) {
        let get = |name: &str| js_sys::Reflect::get(value, &name.into()).ok();
        let buffer = get("buffer")?;
        let offset = get("byteOffset")?.as_f64()?;
        let length = get("byteLength")?.as_f64()?;
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let view = js_sys::Uint8Array::new_with_byte_offset_and_length(
            &buffer,
            offset as u32,
            length as u32,
        );
        return Some(view.to_vec());
    }
    None
}

/// The response fields other than `body`
fn response_head_to_js(
    status: u16,
    status_text: &str,
    url: &str,
    response_headers: &Headers,
) -> Result<js_sys::Object> {
    let obj = js_sys::Object::new();
    set(&obj, "status", &f64::from(status).into())?;
    set(&obj, "statusText", &status_text.into())?;
    set(&obj, "ok", &(200..300).contains(&status).into())?;
    set(&obj, "url", &url.into())?;

    let headers = js_sys::Object::new();
    for (name, values) in response_headers.iter() {
        set(&headers, name, &values.join(", ").into())?;
    }
    set(&obj, "headers", &headers)?;
    Ok(obj)
}

/// Convert a response into the object returned to JavaScript
#[cfg(not(target_arch = "wasm32"))]
fn response_to_js(response: crate::types::Response, body_type: BodyType) -> Result<JsValue> {
    use crate::types::ResponseBody;
    let obj = response_head_to_js(
        response.status,
        &response.status_text,
        &response.url,
        &response.headers,
    )?;

    let content_type = response
        .headers
        .get_first("content-type")
        .unwrap_or("")
        .to_string();
    let bytes = match response.body {
        ResponseBody::Binary(bytes) => bytes,
        ResponseBody::Text(text) => text.into_bytes(),
        ResponseBody::Json(json) => serde_json::to_vec(&json)?,
        ResponseBody::Empty => Vec::new(),
    };
    set(
        &obj,
        "body",
        &decode_js_body(bytes, &content_type, body_type)?,
    )?;
    Ok(obj.into())
}

/// Convert a streaming response; its body becomes a `ReadableStream<Uint8Array>`
fn streaming_response_to_js(
    response: StreamingResponse,
    signal: Option<web_sys::AbortSignal>,
) -> Result<JsValue> {
    let obj = response_head_to_js(
        response.status,
        &response.status_text,
        &response.url,
        &response.headers,
    )?;
    // Without progress or a size limit the core doesn't need the bytes, so
    // each chunk of the transport's stream passes through as an opaque JS
    // value: no copy into WebAssembly and back. The signal, typed errors and
    // backpressure (read only as the caller reads) work as on the copying path.
    #[cfg(target_arch = "wasm32")]
    let response = match response.into_raw() {
        Ok((raw, controller)) => {
            let chunks = raw.map(|raw| {
                wasm_streams::ReadableStream::from_raw(raw)
                    .into_stream()
                    .map(|chunk| {
                        chunk
                            .map(own_chunk)
                            .map_err(|error| transport::body_error(&error))
                    })
            });
            let chunks = transport::body_with_abort(
                futures_util::stream::iter(chunks).flatten(),
                controller,
            );
            let chunks =
                AbortableStream::new(chunks, signal).map(|chunk| chunk.map_err(JsValue::from));
            let stream = wasm_streams::ReadableStream::from_stream(chunks).into_raw();
            set(&obj, "body", &stream)?;
            return Ok(obj.into());
        }
        Err(response) => response,
    };
    let chunks = AbortableStream::new(response.into_stream(), signal).map(|chunk| {
        chunk
            .map(|bytes| js_sys::Uint8Array::from(bytes.as_slice()).into())
            .map_err(JsValue::from)
    });
    let stream = wasm_streams::ReadableStream::from_stream(chunks).into_raw();
    set(&obj, "body", &stream)?;
    Ok(obj.into())
}

/// A chunk that owns its whole buffer, as the copying path's do: a view into
/// a larger buffer (which could hold other data) is copied
#[cfg(target_arch = "wasm32")]
fn own_chunk(chunk: JsValue) -> JsValue {
    match chunk.dyn_ref::<js_sys::Uint8Array>() {
        Some(view)
            if view.byte_offset() != 0 || view.byte_length() != view.buffer().byte_length() =>
        {
            view.slice(0, view.length()).into()
        }
        _ => chunk,
    }
}

/// A newline-delimited JSON response: `body` is a `ReadableStream` of parsed
/// values. A line that isn't JSON errors the stream with a `ParseError`.
fn ndjson_response_to_js(
    response: StreamingResponse,
    signal: Option<web_sys::AbortSignal>,
    max_line_bytes: Option<usize>,
) -> Result<JsValue> {
    let obj = response_head_to_js(
        response.status,
        &response.status_text,
        &response.url,
        &response.headers,
    )?;
    let mut lines = crate::lines::Lines::with_limit(max_line_bytes);
    // Each chunk, then a final None to flush a last line without a newline
    let chunks = AbortableStream::new(response.into_stream(), signal)
        .map(Some)
        .chain(futures_util::stream::once(async { None }));
    let parsed = chunks.flat_map(move |chunk| {
        let lines: Vec<std::result::Result<crate::lines::Line, Error>> = match chunk {
            Some(Ok(bytes)) => {
                let (lines, error) = lines.feed(&bytes);
                lines.into_iter().map(Ok).chain(error.map(Err)).collect()
            }
            Some(Err(error)) => vec![Err(error)],
            None => lines.finish().into_iter().map(Ok).collect(),
        };
        futures_util::stream::iter(lines.into_iter().map(|line| {
            let line = line.map_err(JsValue::from)?;
            parse_json_line(&line).map_err(JsValue::from)
        }))
    });
    let stream = wasm_streams::ReadableStream::from_stream(parsed).into_raw();
    set(&obj, "body", &stream)?;
    Ok(obj.into())
}

/// Parse one NDJSON line with the JS engine's `JSON.parse`
fn parse_json_line(line: &crate::lines::Line) -> Result<JsValue> {
    #[cfg(target_arch = "wasm32")]
    {
        transport::parse_native_json(&JsValue::from_str(&line.text)).map_err(|error| Error::Parse {
            message: format!(
                "Failed to parse line {} as JSON: {}",
                line.number,
                js_error_message(&error)
            ),
            source: None,
        })
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = line;
        Ok(JsValue::UNDEFINED)
    }
}

#[cfg(not(target_arch = "wasm32"))]
/// Decode a body into a JS value, mirroring the Rust `ResponseFormat` rules
pub(crate) fn decode_js_body(
    bytes: Vec<u8>,
    content_type: &str,
    body_type: BodyType,
) -> Result<JsValue> {
    use crate::{
        client::bytes_to_text,
        types::{is_json_content_type, is_text_content_type},
    };
    if bytes.is_empty() {
        return Ok(match body_type {
            BodyType::Text => JsValue::from_str(""),
            BodyType::Binary | BodyType::Stream | BodyType::Ndjson => {
                js_sys::Uint8Array::new_with_length(0).into()
            }
            BodyType::Auto | BodyType::Json => JsValue::NULL,
        });
    }

    match body_type {
        BodyType::Json => parse_json(&bytes_to_text(bytes)),
        BodyType::Text => Ok(bytes_to_text(bytes).into()),
        BodyType::Binary | BodyType::Stream | BodyType::Ndjson => {
            Ok(js_sys::Uint8Array::from(bytes.as_slice()).into())
        }
        BodyType::Auto if is_json_content_type(content_type) => {
            let text = bytes_to_text(bytes);
            // Mislabelled responses fall back to text
            Ok(parse_json(&text).unwrap_or_else(|_| text.into()))
        }
        BodyType::Auto if is_text_content_type(content_type) => Ok(bytes_to_text(bytes).into()),
        BodyType::Auto => Ok(js_sys::Uint8Array::from(bytes.as_slice()).into()),
    }
}

#[cfg(not(target_arch = "wasm32"))]
/// Parse JSON with the engine's `JSON.parse`, exactly like `Response.json()`
/// (large integers lose precision instead of failing the request)
fn parse_json(text: &str) -> Result<JsValue> {
    js_sys::JSON::parse(text).map_err(|e| Error::Parse {
        message: format!("Failed to parse JSON response: {}", js_error_message(&e)),
        source: None,
    })
}

pub(crate) fn parse_method(method: &str) -> Result<Method> {
    match Method::from_str(method) {
        // The Fetch standard forbids these, so browsers and Node.js reject them
        Some(Method::Connect | Method::Trace) => Err(invalid(
            "method",
            &format!("{} is not supported by fetch()", method.to_uppercase()),
        )),
        Some(method) => Ok(method),
        None => Err(invalid("method", &format!("Invalid HTTP method: {method}"))),
    }
}

pub(crate) fn parse_headers(value: &JsValue) -> Result<Headers> {
    Headers::from_js(value).map_err(|e| invalid("headers", &js_error_message(&e)))
}

fn parse_params(value: &JsValue) -> Result<Vec<(String, String)>> {
    let entries: Vec<JsValue> = if is_instance_of_global(value, "URLSearchParams") {
        js_sys::try_iter(value)?
            .ok_or_else(|| invalid("params", "URLSearchParams is not iterable"))?
            .collect::<std::result::Result<_, _>>()?
    } else if value.is_object() {
        js_sys::Object::entries(value.unchecked_ref())
            .iter()
            .collect()
    } else {
        return Err(invalid("params", "must be an object or URLSearchParams"));
    };

    let mut params = Vec::new();
    for entry in entries {
        let entry = js_sys::Array::from(&entry);
        let key = entry.get(0).as_string().unwrap_or_default();
        let value = entry.get(1);
        let values: Vec<JsValue> = if js_sys::Array::is_array(&value) {
            js_sys::Array::from(&value).iter().collect()
        } else {
            vec![value]
        };
        for value in values {
            if value.is_null() || value.is_undefined() {
                continue;
            }
            let value = scalar_to_string(&value).ok_or_else(|| {
                invalid(
                    "params",
                    &format!("'{key}' must be a string, number or boolean"),
                )
            })?;
            params.push((key.clone(), value));
        }
    }
    Ok(params)
}

fn parse_timeout(value: &JsValue) -> Result<Option<Duration>> {
    match value.as_f64() {
        Some(ms) if ms == 0.0 => Ok(None),
        Some(ms) if ms.is_finite() && ms > 0.0 => Ok(Some(Duration::from_secs_f64(ms / 1000.0))),
        _ => Err(invalid(
            "timeoutMs",
            "must be a non-negative number of milliseconds",
        )),
    }
}

/// `true` for the defaults, `false` for none, or `RetryBudgetOptions`
fn parse_retry_budget(value: &JsValue) -> Result<Option<crate::RetryBudget>> {
    if let Some(on) = value.as_bool() {
        return Ok(on.then(crate::RetryBudget::new));
    }
    if !value.is_object() {
        return Err(invalid(
            "retryBudget",
            "must be a boolean or a RetryBudgetOptions object",
        ));
    }
    // Range checks happen in `ClientBuilder::build`
    let number = |name: &str, parameter: &str| {
        prop(value, name)
            .map(|v| {
                v.as_f64()
                    .ok_or_else(|| invalid(parameter, "must be a number"))
            })
            .transpose()
    };
    let mut budget = crate::RetryBudget::new();
    if let Some(ratio) = number("ratio", "retryBudget.ratio")? {
        budget = budget.ratio(ratio);
    }
    if let Some(min) = number("minPerSecond", "retryBudget.minPerSecond")? {
        budget = budget.min_per_second(min);
    }
    if let Some(window) = number("windowMs", "retryBudget.windowMs")? {
        budget = budget.window(parse_delay(&window.into(), "retryBudget.windowMs")?);
    }
    Ok(Some(budget))
}

fn parse_retries(value: &JsValue) -> Result<RetryConfig> {
    let mut config = RetryConfig::default();

    if let Some(count) = value.as_f64() {
        config.max_retries = non_negative_u32(count, "retries")?;
        return Ok(config);
    }
    if !value.is_object() {
        return Err(invalid(
            "retries",
            "must be a number or a RetryOptions object",
        ));
    }

    if let Some(v) = prop(value, "maxRetries") {
        config.max_retries =
            non_negative_u32(v.as_f64().unwrap_or(f64::NAN), "retries.maxRetries")?;
    }
    if let Some(v) = prop(value, "initialDelayMs") {
        config.initial_delay = parse_delay(&v, "retries.initialDelayMs")?;
    }
    if let Some(v) = prop(value, "maxDelayMs") {
        config.max_delay = parse_delay(&v, "retries.maxDelayMs")?;
    }
    if let Some(v) = prop(value, "multiplier") {
        config.multiplier = v
            .as_f64()
            .filter(|m| m.is_finite() && *m >= 1.0)
            .ok_or_else(|| invalid("retries.multiplier", "must be a number >= 1"))?;
    }
    if let Some(v) = prop(value, "retryOn") {
        if !js_sys::Array::is_array(&v) {
            return Err(invalid(
                "retries.retryOn",
                "must be an array of status codes",
            ));
        }
        config.retry_on_status = js_sys::Array::from(&v)
            .iter()
            .map(|status| {
                status
                    .as_f64()
                    .filter(|s| s.fract() == 0.0 && (100.0..=599.0).contains(s))
                    .map(|s| s as u16)
                    .ok_or_else(|| {
                        invalid(
                            "retries.retryOn",
                            "must contain HTTP status codes (100-599)",
                        )
                    })
            })
            .collect::<Result<_>>()?;
    }
    if let Some(v) = prop(value, "retryOnNetworkError") {
        config.retry_on_network_error = parse_bool(&v, "retries.retryOnNetworkError")?;
    }
    if let Some(v) = prop(value, "retryOnTimeout") {
        config.retry_on_timeout = parse_bool(&v, "retries.retryOnTimeout")?;
    }
    if let Some(v) = prop(value, "retryNonIdempotent") {
        config.retry_non_idempotent = parse_bool(&v, "retries.retryNonIdempotent")?;
    }
    Ok(config)
}

/// `'env'`, or an `http:` / `https:` proxy URL
#[cfg(target_arch = "wasm32")]
fn parse_proxy(value: &JsValue) -> Result<String> {
    let reason = "must be 'env' or an http: or https: proxy URL";
    let proxy = value.as_string().ok_or_else(|| invalid("proxy", reason))?;
    if proxy == "env" {
        return Ok(proxy);
    }
    match crate::url::Url::parse(&proxy) {
        Ok(url) if matches!(url.scheme(), "http" | "https") && url.has_host() => Ok(url.into()),
        _ => Err(invalid("proxy", reason)),
    }
}

fn parse_max_response_bytes(value: &JsValue) -> Result<u64> {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    value
        .as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0 && n.fract() == 0.0 && *n <= 9_007_199_254_740_991.0)
        .map(|n| n as u64)
        .ok_or_else(|| {
            invalid(
                "maxResponseBytes",
                "must be a non-negative integer number of bytes",
            )
        })
}

fn parse_redirect(value: &JsValue) -> Result<Redirect> {
    match value.as_string().as_deref() {
        Some("follow") => Ok(Redirect::Follow),
        Some("manual") => Ok(Redirect::Manual),
        Some("error") => Ok(Redirect::Error),
        _ => Err(invalid("redirect", "must be 'follow', 'manual' or 'error'")),
    }
}

fn parse_max_redirects(value: &JsValue) -> Result<u32> {
    non_negative_u32(value.as_f64().unwrap_or(f64::NAN), "maxRedirects")
}

fn parse_max_pending_requests(value: &JsValue) -> Result<usize> {
    positive_u32(value, "maxPendingRequests")
}

/// `sensitiveHeaders`: an array of valid header names
fn parse_header_names(value: &JsValue) -> Result<Vec<String>> {
    let invalid_names = || invalid("sensitiveHeaders", "must be an array of header names");
    if !js_sys::Array::is_array(value) {
        return Err(invalid_names());
    }
    js_sys::Array::from(value)
        .iter()
        .map(|name| {
            name.as_string()
                .filter(|name| reqwest::header::HeaderName::from_bytes(name.as_bytes()).is_ok())
                .ok_or_else(invalid_names)
        })
        .collect()
}

/// A stream limit (`maxLineBytes`, `maxEventBytes`) for a request or an event
/// stream: the client's unless set; `null` for none
pub(crate) fn parse_stream_limit(
    value: &JsValue,
    client: Option<usize>,
    parameter: &str,
) -> Result<Option<usize>> {
    match value {
        value if value.is_null() => Ok(None),
        value if value.is_undefined() => Ok(client),
        value => positive_u32(value, parameter).map(Some),
    }
}

pub(crate) fn positive_u32(value: &JsValue, parameter: &str) -> Result<usize> {
    match non_negative_u32(value.as_f64().unwrap_or(f64::NAN), parameter) {
        Ok(0) | Err(_) => Err(invalid(parameter, "must be a positive integer")),
        Ok(max) => Ok(max as usize),
    }
}

fn parse_body_type(value: &JsValue) -> Result<BodyType> {
    match value.as_string().as_deref() {
        Some("auto") => Ok(BodyType::Auto),
        Some("json") => Ok(BodyType::Json),
        Some("text") => Ok(BodyType::Text),
        Some("binary") => Ok(BodyType::Binary),
        Some("stream") => Ok(BodyType::Stream),
        Some("ndjson") => Ok(BodyType::Ndjson),
        _ => Err(invalid(
            "responseType",
            "must be 'auto', 'json', 'text', 'binary', 'stream' or 'ndjson'",
        )),
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn non_negative_u32(value: f64, parameter: &str) -> Result<u32> {
    if value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value <= f64::from(u32::MAX) {
        Ok(value as u32)
    } else {
        Err(invalid(parameter, "must be a non-negative integer"))
    }
}

fn parse_delay(value: &JsValue, parameter: &str) -> Result<Duration> {
    value
        .as_f64()
        .filter(|ms| ms.is_finite() && *ms >= 0.0)
        .map(|ms| Duration::from_secs_f64(ms / 1000.0))
        .ok_or_else(|| invalid(parameter, "must be a non-negative number of milliseconds"))
}

fn parse_bool(value: &JsValue, parameter: &str) -> Result<bool> {
    value
        .as_bool()
        .ok_or_else(|| invalid(parameter, "must be a boolean"))
}

fn scalar_to_string(value: &JsValue) -> Option<String> {
    value
        .as_string()
        .or_else(|| value.as_f64().map(js_number_to_string))
        .or_else(|| value.as_bool().map(|b| b.to_string()))
}

/// Format a number the way JavaScript's `String(n)` does
fn js_number_to_string(n: f64) -> String {
    js_sys::Number::from(n)
        .to_string_with_radix(10)
        .map(String::from)
        .unwrap_or_else(|_| n.to_string())
}

/// Read an object property, treating `undefined` and `null` as absent
fn prop(target: &JsValue, name: &str) -> Option<JsValue> {
    if !target.is_object() {
        return None;
    }
    js_sys::Reflect::get(target, &name.into())
        .ok()
        .filter(|v| !v.is_undefined() && !v.is_null())
}

fn set(target: &js_sys::Object, name: &str, value: &JsValue) -> Result<()> {
    js_sys::Reflect::set(target, &name.into(), value)?;
    Ok(())
}

/// `value instanceof globalThis[name]`, false if that global doesn't exist
fn is_instance_of_global(value: &JsValue, name: &str) -> bool {
    if !value.is_object() {
        return false;
    }
    js_sys::Reflect::get(&js_sys::global(), &name.into())
        .ok()
        .filter(JsValue::is_function)
        .and_then(|ctor| js_sys::Reflect::get(&ctor, &"prototype".into()).ok())
        .filter(JsValue::is_object)
        .is_some_and(|proto| {
            proto
                .unchecked_ref::<js_sys::Object>()
                .is_prototype_of(value)
        })
}

fn js_error_message(error: &JsValue) -> String {
    js_sys::Reflect::get(error, &"message".into())
        .ok()
        .and_then(|m| m.as_string())
        .or_else(|| error.as_string())
        .unwrap_or_else(|| format!("{error:?}"))
}

fn into_js<T: Into<JsValue>>(value: Option<T>) -> JsValue {
    value.map_or(JsValue::UNDEFINED, Into::into)
}

fn invalid(parameter: &str, reason: &str) -> Error {
    Error::InvalidInput {
        parameter: parameter.to_string(),
        reason: reason.to_string(),
    }
}

fn rejected(error: Error) -> ResponsePromise {
    js_sys::Promise::reject(&JsValue::from(error)).unchecked_into()
}

impl Headers {
    /// Create from a plain JavaScript object
    pub fn from_js_object(obj: &js_sys::Object) -> std::result::Result<Self, JsValue> {
        Self::from_js(obj.as_ref())
    }

    /// Create from any JavaScript `HeadersInit`: a plain object, a `Headers`
    /// instance, a `Map`, or an array of `[name, value]` pairs.
    ///
    /// Number and boolean values are converted to strings; `null` and
    /// `undefined` values are skipped. Anything else is an error rather than
    /// being silently dropped.
    pub fn from_js(value: &JsValue) -> std::result::Result<Self, JsValue> {
        let mut headers = Headers::new();
        if value.is_null() || value.is_undefined() {
            return Ok(headers);
        }
        if !value.is_object() {
            return Err(JsValue::from_str(
                "headers must be an object, Headers, Map or array of pairs",
            ));
        }

        // Iterables (Headers, Map, arrays) yield [name, value] pairs; plain
        // objects are read through Object.entries.
        let pairs: Vec<JsValue> = match js_sys::try_iter(value)? {
            Some(iter) => iter.collect::<std::result::Result<_, _>>()?,
            None => js_sys::Object::entries(value.unchecked_ref())
                .iter()
                .collect(),
        };

        for pair in pairs {
            let pair = js_sys::Array::from(&pair);
            let name = pair
                .get(0)
                .as_string()
                .ok_or_else(|| JsValue::from_str("header names must be strings"))?;
            let value = pair.get(1);
            if value.is_null() || value.is_undefined() {
                continue;
            }
            let value = value
                .as_string()
                .or_else(|| value.as_f64().map(|n| n.to_string()))
                .or_else(|| value.as_bool().map(|b| b.to_string()))
                .ok_or_else(|| {
                    JsValue::from_str(&format!(
                        "header '{name}' must be a string, number or boolean"
                    ))
                })?;
            headers.insert(name, value);
        }

        Ok(headers)
    }
}

/// Convert Error to JsValue for WASM boundary
impl From<Error> for JsValue {
    fn from(error: Error) -> Self {
        // A real `Error` (with a stack trace) carrying structured details;
        // `name` and `kind` both hold the error kind, e.g. "HttpError".
        let obj = js_sys::Error::new(&error.to_string());
        obj.set_name(error.kind());
        let _ = js_sys::Reflect::set(&obj, &"kind".into(), &error.kind().into());

        if let Some(timeout) = error.timeout_details() {
            let _ = js_sys::Reflect::set(&obj, &"phase".into(), &timeout.phase.as_str().into());
            #[allow(clippy::cast_precision_loss)]
            let _ = js_sys::Reflect::set(
                &obj,
                &"timeoutMs".into(),
                &(timeout.duration_ms as f64).into(),
            );
        }
        if let Some(circuit) = error.circuit_open() {
            let _ = js_sys::Reflect::set(&obj, &"origin".into(), &circuit.origin.as_str().into());
            let _ = js_sys::Reflect::set(
                &obj,
                &"retryAfterMs".into(),
                &(circuit.retry_after.as_secs_f64() * 1000.0).into(),
            );
        }
        // Add additional context based on error type
        match &error {
            Error::Http {
                status,
                status_text,
                body,
            } => {
                let _ = js_sys::Reflect::set(&obj, &"status".into(), &(*status as f64).into());
                let _ = js_sys::Reflect::set(&obj, &"statusText".into(), &status_text.into());
                if let Some(body) = body {
                    let _ = js_sys::Reflect::set(&obj, &"body".into(), &body.into());
                }
            }
            Error::Timeout { duration_ms } => {
                let _ =
                    js_sys::Reflect::set(&obj, &"timeoutMs".into(), &(*duration_ms as f64).into());
            }
            Error::InvalidInput { parameter, .. } => {
                let _ = js_sys::Reflect::set(&obj, &"parameter".into(), &parameter.into());
            }
            _ => {}
        }
        if let Some(limit) = error.response_too_large() {
            #[allow(clippy::cast_precision_loss)]
            let _ = js_sys::Reflect::set(&obj, &"maxResponseBytes".into(), &(limit as f64).into());
        }
        if let Some((option, limit)) = error.full_queue() {
            #[allow(clippy::cast_precision_loss)]
            let _ = js_sys::Reflect::set(&obj, &option.into(), &(limit as f64).into());
        }
        if let Some(limit) = error.event_too_large_limit() {
            #[allow(clippy::cast_precision_loss)]
            let _ = js_sys::Reflect::set(&obj, &"maxEventBytes".into(), &(limit as f64).into());
        }
        if let Some(limit) = error.line_too_long() {
            #[allow(clippy::cast_precision_loss)]
            let _ = js_sys::Reflect::set(&obj, &"maxLineBytes".into(), &(limit as f64).into());
        }
        if let Some(limit) = error.too_many_pending_requests() {
            #[allow(clippy::cast_precision_loss)]
            let _ =
                js_sys::Reflect::set(&obj, &"maxPendingRequests".into(), &(limit as f64).into());
        }

        obj.into()
    }
}

/// Convert from serde_wasm_bindgen errors
impl From<serde_wasm_bindgen::Error> for Error {
    fn from(err: serde_wasm_bindgen::Error) -> Self {
        Error::JsInterop {
            message: format!("JavaScript serialization error: {}", err),
        }
    }
}

/// Convert from JsValue for error propagation
impl From<JsValue> for Error {
    fn from(value: JsValue) -> Self {
        Error::JsInterop {
            message: format!("JavaScript error: {:?}", value),
        }
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests;
