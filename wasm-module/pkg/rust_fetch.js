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
        __wbg_buffered_amount_13ecd55ec8cd408c: function(arg0) {
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
        __wbg_clearTimeout_67a499ffedb6b2b8: function(arg0) {
            clearTimeout(arg0);
        },
        __wbg_close_185286988f30f252: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_close_748f26698dabe269: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_close_a86e2b7d353a877e: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.close(arg1, getStringFromWasm0(arg2, arg3));
        }, arguments); },
        __wbg_close_eb06367c02f3a8d2: function(arg0) {
            arg0.close();
        },
        __wbg_decode_a78b2ed214fe37a5: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.decode(arg1);
            return ret;
        }, arguments); },
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
        __wbg_fetch_8fd7e12f7b068a20: function() { return handleError(function (arg0) {
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
        __wbg_has_5d6706e5209576c1: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.has(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_headers_eba93595f8944c2f: function(arg0) {
            const ret = arg0.headers;
            return ret;
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
        __wbg_new_256effd913b996c2: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new WebSocket(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_new_2e41357094e99294: function() { return handleError(function () {
            const ret = new AbortController();
            return ret;
        }, arguments); },
        __wbg_new_343a093a3c2ffb4e: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_5502aad30c185fc8: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined_______true_(a, state0.b, arg0, arg1);
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
        __wbg_new_83ca405eae412a62: function() { return handleError(function () {
            const ret = new Headers();
            return ret;
        }, arguments); },
        __wbg_new_9aa246b68dc5e818: function() {
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
                        return wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined_______true_(a, state0.b, arg0, arg1);
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
        __wbg_of_20798cb14708764f: function(arg0, arg1) {
            const ret = Array.of(arg0, arg1);
            return ret;
        },
        __wbg_open_f0c8628338345808: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.open(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4), arg5 !== 0);
        }, arguments); },
        __wbg_parse_040ab083cabdc292: function() { return handleError(function (arg0) {
            const ret = JSON.parse(arg0);
            return ret;
        }, arguments); },
        __wbg_protocol_50b6aec8e8a7349c: function(arg0, arg1) {
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
        __wbg_random_5a4cafd2f02395ff: function() {
            const ret = Math.random();
            return ret;
        },
        __wbg_read_2a943774344c9728: function(arg0) {
            const ret = arg0.read();
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
        __wbg_send_27717f7429d15105: function() { return handleError(function (arg0, arg1) {
            arg0.send(arg1);
        }, arguments); },
        __wbg_send_2f217a35fed89145: function() { return handleError(function (arg0, arg1) {
            arg0.send(arg1);
        }, arguments); },
        __wbg_send_9d00bd9d7a2c90b5: function() { return handleError(function (arg0) {
            arg0.send();
        }, arguments); },
        __wbg_setRequestHeader_733b74e99bf9b791: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setRequestHeader(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_setTimeout_95a5983eea34175a: function(arg0, arg1) {
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
        __wbg_set_binary_type_19c085577a8de004: function(arg0, arg1, arg2) {
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
        __wbg_set_onclose_9ce8de200e4a7ec5: function(arg0, arg1) {
            arg0.onclose = arg1;
        },
        __wbg_set_onerror_5f014019e4fa2820: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onerror_c298a45be45812dd: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onload_2cbb4e46b9492f82: function(arg0, arg1) {
            arg0.onload = arg1;
        },
        __wbg_set_onmessage_9dc0c149e214796c: function(arg0, arg1) {
            arg0.onmessage = arg1;
        },
        __wbg_set_onopen_4db2eec51c5cb48d: function(arg0, arg1) {
            arg0.onopen = arg1;
        },
        __wbg_set_onprogress_6da9421890668006: function(arg0, arg1) {
            arg0.onprogress = arg1;
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
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 197, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___wasm_bindgen_9d298ef7e71c0d11___JsValue______true_);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 284, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___wasm_bindgen_9d298ef7e71c0d11___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_9d298ef7e71c0d11___JsError___true_);
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("ProgressEvent")], shim_idx: 118, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___web_sys_e9a7b01c56fed3da___features__gen_ProgressEvent__ProgressEvent______true_);
            return ret;
        },
        __wbindgen_generic_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 185, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke_______true_);
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

function wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke_______true_(arg0, arg1) {
    wasm.wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke_______true_(arg0, arg1);
}

function wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___wasm_bindgen_9d298ef7e71c0d11___JsValue______true_(arg0, arg1, arg2) {
    wasm.wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___wasm_bindgen_9d298ef7e71c0d11___JsValue______true_(arg0, arg1, arg2);
}

function wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___web_sys_e9a7b01c56fed3da___features__gen_ProgressEvent__ProgressEvent______true_(arg0, arg1, arg2) {
    wasm.wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___web_sys_e9a7b01c56fed3da___features__gen_ProgressEvent__ProgressEvent______true_(arg0, arg1, arg2);
}

function wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___wasm_bindgen_9d298ef7e71c0d11___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_9d298ef7e71c0d11___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___wasm_bindgen_9d298ef7e71c0d11___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_9d298ef7e71c0d11___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_9d298ef7e71c0d11___convert__closures_____invoke___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined___js_sys_6cf4d9cd98c8a011___Function_fn_wasm_bindgen_9d298ef7e71c0d11___JsValue_____wasm_bindgen_9d298ef7e71c0d11___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
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
