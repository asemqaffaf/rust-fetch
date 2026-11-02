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
pub(crate) mod transport;
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
use wasm_bindgen_futures::future_to_promise;

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

        if let Some(options) = options {
            let options: &JsValue = options.as_ref();
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
            if let Some(redirect) = prop(options, "redirect") {
                builder = builder.redirect(parse_redirect(&redirect)?);
            }
            if let Some(max) = prop(options, "maxRedirects") {
                builder = builder.max_redirects(parse_max_redirects(&max)?);
            }
            #[cfg(target_arch = "wasm32")]
            {
                builder = builder.fetch_options(parse_fetch_options(options, None)?);
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
            Err(error) => rejected(error),
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
            Err(error) => rejected(error),
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
        // Snapshot, so interceptors added while a request is in flight don't affect it
        let (request_interceptors, response_interceptors) = {
            let interceptors = self.interceptors.borrow();
            (interceptors.request.clone(), interceptors.response.clone())
        };
        future_to_promise(async move {
            let result = async {
                let mut request = JsRequest::new(method, url, &headers, body, &options)?;
                for (_, interceptor) in &request_interceptors {
                    request = request.intercept(interceptor).await?;
                }
                send(&client, request, &options)
                    .await
                    .map_err(JsValue::from)
            }
            .await;

            let mut result = result;
            for (_, on_fulfilled, on_rejected) in &response_interceptors {
                result = match (result, on_fulfilled, on_rejected) {
                    (Ok(response), Some(handler), _) => call_async(handler, &response).await,
                    (Err(error), _, Some(handler)) => call_async(handler, &error).await,
                    (unhandled, _, _) => unhandled,
                };
            }
            result
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
        // An interceptor may return a new object without a body: the prototype
        // chain of a plain one must not supply it
        let body = try_raw_prop(&info, "body")?;
        Ok(Self {
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

/// Build, send and convert a request coming from JavaScript
pub(crate) async fn send(
    client: &Client,
    request: JsRequest,
    options: &JsValue,
) -> Result<JsValue> {
    let (mut builder, body) = request_builder(client, request, options)?;
    let body_type = match prop(options, "responseType") {
        Some(value) => parse_body_type(&value)?,
        None => BodyType::Auto,
    };
    let signal = match prop(options, "signal") {
        Some(signal) if js_sys::Reflect::has(&signal, &"aborted".into()).unwrap_or(false) => {
            Some(signal.unchecked_into::<web_sys::AbortSignal>())
        }
        Some(_) => return Err(invalid("signal", "must be an AbortSignal")),
        None => None,
    };
    let progress = callback_option(options, "onDownloadProgress")?;
    if let Some(callback) = &progress {
        builder = with_progress(builder, callback.clone());
    }
    let upload_progress = callback_option(options, "onUploadProgress")?;
    if let Some(redirect) = prop(options, "redirect") {
        builder = builder.redirect(parse_redirect(&redirect)?);
    }
    if let Some(max) = prop(options, "maxRedirects") {
        builder = builder.max_redirects(parse_max_redirects(&max)?);
    }

    builder = apply_body(builder, body).await?;
    if let BodyType::Stream | BodyType::Ndjson = body_type {
        if upload_progress.is_some() {
            return Err(invalid(
                "onUploadProgress",
                "can't be combined with a streamed responseType ('stream' or 'ndjson')",
            ));
        }
        let response = abortable(signal.clone(), builder.send_streaming()).await?;
        if let BodyType::Ndjson = body_type {
            return ndjson_response_to_js(response, signal);
        }
        return streaming_response_to_js(response, signal);
    }
    #[cfg(target_arch = "wasm32")]
    {
        let callbacks = transport::ProgressCallbacks {
            upload: upload_progress,
            download: progress,
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
    options: &JsValue,
) -> Result<(RequestBuilder, BodyMode)> {
    let JsRequest {
        method,
        url,
        headers,
        body,
    } = request;
    let mut builder = client
        .request(method, &url)
        // Decode here rather than in Rust, so JSON is parsed by the JS engine
        .response_format(ResponseFormat::Binary)
        .headers(headers);

    if let Some(params) = prop(options, "params") {
        builder = builder.query(parse_params(&params)?);
    }
    if let Some(timeout) = prop(options, "timeoutMs") {
        builder = match parse_timeout(&timeout)? {
            Some(timeout) => builder.timeout(timeout),
            None => builder.no_timeout(),
        };
    }
    #[cfg(target_arch = "wasm32")]
    {
        builder.fetch_options = parse_fetch_options(options, builder.fetch_options.as_ref())?;
    }
    Ok((builder, body))
}

/// `BrowserRequestOptions`, validated and merged over the client's. Node.js
/// requests don't use them, so there they're only validated.
#[cfg(target_arch = "wasm32")]
fn parse_fetch_options(
    options: &JsValue,
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
    // Most requests set none of these: one Object.keys call instead of a
    // property lookup per option (each a call into JS, ~5% per request)
    let set_any = options.is_object()
        && js_sys::Object::keys(options.unchecked_ref::<js_sys::Object>())
            .iter()
            .any(|key| {
                key.as_string()
                    .is_some_and(|key| NAMES.contains(&key.as_str()))
            });
    if !set_any {
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
        if let Some(value) = prop(options, name) {
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
        if let Some(value) = prop(options, name) {
            if !value.is_string() {
                return Err(invalid(name, "must be a string"));
            }
            add(name, &value)?;
        }
    }
    if let Some(value) = prop(options, "keepalive") {
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
        if is_instance_of_global(&value, "ReadableStream") {
            return Err(invalid(
                "body",
                "ReadableStream bodies are not supported; send bytes, a Blob or FormData",
            ));
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
    let chunks = AbortableStream::new(response.into_stream(), signal).map(|chunk| {
        chunk
            .map(|bytes| js_sys::Uint8Array::from(bytes.as_slice()).into())
            .map_err(JsValue::from)
    });
    let stream = wasm_streams::ReadableStream::from_stream(chunks).into_raw();
    set(&obj, "body", &stream)?;
    Ok(obj.into())
}

/// A newline-delimited JSON response: `body` is a `ReadableStream` of parsed
/// values. A line that isn't JSON errors the stream with a `ParseError`.
fn ndjson_response_to_js(
    response: StreamingResponse,
    signal: Option<web_sys::AbortSignal>,
) -> Result<JsValue> {
    let obj = response_head_to_js(
        response.status,
        &response.status_text,
        &response.url,
        &response.headers,
    )?;
    let mut lines = crate::lines::Lines::new();
    // Each chunk, then a final None to flush a last line without a newline
    let chunks = AbortableStream::new(response.into_stream(), signal)
        .map(Some)
        .chain(futures_util::stream::once(async { None }));
    let parsed = chunks.flat_map(move |chunk| {
        let lines: Vec<std::result::Result<crate::lines::Line, Error>> = match chunk {
            Some(Ok(bytes)) => lines.feed(&bytes).into_iter().map(Ok).collect(),
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

fn parse_headers(value: &JsValue) -> Result<Headers> {
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
    match reqwest::Url::parse(&proxy) {
        Ok(url) if matches!(url.scheme(), "http" | "https") && url.has_host() => Ok(url.into()),
        _ => Err(invalid("proxy", reason)),
    }
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

thread_local! {
    static OBJECT_PROTOTYPE: JsValue = js_sys::Object::get_prototype_of(&js_sys::Object::new()).into();
}

/// Whether `value` is an object whose only prototype is `Object.prototype` (or
/// none). Options on such objects never come from the prototype chain, so
/// pollution of `Object.prototype` can't set them; objects with their own
/// prototype may inherit options deliberately.
fn is_plain_object(value: &JsValue) -> bool {
    let prototype: JsValue = js_sys::Object::get_prototype_of(value).into();
    prototype.is_null() || OBJECT_PROTOTYPE.with(|object| *object == prototype)
}

/// Read an option from an options object, treating `undefined` and `null` as
/// absent. On a plain object only its own properties count.
fn prop(target: &JsValue, name: &str) -> Option<JsValue> {
    if !target.is_object() {
        return None;
    }
    if is_plain_object(target)
        && !js_sys::Object::has_own(target.unchecked_ref::<js_sys::Object>(), &name.into())
    {
        return None;
    }
    js_sys::Reflect::get(target, &name.into())
        .ok()
        .filter(|v| !v.is_undefined() && !v.is_null())
}

/// Like `prop`, but `null` is a value (`undefined` when unset)
pub(crate) fn raw_prop(target: &JsValue, name: &str) -> JsValue {
    try_raw_prop(target, name).unwrap_or(JsValue::UNDEFINED)
}

/// `raw_prop`, passing on an exception thrown by a getter
fn try_raw_prop(target: &JsValue, name: &str) -> std::result::Result<JsValue, JsValue> {
    if !target.is_object()
        || (is_plain_object(target)
            && !js_sys::Object::has_own(target.unchecked_ref::<js_sys::Object>(), &name.into()))
    {
        return Ok(JsValue::UNDEFINED);
    }
    js_sys::Reflect::get(target, &name.into())
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
