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
