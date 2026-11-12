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
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(method, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
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
        const val2 = +(isLikeNone(code) ? 0xFFFFFF : code);
        var ptr0 = isLikeNone(reason) ? 0 : passStringToWasm0(reason, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.websocketconnection_close(this.__wbg_ptr, val2, ptr0, len0);
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
    let ptr0, len0, ptr1, len1, ptr2, len2;
    try {
        ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(method, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = isLikeNone(body) ? 0 : passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.fetch_with_options(ptr0, len0, ptr1, len1, headers, ptr2, len2);
    return ret;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_208446807d0d1e30: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_boolean_get_4f1baf9a00be3c74: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_f249a2a76caa9a55: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_falsy_d864b623500ae65d: function(arg0) {
            const ret = !arg0;
            return ret;
        },
        __wbg___wbindgen_is_function_741ff2bb612836f5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_c22311b1cc228e3a: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_8b968c3ab8e96595: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_fc456fee5d3317de: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_38d7bfbe4cc84039: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_934b640d0889af78: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64((arg0 >>> 0) + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_7ce8eee7fd327545: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_09736879a3f67559: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_abort_968456626434218d: function() { return handleError(function (arg0) {
            arg0.abort();
        }, arguments); },
        __wbg_abort_f8d1589eb0c65ee2: function(arg0) {
            arg0.abort();
        },
        __wbg_aborted_31456edf1be00084: function(arg0) {
            const ret = arg0.aborted;
            return ret;
        },
        __wbg_addEventListener_847fd86b8c33ec43: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.addEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_append_24889ba5c72546c0: function(arg0, arg1, arg2, arg3, arg4) {
            arg0.append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        },
        __wbg_append_ba9a4dc30a0323fd: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_arrayBuffer_2c99a9ba14ba536c: function() { return handleError(function (arg0) {
            const ret = arg0.arrayBuffer();
            return ret;
        }, arguments); },
        __wbg_assign_6b6bb30388088072: function(arg0, arg1) {
            const ret = Object.assign(arg0, arg1);
            return ret;
        },
        __wbg_body_0da01a9a056907d8: function(arg0) {
            const ret = arg0.body;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_buffer_aca05a93c046db1a: function(arg0) {
            const ret = arg0.buffer;
            return ret;
        },
        __wbg_buffered_amount_6ddf24fba61cb1ad: function(arg0) {
            const ret = arg0.bufferedAmount;
            return ret;
        },
        __wbg_byobRequest_18280c78e462544c: function(arg0) {
            const ret = arg0.byobRequest;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_byteLength_c5f3c188d5252e5b: function(arg0) {
            const ret = arg0.byteLength;
            return ret;
        },
        __wbg_byteLength_fa48f24814f5ef46: function(arg0) {
            const ret = arg0.byteLength;
            return ret;
        },
        __wbg_byteOffset_63cdc7b38f33a45e: function(arg0) {
            const ret = arg0.byteOffset;
            return ret;
        },
        __wbg_call_40b008ba32f73991: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_fc92fee6137d452d: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_cancel_267512f685fb84c3: function(arg0) {
            const ret = arg0.cancel();
            return ret;
        },
        __wbg_cancel_b195250778e9d8e7: function(arg0) {
            const ret = arg0.cancel();
            return ret;
        },
        __wbg_catch_fd4c7ea14fde9d83: function(arg0, arg1) {
            const ret = arg0.catch(arg1);
            return ret;
        },
        __wbg_clearTimeout_b30195d7061d1ed1: function(arg0) {
            clearTimeout(arg0);
        },
        __wbg_close_294d3f727cb7a844: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_close_bf94aa7e38b9a94b: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_close_c33aae6af9256af6: function(arg0) {
            arg0.close();
        },
        __wbg_close_d7cc8e48c07787b5: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.close(arg1, getStringFromWasm0(arg2, arg3));
        }, arguments); },
        __wbg_construct_8670bb4c2b062969: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.construct(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_create_8853e9d4d0f625e5: function(arg0) {
            const ret = Object.create(arg0);
            return ret;
        },
        __wbg_decode_98bbbbc6085edbd9: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.decode(arg1);
            return ret;
        }, arguments); },
        __wbg_defineProperty_a5a9526e5e4e6fd7: function(arg0, arg1, arg2) {
            const ret = Object.defineProperty(arg0, arg1, arg2);
            return ret;
        },
        __wbg_done_57e08d0be6e30c02: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_enqueue_c11626eae1c54509: function() { return handleError(function (arg0, arg1) {
            arg0.enqueue(arg1);
        }, arguments); },
        __wbg_entries_7bb1459bd9b5c2b9: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_fetch_bd5ae8e2d1b21dc8: function() { return handleError(function (arg0) {
            const ret = fetch(arg0);
            return ret;
        }, arguments); },
        __wbg_for_e12451d86fef973f: function(arg0, arg1) {
            const ret = Symbol.for(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_fromEntries_d7c8cd4202f2bba8: function() { return handleError(function (arg0) {
            const ret = Object.fromEntries(arg0);
            return ret;
        }, arguments); },
        __wbg_from_eac91875c8a5ffa4: function(arg0) {
            const ret = Array.from(arg0);
            return ret;
        },
        __wbg_getAllResponseHeaders_7a4942e43031efbb: function() { return handleError(function (arg0, arg1) {
            const ret = arg1.getAllResponseHeaders();
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getPrototypeOf_684ea783c7170e41: function(arg0) {
            const ret = Object.getPrototypeOf(arg0);
            return ret;
        },
        __wbg_getReader_6912875434814e8c: function() { return handleError(function (arg0) {
            const ret = arg0.getReader();
            return ret;
        }, arguments); },
        __wbg_get_2080c49015e35254: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_556f1c9a5c587e8c: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg1.get(getStringFromWasm0(arg2, arg3));
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_get_635eea311fa1a291: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_d7176cfb76d71114: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_done_3bf2b4a34e149301: function(arg0) {
            const ret = arg0.done;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg_get_unchecked_e6325ad374eff861: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_value_9454480da7066d61: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbg_hasOwn_19cf56c2a374e9e5: function(arg0, arg1) {
            const ret = Object.hasOwn(arg0, arg1);
            return ret;
        },
        __wbg_has_2c4d5cf25ec8c1cf: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.has(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_headers_5fc0106c076eb731: function(arg0) {
            const ret = arg0.headers;
            return ret;
        },
        __wbg_host_68f98460c7328ca5: function(arg0, arg1) {
            const ret = arg1.host;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg_href_436d1661275da591: function(arg0, arg1) {
            const ret = arg1.href;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg_instanceof_ArrayBuffer_12cdaa4161423e6b: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_ReadableStream_ac28304925ec0f96: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ReadableStream;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_d7aeb0dcb3108fea: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_bcf1376d0d732d08: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isPrototypeOf_ad527b072b042d2d: function(arg0, arg1) {
            const ret = arg0.isPrototypeOf(arg1);
            return ret;
        },
        __wbg_isView_7c4f5a7c257b3a84: function(arg0) {
            const ret = ArrayBuffer.isView(arg0);
            return ret;
        },
        __wbg_iterator_e4c5e8f68ada7b58: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_keys_105f5c0857898f84: function(arg0) {
            const ret = Object.keys(arg0);
            return ret;
        },
        __wbg_lengthComputable_9183f225bad60e7a: function(arg0) {
            const ret = arg0.lengthComputable;
            return ret;
        },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_b03a0fabb109b1e9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_loaded_5231f88cef6d7e46: function(arg0) {
            const ret = arg0.loaded;
            return ret;
        },
        __wbg_new_13de428334042d26: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_277c27c26f94cbc2: function() { return handleError(function () {
            const ret = new Headers();
            return ret;
        }, arguments); },
        __wbg_new_37eb45aaf5eeb820: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_433d3f85043258e7: function() { return handleError(function () {
            const ret = new XMLHttpRequest();
            return ret;
        }, arguments); },
        __wbg_new_5f28518387ad0e34: function() { return handleError(function () {
            const ret = new AbortController();
            return ret;
        }, arguments); },
        __wbg_new_787b9fb330d55d78: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_96baed0986e0d99f: function() { return handleError(function (arg0, arg1) {
            const ret = new URL(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_new_ba40181b3f24ac80: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___js_sys_6560307743d9e97c___Function_fn_wasm_bindgen_62e38f1167266ad9___JsValue_____wasm_bindgen_62e38f1167266ad9___sys__Undefined___js_sys_6560307743d9e97c___Function_fn_wasm_bindgen_62e38f1167266ad9___JsValue_____wasm_bindgen_62e38f1167266ad9___sys__Undefined_______true_(a, state0.b, arg0, arg1);
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
        __wbg_new_c32445e09f2bdf44: function() {
            const ret = new TextDecoder();
            return ret;
        },
        __wbg_new_cd4348290afae586: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_e44cc4fa8a12909f: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new WebSocket(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_new_from_slice_b8daf545a41c6aa0: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_e09da9dae6ee5935: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___js_sys_6560307743d9e97c___Function_fn_wasm_bindgen_62e38f1167266ad9___JsValue_____wasm_bindgen_62e38f1167266ad9___sys__Undefined___js_sys_6560307743d9e97c___Function_fn_wasm_bindgen_62e38f1167266ad9___JsValue_____wasm_bindgen_62e38f1167266ad9___sys__Undefined_______true_(a, state0.b, arg0, arg1);
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
        __wbg_new_with_base_44e88b67db0c589b: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = new URL(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
            return ret;
        }, arguments); },
        __wbg_new_with_byte_offset_and_length_3cd32055a417f095: function(arg0, arg1, arg2) {
            const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_new_with_into_underlying_source_10a8d5a675a6a5f5: function(arg0, arg1) {
            const ret = new ReadableStream(streamSource(IntoUnderlyingSource.__wrap(arg0)), streamStrategy(arg1));
            return ret;
        },
        __wbg_new_with_length_01b143a7e5dd5a3e: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_str_and_init_d9f6b5611184e16b: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_next_178c1651c11432b3: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_af5ac6a08bb0a717: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_now_463ac581d2fc7ea3: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_now_7e9f77981e255f9b: function() { return handleError(function () {
            const ret = performance.now();
            return ret;
        }, arguments); },
        __wbg_of_027eb15371aac932: function(arg0) {
            const ret = Array.of(arg0);
            return ret;
        },
        __wbg_of_e7ea0fcd535c1444: function(arg0, arg1) {
            const ret = Array.of(arg0, arg1);
            return ret;
        },
        __wbg_open_2053ae7791d71fe8: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.open(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4), arg5 !== 0);
        }, arguments); },
        __wbg_parse_f18a4bb3872186c6: function() { return handleError(function (arg0) {
            const ret = JSON.parse(arg0);
            return ret;
        }, arguments); },
        __wbg_protocol_65de2b203655c0fc: function(arg0, arg1) {
            const ret = arg1.protocol;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg_protocol_e7b9813a6bd3e53b: function(arg0, arg1) {
            const ret = arg1.protocol;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_c9f4893fc209f768: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_1e8503a8a690f0a3: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_4a1a4d8dd332373b: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_randomUUID_4add2e120d632aef: function() { return handleError(function (arg0) {
            const ret = crypto.randomUUID();
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_random_df36b90cd78a7d54: function() {
            const ret = Math.random();
            return ret;
        },
        __wbg_read_e3bea75dace70752: function(arg0) {
            const ret = arg0.read();
            return ret;
        },
        __wbg_readyState_a2f9f058183b6a88: function(arg0) {
            const ret = arg0.readyState;
            return ret;
        },
        __wbg_reject_334b730b3c00849b: function(arg0) {
            const ret = Promise.reject(arg0);
            return ret;
        },
        __wbg_releaseLock_eddf1401c763f0b9: function(arg0) {
            arg0.releaseLock();
        },
        __wbg_removeEventListener_4e20bd5fac3de092: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.removeEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_resolve_dbf78ab4942478b0: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_respond_d97c023ee981d1f5: function() { return handleError(function (arg0, arg1) {
            arg0.respond(arg1 >>> 0);
        }, arguments); },
        __wbg_responseURL_6b4feae8d9bc33d7: function(arg0, arg1) {
            const ret = arg1.responseURL;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg_response_909ec67532c29a2f: function() { return handleError(function (arg0) {
            const ret = arg0.response;
            return ret;
        }, arguments); },
        __wbg_searchParams_1e9bb9820401be23: function(arg0) {
            const ret = arg0.searchParams;
            return ret;
        },
        __wbg_send_a5f53efbb0af4f46: function() { return handleError(function (arg0) {
            arg0.send();
        }, arguments); },
        __wbg_send_a9edcd4f45334b89: function() { return handleError(function (arg0, arg1) {
            arg0.send(arg1);
        }, arguments); },
        __wbg_send_c53818096716ecd6: function() { return handleError(function (arg0, arg1) {
            arg0.send(arg1);
        }, arguments); },
        __wbg_setPrototypeOf_ea90a878c36ca098: function(arg0, arg1) {
            const ret = Object.setPrototypeOf(arg0, arg1);
            return ret;
        },
        __wbg_setRequestHeader_a62c26acc62b07c7: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setRequestHeader(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_setTimeout_d103db11a6e047ef: function(arg0, arg1) {
            const ret = setTimeout(arg0, arg1);
            return ret;
        },
        __wbg_set_118fefd528ab0a79: function(arg0, arg1, arg2) {
            arg0.set(arg1, arg2 >>> 0);
        },
        __wbg_set_2793479888329cb6: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_bcb0ec2400cfa22e: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.set(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_set_binary_type_fc70b30aaeab5c62: function(arg0, arg1, arg2) {
            arg0.binaryType = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_body_877d5251e78ca815: function(arg0, arg1) {
            arg0.body = arg1;
        },
        __wbg_set_feb3714f475485ba: function(arg0, arg1, arg2) {
            arg0.set(getArrayU8FromWasm0(arg1, arg2));
        },
        __wbg_set_headers_6d75a7df4eb22716: function(arg0, arg1) {
            arg0.headers = arg1;
        },
        __wbg_set_high_water_mark_2c2355a75a627679: function(arg0, arg1) {
            arg0.highWaterMark = arg1;
        },
        __wbg_set_method_639e69af35614d36: function(arg0, arg1, arg2) {
            arg0.method = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_name_822e3903f3184979: function(arg0, arg1, arg2) {
            arg0.name = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_onclose_626732f2478c02ce: function(arg0, arg1) {
            arg0.onclose = arg1;
        },
        __wbg_set_onerror_1b3c8de36b5c653e: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onerror_52ccc356d75b8b9c: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onload_b9b3a9faed5ef715: function(arg0, arg1) {
            arg0.onload = arg1;
        },
        __wbg_set_onmessage_5356e5284d0579e1: function(arg0, arg1) {
            arg0.onmessage = arg1;
        },
        __wbg_set_onopen_d1792a6e8b3f6140: function(arg0, arg1) {
            arg0.onopen = arg1;
        },
        __wbg_set_onprogress_75a3e7e649ad9d8d: function(arg0, arg1) {
            arg0.onprogress = arg1;
        },
        __wbg_set_onreadystatechange_4c295f4d34b5a1f8: function(arg0, arg1) {
            arg0.onreadystatechange = arg1;
        },
        __wbg_set_protocol_b93c106c6d73adc5: function(arg0, arg1, arg2) {
            arg0.protocol = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_redirect_a95a432ab7d10765: function(arg0, arg1) {
            arg0.redirect = __wbindgen_enum_RequestRedirect[arg1];
        },
        __wbg_set_responseType_e08a4356df5bc72d: function(arg0, arg1) {
            arg0.responseType = __wbindgen_enum_XmlHttpRequestResponseType[arg1];
        },
        __wbg_set_signal_0b2eee78907e5ba7: function(arg0, arg1) {
            arg0.signal = arg1;
        },
        __wbg_set_withCredentials_cd7ffd2fc6a048c8: function(arg0, arg1) {
            arg0.withCredentials = arg1 !== 0;
        },
        __wbg_signal_fac908876f45725d: function(arg0) {
            const ret = arg0.signal;
            return ret;
        },
        __wbg_slice_755033ec72548d4a: function(arg0, arg1, arg2) {
            const ret = arg0.slice(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_static_accessor_GLOBAL_THIS_003ee833af9699fc: function() {
            const ret = typeof globalThis === 'undefined' ? undefined : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e4293fb22cbe77da: function() {
            const ret = typeof global === 'undefined' ? undefined : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_53bb20457401453d: function() {
            const ret = typeof self === 'undefined' ? undefined : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b5e0810bfecb7feb: function() {
            const ret = typeof window === 'undefined' ? undefined : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_status_5432a759e0b4975d: function() { return handleError(function (arg0) {
            const ret = arg0.status;
            return ret;
        }, arguments); },
        __wbg_status_cb85b6c8d1769fa1: function(arg0) {
            const ret = arg0.status;
            return ret;
        },
        __wbg_stringify_0a0fbf2ef722380a: function() { return handleError(function (arg0) {
            const ret = JSON.stringify(arg0);
            return ret;
        }, arguments); },
        __wbg_then_656f253a5dd7d8ea: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_e3f7f2d365708be8: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_toString_55ffdf586349746b: function(arg0) {
            const ret = arg0.toString();
            return ret;
        },
        __wbg_toString_6b1cac73c93ef5d1: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.toString(arg1);
            return ret;
        }, arguments); },
        __wbg_total_d3f9c67a5880ff1b: function(arg0) {
            const ret = arg0.total;
            return ret;
        },
        __wbg_type_1a237db07c5ee2de: function(arg0) {
            const ret = arg0.type;
            return (__wbindgen_enum_ResponseType.indexOf(ret) + 1 || 7) - 1;
        },
        __wbg_upload_1bcc9aa2f00d0fc4: function() { return handleError(function (arg0) {
            const ret = arg0.upload;
            return ret;
        }, arguments); },
        __wbg_url_9fadea28ec624f1d: function(arg0, arg1) {
            const ret = arg1.url;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg_value_e0f328965e184931: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbg_view_3b708d3bdaf3fc96: function(arg0) {
            const ret = arg0.view;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 192, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___wasm_bindgen_62e38f1167266ad9___JsValue______true_);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 265, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___wasm_bindgen_62e38f1167266ad9___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_62e38f1167266ad9___JsError___true_);
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("ProgressEvent")], shim_idx: 6, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___web_sys_5d65fa1d64006a8a___features__gen_ProgressEvent__ProgressEvent______true_);
            return ret;
        },
        __wbindgen_generic_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 184, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke_______true_);
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
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./rust_fetch_bg.js": import0,
    };
}

function wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke_______true_(arg0, arg1) {
    wasm.wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke_______true_(arg0, arg1);
}

function wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___wasm_bindgen_62e38f1167266ad9___JsValue______true_(arg0, arg1, arg2) {
    wasm.wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___wasm_bindgen_62e38f1167266ad9___JsValue______true_(arg0, arg1, arg2);
}

function wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___web_sys_5d65fa1d64006a8a___features__gen_ProgressEvent__ProgressEvent______true_(arg0, arg1, arg2) {
    wasm.wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___web_sys_5d65fa1d64006a8a___features__gen_ProgressEvent__ProgressEvent______true_(arg0, arg1, arg2);
}

function wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___wasm_bindgen_62e38f1167266ad9___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_62e38f1167266ad9___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___wasm_bindgen_62e38f1167266ad9___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_62e38f1167266ad9___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___js_sys_6560307743d9e97c___Function_fn_wasm_bindgen_62e38f1167266ad9___JsValue_____wasm_bindgen_62e38f1167266ad9___sys__Undefined___js_sys_6560307743d9e97c___Function_fn_wasm_bindgen_62e38f1167266ad9___JsValue_____wasm_bindgen_62e38f1167266ad9___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_62e38f1167266ad9___convert__closures_____invoke___js_sys_6560307743d9e97c___Function_fn_wasm_bindgen_62e38f1167266ad9___JsValue_____wasm_bindgen_62e38f1167266ad9___sys__Undefined___js_sys_6560307743d9e97c___Function_fn_wasm_bindgen_62e38f1167266ad9___JsValue_____wasm_bindgen_62e38f1167266ad9___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
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
    switch (typeof val) {
        // primitive types
        case 'number':
        case 'boolean':
        case 'undefined':
        return `${val}`;
        case 'string':
        return JSON.stringify(val);
        case 'bigint':
        return `${val}n`;
        case 'symbol':
        return val.description !== undefined
            ? `Symbol(${val.description})`
            : 'Symbol';
        case 'function':
        return typeof val.name === 'string' && val.name !== ''
            ? `Function(${val.name})`
            : 'Function';
        case 'object': {
            if (val === null) {
                return 'null';
            }
            // objects
            if (Array.isArray(val)) {
                return '[' + Array.from(val, debugString).join(', ') + ']';
            }
            // errors
            if (val instanceof Error) {
                return `${val.name}: ${val.message}\n${val.stack}`;
            }

            const toStringOutput = toString.call(val);
            // Test for built-in
            const className = /\[object ([^\]]+)\]/.exec(toStringOutput)?.[1];

            // Failed to match the standard '[object ClassName]'
            if (className === undefined) {
                return toStringOutput;
            }
            if (className === 'Object') {
                // we're a user defined class or Object
                // JSON.stringify avoids problems with cycles, and is generally much
                // easier than looping through ownProperties of `val`.
                try {
                    return 'Object(' + JSON.stringify(val) + ')';
                } catch (_) {
                    return 'Object';
                }
            }
            // TODO we could test for more things here, like `Set`s and `Map`s.
            return className;
        }
        // Per MDN: 'This list of values is exhaustive.'
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#description
    }
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
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
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

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
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

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

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

// Added by scripts/postbuild.mjs
function streamSource(source) {
  for (const name of ['type', 'autoAllocateChunkSize', 'start']) Object.defineProperty(source, name, { __proto__: null, value: undefined });
  return source;
}
function streamStrategy(strategy) {
  return new CountQueuingStrategy({ highWaterMark: strategy.highWaterMark });
}

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
    let record = { __proto__: null, loaded: 0, done: false, source: owner.factory ? undefined : owner.source };
    const report = (current) => {
      if (progress && !current.cancelled) try { progress({ loaded: current.loaded, total }); } catch {}
    };
    async function read() {
      const current = record;
      try {
        if (current.done) return { __proto__: null, done: true };
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
          if (current.done) { current.done = false; current.cancelled = false; cancel(current); return { __proto__: null, done: true }; }
        }
        let data = current.pending;
        while (!data?.byteLength) {
          const step = await (current.web ? current.reader.read() : current.reader.next());
          if (current.done) return { __proto__: null, done: true };
          if (step.done) {
            if (expected !== undefined && current.loaded !== expected) throw invalid('Streaming body length does not match Content-Length');
            current.done = true;
            if (current.web) current.reader.releaseLock();
            return { __proto__: null, done: true };
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
            if (current.cancelled) return { __proto__: null, done: true };
            if (step.done) break;
            if (bytes(step.value).byteLength) throw invalid('Streaming body exceeds Content-Length');
          }
          current.done = true;
          if (current.web) current.reader.releaseLock();
        }
        return { __proto__: null, done: false, data: chunk, end: current.done };
      } catch (cause) {
        const cancelled = current.cancelled;
        cancel(current);
        if (cancelled) return { __proto__: null, done: true };
        return current.failure = { __proto__: null, done: true, error: cause?.message ?? String(cause), invalidInput: cause?.code === 'RUST_FETCH_UPLOAD_INPUT', cause };
      }
    }
    const session = {
      __proto__: null,
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
        // No prototype: the ReadableStream constructor reads `type`, `start` and `size` by inheritance
        return new ReadableStream({
          __proto__: null,
          type: undefined,
          autoAllocateChunkSize: undefined,
          start: undefined,
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
        }, new CountQueuingStrategy({ highWaterMark: 0 }));
      },
    };
    if (owner.factory) session.restart = () => { cancel(record); record = { __proto__: null, loaded: 0, done: false }; };
    return session;
  }
  function create(source) {
    const factory = typeof source === 'function' ? source : undefined;
    if (!factory && !isSource(source)) return undefined;
    const owner = { __proto__: null, source, factory, used: false };
    const result = {
      __proto__: null,
      replayable: !!factory,
      open: (progress, length) => open(owner, progress ?? result.progress, length),
      cancel: () => { if (!owner.used && !factory) cancel({ __proto__: null, source, done: false }); },
    };
    return result;
  }
  create.supported = () => {
    if (supported !== undefined) return supported;
    let duplex = false;
    try {
      const request = new Request('https://rust-fetch.invalid/', {
        __proto__: null,
        method: 'POST',
        body: new ReadableStream({ __proto__: null, type: undefined, autoAllocateChunkSize: undefined, pull: undefined, cancel: undefined, start(c) { c.close(); } }),
        get duplex() { duplex = true; return 'half'; },
      });
      supported = duplex && !request.headers.has('Content-Type');
    } catch { supported = false; }
    return supported;
  };
  globalThis[Symbol.for('rust-fetch.upload')] = create;
})();
// Shared helpers for the JavaScript client wrapper layers appended by scripts/postbuild.mjs.
const optionsArgIndex = (name) => (name === 'request' ? 4 : name.endsWith('_json') ? 2 : 1);
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
  const metrics = () => ({ __proto__: null, started: 0, completed: 0, failed: 0, active: 0, attempts: 0, retries: 0, samples: [], next: 0, count: 0, sum: 0, min: Infinity, max: 0, origins: new Map() });
  const diagnosticOptions = ['onRequestStart', 'onRequestEnd', 'redactUrl', 'traceContext', 'timings', 'metrics', 'propagateTrace', 'debug', 'traceOrigins'];
  function stateFor(options) {
    const debug = typeof process !== 'undefined' && /(?:^|,)(?:rust-fetch\*?|\*)(?:,|$)/.test(process.env?.DEBUG ?? '');
    if (!debug && !diagnosticOptions.some((name) => options != null && Object.hasOwn(Object(options), name))) {
      return { __proto__: null, config: { __proto__: null, enabled: false, debug: false }, options: { __proto__: null } };
    }
    return configure(options);
  }
  function configure(options = {}) {
    const c = { __proto__: null };
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
    return { __proto__: null, config: c, options: { __proto__: null }, metrics: c.metrics ? metrics() : undefined };
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
  // Errors keep their URL minus the password and fragment (#238); redactUrl applies to every error in the cause chain (#239)
  const maskUrl = (v) => { try { const u = new URL(v); if (u.password) u.password = '***'; u.hash = ''; return u.href; } catch { return '[invalid URL]'; } };
  function scrubUrls(error, redact) {
    for (let e = error, i = 0; e && typeof e === 'object' && i < 16; e = e.cause, i++) {
      try { if (typeof e.url === 'string') e.url = redact ? String(redact(e.url)) : maskUrl(e.url); } catch { try { e.url = safeUrl(e.url); } catch {} }
    }
  }
  function context(error, method, url, attempts, redact) {
    if (error && typeof error === 'object') {
      try { error.method ??= method; error.url ??= url; error.attempts ??= attempts; } catch {}
      scrubUrls(error, redact);
    }
    return error;
  }
  function request(state, name, raw, client, args) {
    const c = state.config;
    const index = optionsArgIndex(name);
    let method = name === 'request' ? args[0] : name === 'fetch' ? own(args[1], 'method') ?? 'GET' : name.replace('_json', '').toUpperCase();
    const inputUrl = args[name === 'request' ? 1 : 0], input = args[index];
    const streaming = ['stream', 'ndjson'].includes(own(input, 'responseType'));
    if (!c.enabled && !streaming) {
      const promise = raw.apply(client, args);
      return promise.catch((e) => { if (c.redactUrl) throw context(e, method, inputUrl, 0, c.redactUrl); scrubUrls(e); throw e; });
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
        last = { __proto__: null, startMs: t - start, ttfbMs: null, totalMs: 0 }; timings.attempts.push(last);
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
      const entry = summary('requestEnd', { status: response?.status ?? error?.status, error: failed ? { kind: ['NetworkError','HttpError','TimeoutError','ParseError','InvalidInputError','CancelledError','CircuitOpenError','JsInteropError','ValidationError'].includes(error?.kind) ? error.kind : undefined, status: typeof error?.status === 'number' ? error.status : undefined, phase: ['connect','response','idle','total'].includes(error?.phase) ? error.phase : undefined } : undefined, timings });
      call(c.onRequestEnd, entry); log(c, entry);
    };
    let pending;
    try { pending = raw.apply(client, args); } catch (e) { end(undefined, e, true); throw e; }
    return pending.then((response) => {
      url = response.url || url;
      if (response.body instanceof ReadableStream) {
        const reader = response.body.getReader(); response.timings = timings;
        response.body = new ReadableStream({
          __proto__: null,
          type: undefined,
          autoAllocateChunkSize: undefined,
          start: undefined,
          async pull(controller) {
            try { const step = await reader.read(); if (step.done) { end(response); reader.releaseLock(); controller.close(); } else controller.enqueue(step.value); }
            catch (e) { end(undefined, e, true); reader.releaseLock(); controller.error(e); }
          },
          async cancel(reason) { try { await reader.cancel(reason); } finally { end(response); reader.releaseLock(); } },
        }, new CountQueuingStrategy({ highWaterMark: 0 }));
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
        __proto__: null,
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
    const index = optionsArgIndex(name);
    ObservableClient.prototype[name] = function (...args) {
      let state = states.get(this);
      if (!state) { state = stateFor(); states.set(this, state); }
      // Ordinary buffered requests, including explicit request options, do
      // not need the timing/metrics/stream instrumentation.
      if (!state.config.enabled && !state.config.redactUrl) {
        const type = own(args[index], 'responseType');
        if (type !== 'stream' && type !== 'ndjson') return raw.apply(this, args);
      }
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
// responseType: 'blob' (#81): the bytes of a binary response, as a Blob typed with the response's Content-Type.
(() => {
  const Base = WasmClient;
  class BlobClient extends Base {}
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const index = optionsArgIndex(name);
    BlobClient.prototype[name] = function (...args) {
      const options = args[index];
      if (options == null || options.responseType !== 'blob') return Base.prototype[name].apply(this, args);
      if (typeof Blob === 'undefined') return Promise.reject(Object.assign(new TypeError("responseType 'blob' needs a runtime with Blob"), { kind: 'InvalidInputError', parameter: 'responseType' }));
      args[index] = Object.assign({ __proto__: Object.getPrototypeOf(options) }, options, { responseType: 'binary' });
      return Base.prototype[name].apply(this, args).then((response) => ({
        ...response,
        body: new Blob(response.body ? [response.body] : [], { type: String(response.headers['content-type'] ?? '').toLowerCase() }),
      }));
    };
  }
  Object.defineProperty(BlobClient, 'name', { value: 'WasmClient' });
  WasmClient = BlobClient;
})();
// The `transport` client option (#47): a function that answers this client's buffered requests. createMockTransport() in testing.js builds one.
(() => {
  const Base = WasmClient, custom = new WeakMap();
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  class TransportClient extends Base {
    constructor(options) {
      const transport = options != null && Object.hasOwn(Object(options), 'transport') ? options.transport : undefined;
      if (transport != null && typeof transport !== 'function') throw invalid('transport', 'must be a function');
      super(options);
      if (transport != null) custom.set(this, transport);
    }
  }
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const index = optionsArgIndex(name);
    TransportClient.prototype[name] = function (...args) {
      const transport = custom.get(this);
      if (transport) {
        const given = args[index];
        args.length = Math.max(args.length, index + 1);
        args[index] = Object.assign({ __proto__: given == null ? Object.prototype : Object.getPrototypeOf(given) }, given, { __transport: transport });
      }
      return Base.prototype[name].apply(this, args);
    };
  }
  Object.defineProperty(TransportClient, 'name', { value: 'WasmClient' });
  WasmClient = TransportClient;
})();
// The `auth` client option (#70): bearer tokens with a single-flight refresh on 401, and Basic credentials. Only for the client's own origin(s).
(() => {
  const Base = WasmClient, states = new WeakMap();
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const originOf = (value, base) => { try { return new URL(value, base).origin; } catch { return undefined; } };
  const value = async (auth) => {
    if (auth.basic) {
      const bytes = new TextEncoder().encode(`${auth.basic.username}:${auth.basic.password}`);
      return `Basic ${btoa(String.fromCharCode(...bytes))}`;
    }
    const token = typeof auth.bearer === 'function' ? await auth.bearer() : auth.bearer;
    return token == null || token === '' ? undefined : `Bearer ${token}`;
  };
  function validate(auth, baseUrl) {
    if (auth === null || typeof auth !== 'object') throw invalid('auth', 'must be an object');
    const { bearer, basic, refresh, origins } = auth;
    if ((bearer === undefined) === (basic === undefined)) throw invalid('auth', 'needs exactly one of bearer and basic');
    if (bearer !== undefined && typeof bearer !== 'string' && typeof bearer !== 'function') throw invalid('auth.bearer', 'must be a string or a function');
    if (basic !== undefined && (basic === null || typeof basic.username !== 'string' || typeof basic.password !== 'string')) throw invalid('auth.basic', 'must be { username, password } strings');
    if (refresh !== undefined && (typeof refresh !== 'function' || basic !== undefined)) throw invalid('auth.refresh', 'must be a function, and needs bearer');
    if (origins !== undefined && (!Array.isArray(origins) || origins.some((origin) => typeof origin !== 'string' || originOf(origin) === undefined))) throw invalid('auth.origins', 'must be an array of URLs');
    const allowed = new Set((origins ?? []).map((origin) => originOf(origin)));
    if (baseUrl != null) allowed.add(originOf(baseUrl));
    if (allowed.size === 0 || allowed.has(undefined)) throw invalid('auth', 'needs a valid baseUrl or auth.origins: credentials are only sent to origins you name');
    return allowed;
  }
  const install = (client, state) => {
    state.id = Base.prototype.addRequestInterceptor.call(client, async (request) => {
      if (!state.origins.has(originOf(request.url, state.baseUrl))) return;
      if (Object.keys(request.headers).some((name) => name.toLowerCase() === 'authorization')) return;
      const header = await value(state.auth);
      if (header) request.headers.authorization = header;
    });
  };
  const replayable = (args) => typeof ReadableStream === 'undefined' || !args.some((arg) => arg instanceof ReadableStream || arg?.body instanceof ReadableStream);
  class AuthClient extends Base {
    constructor(options) {
      const auth = options != null && Object.hasOwn(Object(options), 'auth') ? options.auth : undefined;
      const baseUrl = options?.baseUrl;
      const origins = auth === undefined ? undefined : validate(auth, baseUrl);
      super(options);
      if (auth !== undefined) {
        const state = { auth, origins, baseUrl, epoch: 0, outcome: undefined, refreshing: undefined, id: 0 };
        states.set(this, state);
        install(this, state);
      }
    }
    clearInterceptors() {
      super.clearInterceptors();
      const state = states.get(this);
      if (state) install(this, state);
    }
  }
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const raw = Base.prototype[name];
    AuthClient.prototype[name] = function (...args) {
      const state = states.get(this);
      if (!state?.auth.refresh) return raw.apply(this, args);
      const epoch = state.epoch;
      return raw.apply(this, args).catch(async (error) => {
        if (error?.kind !== 'HttpError' || error.status !== 401 || !state.origins.has(originOf(error.url, state.baseUrl)) || !replayable(args)) throw error;
        // Requests failing together share one refresh. One that started before a refresh settled uses its outcome, so a failed refresh isn't run again for each.
        if (state.epoch === epoch) {
          state.refreshing ??= Promise.resolve().then(() => state.auth.refresh()).then(() => ({}), (cause) => ({ cause })).then((outcome) => { state.epoch++; state.outcome = outcome; state.refreshing = undefined; });
          await state.refreshing;
        }
        if (state.outcome.cause !== undefined) {
          if (error.cause === undefined) error.cause = state.outcome.cause;
          throw error;
        }
        return raw.apply(this, args);
      });
    };
  }
  Object.defineProperty(AuthClient, 'name', { value: 'WasmClient' });
  WasmClient = AuthClient;
})();
// The `dedupe` option (#46): identical GET and HEAD requests in flight at once share one request and one response.
(() => {
  const Base = WasmClient, enabled = new WeakMap();
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const clone = (response) => {
    const body = response.body;
    return { ...response, headers: { ...response.headers }, body: body !== null && typeof body === 'object' ? structuredClone(body) : body };
  };
  const entries = (value) => value == null ? [] : typeof value === 'object' && typeof value[Symbol.iterator] === 'function' ? [...value] : Object.entries(value);
  // The request as a string, or undefined when it cannot be shared (callbacks, streams, uploads…)
  function keyOf(method, url, options) {
    const rest = {};
    for (const [name, value] of Object.entries(options ?? {})) {
      if (name === 'signal' || name === 'dedupe' || value === undefined) continue;
      if (typeof value === 'function' || name === 'responseType' && (value === 'stream' || value === 'ndjson')) return undefined;
      rest[name] = name === 'headers' ? entries(value).map(([key, header]) => [String(key).toLowerCase(), String(header)]).sort() : value;
    }
    try { return JSON.stringify([method, url, Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : 1))]); } catch { return undefined; }
  }
  const cancelled = (signal) => Object.assign(new Error('Request was cancelled'), { name: 'CancelledError', kind: 'CancelledError', reason: signal.reason, cause: signal.reason });
  class DedupingClient extends Base {
    #inflight = new Map();
    constructor(options) {
      const dedupe = options != null && Object.hasOwn(Object(options), 'dedupe') ? options.dedupe : undefined;
      if (dedupe !== undefined && typeof dedupe !== 'boolean') throw invalid('dedupe', 'must be a boolean');
      super(options);
      enabled.set(this, dedupe === true);
    }
    #share(name, url, options) {
      const raw = Base.prototype[name];
      const request = options != null && typeof options === 'object' ? options.dedupe : undefined;
      if (request !== undefined && typeof request !== 'boolean') return Promise.reject(invalid('dedupe', 'must be a boolean'));
      if (!(request ?? enabled.get(this))) return raw.call(this, url, options);
      const key = typeof url === 'string' ? keyOf(name, url, options) : undefined;
      if (key === undefined) return raw.call(this, url, options);
      const signal = options?.signal;
      if (signal?.aborted) return raw.call(this, url, options); // rejects at once, sends nothing
      let created = false;
      let shared = this.#inflight.get(key);
      if (!shared) {
        const controller = new AbortController();
        const { signal: _signal, dedupe: _dedupe, ...rest } = options ?? {};
        shared = { controller, callers: 0, promise: undefined };
        shared.promise = raw.call(this, url, { ...rest, signal: controller.signal });
        const forget = () => { if (this.#inflight.get(key) === shared) this.#inflight.delete(key); };
        shared.promise.then(forget, forget);
        this.#inflight.set(key, shared);
        created = true;
      }
      shared.callers++;
      return new Promise((resolve, reject) => {
        let done = false;
        const leave = () => {
          if (--shared.callers === 0) { shared.controller.abort(signal?.reason); if (this.#inflight.get(key) === shared) this.#inflight.delete(key); }
        };
        const onAbort = () => { if (!done) { done = true; reject(cancelled(signal)); leave(); } };
        signal?.addEventListener('abort', onAbort, { once: true });
        shared.promise.then((response) => {
          if (done) return;
          done = true; signal?.removeEventListener('abort', onAbort);
          shared.callers--;
          resolve(created ? response : clone(response));
        }, (error) => {
          if (done) return;
          done = true; signal?.removeEventListener('abort', onAbort);
          shared.callers--;
          reject(error);
        });
      });
    }
    get(url, options) { return this.#share('get', url, options); }
    head(url, options) { return this.#share('head', url, options); }
  }
  Object.defineProperty(DedupingClient, 'name', { value: 'WasmClient' });
  WasmClient = DedupingClient;
})();
// The `httpCache` option (#45): an opt-in private cache for GET responses (RFC 9111): fresh responses from memory, stale ones revalidated.
(() => {
  const Base = WasmClient, caches = new WeakMap();
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const entries = (value) => value == null ? [] : typeof value === 'object' && typeof value[Symbol.iterator] === 'function' ? [...value] : Object.entries(value);
  const lower = (headers) => Object.fromEntries(entries(headers).map(([name, value]) => [String(name).toLowerCase(), String(value)]));
  const directives = (value) => Object.fromEntries(String(value ?? '').toLowerCase().split(',').map((part) => part.trim().split('=')).filter(([name]) => name).map(([name, v]) => [name, v === undefined ? true : v.replace(/"/g, '')]));
  const natural = (value) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : undefined; };
  const STORABLE = new Set([200, 203, 204]);
  const limits = (config) => {
    const { maxEntries = 100, maxBytes = 50_000_000, maxEntryBytes = 1_000_000, ...rest } = config === true ? {} : config;
    for (const [name, value] of Object.entries({ maxEntries, maxBytes, maxEntryBytes })) if (!Number.isInteger(value) || value < 1) throw invalid(`httpCache.${name}`, 'must be a positive integer');
    if (Object.keys(rest).length) throw invalid(`httpCache.${Object.keys(rest)[0]}`, 'is not an option');
    return { maxEntries, maxBytes, maxEntryBytes };
  };
  const sizeOf = (response) => {
    const { body } = response;
    return (typeof body === 'string' ? body.length * 2 : body?.byteLength ?? body?.size ?? natural(response.headers['content-length']) ?? 1024) + 512;
  };
  const copy = (value) => value !== null && typeof value === 'object' ? structuredClone(value) : value;
  const age = (entry) => entry.initialAge + (Date.now() - entry.storedAt);
  const fresh = (entry) => !entry.noCache && entry.lifetime !== undefined && age(entry) < entry.lifetime;
  class CachingClient extends Base {
    constructor(options) {
      const config = options != null && Object.hasOwn(Object(options), 'httpCache') ? options.httpCache : undefined;
      if (config !== undefined && config !== true && config !== false && (config === null || typeof config !== 'object')) throw invalid('httpCache', 'must be true or an object');
      super(options);
      if (config) caches.set(this, { store: new Map(), bytes: 0, limits: limits(config), baseUrl: options.baseUrl });
    }
  }
  const keyOf = (state, url, params) => {
    try {
      const target = new URL(url, state.baseUrl);
      for (const [name, value] of entries(params)) for (const one of [].concat(value)) if (one != null) target.searchParams.append(name, String(one));
      target.hash = '';
      return target.href;
    } catch { return undefined; }
  };
  const forget = (state, key) => { const entry = state.store.get(key); if (entry) { state.store.delete(key); state.bytes -= entry.bytes; } };
  function store(state, key, response, request) {
    const headers = response.headers, cc = directives(headers['cache-control']);
    if (!STORABLE.has(response.status) || cc['no-store'] || headers.vary?.trim() === '*') return forget(state, key);
    const explicit = natural(cc['max-age']) ?? (headers.expires === undefined ? undefined : Math.max(0, (Date.parse(headers.expires) - (Date.parse(headers.date) || Date.now())) / 1000 || 0));
    const validator = headers.etag || headers['last-modified'];
    if (explicit === undefined && !validator) return forget(state, key);
    const bytes = sizeOf(response);
    if (bytes > state.limits.maxEntryBytes) return forget(state, key);
    forget(state, key);
    state.store.set(key, {
      response: { status: response.status, statusText: response.statusText, ok: response.ok, url: response.url, headers: { ...headers }, body: copy(response.body) },
      storedAt: Date.now(), initialAge: (natural(headers.age) ?? 0) * 1000, lifetime: explicit === undefined ? undefined : explicit * 1000,
      noCache: Boolean(cc['no-cache']), etag: headers.etag, lastModified: headers['last-modified'],
      vary: String(headers.vary ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean).map((name) => [name, request[name] ?? '']), bytes,
    });
    state.bytes += bytes;
    // Least recently used first: a Map iterates in insertion order and hits re-insert
    for (const [oldest] of state.store) {
      if (state.store.size <= state.limits.maxEntries && state.bytes <= state.limits.maxBytes) break;
      forget(state, oldest);
    }
  }
  const hit = (entry, revalidated) => ({ ...entry.response, headers: { ...entry.response.headers, age: String(Math.floor(age(entry) / 1000)) }, body: copy(entry.response.body), cached: true, revalidated });
  const bypass = (options) => options == null || typeof options !== 'object' ? options : Object.assign({ __proto__: Object.getPrototypeOf(options) }, options, { httpCache: undefined });
  const GET_LIKE = new Set(['get', 'fetch', 'request']);
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const index = optionsArgIndex(name);
    CachingClient.prototype[name] = function (...args) {
      const state = caches.get(this), raw = Base.prototype[name];
      if (!state) return raw.apply(this, args);
      const options = args[index];
      if (options != null && options.httpCache !== undefined && typeof options.httpCache !== 'boolean') return Promise.reject(invalid('httpCache', 'must be a boolean'));
      const method = name === 'request' ? String(args[0]).toUpperCase() : name === 'fetch' || name === 'post' || name === 'put' || name === 'patch' ? String(options?.method ?? (name === 'fetch' ? 'GET' : name.toUpperCase())).toUpperCase() : name.replace('_json', '').toUpperCase();
      const url = name === 'request' ? args[1] : args[0];
      const key = typeof url === 'string' ? keyOf(state, url, options?.params) : undefined;
      if (key === undefined) return raw.apply(this, args);
      if (method !== 'GET' || !GET_LIKE.has(name)) {
        // An unsafe method that succeeds invalidates the cached response for its URL (RFC 9111 4.4)
        const done = raw.apply(this, args);
        if (method !== 'HEAD') done.then(() => forget(state, key), () => {});
        return done;
      }
      if (options?.httpCache === false || options?.responseType === 'stream' || options?.responseType === 'ndjson') return raw.apply(this, bypassArgs(args, index));
      const headers = lower(name === 'request' ? args[2] ?? options?.headers : options?.headers);
      const requestCC = directives(headers['cache-control']);
      if (requestCC['no-store'] || headers['if-none-match'] || headers['if-modified-since']) return raw.apply(this, bypassArgs(args, index));
      let entry = state.store.get(key);
      if (entry && !entry.vary.every(([header, value]) => (headers[header] ?? '') === value)) entry = undefined;
      if (entry) { state.store.delete(key); state.store.set(key, entry); } // most recently used
      if (entry && fresh(entry) && !requestCC['no-cache']) return Promise.resolve(hit(entry, false));
      const send = (extra) => {
        const next = [...args];
        const base = bypass(options) ?? {};
        const merged = { ...lower(base.headers), ...extra };
        if (name === 'request') { next[2] = { ...lower(next[2]), ...extra }; next[index] = base; } else next[index] = Object.assign({ __proto__: Object.getPrototypeOf(base) }, base, { headers: merged });
        return raw.apply(this, next);
      };
      const validators = entry && (entry.etag || entry.lastModified) ? { ...(entry.etag ? { 'if-none-match': entry.etag } : {}), ...(!entry.etag && entry.lastModified ? { 'if-modified-since': entry.lastModified } : {}) } : undefined;
      return (validators ? send(validators) : raw.apply(this, args)).then((response) => {
        store(state, key, response, headers);
        return { ...response, cached: false, revalidated: false };
      }, (error) => {
        // 304: the stored response is still good. The error carries no headers, so it stays fresh for its original lifetime.
        if (entry && validators && error?.kind === 'HttpError' && error.status === 304 && state.store.get(key) === entry) {
          entry.storedAt = Date.now();
          entry.initialAge = 0;
          return hit(entry, true);
        }
        throw error;
      });
    };
  }
  function bypassArgs(args, index) {
    const next = [...args];
    next[index] = bypass(args[index]);
    return next;
  }
  Object.defineProperty(CachingClient, 'name', { value: 'WasmClient' });
  WasmClient = CachingClient;
})();
// The `schema` request option (#43): validate the response body with any Standard Schema (Zod, Valibot, ArkType…).
(() => {
  const Base = WasmClient;
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const check = (options) => {
    const schema = options == null ? undefined : options.schema;
    if (schema === undefined) return undefined;
    if (schema === null || (typeof schema !== 'object' && typeof schema !== 'function') || typeof schema['~standard']?.validate !== 'function') throw invalid('schema', 'must be a Standard Schema (a validator with ~standard.validate)');
    if (options.responseType === 'stream' || options.responseType === 'ndjson') throw invalid('schema', 'cannot validate a streamed responseType');
    return schema['~standard'];
  };
  const validated = async (method, response, standard) => {
    const result = await standard.validate(response.body);
    if (!result.issues) return { ...response, body: result.value };
    // The message names no values: validators such as Valibot quote the received value in theirs, and error messages get logged. The issues are on `issues`.
    const issues = [...result.issues];
    throw Object.assign(new Error(`Response validation failed: ${issues.length} issue${issues.length === 1 ? '' : 's'}`), {
      name: 'ValidationError', kind: 'ValidationError', issues, method, url: response.url, status: response.status,
    });
  };
  class SchemaClient extends Base {}
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const index = optionsArgIndex(name);
    const raw = Base.prototype[name];
    const method = name === 'request' || name === 'fetch' ? undefined : name.replace('_json', '').toUpperCase();
    SchemaClient.prototype[name] = function (...args) {
      let standard;
      try { standard = check(args[index]); } catch (error) { return Promise.reject(error); }
      const pending = raw.apply(this, args);
      return standard ? pending.then((response) => validated(method ?? (name === 'request' ? String(args[0]).toUpperCase() : String(args[1]?.method ?? 'GET').toUpperCase()), response, standard)) : pending;
    };
  }
  Object.defineProperty(SchemaClient, 'name', { value: 'WasmClient' });
  WasmClient = SchemaClient;
})();
// The `resume` option (#51): a streamed GET that continues with a Range request when the connection breaks mid-body.
(() => {
  const Base = WasmClient;
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const entries = (value) => value == null ? [] : typeof value === 'object' && typeof value[Symbol.iterator] === 'function' ? [...value] : Object.entries(value);
  class ResumingClient extends Base {
    get(url, options) {
      const resume = options?.resume;
      if (resume === undefined || resume === false) return super.get(url, options);
      const config = resume === true ? {} : resume;
      if (config === null || typeof config !== 'object') return Promise.reject(invalid('resume', 'must be true or { maxResumes }'));
      const { maxResumes = 3, ...unknown } = config;
      if (!Number.isInteger(maxResumes) || maxResumes < 1 || Object.keys(unknown).length) return Promise.reject(invalid('resume', 'maxResumes must be a positive integer'));
      if (options.responseType !== 'stream') return Promise.reject(invalid('resume', "needs responseType: 'stream'"));
      const { resume: _, ...rest } = options;
      return super.get(url, rest).then((response) => follow(this, url, rest, response, maxResumes));
    }
  }
  function follow(client, url, rest, response, maxResumes) {
    const headers = response.headers;
    const validator = headers.etag && !headers.etag.startsWith('W/') ? headers.etag : headers['last-modified'];
    // Only a plain 200 with byte ranges, a validator to check the file hasn't changed, and no content coding (ranges count encoded bytes)
    if (response.status !== 200 || headers['accept-ranges'] !== 'bytes' || !validator || (headers['content-encoding'] && headers['content-encoding'] !== 'identity')) return response;
    let reader = response.body.getReader(), received = 0, resumes = 0;
    const body = new ReadableStream({
      async pull(controller) {
        for (;;) {
          try {
            const { done, value } = await reader.read();
            if (done) return controller.close();
            received += value.byteLength;
            return controller.enqueue(value);
          } catch (error) {
            if ((error?.kind !== 'NetworkError' && error?.kind !== 'TimeoutError') || resumes >= maxResumes) return controller.error(error);
            resumes++;
            try {
              const asked = { ...rest, headers: { ...Object.fromEntries(entries(rest.headers).map(([name, v]) => [String(name).toLowerCase(), v])), range: `bytes=${received}-`, 'if-range': validator } };
              const next = await client.get(url, asked);
              // 200 means the file changed (If-Range failed); anything but the bytes from `received` on is no continuation
              if (next.status !== 206 || !new RegExp(`^bytes ${received}-`).test(next.headers['content-range'] ?? '')) {
                next.body.cancel().catch(() => {});
                return controller.error(Object.assign(error, { cause: error.cause ?? new Error('The download could not be resumed: the server did not continue from the same byte, or the file changed') }));
              }
              reader = next.body.getReader();
            } catch (resumeError) {
              return controller.error(Object.assign(error, { cause: error.cause ?? resumeError }));
            }
          }
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return Object.defineProperty({ ...response, body }, 'resumes', { get: () => resumes, enumerable: true });
  }
  Object.defineProperty(ResumingClient, 'name', { value: 'WasmClient' });
  WasmClient = ResumingClient;
})();
// client.extend(overrides) (#69): a new client with the parent's options and interceptors, and the overrides on top.
(() => {
  const Base = WasmClient, saved = new WeakMap();
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const entries = (value) => value == null ? [] : typeof value === 'object' && typeof value[Symbol.iterator] === 'function' ? [...value] : Object.entries(value);
  const merge = (parent, child) => {
    const headers = new Map();
    for (const [name, value] of [...entries(parent), ...entries(child)]) headers.set(String(name).toLowerCase(), [name, value]);
    return Object.fromEntries(headers.values());
  };
  class ExtendableClient extends Base {
    constructor(options) {
      super(options);
      saved.set(this, { options: Object.assign({ __proto__: null }, options), request: [], response: [] });
    }
    addRequestInterceptor(interceptor) {
      const id = super.addRequestInterceptor(interceptor);
      saved.get(this)?.request.push([id, interceptor]);
      return id;
    }
    addResponseInterceptor(onFulfilled, onRejected) {
      const id = super.addResponseInterceptor(onFulfilled, onRejected);
      saved.get(this)?.response.push([id, onFulfilled, onRejected]);
      return id;
    }
    ejectInterceptor(id) {
      const state = saved.get(this);
      if (state) { state.request = state.request.filter((entry) => entry[0] !== id); state.response = state.response.filter((entry) => entry[0] !== id); }
      return super.ejectInterceptor(id);
    }
    clearInterceptors() {
      const state = saved.get(this);
      if (state) { state.request = []; state.response = []; }
      return super.clearInterceptors();
    }
    extend(overrides) {
      if (overrides != null && typeof overrides !== 'object') throw invalid('options', 'must be an object');
      const state = saved.get(this) ?? { options: { __proto__: null }, request: [], response: [] };
      const options = Object.assign({ __proto__: null }, state.options);
      for (const [name, value] of Object.entries(overrides ?? {})) {
        if (value === undefined) continue;
        if (name === 'headers' && value !== null && typeof value !== 'object') throw invalid('headers', 'must be an object, Headers, Map or array of pairs');
        options[name] = name === 'headers' ? merge(options.headers, value) : value;
      }
      const child = new ExtendableClient(options);
      for (const [, interceptor] of state.request) child.addRequestInterceptor(interceptor);
      for (const [, onFulfilled, onRejected] of state.response) child.addResponseInterceptor(onFulfilled, onRejected);
      return child;
    }
  }
  Object.defineProperty(ExtendableClient, 'name', { value: 'WasmClient' });
  WasmClient = ExtendableClient;
})();
// client.paginate(url, options) (#44): an async iterator over pages, or over items. Each page is a normal GET.
(() => {
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const linkNext = (response) => {
    for (const [, target, params] of String(response.headers?.link ?? '').matchAll(/<([^>]*)>((?:\s*;\s*(?:[^;,"<]|"[^"]*")+)*)/g)) {
      const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;,\s]+))/i.exec(params);
      if ((rel?.[1] ?? rel?.[2] ?? '').toLowerCase().split(/\s+/).includes('next')) return target;
    }
  };
  WasmClient.prototype.paginate = async function* (url, options) {
    if (options != null && typeof options !== 'object') throw invalid('options', 'must be an object');
    const { items, next = linkNext, maxPages = 1000, crossOrigin = false, ...request } = options ?? {};
    if (items !== undefined && typeof items !== 'function') throw invalid('items', 'must be a function');
    if (typeof next !== 'function') throw invalid('next', 'must be a function');
    if (!Number.isInteger(maxPages) || maxPages < 1) throw invalid('maxPages', 'must be a positive integer');
    const seen = new Set();
    let target = url, init = request;
    for (let page = 0; page < maxPages; page++) {
      const response = await this.get(target, init);
      if (items) yield* await items(response); else yield response;
      const more = await next(response);
      if (!more) return;
      const spec = typeof more === 'string' ? { url: more } : more;
      if (spec === null || typeof spec !== 'object' || (spec.url !== undefined && typeof spec.url !== 'string')) throw invalid('next', 'must return a URL, { url?, params? } or nothing');
      if (spec.url !== undefined) {
        const resolved = new URL(spec.url, response.url);
        if (resolved.origin !== new URL(response.url).origin && !crossOrigin) throw invalid('next', `points to another origin (${resolved.origin}); set crossOrigin: true to follow it`);
        target = resolved.href;
        init = { ...request, params: spec.params };
      } else init = { ...request, params: { ...request.params, ...spec.params } };
      // A server that links back to a page it already sent would loop until maxPages
      const key = JSON.stringify([target, init.params]);
      if (seen.has(key)) return;
      seen.add(key);
    }
  };
})();
// Type guards for rust-fetch errors (#68). Shape checks, not `instanceof`: an error from another realm or copy of the package counts too.
const ERROR_KINDS = new Set(['CircuitOpenError', 'NetworkError', 'HttpError', 'ParseError', 'TimeoutError', 'InvalidInputError', 'JsInteropError', 'CancelledError', 'ValidationError']);
export function isRustFetchError(value, kind) {
  if (value === null || typeof value !== 'object') return false;
  const found = value.kind;
  return ERROR_KINDS.has(found) && typeof value.message === 'string' && (kind === undefined || found === kind);
}
export const isHttpError = (value) => isRustFetchError(value, 'HttpError');
export const isTimeoutError = (value) => isRustFetchError(value, 'TimeoutError');
export const isNetworkError = (value) => isRustFetchError(value, 'NetworkError');
export const isParseError = (value) => isRustFetchError(value, 'ParseError');
export const isInvalidInputError = (value) => isRustFetchError(value, 'InvalidInputError');
export const isCancelledError = (value) => isRustFetchError(value, 'CancelledError');
export const isCircuitOpenError = (value) => isRustFetchError(value, 'CircuitOpenError');
export const isJsInteropError = (value) => isRustFetchError(value, 'JsInteropError');
export const isValidationError = (value) => isRustFetchError(value, 'ValidationError');
