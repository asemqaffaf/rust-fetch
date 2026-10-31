/* @ts-self-types="./rust_fetch.d.ts" */

/**
 * A Server-Sent Events stream created by `WasmClient.events()`; also an async iterator of events
 */
export class EventStream {
    static __wrap(ptr) {
        const obj = Object.create(EventStream.prototype);
        obj.__wbg_ptr = ptr;
        EventStreamFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EventStreamFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_eventstream_free(ptr, 0);
    }
    /**
     * Close the stream and stop reconnecting
     */
    close() {
        wasm.eventstream_close(this.__wbg_ptr);
    }
    /**
     * Resolves once the stream is closed for good
     * @returns {Promise<void>}
     */
    get closed() {
        const ret = wasm.eventstream_closed(this.__wbg_ptr);
        return ret;
    }
    /**
     * The last event ID received, sent as `Last-Event-ID` when reconnecting
     * @returns {string}
     */
    get lastEventId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.eventstream_last_event_id(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The next buffered event (async iterator protocol)
     * @returns {Promise<IteratorResult<ServerSentEvent>>}
     */
    next() {
        const ret = wasm.eventstream_next(this.__wbg_ptr);
        return ret;
    }
    /**
     * Resolves when the first connection opens; rejects if it never does
     * @returns {Promise<void>}
     */
    get opened() {
        const ret = wasm.eventstream_opened(this.__wbg_ptr);
        return ret;
    }
    /**
     * Stop iterating: closes the stream (async iterator protocol, e.g. `break`)
     * @returns {Promise<IteratorResult<ServerSentEvent>>}
     */
    return() {
        const ret = wasm.eventstream_return(this.__wbg_ptr);
        return ret;
    }
    /**
     * `connecting`, `open`, `reconnecting` or `closed`
     * @returns {EventStreamState}
     */
    get state() {
        const ret = wasm.eventstream_state(this.__wbg_ptr);
        return ret;
    }
    /**
     * The stream's URL, resolved against the client's base URL
     * @returns {string}
     */
    get url() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.eventstream_url(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) EventStream.prototype[Symbol.dispose] = EventStream.prototype.free;

export class IntoUnderlyingByteSource {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IntoUnderlyingByteSourceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_intounderlyingbytesource_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get autoAllocateChunkSize() {
        const ret = wasm.intounderlyingbytesource_autoAllocateChunkSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    cancel() {
        const ptr = this.__destroy_into_raw();
        wasm.intounderlyingbytesource_cancel(ptr);
    }
    /**
     * @param {ReadableByteStreamController} controller
     * @returns {Promise<any>}
     */
    pull(controller) {
        const ret = wasm.intounderlyingbytesource_pull(this.__wbg_ptr, controller);
        return ret;
    }
    /**
     * @param {ReadableByteStreamController} controller
     */
    start(controller) {
        wasm.intounderlyingbytesource_start(this.__wbg_ptr, controller);
    }
    /**
     * @returns {ReadableStreamType}
     */
    get type() {
        const ret = wasm.intounderlyingbytesource_type(this.__wbg_ptr);
        return __wbindgen_enum_ReadableStreamType[ret];
    }
}
if (Symbol.dispose) IntoUnderlyingByteSource.prototype[Symbol.dispose] = IntoUnderlyingByteSource.prototype.free;

export class IntoUnderlyingSink {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IntoUnderlyingSinkFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_intounderlyingsink_free(ptr, 0);
    }
    /**
     * @param {any} reason
     * @returns {Promise<any>}
     */
    abort(reason) {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.intounderlyingsink_abort(ptr, reason);
        return ret;
    }
    /**
     * @returns {Promise<any>}
     */
    close() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.intounderlyingsink_close(ptr);
        return ret;
    }
    /**
     * @param {any} chunk
     * @returns {Promise<any>}
     */
    write(chunk) {
        const ret = wasm.intounderlyingsink_write(this.__wbg_ptr, chunk);
        return ret;
    }
}
if (Symbol.dispose) IntoUnderlyingSink.prototype[Symbol.dispose] = IntoUnderlyingSink.prototype.free;

export class IntoUnderlyingSource {
    static __wrap(ptr) {
        const obj = Object.create(IntoUnderlyingSource.prototype);
        obj.__wbg_ptr = ptr;
        IntoUnderlyingSourceFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IntoUnderlyingSourceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_intounderlyingsource_free(ptr, 0);
    }
    cancel() {
        const ptr = this.__destroy_into_raw();
        wasm.intounderlyingsource_cancel(ptr);
    }
    /**
     * @param {ReadableStreamDefaultController} controller
     * @returns {Promise<any>}
     */
    pull(controller) {
        const ret = wasm.intounderlyingsource_pull(this.__wbg_ptr, controller);
        return ret;
    }
}
if (Symbol.dispose) IntoUnderlyingSource.prototype[Symbol.dispose] = IntoUnderlyingSource.prototype.free;

/**
 * HTTP client for JavaScript
 */
export class WasmClient {
    static __wrap(ptr) {
        const obj = Object.create(WasmClient.prototype);
        obj.__wbg_ptr = ptr;
        WasmClientFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmClientFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmclient_free(ptr, 0);
    }
    /**
     * Run `interceptor` on every request before it is sent; returns an id for `ejectInterceptor`
     * @param {RequestInterceptor} interceptor
     * @returns {number}
     */
    addRequestInterceptor(interceptor) {
        const ret = wasm.wasmclient_addRequestInterceptor(this.__wbg_ptr, interceptor);
        return ret >>> 0;
    }
    /**
     * Run handlers on every settled request, like `promise.then(onFulfilled, onRejected)`;
     * returns an id for `ejectInterceptor`
     * @param {ResponseFulfilledInterceptor | null} [on_fulfilled]
     * @param {ResponseRejectedInterceptor | null} [on_rejected]
     * @returns {number}
     */
    addResponseInterceptor(on_fulfilled, on_rejected) {
        const ret = wasm.wasmclient_addResponseInterceptor(this.__wbg_ptr, isLikeNone(on_fulfilled) ? 0 : addToExternrefTable0(on_fulfilled), isLikeNone(on_rejected) ? 0 : addToExternrefTable0(on_rejected));
        return ret >>> 0;
    }
    /**
     * Remove all interceptors
     */
    clearInterceptors() {
        wasm.wasmclient_clearInterceptors(this.__wbg_ptr);
    }
    /**
     * Make a DELETE request
     * @param {string} url
     * @param {RequestOptions | null} [options]
     * @returns {Promise<HttpResponse>}
     */
    delete(url, options) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_delete(this.__wbg_ptr, ptr0, len0, isLikeNone(options) ? 0 : addToExternrefTable0(options));
        return ret;
    }
    /**
     * Remove an interceptor; returns whether it was registered
     * @param {number} id
     * @returns {boolean}
     */
    ejectInterceptor(id) {
        const ret = wasm.wasmclient_ejectInterceptor(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * Open a Server-Sent Events stream. Relative URLs are resolved against the base URL.
     * @param {string} url
     * @param {EventStreamOptions | null} [options]
     * @returns {EventStream}
     */
    events(url, options) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_events(this.__wbg_ptr, ptr0, len0, isLikeNone(options) ? 0 : addToExternrefTable0(options));
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return EventStream.__wrap(ret[0]);
    }
    /**
     * Make a request described by a `fetch`-style init object
     * @param {string} url
     * @param {FetchInit | null} [init]
     * @returns {Promise<HttpResponse>}
     */
    fetch(url, init) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_fetch(this.__wbg_ptr, ptr0, len0, isLikeNone(init) ? 0 : addToExternrefTable0(init));
        return ret;
    }
    /**
     * Make a GET request
     * @param {string} url
     * @param {RequestOptions | null} [options]
     * @returns {Promise<HttpResponse>}
     */
    get(url, options) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_get(this.__wbg_ptr, ptr0, len0, isLikeNone(options) ? 0 : addToExternrefTable0(options));
        return ret;
    }
    /**
     * Make a HEAD request
     * @param {string} url
     * @param {RequestOptions | null} [options]
     * @returns {Promise<HttpResponse>}
     */
    head(url, options) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_head(this.__wbg_ptr, ptr0, len0, isLikeNone(options) ? 0 : addToExternrefTable0(options));
        return ret;
    }
    /**
     * Create a new client
     * @param {ClientOptions | null} [options]
     */
    constructor(options) {
        const ret = wasm.wasmclient_new(isLikeNone(options) ? 0 : addToExternrefTable0(options));
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmClientFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Make a PATCH request; the body is taken from `init.body`
     * @param {string} url
     * @param {FetchInit | null} [init]
     * @returns {Promise<HttpResponse>}
     */
    patch(url, init) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_patch(this.__wbg_ptr, ptr0, len0, isLikeNone(init) ? 0 : addToExternrefTable0(init));
        return ret;
    }
    /**
     * Make a PATCH request with a JSON body
     * @param {string} url
     * @param {any} body
     * @param {RequestOptions | null} [options]
     * @returns {Promise<HttpResponse>}
     */
    patch_json(url, body, options) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_patch_json(this.__wbg_ptr, ptr0, len0, body, isLikeNone(options) ? 0 : addToExternrefTable0(options));
        return ret;
    }
    /**
     * Make a POST request; the body is taken from `init.body`
     * @param {string} url
     * @param {FetchInit | null} [init]
     * @returns {Promise<HttpResponse>}
     */
    post(url, init) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_post(this.__wbg_ptr, ptr0, len0, isLikeNone(init) ? 0 : addToExternrefTable0(init));
        return ret;
    }
    /**
     * Make a POST request with a JSON body
     * @param {string} url
     * @param {any} body
     * @param {RequestOptions | null} [options]
     * @returns {Promise<HttpResponse>}
     */
    post_json(url, body, options) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_post_json(this.__wbg_ptr, ptr0, len0, body, isLikeNone(options) ? 0 : addToExternrefTable0(options));
        return ret;
    }
    /**
     * Make a PUT request; the body is taken from `init.body`
     * @param {string} url
     * @param {FetchInit | null} [init]
     * @returns {Promise<HttpResponse>}
     */
    put(url, init) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_put(this.__wbg_ptr, ptr0, len0, isLikeNone(init) ? 0 : addToExternrefTable0(init));
        return ret;
    }
    /**
     * Make a PUT request with a JSON body
     * @param {string} url
     * @param {any} body
     * @param {RequestOptions | null} [options]
     * @returns {Promise<HttpResponse>}
     */
    put_json(url, body, options) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_put_json(this.__wbg_ptr, ptr0, len0, body, isLikeNone(options) ? 0 : addToExternrefTable0(options));
        return ret;
    }
    /**
     * Make a request with any method, headers and body
     * @param {string} method
     * @param {string} url
     * @param {HeadersLike | null} [headers]
     * @param {RequestBody | null} [body]
     * @param {RequestOptions | null} [options]
     * @returns {Promise<HttpResponse>}
     */
    request(method, url, headers, body, options) {
        const ptr0 = passStringToWasm0(method, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_request(this.__wbg_ptr, ptr0, len0, ptr1, len1, isLikeNone(headers) ? 0 : addToExternrefTable0(headers), isLikeNone(body) ? 0 : addToExternrefTable0(body), isLikeNone(options) ? 0 : addToExternrefTable0(options));
        return ret;
    }
    /**
     * Retries the client's `retryBudget` has refused so far (0 without a budget)
     * @returns {number}
     */
    get retriesRefused() {
        const ret = wasm.wasmclient_retries_refused(this.__wbg_ptr);
        return ret;
    }
    /**
     * Open a WebSocket connection. Relative URLs are resolved against the
     * base URL, with `http:` and `https:` becoming `ws:` and `wss:`.
     * @param {string} url
     * @param {WebSocketOptions | null} [options]
     * @returns {WebSocketConnection}
     */
    websocket(url, options) {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmclient_websocket(this.__wbg_ptr, ptr0, len0, isLikeNone(options) ? 0 : addToExternrefTable0(options));
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WebSocketConnection.__wrap(ret[0]);
    }
}
if (Symbol.dispose) WasmClient.prototype[Symbol.dispose] = WasmClient.prototype.free;

