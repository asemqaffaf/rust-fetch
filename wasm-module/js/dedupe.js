// The `dedupe` option (#46): identical GET and HEAD requests in flight at once share one request and one response.
(() => {
  const Base = WasmClient, enabled = new WeakMap();
  const clone = (response) => ({ ...response, headers: { ...response.headers }, body: cloneValue(response.body) });
  // The request as a string, or undefined when it cannot be shared (callbacks, streams, uploads…)
  function keyOf(method, url, options) {
    const rest = {};
    for (const [name, value] of Object.entries(options ?? {})) {
      if (name === 'signal' || name === 'dedupe' || value === undefined) continue;
      if (typeof value === 'function' || (name === 'responseType' && (value === 'stream' || value === 'ndjson'))) return;
      rest[name] = name === 'headers' ? headerEntries(value).map(([k, v]) => [String(k).toLowerCase(), String(v)]).sort() : value;
    }
    try { return JSON.stringify([method, url, Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : 1))]); } catch {}
  }
  const cancelled = (signal) => Object.assign(new Error('Request was cancelled'), { name: 'CancelledError', kind: 'CancelledError', reason: signal.reason, cause: signal.reason });
  class DedupingClient extends Base {
    #inflight = new Map();
    constructor(options) {
      const dedupe = ownProp(options, 'dedupe');
      if (dedupe !== undefined && typeof dedupe !== 'boolean') throw invalidInput('dedupe', 'must be a boolean');
      super(options);
      enabled.set(this, dedupe === true);
    }
    #share(name, url, options) {
      const raw = Base.prototype[name];
      const request = options != null && typeof options === 'object' ? options.dedupe : undefined;
      if (request !== undefined && typeof request !== 'boolean') return Promise.reject(invalidInput('dedupe', 'must be a boolean'));
      if (!(request ?? enabled.get(this))) return raw.call(this, url, options);
      const key = typeof url === 'string' ? keyOf(name, url, options) : undefined;
      if (key === undefined || options?.signal?.aborted) return raw.call(this, url, options);
      const signal = options?.signal;
      let created = false, shared = this.#inflight.get(key);
      if (!shared) {
        const controller = new AbortController(), { signal: _s, dedupe: _d, ...rest } = options ?? {};
        shared = { controller, callers: 0, promise: raw.call(this, url, { ...rest, signal: controller.signal }) };
        const forget = () => { if (this.#inflight.get(key) === shared) this.#inflight.delete(key); };
        shared.promise.then(forget, forget);
        this.#inflight.set(key, shared);
        created = true;
      }
      shared.callers++;
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (cb, value) => { if (!done) { done = true; signal?.removeEventListener('abort', onAbort); shared.callers--; cb(value); } };
        const onAbort = () => { if (!done) { done = true; reject(cancelled(signal)); if (--shared.callers === 0) { shared.controller.abort(signal?.reason); if (this.#inflight.get(key) === shared) this.#inflight.delete(key); } } };
        signal?.addEventListener('abort', onAbort, { once: true });
        shared.promise.then((r) => finish(resolve, created ? r : clone(r)), (e) => finish(reject, e));
      });
    }
    get(url, options) { return this.#share('get', url, options); }
    head(url, options) { return this.#share('head', url, options); }
  }
  wrapClient(DedupingClient);
})();
