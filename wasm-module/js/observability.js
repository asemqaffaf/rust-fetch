// Per-module instrumentation. Retry, admission and timeout policy stay in Rust.
let nodeDiagnostics;
export function __setNodeDiagnostics(snapshot) { nodeDiagnostics = snapshot; }
(() => {
  const Original = WasmClient, states = new WeakMap(), now = () => performance.now();
  const DEBUG_RE = /(?:^|,)(?:rust-fetch\*?|\*)(?:,|$)/;
  const envDebug = () => typeof process !== 'undefined' && DEBUG_RE.test(process.env?.DEBUG ?? '');
  const prop = (o, k) => { try { return o?.[k]; } catch {} };
  const option = (o, k) => (o != null && Object.getPrototypeOf(o) !== Object.prototype ? prop(o, k) : ownProp(o, k));
  const call = (fn, value) => { try { fn?.(value)?.catch?.(() => {}); } catch {} };
  const origin = (value) => originOf(value) ?? '';
  const safeUrl = (value, redact) => {
    try { const u = new URL(value); u.username = u.password = u.search = u.hash = ''; return redact ? String(redact(u.href)) : u.href; }
    catch { return '[invalid URL]'; }
  };
  function safeHeaders(value, names) {
    const result = Object.create(null);
    if (value == null) return result;
    try {
      // Iterate pairs directly so arrays redact by header name.
      for (const pair of headerEntries(value)) {
        if (!Array.isArray(pair)) continue;
        const [key, v] = pair;
        if (typeof key !== 'string' || v == null) continue;
        const name = key.toLowerCase();
        if (names === null || names.has(name)) result[name] = '[REDACTED]';
        else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') result[name] = name === 'location' || name === 'referer' ? safeUrl(v) : String(v);
      }
    } catch { return Object.create(null); } // The core validates malformed headers.
    return result;
  }
  const metrics = () => ({ __proto__: null, started: 0, completed: 0, failed: 0, active: 0, attempts: 0, retries: 0, samples: [], next: 0, count: 0, sum: 0, min: Infinity, max: 0, origins: new Map() });
  const diagnosticOptions = ['onRequestStart', 'onRequestEnd', 'redactUrl', 'traceContext', 'timings', 'metrics', 'propagateTrace', 'debug', 'traceOrigins'];
  function stateFor(options) {
    if (!envDebug() && !diagnosticOptions.some((name) => options != null && Object.hasOwn(Object(options), name))) {
      return { __proto__: null, config: { __proto__: null, enabled: false, debug: false }, options: { __proto__: null } };
    }
    return configure(options);
  }
  function configure(options = {}) {
    const c = { __proto__: null };
    for (const key of diagnosticOptions.slice(0, 4)) {
      c[key] = ownProp(options, key);
      if (c[key] != null && typeof c[key] !== 'function') throw invalidInput(key, 'must be a function');
    }
    for (const key of diagnosticOptions.slice(4, 7)) {
      const v = ownProp(options, key);
      if (v != null && typeof v !== 'boolean') throw invalidInput(key, 'must be a boolean');
      c[key] = v === true;
    }
    c.debug = ownProp(options, 'debug');
    if (c.debug != null && typeof c.debug !== 'boolean' && typeof c.debug !== 'function') throw invalidInput('debug', 'must be a boolean or function');
    if (c.debug == null) c.debug = envDebug();
    c.traceOrigins = new Set();
    const origins = ownProp(options, 'traceOrigins');
    if (origins != null) {
      if (!Array.isArray(origins)) throw invalidInput('traceOrigins', 'must be an array of HTTP origins');
      for (const value of origins) {
        try { const u = new URL(value); if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw 0; c.traceOrigins.add(u.origin); }
        catch { throw invalidInput('traceOrigins', 'must contain only HTTP origins'); }
      }
    }
    if (c.propagateTrace && (!c.traceOrigins.size || !c.traceContext)) throw invalidInput('propagateTrace', 'requires traceOrigins and traceContext');
    c.enabled = !!(c.timings || c.metrics || c.debug || c.onRequestStart || c.onRequestEnd || c.propagateTrace);
    return { __proto__: null, config: c, options: { __proto__: null }, metrics: c.metrics ? metrics() : undefined };
  }
  const log = (c, e) => call(c.debug === true ? (v) => console.debug('[rust-fetch]', v) : typeof c.debug === 'function' ? c.debug : undefined, e);
  function trace(c) {
    const ctx = c.traceContext();
    if (ctx == null) return;
    const parent = ownProp(ctx, 'traceparent'), state = ownProp(ctx, 'tracestate');
    if (typeof parent !== 'string' || !/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(parent) || parent.startsWith('ff-') || /^..-0{32}-/.test(parent) || /^..-[0-9a-f]{32}-0{16}-/.test(parent)) throw invalidInput('traceContext', 'invalid traceparent');
    if (state != null) {
      if (typeof state !== 'string' || state.length > 512 || state.split(',').length > 32) throw invalidInput('traceContext', 'invalid tracestate');
      const seen = new Set();
      for (const member of state.split(',')) {
        const [key, ...rest] = member.trim().split('='), value = rest.join('=');
        if (!/^(?:[a-z][a-z0-9_*/-]{0,255}|[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13})$/.test(key) || !value || /[^\x20-\x7e]|[,=]/.test(value) || seen.has(key)) throw invalidInput('traceContext', 'invalid tracestate');
        seen.add(key);
      }
    }
    return state == null ? { traceparent: parent } : { traceparent: parent, tracestate: state };
  }
  function resolve(options, value, params) {
    const base = ownProp(options, 'baseUrl');
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
  const traceHook = (c) => (target) => (c.traceOrigins.has(origin(target)) ? trace(c) : undefined);
  function request(state, name, raw, client, args) {
    const c = state.config, index = optionsArgIndex(name);
    let method = methodOf(name, args, args[1]);
    const inputUrl = args[name === 'request' ? 1 : 0], input = args[index];
    const streaming = ownProp(input, 'responseType') === 'stream' || ownProp(input, 'responseType') === 'ndjson';
    if (!c.enabled && !streaming) {
      return raw.apply(client, args).catch((e) => { if (c.redactUrl) throw context(e, method, inputUrl, 0, c.redactUrl); scrubUrls(e); throw e; });
    }
    const options = input && typeof input === 'object' ? cloneProto(input) : input == null ? {} : input;
    let url = resolve(state.options, inputUrl, ownProp(options, 'params'));
    const start = now(), timings = { queuedMs: 0, retryDelayMs: 0, attempts: [], totalMs: 0 };
    let queue, last, ended = false, cause, bucket;
    const summary = (type, extra) => ({ type, method: typeof method === 'string' && /^[A-Za-z]{1,16}$/.test(method) ? method.toUpperCase() : 'UNKNOWN', url: safeUrl(url, c.redactUrl), ...extra });
    const requested = option(options, 'sensitiveHeaders');
    const sensitive = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie', ...(state.options.sensitiveHeaders ?? []), ...(Array.isArray(requested) ? requested.filter((n) => typeof n === 'string') : [])].map((n) => n.toLowerCase()));
    const redactSet = requested != null && (!Array.isArray(requested) || requested.some((n) => typeof n !== 'string')) ? null : sensitive;
    const m = state.metrics;
    if (m) {
      m.started++; m.active++;
      const key = origin(url);
      if (!m.origins.has(key) && m.origins.size < 128) m.origins.set(key, { started: 0, completed: 0, failed: 0, active: 0 });
      bucket = m.origins.get(key); if (bucket) { bucket.started++; bucket.active++; }
    }
    call(c.onRequestStart, summary('requestStart'));
    log(c, summary('request', { headers: { ...safeHeaders(state.options.headers, redactSet), ...safeHeaders(name === 'request' ? args[2] : undefined, redactSet), ...safeHeaders(option(options, 'headers'), redactSet) } }));
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
      if (c.propagateTrace) options.__trace = traceHook(c);
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
        m.active--; m.completed++; m.failed += +failed; m.attempts += timings.attempts.length; m.retries += Math.max(0, timings.attempts.length - 1);
        m.samples[m.next++ % 1024] = timings.totalMs; m.count++; m.sum += timings.totalMs; m.min = Math.min(m.min, timings.totalMs); m.max = Math.max(m.max, timings.totalMs);
        if (bucket) { bucket.active--; bucket.completed++; bucket.failed += +failed; }
      }
      const entry = summary('requestEnd', { status: response?.status ?? error?.status, error: failed ? { kind: ERROR_KINDS.has(error?.kind) ? error.kind : undefined, status: typeof error?.status === 'number' ? error.status : undefined, phase: ['connect', 'response', 'idle', 'total'].includes(error?.phase) ? error.phase : undefined } : undefined, timings });
      call(c.onRequestEnd, entry); log(c, entry);
    };
    let pending;
    try { pending = raw.apply(client, args); } catch (e) { end(undefined, e, true); throw e; }
    return pending.then((response) => {
      url = response.url || url;
      if (response.body instanceof ReadableStream) {
        const reader = response.body.getReader(); response.timings = timings;
        response.body = safeStream({
          async pull(controller) {
            try { const step = await reader.read(); if (step.done) { end(response); reader.releaseLock(); controller.close(); } else controller.enqueue(step.value); }
            catch (e) { end(undefined, e, true); reader.releaseLock(); controller.error(e); }
          },
          async cancel(reason) { try { await reader.cancel(reason); } finally { end(response); reader.releaseLock(); } },
        }, 0);
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
      let state = states.get(this); if (!state) states.set(this, state = stateFor());
      state.metrics ??= metrics(); state.config.enabled = true;
      const m = state.metrics, samples = [...m.samples].sort((a, b) => a - b);
      const p = (n) => (samples.length ? samples[Math.min(samples.length - 1, Math.ceil(n * samples.length) - 1)] : null);
      return {
        requests: { started: m.started, completed: m.completed, failed: m.failed, active: m.active }, attempts: m.attempts, retries: m.retries,
        latency: { count: m.count, minMs: m.count ? m.min : null, maxMs: m.count ? m.max : null, meanMs: m.count ? m.sum / m.count : null, p50Ms: p(0.5), p95Ms: p(0.95), p99Ms: p(0.99), sampleCount: samples.length },
        origins: Object.fromEntries([...m.origins].map(([k, v]) => [k, { ...v }])), pools: nodeDiagnostics ? nodeDiagnostics() : null,
      };
    }
  }
  for (const name of ['events', 'websocket']) {
    const raw = Original.prototype[name];
    defineMethod(ObservableClient.prototype, name, function (url, options) {
      const state = states.get(this) ?? stateFor(), c = state.config;
      let target = resolve(state.options, url, ownProp(options, 'params'));
      if (name === 'websocket') target = target.replace(/^http(s?):/, 'ws$1:');
      const method = name === 'websocket' ? 'GET' : ownProp(options, 'method') ?? 'GET';
      let attempts = 0;
      const init = cloneProto(options ?? {});
      if (name === 'events' && c.propagateTrace) init.__trace = traceHook(c);
      for (const hook of ['onOpen', 'onError', 'onClose', 'onReconnect']) {
        const app = prop(init, hook);
        if (app != null && typeof app !== 'function') continue;
        Object.defineProperty(init, hook, { __proto__: null, value: (event) => {
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
            const fn = connection[methodName].bind(connection);
            connection[methodName] = (...args) => {
              try { return fn(...args); }
              catch (error) { throw context(error, 'GET', target, Math.max(1, attempts), c.redactUrl); }
            };
          }
        }
        attempts = 1;
        const opened = connection.opened.catch((e) => { throw context(e, method, target, Math.max(1, attempts), c.redactUrl); });
        opened.catch(() => {});
        Object.defineProperty(connection, 'opened', { __proto__: null, value: opened, configurable: true });
        if (name === 'events') { const next = connection.next.bind(connection); connection.next = (...args) => next(...args).catch((e) => { throw context(e, method, target, Math.max(1, attempts), c.redactUrl); }); }
        return connection;
      } catch (e) { throw context(e, method, target, attempts, c.redactUrl); }
    });
  }
  wrapClient(ObservableClient, (name, index, raw) => function (...args) {
    let state = states.get(this);
    if (!state) states.set(this, state = stateFor());
    // Ordinary buffered requests, including explicit request options, do
    // not need the timing/metrics/stream instrumentation.
    if (!state.config.enabled && !state.config.redactUrl) {
      const type = ownProp(args[index], 'responseType');
      if (type !== 'stream' && type !== 'ndjson') return raw.apply(this, args);
    }
    return request(state, name, raw, this, args);
  });
  // Keep the convenience exports on the same contextual-error path as clients.
  fetch_json = fetch_json_promise = fetch_wasm_json = fetch_wasm_map = fetch_wasm_api = (url) => new WasmClient().get(url, { responseType: 'json' }).then((r) => r.body);
  fetch_text = fetch_wasm_html = (url) => new WasmClient().get(url, { responseType: 'text' }).then((r) => r.body);
  fetch_with_options = (url, method, headers, body) => new WasmClient().request(method, url, headers, body ?? undefined);
})();
