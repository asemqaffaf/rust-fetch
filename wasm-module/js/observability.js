// Per-module instrumentation. Retry, admission and timeout policy stay in Rust.
let nodeDiagnostics;
export function __setNodeDiagnostics(snapshot) { nodeDiagnostics = snapshot; }
(() => {
  const Original = WasmClient, states = new WeakMap(), now = () => performance.now();
  const own = (o, k) => o != null && Object.hasOwn(Object(o), k) ? o[k] : undefined;
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
    const entries = typeof value.entries === 'function' ? value.entries() : Array.isArray(value) ? value : Object.entries(value);
    for (const [key, v] of entries) {
      const name = String(key).toLowerCase();
      result[name] = (names === null || names.has(name)) ? '[REDACTED]' : ['location', 'referer'].includes(name) ? safeUrl(v) : String(v);
    }
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
    const options = input && typeof input === 'object' ? Object.assign(Object.create(Object.getPrototypeOf(input)), input) : input == null ? {} : input;
    let url = resolve(state.options, inputUrl, own(options, 'params'));
    const start = now(), timings = { queuedMs: 0, retryDelayMs: 0, attempts: [], totalMs: 0 };
    let queue, last, ended = false, cause;
    const summary = (type, extra = {}) => ({ type, method: typeof method === 'string' && /^[A-Za-z]{1,16}$/.test(method) ? method.toUpperCase() : 'UNKNOWN', url: safeUrl(url, c.redactUrl), ...extra });
    const sensitive = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie', ...(Array.isArray(own(state.options, 'sensitiveHeaders')) ? own(state.options, 'sensitiveHeaders') : []), ...(Array.isArray(own(options, 'sensitiveHeaders')) ? own(options, 'sensitiveHeaders') : [])].map((n) => String(n).toLowerCase()));
    const hideAllHeaders = own(options, 'sensitiveHeaders') != null && !Array.isArray(own(options, 'sensitiveHeaders'));
    const m = state.metrics;
    let bucket;
    if (m) {
      m.started++; m.active++;
      const key = origin(url);
      if (!m.origins.has(key) && m.origins.size < 128) m.origins.set(key, { started: 0, completed: 0, failed: 0, active: 0 });
      bucket = m.origins.get(key); if (bucket) { bucket.started++; bucket.active++; }
    }
    call(c.onRequestStart, summary('requestStart'));
    log(c, summary('request', { headers: { ...safeHeaders(own(state.options, 'headers'), hideAllHeaders ? null : sensitive), ...safeHeaders(name === 'request' ? args[2] : undefined, hideAllHeaders ? null : sensitive), ...safeHeaders(own(options, 'headers'), hideAllHeaders ? null : sensitive) } }));
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
      state.options = {
        baseUrl: own(options, 'baseUrl'),
        headers: state.config.debug ? safeHeaders(own(options, 'headers'), new Set()) : undefined,
        sensitiveHeaders: Array.isArray(own(options, 'sensitiveHeaders')) ? [...options.sensitiveHeaders] : undefined,
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
      const init = { ...options };
      if (name === 'events' && c.propagateTrace) init.__trace = (target) => c.traceOrigins.has(origin(target)) ? trace(c) : undefined;
      for (const hook of ['onOpen', 'onError', 'onClose', 'onReconnect']) {
        const app = own(options, hook);
        init[hook] = (event) => {
          if (hook === 'onReconnect') attempts++;
          if (hook === 'onError') context(event, method, target, Math.max(1, attempts), c.redactUrl);
          log(c, { type: name + ':' + hook.slice(2).toLowerCase(), method, url: safeUrl(target, c.redactUrl), error: hook === 'onError' ? { kind: event?.kind } : undefined });
          return app?.(event);
        };
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