/**
 * A WebSocket connection created by `WasmClient.websocket()`
 */
export class WebSocketConnection {
    static __wrap(ptr) {
        const obj = Object.create(WebSocketConnection.prototype);
        obj.__wbg_ptr = ptr;
        WebSocketConnectionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WebSocketConnectionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_websocketconnection_free(ptr, 0);
    }
    /**
     * Bytes queued by the socket but not yet sent
     * @returns {number}
     */
    get bufferedAmount() {
        const ret = wasm.websocketconnection_buffered_amount(this.__wbg_ptr);
        return ret;
    }
    /**
     * Close the connection and stop reconnecting. `code` is 1000 (the
     * default) or 3000-4999; `reason` is at most 123 bytes of UTF-8.
     * @param {number | null} [code]
     * @param {string | null} [reason]
     */
    close(code, reason) {
        var ptr0 = isLikeNone(reason) ? 0 : passStringToWasm0(reason, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.websocketconnection_close(this.__wbg_ptr, isLikeNone(code) ? 0xFFFFFF : code, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Resolves with the close code and reason once the connection is closed for good
     * @returns {Promise<WebSocketCloseInfo>}
     */
    get closed() {
        const ret = wasm.websocketconnection_closed(this.__wbg_ptr);
        return ret;
    }
    /**
     * Resolves when the first connection opens; rejects if it never does
     * @returns {Promise<void>}
     */
    get opened() {
        const ret = wasm.websocketconnection_opened(this.__wbg_ptr);
        return ret;
    }
    /**
     * The subprotocol the server selected, or `""`
     * @returns {string}
     */
    get protocol() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.websocketconnection_protocol(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Send a value as JSON text
     * @param {any} value
     */
    sendJson(value) {
        const ret = wasm.websocketconnection_sendJson(this.__wbg_ptr, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Send a message. Before the connection opens (or while reconnecting),
     * messages are queued and sent once it does.
     * @param {WebSocketData} data
     */
    send(data) {
        const ret = wasm.websocketconnection_send(this.__wbg_ptr, data);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * `connecting`, `open`, `reconnecting`, `closing` or `closed`
     * @returns {WebSocketState}
     */
    get state() {
        const ret = wasm.websocketconnection_state(this.__wbg_ptr);
        return ret;
    }
    /**
     * The connection URL (`ws:` or `wss:`)
     * @returns {string}
     */
    get url() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.websocketconnection_url(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WebSocketConnection.prototype[Symbol.dispose] = WebSocketConnection.prototype.free;

/**
 * Private adapter handshake, called synchronously by the Node entry point.
 * @param {Function} transport
 * @param {Function} websocket_guard
 */
export function __bindNodeTransport(transport, websocket_guard) {
    const ret = wasm.__bindNodeTransport(transport, websocket_guard);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * Create a configured HTTP client (exported for advanced use)
 * @returns {WasmClient}
 */
export function create_client() {
    const ret = wasm.create_client();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return WasmClient.__wrap(ret[0]);
}

/**
 * Fetch a URL and parse the body as JSON (whatever its Content-Type).
 * An empty body resolves to `null`.
 * @param {string} url
 * @returns {Promise<any>}
 */
export function fetch_json(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fetch_json(ptr0, len0);
    return ret;
}

/**
 * Fetch JSON data and return as a Promise
 * @param {string} url
 * @returns {Promise<any>}
 */
export function fetch_json_promise(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fetch_json_promise(ptr0, len0);
    return ret;
}

/**
 * Fetch a URL and return the body as text
 * @param {string} url
 * @returns {Promise<string>}
 */
export function fetch_text(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fetch_text(ptr0, len0);
    return ret;
}

/**
 * Fetch API data (deprecated, use fetch_json instead)
 * @param {string} url
 * @returns {Promise<any>}
 */
export function fetch_wasm_api(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fetch_wasm_api(ptr0, len0);
    return ret;
}

/**
 * Fetch HTML data (deprecated, use fetch_text instead)
 * @param {string} url
 * @returns {Promise<string>}
 */
export function fetch_wasm_html(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fetch_wasm_html(ptr0, len0);
    return ret;
}

/**
 * Fetch JSON data (deprecated, use fetch_json instead)
 * @param {string} url
 * @returns {Promise<any>}
 */
export function fetch_wasm_json(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fetch_wasm_json(ptr0, len0);
    return ret;
}

/**
 * Fetch data and return as map (deprecated, use fetch_json instead)
 * @param {string} url
 * @returns {Promise<any>}
 */
export function fetch_wasm_map(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fetch_wasm_map(ptr0, len0);
    return ret;
}

/**
 * Fetch with a method, headers and an optional string body.
 *
 * Resolves to `{ status, statusText, ok, url, headers, body }`.
 * @param {string} url
 * @param {string} method
 * @param {any} headers
 * @param {string | null} [body]
 * @returns {Promise<any>}
 */
export function fetch_with_options(url, method, headers, body) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(method, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(body) ? 0 : passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.fetch_with_options(ptr0, len0, ptr1, len1, headers, ptr2, len2);
    return ret;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_boolean_get_5b446f51afd21013: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_4687d8d8c2017d52: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_1f9d30630b8b1d3d: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_e343b7d08827ba72: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_3c45d4f2dde4e749: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_90b56bc79aad6f6c: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_8865fb403f8fe9d8: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_02babf21faa37971: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_2e0e7dee9f701a71: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_0380ccaa2f57f0d9: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_dcc1a90847f04c41: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_abort_d41cc73c8955bf84: function() { return handleError(function (arg0) {
            arg0.abort();
        }, arguments); },
        __wbg_abort_f78b99d80248bacb: function(arg0) {
            arg0.abort();
        },
        __wbg_aborted_5b2b5f06b5e59fde: function(arg0) {
            const ret = arg0.aborted;
            return ret;
        },
        __wbg_addEventListener_4d0db17c671ea324: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.addEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_append_1938ed58fb5613b8: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_append_1e9e3768bd52da3e: function(arg0, arg1, arg2, arg3, arg4) {
            arg0.append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        },
        __wbg_arrayBuffer_f07be74819944ea2: function() { return handleError(function (arg0) {
            const ret = arg0.arrayBuffer();
            return ret;
        }, arguments); },
        __wbg_assign_e39d243f5fbe1e2d: function(arg0, arg1) {
            const ret = Object.assign(arg0, arg1);
            return ret;
        },
        __wbg_body_4e088733babc630d: function(arg0) {
            const ret = arg0.body;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_buffer_56ec2905a66f58b9: function(arg0) {
            const ret = arg0.buffer;
            return ret;
        },
        __wbg_buffered_amount_cbeca036408e1ce3: function(arg0) {
            const ret = arg0.bufferedAmount;
            return ret;
        },
        __wbg_byobRequest_54f7ce41d584549a: function(arg0) {
            const ret = arg0.byobRequest;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_byteLength_27689b065d089962: function(arg0) {
            const ret = arg0.byteLength;
            return ret;
        },
        __wbg_byteLength_9f985b8373f1f3fe: function(arg0) {
            const ret = arg0.byteLength;
            return ret;
        },
        __wbg_byteOffset_0bd5a6a03553639c: function(arg0) {
            const ret = arg0.byteOffset;
            return ret;
        },
        __wbg_call_1875a20c43a36133: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_call_187d372bd5fdd4aa: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_6137034ef55c9d0f: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_cancel_3b323af6bb094e47: function(arg0) {
            const ret = arg0.cancel();
            return ret;
        },
        __wbg_cancel_7c2a08c8db4c73f3: function(arg0) {
            const ret = arg0.cancel();
            return ret;
        },
        __wbg_catch_92594c2d17f55f12: function(arg0, arg1) {
            const ret = arg0.catch(arg1);
            return ret;
        },
        __wbg_clearTimeout_4d1250271bbcde85: function(arg0) {
            clearTimeout(arg0);
        },
        __wbg_close_185286988f30f252: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_close_748f26698dabe269: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_close_bca57ed2bee685e8: function(arg0) {
            arg0.close();
        },
        __wbg_close_dd7b5faaa7cf9df7: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.close(arg1, getStringFromWasm0(arg2, arg3));
        }, arguments); },
        __wbg_construct_2cc135b78387ed16: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.construct(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_create_7febfb959f8c7046: function(arg0) {
            const ret = Object.create(arg0);
            return ret;
        },
        __wbg_decode_05218d3a3ad3672c: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.decode(arg1);
            return ret;
        }, arguments); },
        __wbg_defineProperty_800078cb475eea1b: function(arg0, arg1, arg2) {
            const ret = Object.defineProperty(arg0, arg1, arg2);
            return ret;
        },
        __wbg_done_b41a1d26cdb37fb6: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_enqueue_4a01c128f9a0de16: function() { return handleError(function (arg0, arg1) {
            arg0.enqueue(arg1);
        }, arguments); },
        __wbg_entries_fb6397112b1de25f: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_fetch_154bb2e06427be3a: function() { return handleError(function (arg0) {
            const ret = fetch(arg0);
            return ret;
        }, arguments); },
        __wbg_for_beb5dc4e908dd8b8: function(arg0, arg1) {
            const ret = Symbol.for(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_fromEntries_5159142be68954c3: function() { return handleError(function (arg0) {
            const ret = Object.fromEntries(arg0);
            return ret;
        }, arguments); },
        __wbg_from_296ca31f8d0f1c52: function(arg0) {
            const ret = Array.from(arg0);
            return ret;
        },
        __wbg_getAllResponseHeaders_537d007c37d53dba: function() { return handleError(function (arg0, arg1) {
            const ret = arg1.getAllResponseHeaders();
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getPrototypeOf_228a4abae6ef0509: function(arg0) {
            const ret = Object.getPrototypeOf(arg0);
            return ret;
        },
        __wbg_getReader_9facd4f899beac89: function() { return handleError(function (arg0) {
            const ret = arg0.getReader();
            return ret;
        }, arguments); },
        __wbg_get_31af05bd4842a84f: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_658f6698067d9515: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_6c896e0571ddae51: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_done_7020b91c987365c7: function(arg0) {
            const ret = arg0.done;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg_get_f75619e20cb68514: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg1.get(getStringFromWasm0(arg2, arg3));
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_get_unchecked_288889d017702237: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_value_87fbd6ad1283f2e7: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbg_hasOwn_5e07e23a451013c0: function(arg0, arg1) {
            const ret = Object.hasOwn(arg0, arg1);
            return ret;
        },
        __wbg_has_5d6706e5209576c1: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.has(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_headers_eba93595f8944c2f: function(arg0) {
            const ret = arg0.headers;
            return ret;
        },
        __wbg_host_bf79b73236067054: function(arg0, arg1) {
            const ret = arg1.host;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_href_221703ee1ed727fc: function(arg0, arg1) {
            const ret = arg1.href;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_instanceof_ArrayBuffer_a99f175873e5d9b8: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_ReadableStream_e2d77912575119ab: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ReadableStream;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_828cef2aaacafc31: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_e15a2ff68ffdbef2: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isPrototypeOf_59fbabb5a4f3f1ff: function(arg0, arg1) {
            const ret = arg0.isPrototypeOf(arg1);
            return ret;
        },
        __wbg_isView_87b70d94ddaa60d3: function(arg0) {
            const ret = ArrayBuffer.isView(arg0);
            return ret;
        },
        __wbg_iterator_e3c31c892080e444: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_keys_440be172f17c0265: function(arg0) {
            const ret = Object.keys(arg0);
            return ret;
        },
        __wbg_lengthComputable_0c360fba2e78c440: function(arg0) {
            const ret = arg0.lengthComputable;
            return ret;
        },
        __wbg_length_7f3c00c40364105e: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_d4bdea10311bd9cf: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_loaded_29f94ac40d975528: function(arg0) {
            const ret = arg0.loaded;
            return ret;
        },
        __wbg_new_1dbf7428bba60a42: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_2e41357094e99294: function() { return handleError(function () {
            const ret = new AbortController();
            return ret;
        }, arguments); },
        __wbg_new_343a093a3c2ffb4e: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_4ab3c437b555a8b1: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new WebSocket(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_new_5502aad30c185fc8: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___js_sys_becbaa0f305191ad___Function_fn_wasm_bindgen_e6efeab14c3ffd08___JsValue_____wasm_bindgen_e6efeab14c3ffd08___sys__Undefined___js_sys_becbaa0f305191ad___Function_fn_wasm_bindgen_e6efeab14c3ffd08___JsValue_____wasm_bindgen_e6efeab14c3ffd08___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_617a8cdb8bb1130e: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_820eb53f620ccf82: function() { return handleError(function (arg0, arg1) {
            const ret = new URL(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_new_83ca405eae412a62: function() { return handleError(function () {
            const ret = new Headers();
            return ret;
        }, arguments); },
        __wbg_new_8bc23f04f81496fa: function() {
            const ret = new TextDecoder();
            return ret;
        },
        __wbg_new_d1d1f48568532d74: function() { return handleError(function () {
            const ret = new XMLHttpRequest();
            return ret;
        }, arguments); },
        __wbg_new_ee2291f50781bf1d: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_from_slice_9a868026ffa4208a: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_b01cb72a8af741a3: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___js_sys_becbaa0f305191ad___Function_fn_wasm_bindgen_e6efeab14c3ffd08___JsValue_____wasm_bindgen_e6efeab14c3ffd08___sys__Undefined___js_sys_becbaa0f305191ad___Function_fn_wasm_bindgen_e6efeab14c3ffd08___JsValue_____wasm_bindgen_e6efeab14c3ffd08___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_base_29cdb449ce79d2d5: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = new URL(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
            return ret;
        }, arguments); },
        __wbg_new_with_byte_offset_and_length_2f5d7fc2a828b74d: function(arg0, arg1, arg2) {
            const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_new_with_into_underlying_source_fd904252f385f59c: function(arg0, arg1) {
            const ret = new ReadableStream(IntoUnderlyingSource.__wrap(arg0), arg1);
            return ret;
        },
        __wbg_new_with_length_3da0ad195f6f63ba: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_str_and_init_4618dee4e950224f: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_next_33784799010f1bbe: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_f4aac29c42af995c: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_now_18fa3d30d5c87624: function() { return handleError(function () {
            const ret = performance.now();
            return ret;
        }, arguments); },
        __wbg_now_aa4ccb83129e9e55: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_of_20798cb14708764f: function(arg0, arg1) {
            const ret = Array.of(arg0, arg1);
            return ret;
        },
        __wbg_of_d5dbecdc59e02e34: function(arg0) {
            const ret = Array.of(arg0);
            return ret;
        },
        __wbg_open_f0c8628338345808: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.open(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4), arg5 !== 0);
        }, arguments); },
        __wbg_parse_bd50677601adc467: function() { return handleError(function (arg0) {
            const ret = JSON.parse(arg0);
            return ret;
        }, arguments); },
        __wbg_protocol_2fe4c3a2a8ea9854: function(arg0, arg1) {
            const ret = arg1.protocol;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_protocol_31c333d9fb09b193: function(arg0, arg1) {
            const ret = arg1.protocol;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_prototypesetcall_bc27214492979395: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_2baf45db356cf468: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_9833f9a49df95a49: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_a72f977e97f23c5f: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_randomUUID_c6ffba5be5f48f50: function() { return handleError(function (arg0) {
            const ret = crypto.randomUUID();
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_random_5a4cafd2f02395ff: function() {
            const ret = Math.random();
            return ret;
        },
        __wbg_read_2a943774344c9728: function(arg0) {
            const ret = arg0.read();
            return ret;
        },
        __wbg_readyState_18517ecae25833be: function(arg0) {
            const ret = arg0.readyState;
            return ret;
        },
        __wbg_reject_1548d2ad77237dc9: function(arg0) {
            const ret = Promise.reject(arg0);
            return ret;
        },
        __wbg_releaseLock_eb64cd83aa9fcfe4: function(arg0) {
            arg0.releaseLock();
        },
        __wbg_removeEventListener_6e68185345978771: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.removeEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_resolve_0076e10020304ede: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_respond_c102fabcc79e5ef0: function() { return handleError(function (arg0, arg1) {
            arg0.respond(arg1 >>> 0);
        }, arguments); },
        __wbg_responseURL_ec5cfdd2025cc9f4: function(arg0, arg1) {
            const ret = arg1.responseURL;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_response_ce3feafb4716c448: function() { return handleError(function (arg0) {
            const ret = arg0.response;
            return ret;
        }, arguments); },
        __wbg_searchParams_8c7a3f0cc72c149d: function(arg0) {
            const ret = arg0.searchParams;
            return ret;
        },
        __wbg_send_27717f7429d15105: function() { return handleError(function (arg0, arg1) {
            arg0.send(arg1);
        }, arguments); },
        __wbg_send_9d00bd9d7a2c90b5: function() { return handleError(function (arg0) {
            arg0.send();
        }, arguments); },
        __wbg_send_defcfe42df8af5c8: function() { return handleError(function (arg0, arg1) {
            arg0.send(arg1);
        }, arguments); },
        __wbg_setRequestHeader_733b74e99bf9b791: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setRequestHeader(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_setTimeout_0d7f9638441e99e8: function(arg0, arg1) {
            const ret = setTimeout(arg0, arg1);
            return ret;
        },
        __wbg_set_145a351398b48c65: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_34d08fd992d43d61: function(arg0, arg1, arg2) {
            arg0.set(arg1, arg2 >>> 0);
        },
        __wbg_set_575d3ddb70fe831d: function(arg0, arg1, arg2) {
            arg0.set(getArrayU8FromWasm0(arg1, arg2));
        },
        __wbg_set_af5932e3f78b5648: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.set(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_set_binary_type_8ac45ccbbfd39afc: function(arg0, arg1, arg2) {
            arg0.binaryType = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_body_1fb0f1008bfc7df6: function(arg0, arg1) {
            arg0.body = arg1;
        },
        __wbg_set_headers_40ad33dcf016613f: function(arg0, arg1) {
            arg0.headers = arg1;
        },
        __wbg_set_high_water_mark_3a96edf83df7e06c: function(arg0, arg1) {
            arg0.highWaterMark = arg1;
        },
        __wbg_set_method_dcb32343247ec427: function(arg0, arg1, arg2) {
            arg0.method = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_name_2c630595dc90a7aa: function(arg0, arg1, arg2) {
            arg0.name = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_onclose_69c84f4298cf9985: function(arg0, arg1) {
            arg0.onclose = arg1;
        },
        __wbg_set_onerror_5f014019e4fa2820: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onerror_87068ea5915e21a6: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onload_2cbb4e46b9492f82: function(arg0, arg1) {
            arg0.onload = arg1;
        },
        __wbg_set_onmessage_d5291a55ad2e195f: function(arg0, arg1) {
            arg0.onmessage = arg1;
        },
        __wbg_set_onopen_77e5290f7cf69df5: function(arg0, arg1) {
            arg0.onopen = arg1;
        },
        __wbg_set_onprogress_6da9421890668006: function(arg0, arg1) {
            arg0.onprogress = arg1;
        },
        __wbg_set_onreadystatechange_4965f5b67e7d82f6: function(arg0, arg1) {
            arg0.onreadystatechange = arg1;
        },
        __wbg_set_protocol_ab812f704fa42988: function(arg0, arg1, arg2) {
            arg0.protocol = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_redirect_cc128ab2411da334: function(arg0, arg1) {
            arg0.redirect = __wbindgen_enum_RequestRedirect[arg1];
        },
        __wbg_set_responseType_1f631c1316f4c16e: function(arg0, arg1) {
            arg0.responseType = __wbindgen_enum_XmlHttpRequestResponseType[arg1];
        },
        __wbg_set_signal_2dbd377604627f26: function(arg0, arg1) {
            arg0.signal = arg1;
        },
        __wbg_set_withCredentials_370fcfa1299c89b2: function(arg0, arg1) {
            arg0.withCredentials = arg1 !== 0;
        },
        __wbg_signal_e5a49a2d9c65b7f6: function(arg0) {
            const ret = arg0.signal;
            return ret;
        },
        __wbg_slice_1083d97be26bd472: function(arg0, arg1, arg2) {
            const ret = arg0.slice(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_static_accessor_GLOBAL_266715b9d96ba635: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_10fb7dc1ae063179: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_0b583911f537483a: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_d7f903d1508cbdc4: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_status_734f92f48f0f8b78: function() { return handleError(function (arg0) {
            const ret = arg0.status;
            return ret;
        }, arguments); },
        __wbg_status_ce0a98d3c57125f3: function(arg0) {
            const ret = arg0.status;
            return ret;
        },
        __wbg_stringify_52ff602c1cc4fbb6: function() { return handleError(function (arg0) {
            const ret = JSON.stringify(arg0);
            return ret;
        }, arguments); },
        __wbg_then_c949d5a25a4e78f8: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_e71170d78fcf8954: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_toString_0a6162345e699dea: function(arg0) {
            const ret = arg0.toString();
            return ret;
        },
        __wbg_toString_aad181a510c306d8: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.toString(arg1);
            return ret;
        }, arguments); },
        __wbg_total_c37263de22b97fdd: function(arg0) {
            const ret = arg0.total;
            return ret;
        },
        __wbg_type_cab8c70e28a984c8: function(arg0) {
            const ret = arg0.type;
            return (__wbindgen_enum_ResponseType.indexOf(ret) + 1 || 7) - 1;
        },
        __wbg_upload_9fdbbcb96e9e681d: function() { return handleError(function (arg0) {
            const ret = arg0.upload;
            return ret;
        }, arguments); },
        __wbg_url_8e28edeab4cd6bed: function(arg0, arg1) {
            const ret = arg1.url;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_value_f3c585ee8f5ba40c: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbg_view_9c570f33e8d6ab96: function(arg0) {
            const ret = arg0.view;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 189, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___wasm_bindgen_e6efeab14c3ffd08___JsValue______true_);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 260, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___wasm_bindgen_e6efeab14c3ffd08___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_e6efeab14c3ffd08___JsError___true_);
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("ProgressEvent")], shim_idx: 6, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___web_sys_4e3cca8ece9fff4b___features__gen_ProgressEvent__ProgressEvent______true_);
            return ret;
        },
        __wbindgen_generic_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 181, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke_______true_);
            return ret;
        },
        __wbindgen_generic_0000000000000005: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000006: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./rust_fetch_bg.js": import0,
    };
}

function wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke_______true_(arg0, arg1) {
    wasm.wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke_______true_(arg0, arg1);
}

function wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___wasm_bindgen_e6efeab14c3ffd08___JsValue______true_(arg0, arg1, arg2) {
    wasm.wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___wasm_bindgen_e6efeab14c3ffd08___JsValue______true_(arg0, arg1, arg2);
}

function wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___web_sys_4e3cca8ece9fff4b___features__gen_ProgressEvent__ProgressEvent______true_(arg0, arg1, arg2) {
    wasm.wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___web_sys_4e3cca8ece9fff4b___features__gen_ProgressEvent__ProgressEvent______true_(arg0, arg1, arg2);
}

function wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___wasm_bindgen_e6efeab14c3ffd08___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_e6efeab14c3ffd08___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___wasm_bindgen_e6efeab14c3ffd08___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_e6efeab14c3ffd08___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___js_sys_becbaa0f305191ad___Function_fn_wasm_bindgen_e6efeab14c3ffd08___JsValue_____wasm_bindgen_e6efeab14c3ffd08___sys__Undefined___js_sys_becbaa0f305191ad___Function_fn_wasm_bindgen_e6efeab14c3ffd08___JsValue_____wasm_bindgen_e6efeab14c3ffd08___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_e6efeab14c3ffd08___convert__closures_____invoke___js_sys_becbaa0f305191ad___Function_fn_wasm_bindgen_e6efeab14c3ffd08___JsValue_____wasm_bindgen_e6efeab14c3ffd08___sys__Undefined___js_sys_becbaa0f305191ad___Function_fn_wasm_bindgen_e6efeab14c3ffd08___JsValue_____wasm_bindgen_e6efeab14c3ffd08___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_ReadableStreamType = ["bytes"];


const __wbindgen_enum_RequestRedirect = ["follow", "error", "manual"];


const __wbindgen_enum_ResponseType = ["basic", "cors", "default", "error", "opaque", "opaqueredirect"];


const __wbindgen_enum_XmlHttpRequestResponseType = ["", "arraybuffer", "blob", "document", "json", "text"];
const EventStreamFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_eventstream_free(ptr, 1));
const IntoUnderlyingByteSourceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intounderlyingbytesource_free(ptr, 1));
const IntoUnderlyingSinkFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intounderlyingsink_free(ptr, 1));
const IntoUnderlyingSourceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intounderlyingsource_free(ptr, 1));
const WasmClientFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmclient_free(ptr, 1));
const WebSocketConnectionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_websocketconnection_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('rust_fetch_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

// Added by scripts/postbuild.mjs
EventStream.prototype[Symbol.asyncIterator] = function () { return this; };

// Portable byte transport, appended to the generated browser/Node glue by
// postbuild. Retry decisions stay in Rust; an owner only opens a body source.
(() => {
  const ignore = () => {};
  const MAX_CHUNK = 64 * 1024;
  const usedSources = new WeakSet();
  let encoder;
  let supported;
  const invalid = (message) => Object.assign(new TypeError(message), {
    kind: 'InvalidInputError', parameter: 'body', code: 'RUST_FETCH_UPLOAD_INPUT',
  });
  const isSource = (value) => value != null &&
    (typeof value.getReader === 'function' || typeof value[Symbol.asyncIterator] === 'function');
  const bytes = (value) => {
    if (typeof value === 'string') return (encoder ??= new TextEncoder()).encode(value);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw invalid('A streaming request body must produce byte arrays or strings');
  };
  function cancel(record) {
    if (record.cancelled) return;
    record.cancelled = true;
    const finished = record.done;
    record.done = true;
    if (record.source && !record.claimed && !finished) {
      if (usedSources.has(record.source)) record.source = undefined;
      else usedSources.add(record.source);
    }
    try {
      if (record.reader && !finished) {
        const pending = record.web ? record.reader.cancel() : record.reader.return?.();
        Promise.resolve(pending).catch(ignore);
        if (record.web) record.reader.releaseLock();
      }
      if (!finished && !record.reader && typeof record.source?.cancel === 'function') Promise.resolve(record.source.cancel()).catch(ignore);
      if (!finished) record.source?.destroy?.(); // Node Readable: interrupt a pending read too.
    } catch { /* Cancellation preserves the request's original error. */ }
    record.pending = undefined;
  }
  function open(owner, progress, length) {
    if (length != null && (!/^(0|[1-9][0-9]*)$/.test(String(length)) || !Number.isSafeInteger(Number(length)))) throw invalid('Content-Length must be a nonnegative safe integer for a streaming body');
    const total = length == null ? 0 : Number(length);
    const expected = length == null ? undefined : total;
    let record = { loaded: 0, done: false, source: owner.factory ? undefined : owner.source };
    const report = (current) => {
      if (progress && !current.cancelled) try { progress({ loaded: current.loaded, total }); } catch {}
    };
    async function read() {
      const current = record;
      try {
        if (current.done) return { done: true };
        if (!current.reader) {
          const source = owner.factory ? await owner.factory() : owner.source;
          if (!isSource(source)) throw invalid('A body factory must return a ReadableStream or async iterable');
          if (usedSources.has(source)) throw invalid('A streaming request body can only be sent once; provide a body factory to replay it');
          usedSources.add(source);
          owner.used = true;
          current.claimed = true;
          current.source = source;
          current.web = typeof source.getReader === 'function';
          if (current.web && source.locked) throw invalid('The streaming body is already locked');
          current.reader = current.web ? source.getReader() : source[Symbol.asyncIterator]();
          if (current.done) { current.done = false; current.cancelled = false; cancel(current); return { done: true }; }
        }
        let data = current.pending;
        while (!data?.byteLength) {
          const step = await (current.web ? current.reader.read() : current.reader.next());
          if (current.done) return { done: true };
          if (step.done) {
            if (expected !== undefined && current.loaded !== expected) throw invalid('Streaming body length does not match Content-Length');
            current.done = true;
            if (current.web) current.reader.releaseLock();
            return { done: true };
          }
          data = bytes(step.value);
        }
        let chunk = data.subarray(0, MAX_CHUNK);
        current.pending = data.byteLength > MAX_CHUNK ? data.subarray(MAX_CHUNK) : undefined;
        if (expected !== undefined && current.loaded + chunk.byteLength > expected) throw invalid('Streaming body exceeds Content-Length');
        current.loaded += chunk.byteLength;
        if (expected !== undefined && current.loaded === expected) {
          if (current.pending?.byteLength) throw invalid('Streaming body exceeds Content-Length');
          chunk = chunk.slice();
          for (;;) {
            const step = await (current.web ? current.reader.read() : current.reader.next());
            if (current.cancelled) return { done: true };
            if (step.done) break;
            if (bytes(step.value).byteLength) throw invalid('Streaming body exceeds Content-Length');
          }
          current.done = true;
          if (current.web) current.reader.releaseLock();
        }
        return { done: false, data: chunk, end: current.done };
      } catch (cause) {
        const cancelled = current.cancelled;
        cancel(current);
        if (cancelled) return { done: true };
        return current.failure = { done: true, error: cause?.message ?? String(cause), invalidInput: cause?.code === 'RUST_FETCH_UPLOAD_INPUT', cause };
      }
    }
    const session = {
      next: read,
      failure: () => record.failure,
      cancel: () => cancel(record),
      async nativeNext() {
        const step = await read();
        if (step.data) {
          // Native code consumes the result on another thread. Own a copy
          // rather than racing a producer that reuses its original buffer.
          step.data = step.data.slice();
        }
        return step;
      },
      report: (loaded) => { if (progress && !record.cancelled) try { progress({ loaded, total }); } catch {} },
      readable() {
        return new ReadableStream({
          async pull(controller) {
            const current = record;
            const step = await read();
            if (current.cancelled && step.error === undefined) return;
            if (step.error !== undefined) controller.error(Object.assign(new Error(step.error), {
              code: step.invalidInput ? 'RUST_FETCH_UPLOAD_INPUT' : 'RUST_FETCH_UPLOAD_ERROR', cause: step.cause,
            }));
            else if (step.done) controller.close();
            else { controller.enqueue(step.data); report(current); }
          },
          cancel: () => cancel(record),
        }, { highWaterMark: 0 });
      },
    };
    if (owner.factory) session.restart = () => { cancel(record); record = { loaded: 0, done: false }; };
    return session;
  }
  function create(source) {
    const factory = typeof source === 'function' ? source : undefined;
    if (!factory && !isSource(source)) return undefined;
    const owner = { source, factory, used: false };
    const result = {
      replayable: !!factory,
      open: (progress, length) => open(owner, progress ?? result.progress, length),
      cancel: () => { if (!owner.used && !factory) cancel({ source, done: false }); },
    };
    return result;
  }
  create.supported = () => {
    if (supported !== undefined) return supported;
    let duplex = false;
    try {
      const request = new Request('https://rust-fetch.invalid/', {
        method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }),
        get duplex() { duplex = true; return 'half'; },
      });
      supported = duplex && !request.headers.has('Content-Type');
    } catch { supported = false; }
    return supported;
  };
  globalThis[Symbol.for('rust-fetch.upload')] = create;
})();
// Per-module instrumentation. Retry, admission and timeout policy stay in Rust.
let nodeDiagnostics;
export function __setNodeDiagnostics(snapshot) { nodeDiagnostics = snapshot; }
(() => {
  const Original = WasmClient, states = new WeakMap(), now = () => performance.now();
  const own = (o, k) => o != null && Object.hasOwn(Object(o), k) ? o[k] : undefined;
  const prop = (o, k) => { try { return o?.[k]; } catch {} };
  const option = (o, k) => o != null && Object.getPrototypeOf(o) !== Object.prototype ? prop(o, k) : own(o, k);
  const copy = (o) => ({ __proto__: Object.getPrototypeOf(o ?? {}), ...o });
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const call = (fn, value) => { try { fn?.(value)?.catch?.(() => {}); } catch {} };
  const origin = (value) => { try { return new URL(value).origin; } catch { return ''; } };
  const safeUrl = (value, redact) => {
    try { const u = new URL(value); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return redact ? String(redact(u.href)) : u.href; }
    catch { return '[invalid URL]'; }
  };
  function safeHeaders(value, names) {
    const result = Object.create(null);
    if (value == null) return result;
    try {
      // Iterate pairs directly so arrays redact by header name.
      const entries = typeof value[Symbol.iterator] === 'function' ? value : Object.entries(value);
      for (const pair of entries) {
        if (!Array.isArray(pair)) continue;
        const [key, v] = pair;
        if (typeof key !== 'string' || v == null) continue;
        const name = key.toLowerCase();
        if (names === null || names.has(name)) result[name] = '[REDACTED]';
        else if (['string', 'number', 'boolean'].includes(typeof v)) result[name] = ['location', 'referer'].includes(name) ? safeUrl(v) : String(v);
      }
    } catch { return Object.create(null); } // The core validates malformed headers.
    return result;
  }
  const metrics = () => ({ started: 0, completed: 0, failed: 0, active: 0, attempts: 0, retries: 0, samples: [], next: 0, count: 0, sum: 0, min: Infinity, max: 0, origins: new Map() });
  const diagnosticOptions = ['onRequestStart', 'onRequestEnd', 'redactUrl', 'traceContext', 'timings', 'metrics', 'propagateTrace', 'debug', 'traceOrigins'];
  function stateFor(options) {
    const debug = typeof process !== 'undefined' && /(?:^|,)(?:rust-fetch\*?|\*)(?:,|$)/.test(process.env?.DEBUG ?? '');
    if (!debug && !diagnosticOptions.some((name) => options != null && Object.hasOwn(Object(options), name))) {
      return { config: { enabled: false, debug: false }, options: {} };
    }
    return configure(options);
  }
  function configure(options = {}) {
    const c = {};
    for (const key of ['onRequestStart', 'onRequestEnd', 'redactUrl', 'traceContext']) {
      c[key] = own(options, key);
      if (c[key] != null && typeof c[key] !== 'function') throw invalid(key, 'must be a function');
    }
    for (const key of ['timings', 'metrics', 'propagateTrace']) {
      const v = own(options, key);
      if (v != null && typeof v !== 'boolean') throw invalid(key, 'must be a boolean');
      c[key] = v === true;
    }
    c.debug = own(options, 'debug');
    if (c.debug != null && typeof c.debug !== 'boolean' && typeof c.debug !== 'function') throw invalid('debug', 'must be a boolean or function');
    if (c.debug == null && typeof process !== 'undefined') c.debug = /(?:^|,)(?:rust-fetch\*?|\*)(?:,|$)/.test(process.env?.DEBUG ?? '');
    c.traceOrigins = new Set();
    const origins = own(options, 'traceOrigins');
    if (origins != null) {
      if (!Array.isArray(origins)) throw invalid('traceOrigins', 'must be an array of HTTP origins');
      for (const value of origins) {
        try { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw 0; c.traceOrigins.add(u.origin); }
        catch { throw invalid('traceOrigins', 'must contain only HTTP origins'); }
      }
    }
    if (c.propagateTrace && (!c.traceOrigins.size || !c.traceContext)) throw invalid('propagateTrace', 'requires traceOrigins and traceContext');
    c.enabled = !!(c.timings || c.metrics || c.debug || c.onRequestStart || c.onRequestEnd || c.propagateTrace);
    return { config: c, options: {}, metrics: c.metrics ? metrics() : undefined };
  }
  const log = (c, e) => call(c.debug === true ? (v) => console.debug('[rust-fetch]', v) : typeof c.debug === 'function' ? c.debug : undefined, e);
  function trace(c) {
    const ctx = c.traceContext();
    if (ctx == null) return undefined;
    const parent = own(ctx, 'traceparent'), state = own(ctx, 'tracestate');
    if (typeof parent !== 'string' || !/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(parent) || parent.startsWith('ff-') || /^..-0{32}-/.test(parent) || /^..-[0-9a-f]{32}-0{16}-/.test(parent)) throw invalid('traceContext', 'invalid traceparent');
    if (state != null) {
      if (typeof state !== 'string' || state.length > 512 || state.split(',').length > 32) throw invalid('traceContext', 'invalid tracestate');
      const seen = new Set();
      for (const member of state.split(',')) {
        const [key, ...rest] = member.trim().split('='), value = rest.join('=');
        if (!/^(?:[a-z][a-z0-9_*/-]{0,255}|[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13})$/.test(key) || !value || /[^\x20-\x7e]|[,=]/.test(value) || seen.has(key)) throw invalid('traceContext', 'invalid tracestate');
        seen.add(key);
      }
    }
    return state == null ? { traceparent: parent } : { traceparent: parent, tracestate: state };
  }
  function resolve(options, value, params) {
    const base = own(options, 'baseUrl');
    if (base && typeof value === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(value)) value = !value || /^[?#]/.test(value) ? base + value : base.replace(/\/+$/, '') + '/' + value.replace(/^\/+/, '');
    try {
      const u = new URL(value, typeof location !== 'undefined' ? location.href : undefined);
      if (params) for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) if (x != null) u.searchParams.append(k, String(x));
      return u.href;
    } catch { return String(value); }
  }
  function context(error, method, url, attempts, redact) {
    if (error && typeof error === 'object') {
      try { error.method ??= method; error.url ??= url; error.attempts ??= attempts; if (redact) { try { error.url = String(redact(error.url)); } catch { error.url = safeUrl(error.url); } } } catch {}
    }
    return error;
  }
  function request(state, name, raw, client, args) {
    const c = state.config;
    const index = name === 'request' ? 4 : name.endsWith('_json') ? 2 : 1;
    let method = name === 'request' ? args[0] : name === 'fetch' ? own(args[1], 'method') ?? 'GET' : name.replace('_json', '').toUpperCase();
    const inputUrl = args[name === 'request' ? 1 : 0], input = args[index];
    const streaming = ['stream', 'ndjson'].includes(own(input, 'responseType'));
    if (!c.enabled && !streaming) {
      const promise = raw.apply(client, args);
      return c.redactUrl ? promise.catch((e) => { throw context(e, method, inputUrl, 0, c.redactUrl); }) : promise;
    }
    const options = input && typeof input === 'object' ? copy(input) : input == null ? {} : input;
    let url = resolve(state.options, inputUrl, own(options, 'params'));
    const start = now(), timings = { queuedMs: 0, retryDelayMs: 0, attempts: [], totalMs: 0 };
    let queue, last, ended = false, cause;
    const summary = (type, extra = {}) => ({ type, method: typeof method === 'string' && /^[A-Za-z]{1,16}$/.test(method) ? method.toUpperCase() : 'UNKNOWN', url: safeUrl(url, c.redactUrl), ...extra });
    const requested = option(options, 'sensitiveHeaders');
    const sensitive = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie', ...(state.options.sensitiveHeaders ?? []), ...(Array.isArray(requested) ? requested.filter((n) => typeof n === 'string') : [])].map((n) => n.toLowerCase()));
    const hideAllHeaders = requested != null && (!Array.isArray(requested) || requested.some((n) => typeof n !== 'string'));
    const m = state.metrics;
    let bucket;
    if (m) {
      m.started++; m.active++;
      const key = origin(url);
      if (!m.origins.has(key) && m.origins.size < 128) m.origins.set(key, { started: 0, completed: 0, failed: 0, active: 0 });
      bucket = m.origins.get(key); if (bucket) { bucket.started++; bucket.active++; }
    }
    call(c.onRequestStart, summary('requestStart'));
    log(c, summary('request', { headers: { ...safeHeaders(state.options.headers, hideAllHeaders ? null : sensitive), ...safeHeaders(name === 'request' ? args[2] : undefined, hideAllHeaders ? null : sensitive), ...safeHeaders(option(options, 'headers'), hideAllHeaders ? null : sensitive) } }));
    const observe = (type, value) => {
      if (ended) return;
      const t = now();
      if (type === 'method') method = value;
      else if (type === 'resolved') { url = value; log(c, summary('resolved')); }
      else if (type === 'queueStart' || type === 'transportQueued') queue = t;
      else if (type === 'transportStart') { if (queue != null) timings.queuedMs += t - queue; queue = undefined; }
      else if (type === 'attemptStart') {
        cause = undefined;
        if (queue != null) timings.queuedMs += t - queue; queue = undefined;
        last = { startMs: t - start, ttfbMs: null, totalMs: 0 }; timings.attempts.push(last);
        log(c, summary(type, { attempt: timings.attempts.length }));
      } else if (type === 'headers' && last) {
        last.ttfbMs = t - start - last.startMs; if (value) { last.status = value.status; if (value.url) url = value.url; }
      } else if (type === 'attemptEnd' && last) {
        last.totalMs = t - start - last.startMs;
        if (typeof value === 'number') last.status = value;
        if (typeof value === 'string') last.error = value;
        log(c, summary(type, { attempt: timings.attempts.length, status: last.status, error: last.error ? { kind: last.error } : undefined, totalMs: last.totalMs }));
      } else if (type === 'retry') { timings.retryDelayMs += value.delayMs; log(c, summary(type, value)); }
      else if (type === 'cause') cause = value;
      else if (type === 'transport' && last) last.transport = value;
      else if (type === 'connection' && last) Object.assign(last, value);
      else if (type === 'redirect') log(c, summary(type, { status: value.status, location: safeUrl(value.url, c.redactUrl) }));
    };
    if (options && typeof options === 'object') {
      options.__observe = observe;
      if (c.propagateTrace) options.__trace = (target) => c.traceOrigins.has(origin(target)) ? trace(c) : undefined;
      args[index] = options;
    }
    const end = (response, error, failed = false) => {
      if (ended) return; ended = true;
      timings.totalMs = now() - start;
      if (streaming && last) last.totalMs = timings.totalMs - last.startMs;
      if (last && response) last.status = response.status;
      if (last && failed && !last.error) last.error = error?.kind;
      if (failed) {
        context(error, method, url, timings.attempts.length, c.redactUrl);
        try { if (cause && error && typeof error === 'object' && cause !== error && error.cause === undefined) error.cause = cause; } catch {}
      }
      const target = failed ? error : response;
      if ((c.timings || c.onRequestEnd || c.debug) && target && typeof target === 'object') { try { target.timings = timings; } catch {} }
      if (m) {
        m.active--; m.completed++; m.failed += Number(failed); m.attempts += timings.attempts.length; m.retries += Math.max(0, timings.attempts.length - 1);
        m.samples[m.next++ % 1024] = timings.totalMs; m.count++; m.sum += timings.totalMs; m.min = Math.min(m.min, timings.totalMs); m.max = Math.max(m.max, timings.totalMs);
        if (bucket) { bucket.active--; bucket.completed++; bucket.failed += Number(failed); }
      }
      const entry = summary('requestEnd', { status: response?.status ?? error?.status, error: failed ? { kind: ['NetworkError','HttpError','TimeoutError','ParseError','InvalidInputError','CancelledError','CircuitOpenError','JsInteropError'].includes(error?.kind) ? error.kind : undefined, status: typeof error?.status === 'number' ? error.status : undefined, phase: ['connect','response','idle','total'].includes(error?.phase) ? error.phase : undefined } : undefined, timings });
      call(c.onRequestEnd, entry); log(c, entry);
    };
    let pending;
    try { pending = raw.apply(client, args); } catch (e) { end(undefined, e, true); throw e; }
    return pending.then((response) => {
      url = response.url || url;
      if (response.body instanceof ReadableStream) {
        const reader = response.body.getReader(); response.timings = timings;
        response.body = new ReadableStream({
          async pull(controller) {
            try { const step = await reader.read(); if (step.done) { end(response); reader.releaseLock(); controller.close(); } else controller.enqueue(step.value); }
            catch (e) { end(undefined, e, true); reader.releaseLock(); controller.error(e); }
          },
          async cancel(reason) { try { await reader.cancel(reason); } finally { end(response); reader.releaseLock(); } },
        }, { highWaterMark: 0 });
      } else end(response);
      return response;
    }, (e) => { end(undefined, e, true); throw e; });
  }
  class ObservableClient extends Original {
    constructor(options) {
      const state = stateFor(options);
      super(options);
      // Match the core's configuration snapshot without retaining unknown
      // client options (which may contain large application objects).
      const sensitiveHeaders = option(options, 'sensitiveHeaders');
      state.options = {
        baseUrl: option(options, 'baseUrl'),
        headers: state.config.debug ? safeHeaders(option(options, 'headers'), new Set()) : undefined,
        sensitiveHeaders: Array.isArray(sensitiveHeaders) ? [...sensitiveHeaders] : undefined,
      };
      states.set(this, state);
    }
    stats() {
      let state = states.get(this); if (!state) { state = stateFor(); states.set(this, state); }
      state.metrics ??= metrics(); state.config.enabled = true;
      const m = state.metrics, samples = [...m.samples].sort((a, b) => a - b);
      const p = (n) => samples.length ? samples[Math.min(samples.length - 1, Math.ceil(n * samples.length) - 1)] : null;
      return {
        requests: { started: m.started, completed: m.completed, failed: m.failed, active: m.active }, attempts: m.attempts, retries: m.retries,
        latency: { count: m.count, minMs: m.count ? m.min : null, maxMs: m.count ? m.max : null, meanMs: m.count ? m.sum / m.count : null, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), sampleCount: samples.length },
        origins: Object.fromEntries([...m.origins].map(([k, v]) => [k, { ...v }])), pools: nodeDiagnostics ? nodeDiagnostics() : null,
      };
    }
  }
  Object.defineProperty(ObservableClient, 'name', { value: 'WasmClient' });
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const raw = Original.prototype[name];
    const index = name === 'request' ? 4 : name.endsWith('_json') ? 2 : 1;
    ObservableClient.prototype[name] = function (...args) {
      let state = states.get(this);
      if (!state) { state = stateFor(); states.set(this, state); }
      // Keep no-options calls outside the large instrumentation function, so
      // the runtime needn't compile it for the first unobserved request.
      if (!state.config.enabled && !state.config.redactUrl && args.length <= index) return raw.apply(this, args);
      return request(state, name, raw, this, args);
    };
  }
  for (const name of ['events', 'websocket']) {
    const raw = Original.prototype[name];
    ObservableClient.prototype[name] = function (url, options) {
      const state = states.get(this) ?? stateFor(), c = state.config;
      let target = resolve(state.options, url, own(options, 'params'));
      if (name === 'websocket') target = target.replace(/^http(s?):/, 'ws$1:');
      const method = name === 'websocket' ? 'GET' : own(options, 'method') ?? 'GET';
      let attempts = 0;
      const init = copy(options);
      if (name === 'events' && c.propagateTrace) init.__trace = (target) => c.traceOrigins.has(origin(target)) ? trace(c) : undefined;
      for (const hook of ['onOpen', 'onError', 'onClose', 'onReconnect']) {
        const app = prop(init, hook);
        if (app != null && typeof app !== 'function') continue;
        Object.defineProperty(init, hook, { value: (event) => {
          if (hook === 'onReconnect') attempts++;
          if (hook === 'onError') context(event, method, target, Math.max(1, attempts), c.redactUrl);
          log(c, { type: name + ':' + hook.slice(2).toLowerCase(), method, url: safeUrl(target, c.redactUrl), error: hook === 'onError' ? { kind: event?.kind } : undefined });
          return app?.(event);
        }, enumerable: true });
      }
      try {
        const connection = raw.call(this, url, init);
        if (name === 'websocket') {
          target = connection.url;
          for (const methodName of ['send', 'sendJson', 'close']) {
            const method = connection[methodName].bind(connection);
            connection[methodName] = (...args) => {
              try { return method(...args); }
              catch (error) { throw context(error, 'GET', target, Math.max(1, attempts), c.redactUrl); }
            };
          }
        }
        attempts = 1;
        const opened = connection.opened.catch((e) => { throw context(e, method, target, Math.max(1, attempts), c.redactUrl); });
        opened.catch(() => {});
        Object.defineProperty(connection, 'opened', { value: opened, configurable: true });
        if (name === 'events') { const next = connection.next.bind(connection); connection.next = (...args) => next(...args).catch((e) => { throw context(e, method, target, Math.max(1, attempts), c.redactUrl); }); }
        return connection;
      } catch (e) { throw context(e, method, target, attempts, c.redactUrl); }
    };
  }
  WasmClient = ObservableClient;
  // Keep the convenience exports on the same contextual-error path as clients.
  fetch_json = (url) => new WasmClient().get(url, { responseType: 'json' }).then((response) => response.body);
  fetch_json_promise = fetch_json;
  fetch_text = (url) => new WasmClient().get(url, { responseType: 'text' }).then((response) => response.body);
  fetch_with_options = (url, method, headers, body) => new WasmClient().request(method, url, headers, body ?? undefined);
  fetch_wasm_json = fetch_json;
  fetch_wasm_map = fetch_json;
  fetch_wasm_api = fetch_json;
  fetch_wasm_html = fetch_text;
})();
