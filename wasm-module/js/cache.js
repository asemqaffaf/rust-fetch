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
    const index = name === 'request' ? 4 : name.endsWith('_json') ? 2 : 1;
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
