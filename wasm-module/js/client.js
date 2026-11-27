// Unified WasmClient wrapper: verb shortcuts, observability, responseType: 'blob',
// custom transport, auth, dedupe, httpCache, schema validation, Range resume,
// extend(), paginate(), and standalone convenience exports.
let nodeDiagnostics;
export function __setNodeDiagnostics(snapshot) { nodeDiagnostics = snapshot; }
export function create_client() { return new WasmClient(); }
export let fetch_json, fetch_json_promise, fetch_text, fetch_with_options,
  fetch_wasm_json, fetch_wasm_html, fetch_wasm_map, fetch_wasm_api;

(() => {
  const Base = WasmClient, bp = Base.prototype, dispatch = bp.__dispatch;
  delete bp.__dispatch;
  for (const [ctor, name] of [
    [EventStream, 'EventStream'],
    [WebSocketConnection, 'WebSocketConnection'],
    [IntoUnderlyingByteSource, 'IntoUnderlyingByteSource'],
    [IntoUnderlyingSink, 'IntoUnderlyingSink'],
    [IntoUnderlyingSource, 'IntoUnderlyingSource'],
  ]) setFnName(ctor, name);

  const _st = new WeakMap(), now = () => performance.now();
  const DEBUG_RE = /(?:^|,)(?:rust-fetch\*?|\*)(?:,|$)/;
  const envDebug = () => typeof process !== 'undefined' && DEBUG_RE.test(process.env?.DEBUG ?? '');
  const prop = (o, k) => { try { return o?.[k]; } catch {} };
  const option = (o, k) => (o != null && Object.getPrototypeOf(o) !== Object.prototype ? prop(o, k) : ownProp(o, k));
  const callSafe = (fn, v) => { try { fn?.(v)?.catch?.(() => {}); } catch {} };
  const origin = (v) => originOf(v) ?? '';
  const safeUrl = (v, redact) => {
    try { const u = new URL(v); u.username = u.password = u.search = u.hash = ''; return redact ? String(redact(u.href)) : u.href; }
    catch { return '[invalid URL]'; }
  };
  const maskUrl = (v) => { try { const u = new URL(v); if (u.password) u.password = '***'; u.hash = ''; return u.href; } catch { return '[invalid URL]'; } };
  function scrubUrls(err, redact) {
    for (let e = err, i = 0; e && typeof e === 'object' && i < 16; e = e.cause, i++) {
      try { if (typeof e.url === 'string') e.url = redact ? String(redact(e.url)) : maskUrl(e.url); } catch { try { e.url = safeUrl(e.url); } catch {} }
    }
  }
  function errCtx(err, method, url, attempts, redact) {
    if (err && typeof err === 'object') {
      try { err.method ??= method; err.url ??= url; err.attempts ??= attempts; } catch {}
      scrubUrls(err, redact);
    }
    return err;
  }
  function safeHeaders(value, names) {
    const out = Object.create(null);
    if (value == null) return out;
    try {
      for (const pair of headerEntries(value)) {
        if (!Array.isArray(pair)) continue;
        const [k, v] = pair;
        if (typeof k !== 'string' || v == null) continue;
        const n = k.toLowerCase();
        if (names === null || names.has(n)) out[n] = '[REDACTED]';
        else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[n] = n === 'location' || n === 'referer' ? safeUrl(v) : String(v);
      }
    } catch { return Object.create(null); }
    return out;
  }

  // --- Observability config & metrics ----------------------------------------
  // obs cfg tuple: [0:enabled, 1:onRequestStart, 2:onRequestEnd, 3:redactUrl, 4:traceContext, 5:timings, 6:metrics, 7:propagateTrace, 8:debug, 9:traceOrigins]
  // metrics tuple: [0:started, 1:completed, 2:failed, 3:active, 4:attempts, 5:retries, 6:samples, 7:next, 8:count, 9:sum, 10:min, 11:max, 12:origins]
  const mkMetrics = () => [0, 0, 0, 0, 0, 0, [], 0, 0, 0, Infinity, 0, new Map()];
  const DIAG_KEYS = ['onRequestStart', 'onRequestEnd', 'redactUrl', 'traceContext', 'timings', 'metrics', 'propagateTrace', 'debug', 'traceOrigins'];
  function obsStateFor(options) {
    if (!envDebug() && !DIAG_KEYS.some((k) => options != null && Object.hasOwn(Object(options), k))) {
      return [[false, undefined, undefined, undefined, undefined, false, false, false, false, undefined], undefined, undefined];
    }
    const o = options ?? {}, c = [false];
    for (let i = 0; i < 4; i++) {
      const k = DIAG_KEYS[i], v = ownProp(o, k);
      if (v != null && typeof v !== 'function') throw invalidInput(k, 'must be a function');
      c[i + 1] = v;
    }
    for (let i = 4; i < 7; i++) {
      const k = DIAG_KEYS[i], v = ownProp(o, k);
      if (v != null && typeof v !== 'boolean') throw invalidInput(k, 'must be a boolean');
      c[i + 1] = v === true;
    }
    let dbg = ownProp(o, 'debug');
    if (dbg != null && typeof dbg !== 'boolean' && typeof dbg !== 'function') throw invalidInput('debug', 'must be a boolean or function');
    if (dbg == null) dbg = envDebug();
    c[8] = dbg;
    const to = new Set(), rawOrigins = ownProp(o, 'traceOrigins');
    if (rawOrigins != null) {
      if (!Array.isArray(rawOrigins)) throw invalidInput('traceOrigins', 'must be an array of HTTP origins');
      for (const v of rawOrigins) {
        try { const u = new URL(v); if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw 0; to.add(u.origin); }
        catch { throw invalidInput('traceOrigins', 'must contain only HTTP origins'); }
      }
    }
    c[9] = to;
    if (c[7] && (!to.size || !c[4])) throw invalidInput('propagateTrace', 'requires traceOrigins and traceContext');
    c[0] = !!(c[5] || c[6] || c[8] || c[1] || c[2] || c[7]);
    return [c, undefined, c[6] ? mkMetrics() : undefined];
  }
  const logObs = (c, e) => callSafe(c[8] === true ? (v) => console.debug('[rust-fetch]', v) : typeof c[8] === 'function' ? c[8] : undefined, e);
  function readTrace(c) {
    const ctx = c[4]();
    if (ctx == null) return;
    const parent = ownProp(ctx, 'traceparent'), st = ownProp(ctx, 'tracestate');
    if (typeof parent !== 'string' || !/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(parent) || parent.startsWith('ff-') || /^..-0{32}-/.test(parent) || /^..-[0-9a-f]{32}-0{16}-/.test(parent)) {
      throw invalidInput('traceContext', 'invalid traceparent');
    }
    if (st != null) {
      if (typeof st !== 'string' || st.length > 512 || st.split(',').length > 32) throw invalidInput('traceContext', 'invalid tracestate');
      const seen = new Set();
      for (const member of st.split(',')) {
        const [k, ...rest] = member.trim().split('='), v = rest.join('=');
        if (!/^(?:[a-z][a-z0-9_*/-]{0,255}|[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13})$/.test(k) || !v || /[^\x20-\x7e]|[,=]/.test(v) || seen.has(k)) {
          throw invalidInput('traceContext', 'invalid tracestate');
        }
        seen.add(k);
      }
    }
    return st == null ? { traceparent: parent } : { traceparent: parent, tracestate: st };
  }
  const traceHook = (c) => (target) => (c[9].has(origin(target)) ? readTrace(c) : undefined);
  function resolveObsUrl(snap, val, params) {
    const base = snap?.[0];
    if (base && typeof val === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(val)) {
      val = !val || /^[?#]/.test(val) ? base + val : base.replace(/\/+$/, '') + '/' + val.replace(/^\/+/, '');
    }
    try {
      const u = new URL(val, typeof location !== 'undefined' ? location.href : undefined);
      if (params) for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) if (x != null) u.searchParams.append(k, String(x));
      return u.href;
    } catch { return String(val); }
  }

  function rawCall(client, op, args) {
    if (op === 10 || op === 11) return dispatch.call(client, op, args[1], typeof args[0] === 'string' ? args[0] : String(args[0]), args[2], args[3], args[4]);
    return op >= 6 && op <= 8 ? dispatch.call(client, op, args[0], args[1], args[2]) : dispatch.call(client, op, args[0], args[1]);
  }

  const METHODS_SET = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
  const invReq = (p, r) => mkErr('InvalidInputError', `Invalid input for '${p}': ${r}`, { parameter: p });
  const checkMethod = (m) => {
    if (typeof m !== 'string') throw invReq('method', 'must be a string');
    const u = m.toUpperCase();
    if (u === 'CONNECT' || u === 'TRACE') throw invReq('method', `${u} is not supported by fetch()`);
    if (!METHODS_SET.has(u)) throw invReq('method', `Invalid HTTP method: ${m}`);
    return u;
  };
  const mergeReqHeaders = (a, b) => {
    const m = parseHeadersMap(a, invReq);
    if (b != null) {
      for (const [k, vs] of parseHeadersMap(b, invReq)) m.set(k, vs);
    }
    return Object.fromEntries([...m].map(([k, vs]) => [k, vs.join(', ')]));
  };

  function dispatchWithInterceptors(client, st, op, name, idx, args, reqSnapOverride, resSnapOverride) {
    const ic = st[7];
    const reqSnap = reqSnapOverride ?? (ic[1].length ? [...ic[1]] : null);
    const resSnap = resSnapOverride ?? (ic[2].length ? [...ic[2]] : null);
    if (!reqSnap?.length && !resSnap?.length) return rawCall(client, op, args);

    const opts = args[idx], url = op === 10 ? args[1] : args[0];
    const forceJson = op >= 6 && op <= 8;
    const rawMethod = op === 10 ? args[0] : op === 9 ? rawOpt(opts, 'method') ?? 'GET' : name.replace('_json', '').toUpperCase();
    let curMethod = typeof rawMethod === 'string' ? rawMethod.toUpperCase() : 'UNKNOWN', curUrl = String(url);

    let pending;
    if (!reqSnap?.length) {
      pending = rawCall(client, op, args);
    } else {
      pending = (async () => {
        const rawDl = rawOpt(opts, 'deadlineMs');
        let dlMs = ic[3];
        if (rawDl !== undefined && rawDl !== null) {
          if (typeof rawDl !== 'number' || !Number.isFinite(rawDl) || rawDl < 0) {
            throw invReq('deadlineMs', 'must be a non-negative number of milliseconds');
          }
          dlMs = rawDl === 0 ? undefined : rawDl;
        }
        curMethod = checkMethod(rawMethod);
        let hObj = mergeReqHeaders(op === 10 ? args[2] : undefined, rawOpt(opts, 'headers'));
        let curBody = forceJson ? args[1] : op === 10 ? args[3] : (op >= 3 && op <= 5) || op === 9 ? rawOpt(opts, 'body') : undefined;
        let expired = false, dlTimer, endMs;
        const runReqs = async () => {
          for (const [, fn] of reqSnap) {
            const info = { method: curMethod, url: curUrl, headers: hObj, body: curBody };
            const ret = await fn(info);
            if (expired) return;
            const out = ret != null && (typeof ret === 'object' || typeof ret === 'function') ? ret : info;
            const m = rawOpt(out, 'method');
            if (typeof m !== 'string') throw invReq('method', 'a request interceptor must leave `method` a string');
            const u = rawOpt(out, 'url');
            if (typeof u !== 'string') throw invReq('url', 'a request interceptor must leave `url` a string');
            curMethod = checkMethod(m);
            curUrl = u;
            hObj = mergeReqHeaders(rawOpt(out, 'headers'), undefined);
            curBody = rawOpt(out, 'body');
          }
        };
        if (dlMs > 0) {
          endMs = now() + dlMs;
          await new Promise((resolve, reject) => {
            dlTimer = setTimeout(() => {
              expired = true;
              const ms = Math.trunc(dlMs);
              reject(mkErr('TimeoutError', `Request total timeout after ${ms}ms`, { phase: 'total', timeoutMs: ms }));
            }, dlMs);
            runReqs().then(() => { clearTimeout(dlTimer); resolve(); }, (e) => { clearTimeout(dlTimer); reject(e); });
          });
        } else {
          await runReqs();
        }
        if (expired) return;
        const obsFn = ownProp(opts, '__observe');
        if (typeof obsFn === 'function') obsFn('method', curMethod);
        const extra = dlMs > 0 ? { __proto__: null, headers: undefined, body: undefined, __deadlineEndMs: endMs } : { __proto__: null, headers: undefined, body: undefined };
        const nextOpts = opts != null && typeof opts === 'object' ? cloneProto(opts, extra) : extra;
        return dispatch.call(client, forceJson ? 11 : 10, curUrl, curMethod, hObj, curBody, nextOpts);
      })();
    }
    if (resSnap?.length) {
      for (const [, onF, onR] of resSnap) pending = pending.then(onF, onR);
    }
    return pending.catch((e) => { throw errCtx(e, curMethod, curUrl, 0); });
  }

  function obsRequest(obs, st, op, name, idx, client, args) {
    const c = obs[0], snap = obs[1], inputUrl = args[op === 10 ? 1 : 0], input = args[idx];
    let method = methodOf(name, args, args[1]);
    const rt = ownProp(input, 'responseType'), streaming = rt === 'stream' || rt === 'ndjson';
    if (!c[0] && !streaming) {
      return dispatchWithInterceptors(client, st, op, name, idx, args).catch((e) => { if (c[3]) throw errCtx(e, method, inputUrl, 0, c[3]); scrubUrls(e); throw e; });
    }
    const opts = input && typeof input === 'object' ? cloneProto(input) : input == null ? { __proto__: null } : input;
    let url = resolveObsUrl(snap, inputUrl, ownProp(opts, 'params'));
    const start = now(), timings = { queuedMs: 0, retryDelayMs: 0, attempts: [], totalMs: 0 };
    let queue, last, ended = false, cause, bucket;
    const summary = (type, extra) => ({ type, method: typeof method === 'string' && /^[A-Za-z]{1,16}$/.test(method) ? method.toUpperCase() : 'UNKNOWN', url: safeUrl(url, c[3]), ...extra });
    const reqSens = option(opts, 'sensitiveHeaders');
    const sens = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie', ...(snap?.[2] ?? []), ...(Array.isArray(reqSens) ? reqSens.filter((n) => typeof n === 'string') : [])].map((n) => n.toLowerCase()));
    const redactSet = reqSens != null && (!Array.isArray(reqSens) || reqSens.some((n) => typeof n !== 'string')) ? null : sens;
    const m = obs[2];
    if (m) {
      m[0]++; m[3]++;
      const k = origin(url);
      if (!m[12].has(k) && m[12].size < 128) m[12].set(k, { started: 0, completed: 0, failed: 0, active: 0 });
      bucket = m[12].get(k); if (bucket) { bucket.started++; bucket.active++; }
    }
    callSafe(c[1], summary('requestStart'));
    logObs(c, summary('request', { headers: { ...safeHeaders(snap?.[1], redactSet), ...safeHeaders(op === 10 ? args[2] : undefined, redactSet), ...safeHeaders(option(opts, 'headers'), redactSet) } }));
    const observe = (type, value) => {
      if (ended) return;
      const t = now();
      if (type === 'method') method = value;
      else if (type === 'resolved') { url = value; logObs(c, summary('resolved')); }
      else if (type === 'queueStart' || type === 'transportQueued') queue = t;
      else if (type === 'transportStart') { if (queue != null) timings.queuedMs += t - queue; queue = undefined; }
      else if (type === 'attemptStart') {
        cause = undefined;
        if (queue != null) timings.queuedMs += t - queue; queue = undefined;
        last = { __proto__: null, startMs: t - start, ttfbMs: null, totalMs: 0 }; timings.attempts.push(last);
        logObs(c, summary(type, { attempt: timings.attempts.length }));
      } else if (type === 'headers' && last) {
        last.ttfbMs = t - start - last.startMs; if (value) { last.status = value.status; if (value.url) url = value.url; }
      } else if (type === 'attemptEnd' && last) {
        last.totalMs = t - start - last.startMs;
        if (typeof value === 'number') last.status = value;
        if (typeof value === 'string') last.error = value;
        logObs(c, summary(type, { attempt: timings.attempts.length, status: last.status, error: last.error ? { kind: last.error } : undefined, totalMs: last.totalMs }));
      } else if (type === 'retry') { timings.retryDelayMs += value.delayMs; logObs(c, summary(type, value)); }
      else if (type === 'cause') cause = value;
      else if (type === 'transport' && last) last.transport = value;
      else if (type === 'connection' && last) Object.assign(last, value);
      else if (type === 'redirect') logObs(c, summary(type, { status: value.status, location: safeUrl(value.url, c[3]) }));
    };
    if (opts && typeof opts === 'object') {
      opts.__observe = observe;
      if (c[7]) opts.__trace = traceHook(c);
      args[idx] = opts;
    }
    const end = (res, err, failed = false) => {
      if (ended) return; ended = true;
      timings.totalMs = now() - start;
      if (streaming && last) last.totalMs = timings.totalMs - last.startMs;
      if (last && res) last.status = res.status;
      if (last && failed && !last.error) last.error = err?.kind;
      if (failed) {
        errCtx(err, method, url, timings.attempts.length, c[3]);
        try { if (cause && err && typeof err === 'object' && cause !== err && err.cause === undefined) err.cause = cause; } catch {}
      }
      const target = failed ? err : res;
      if ((c[5] || c[2] || c[8]) && target && typeof target === 'object') { try { target.timings = timings; } catch {} }
      if (m) {
        m[3]--; m[1]++; m[2] += +failed; m[4] += timings.attempts.length; m[5] += Math.max(0, timings.attempts.length - 1);
        m[6][m[7]++ % 1024] = timings.totalMs; m[8]++; m[9] += timings.totalMs; m[10] = Math.min(m[10], timings.totalMs); m[11] = Math.max(m[11], timings.totalMs);
        if (bucket) { bucket.active--; bucket.completed++; bucket.failed += +failed; }
      }
      const entry = summary('requestEnd', { status: res?.status ?? err?.status, error: failed ? { kind: ERROR_KINDS.has(err?.kind) ? err.kind : undefined, status: typeof err?.status === 'number' ? err.status : undefined, phase: ['connect', 'response', 'idle', 'total'].includes(err?.phase) ? err.phase : undefined } : undefined, timings });
      callSafe(c[2], entry); logObs(c, entry);
    };
    let pending;
    try { pending = dispatchWithInterceptors(client, st, op, name, idx, args); } catch (e) { end(undefined, e, true); throw e; }
    return pending.then((res) => {
      url = res.url || url;
      if (res.body instanceof ReadableStream) {
        const reader = res.body.getReader(); res.timings = timings;
        res.body = safeStream({
          async pull(ctl) {
            try { const step = await reader.read(); if (step.done) { end(res); reader.releaseLock(); ctl.close(); } else ctl.enqueue(step.value); }
            catch (e) { end(undefined, e, true); reader.releaseLock(); ctl.error(e); }
          },
          async cancel(reason) { try { await reader.cancel(reason); } finally { end(res); reader.releaseLock(); } },
        }, 0);
      } else end(res);
      return res;
    }, (e) => { end(undefined, e, true); throw e; });
  }

  // --- Auth (#70) ------------------------------------------------------------
  const authHeader = async (auth) => {
    if (auth.basic) return `Basic ${btoa(String.fromCharCode(...encodeUtf8(`${auth.basic.username}:${auth.basic.password}`)))}`;
    const t = typeof auth.bearer === 'function' ? await auth.bearer() : auth.bearer;
    return t == null || t === '' ? undefined : `Bearer ${t}`;
  };
  function validateAuth(auth, baseUrl) {
    if (auth === null || typeof auth !== 'object') throw invalidInput('auth', 'must be an object');
    const { bearer, basic, refresh, origins } = auth;
    if ((bearer === undefined) === (basic === undefined)) throw invalidInput('auth', 'needs exactly one of bearer and basic');
    if (bearer !== undefined && typeof bearer !== 'string' && typeof bearer !== 'function') throw invalidInput('auth.bearer', 'must be a string or a function');
    if (basic !== undefined && (basic === null || typeof basic.username !== 'string' || typeof basic.password !== 'string')) throw invalidInput('auth.basic', 'must be { username, password } strings');
    if (refresh !== undefined && (typeof refresh !== 'function' || basic !== undefined)) throw invalidInput('auth.refresh', 'must be a function, and needs bearer');
    if (origins !== undefined && (!Array.isArray(origins) || origins.some((o) => typeof o !== 'string' || originOf(o) === undefined))) throw invalidInput('auth.origins', 'must be an array of URLs');
    const allowed = new Set((origins ?? []).map((o) => originOf(o)));
    if (baseUrl != null) allowed.add(originOf(baseUrl));
    if (allowed.size === 0 || allowed.has(undefined)) throw invalidInput('auth', 'needs a valid baseUrl or auth.origins: credentials are only sent to origins you name');
    return allowed;
  }
  // auth tuple: [0:auth, 1:origins, 2:baseUrl, 3:epoch, 4:outcome, 5:refreshing]
  const installAuth = (ic, a) => {
    ic[1].push([0, async (req) => {
      if (!a[1].has(originOf(req.url, a[2]))) return;
      if (Object.keys(req.headers).some((n) => n.toLowerCase() === 'authorization')) return;
      const h = await authHeader(a[0]);
      if (h) req.headers.authorization = h;
    }, true]);
  };
  const replayable = (args) => typeof ReadableStream === 'undefined' || !args.some((a) => a instanceof ReadableStream || a?.body instanceof ReadableStream);

  // --- Dedupe (#46) ----------------------------------------------------------
  const cloneRes = (r) => ({ ...r, headers: { ...r.headers }, body: cloneValue(r.body) });
  function dedupeKey(name, url, options) {
    const rest = {};
    for (const [k, v] of Object.entries(options ?? {})) {
      if (k === 'signal' || k === 'dedupe' || v === undefined) continue;
      if (typeof v === 'function' || (k === 'responseType' && (v === 'stream' || v === 'ndjson'))) return;
      rest[k] = k === 'headers' ? headerEntries(v).map(([hk, hv]) => [String(hk).toLowerCase(), String(hv)]).sort() : v;
    }
    try { return JSON.stringify([name, url, Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : 1))]); } catch {}
  }

  // --- HTTP Cache (#45) ------------------------------------------------------
  const STORABLE = new Set([200, 203, 204]), GET_LIKE = new Set(['get', 'fetch', 'request']);
  const parseCC = (v) => Object.fromEntries(String(v ?? '').toLowerCase().split(',').map((p) => p.trim().split('=')).filter(([k]) => k).map(([k, x]) => [k, x === undefined ? true : x.replace(/"/g, '')]));
  const natural = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
  function cacheLimits(cfg) {
    const { maxEntries = 100, maxBytes = 50_000_000, maxEntryBytes = 1_000_000, ...rest } = cfg === true ? {} : cfg;
    for (const [k, v] of Object.entries({ maxEntries, maxBytes, maxEntryBytes })) if (!Number.isInteger(v) || v < 1) throw invalidInput(`httpCache.${k}`, 'must be a positive integer');
    if (Object.keys(rest).length) throw invalidInput(`httpCache.${Object.keys(rest)[0]}`, 'is not an option');
    return [maxEntries, maxBytes, maxEntryBytes];
  }
  const resSize = (r) => {
    const b = r.body;
    return (typeof b === 'string' ? b.length * 2 : b?.byteLength ?? b?.size ?? natural(r.headers['content-length']) ?? 1024) + 512;
  };
  // cache state: [0:Map, 1:bytes, 2:[maxEntries, maxBytes, maxEntryBytes], 3:baseUrl]
  // entry tuple: [0:res, 1:storedAt, 2:initialAge, 3:lifetime, 4:noCache, 5:etag, 6:lastMod, 7:vary, 8:bytes]
  const entryAge = (e) => e[2] + (Date.now() - e[1]);
  const cacheKey = (baseUrl, url, params) => {
    try {
      const u = new URL(url, baseUrl);
      for (const [k, v] of headerEntries(params)) for (const x of [].concat(v)) if (x != null) u.searchParams.append(k, String(x));
      u.hash = ''; return u.href;
    } catch {}
  };
  const forgetCache = (cs, k) => { const e = cs[0].get(k); if (e) { cs[0].delete(k); cs[1] -= e[8]; } };
  function storeCache(cs, k, res, reqHdrs) {
    const h = res.headers, cc = parseCC(h['cache-control']);
    if (!STORABLE.has(res.status) || cc['no-store'] || h.vary?.trim() === '*') return forgetCache(cs, k);
    const exp = natural(cc['max-age']) ?? (h.expires === undefined ? undefined : Math.max(0, (Date.parse(h.expires) - (Date.parse(h.date) || Date.now())) / 1000 || 0));
    if (exp === undefined && !h.etag && !h['last-modified']) return forgetCache(cs, k);
    const sz = resSize(res);
    if (sz > cs[2][2]) return forgetCache(cs, k);
    forgetCache(cs, k);
    cs[0].set(k, [
      { status: res.status, statusText: res.statusText, ok: res.ok, url: res.url, headers: { ...h }, body: cloneValue(res.body) },
      Date.now(), (natural(h.age) ?? 0) * 1000, exp === undefined ? undefined : exp * 1000,
      Boolean(cc['no-cache']), h.etag, h['last-modified'],
      String(h.vary ?? '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean).map((n) => [n, reqHdrs[n] ?? '']), sz,
    ]);
    cs[1] += sz;
    for (const [oldest] of cs[0]) { if (cs[0].size <= cs[2][0] && cs[1] <= cs[2][1]) break; forgetCache(cs, oldest); }
  }
  const cacheHit = (e, rev) => ({ ...e[0], headers: { ...e[0].headers, age: String(Math.floor(entryAge(e) / 1000)) }, body: cloneValue(e[0].body), cached: true, revalidated: rev });
  const bypassCache = (o) => (o == null || typeof o !== 'object' ? o : cloneProto(o, { httpCache: undefined }));
  const bypassArgs = (args, idx) => { const n = [...args]; n[idx] = bypassCache(args[idx]); return n; };

  // --- Schema (#43) & Resume (#51) & Extend (#69) & Paginate (#44) -----------
  const checkSchema = (o) => {
    const sc = rawOpt(o, 'schema');
    if (sc === undefined) return;
    if (sc === null || (typeof sc !== 'object' && typeof sc !== 'function') || typeof sc['~standard']?.validate !== 'function') {
      throw invalidInput('schema', 'must be a Standard Schema (a validator with ~standard.validate)');
    }
    const rt = rawOpt(o, 'responseType');
    if (rt === 'stream' || rt === 'ndjson') throw invalidInput('schema', 'cannot validate a streamed responseType');
    return sc['~standard'];
  };
  const runSchema = async (method, res, std) => {
    const r = await std.validate(res.body);
    if (!r.issues) return { ...res, body: r.value };
    const issues = [...r.issues];
    throw Object.assign(new Error(`Response validation failed: ${issues.length} issue${issues.length === 1 ? '' : 's'}`), {
      name: 'ValidationError', kind: 'ValidationError', issues, method, url: res.url, status: res.status,
    });
  };
  function followResume(client, url, rest, res, maxResumes) {
    const h = res.headers, val = h.etag && !h.etag.startsWith('W/') ? h.etag : h['last-modified'];
    if (res.status !== 200 || h['accept-ranges'] !== 'bytes' || !val || (h['content-encoding'] && h['content-encoding'] !== 'identity')) return res;
    let reader = res.body.getReader(), received = 0, resumes = 0;
    const body = safeStream({
      async pull(ctl) {
        for (;;) {
          try {
            const { done, value } = await reader.read();
            if (done) return ctl.close();
            received += value.byteLength;
            return ctl.enqueue(value);
          } catch (err) {
            if ((err?.kind !== 'NetworkError' && err?.kind !== 'TimeoutError') || resumes >= maxResumes) return ctl.error(err);
            resumes++;
            try {
              const next = await client.get(url, { ...rest, headers: { ...lowerHeaders(rest.headers), range: `bytes=${received}-`, 'if-range': val } });
              if (next.status !== 206 || !String(next.headers['content-range'] ?? '').startsWith(`bytes ${received}-`)) {
                next.body.cancel().catch(() => {});
                return ctl.error(Object.assign(err, { cause: err.cause ?? new Error('The download could not be resumed: the server did not continue from the same byte, or the file changed') }));
              }
              reader = next.body.getReader();
            } catch (re) { return ctl.error(Object.assign(err, { cause: err.cause ?? re })); }
          }
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return Object.defineProperty({ ...res, body }, 'resumes', { __proto__: null, get: () => resumes, enumerable: true });
  }
  const mergeHeaders = (a, b) => {
    const m = new Map();
    for (const [k, v] of [...headerEntries(a), ...headerEntries(b)]) m.set(String(k).toLowerCase(), [k, v]);
    return Object.fromEntries(m.values());
  };
  const linkNext = (res) => {
    for (const [, target, params] of String(res.headers?.link ?? '').matchAll(/<([^>]*)>((?:\s*;\s*(?:[^;,"<]|"[^"]*")+)*)/g)) {
      const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;,\s]+))/i.exec(params);
      if ((rel?.[1] ?? rel?.[2] ?? '').toLowerCase().split(/\s+/).includes('next')) return target;
    }
  };

  // --- Unified Request Pipeline (outer -> inner) -----------------------------
  function sendInner(client, st, op, name, idx, args) {
    // Stage 6: custom transport
    if (st[1]) {
      args = [...args];
      args.length = Math.max(args.length, idx + 1);
      args[idx] = cloneProto(args[idx], { __transport: st[1] });
    }
    // Stage 7: responseType: 'blob'
    const o = args[idx];
    let wantBlob = false;
    if (rawOpt(o, 'responseType') === 'blob') {
      if (typeof Blob === 'undefined') return Promise.reject(invalidInput('responseType', "responseType 'blob' needs a runtime with Blob"));
      wantBlob = true;
      args = [...args];
      args[idx] = cloneProto(o, { responseType: 'binary' });
    }
    // Stage 8: observability -> interceptors -> Rust dispatch
    const obs = st[0], c = obs[0], rt = ownProp(args[idx], 'responseType');
    const pending = c[0] || c[3] || rt === 'stream' || rt === 'ndjson'
      ? obsRequest(obs, st, op, name, idx, client, args)
      : dispatchWithInterceptors(client, st, op, name, idx, args);
    return wantBlob
      ? pending.then((r) => ({ ...r, body: new Blob(r.body ? [r.body] : [], { type: String(r.headers['content-type'] ?? '').toLowerCase() }) }))
      : pending;
  }

  function sendAuth(client, st, op, name, idx, args) {
    const a = st[2];
    if (!a?.[0].refresh) return sendInner(client, st, op, name, idx, args);
    const epoch = a[3];
    return sendInner(client, st, op, name, idx, args).catch(async (err) => {
      if (err?.kind !== 'HttpError' || err.status !== 401 || !a[1].has(originOf(err.url, a[2])) || !replayable(args)) throw err;
      if (a[3] === epoch) {
        a[5] ??= Promise.resolve().then(() => a[0].refresh()).then(() => ({}), (cause) => ({ cause })).then((out) => { a[3]++; a[4] = out; a[5] = undefined; });
        await a[5];
      }
      if (a[4].cause !== undefined) { err.cause ??= a[4].cause; throw err; }
      return sendInner(client, st, op, name, idx, args);
    });
  }

  function sendDedupe(client, st, op, name, idx, args) {
    if (op > 1) return sendAuth(client, st, op, name, idx, args);
    const url = args[0], o = args[1], d = st[3];
    const reqD = rawOpt(o, 'dedupe');
    if (reqD !== undefined && typeof reqD !== 'boolean') return Promise.reject(invalidInput('dedupe', 'must be a boolean'));
    if (!(reqD ?? d[0])) return sendAuth(client, st, op, name, idx, args);
    const key = typeof url === 'string' ? dedupeKey(name, url, o) : undefined;
    const sig = rawOpt(o, 'signal');
    if (key === undefined || sig?.aborted) return sendAuth(client, st, op, name, idx, args);
    const inflight = d[1];
    let created = false, sh = inflight.get(key);
    if (!sh) {
      const ctl = new AbortController(), { signal: _s, dedupe: _d, ...rest } = o ?? {};
      sh = [ctl, 0, sendAuth(client, st, op, name, idx, [url, { ...rest, signal: ctl.signal }])];
      const forget = () => { if (inflight.get(key) === sh) inflight.delete(key); };
      sh[2].then(forget, forget);
      inflight.set(key, sh);
      created = true;
    }
    sh[1]++;
    return new Promise((resolve, reject) => {
      let done = false;
      const fin = (cb, v) => { if (!done) { done = true; sig?.removeEventListener('abort', onAb); sh[1]--; cb(v); } };
      const onAb = () => {
        if (!done) {
          done = true;
          reject(mkErr('CancelledError', 'Request was cancelled', { reason: sig.reason, cause: sig.reason }));
          if (--sh[1] === 0) { sh[0].abort(sig?.reason); if (inflight.get(key) === sh) inflight.delete(key); }
        }
      };
      sig?.addEventListener('abort', onAb, { __proto__: null, once: true });
      sh[2].then((r) => { if (!done) fin(resolve, created ? r : cloneRes(r)); }, (e) => fin(reject, e));
    });
  }

  function sendCache(client, st, op, name, idx, args) {
    const cs = st[4];
    if (!cs) return sendDedupe(client, st, op, name, idx, args);
    const o = args[idx], hc = rawOpt(o, 'httpCache');
    if (hc !== undefined && typeof hc !== 'boolean') return Promise.reject(invalidInput('httpCache', 'must be a boolean'));
    const method = String(op === 10 ? args[0] : op === 9 || (op >= 3 && op <= 5) ? rawOpt(o, 'method') ?? (op === 9 ? 'GET' : name) : name.replace('_json', '')).toUpperCase();
    const url = op === 10 ? args[1] : args[0], key = typeof url === 'string' ? cacheKey(cs[3], url, rawOpt(o, 'params')) : undefined;
    if (key === undefined) return sendDedupe(client, st, op, name, idx, args);
    if (method !== 'GET' || !GET_LIKE.has(name)) {
      const done = sendDedupe(client, st, op, name, idx, args);
      if (method !== 'HEAD') done.then(() => forgetCache(cs, key), () => {});
      return done;
    }
    const rt = rawOpt(o, 'responseType');
    if (hc === false || rt === 'stream' || rt === 'ndjson') return sendDedupe(client, st, op, name, idx, bypassArgs(args, idx));
    const hdrs = lowerHeaders(op === 10 ? args[2] ?? rawOpt(o, 'headers') : rawOpt(o, 'headers')), reqCC = parseCC(hdrs['cache-control']);
    if (reqCC['no-store'] || hdrs['if-none-match'] || hdrs['if-modified-since']) return sendDedupe(client, st, op, name, idx, bypassArgs(args, idx));
    let e = cs[0].get(key);
    if (e && !e[7].every(([hk, hv]) => (hdrs[hk] ?? '') === hv)) e = undefined;
    if (e) { cs[0].delete(key); cs[0].set(key, e); }
    if (e && !e[4] && e[3] !== undefined && entryAge(e) < e[3] && !reqCC['no-cache']) return Promise.resolve(cacheHit(e, false));
    const val = e?.[5] ? { 'if-none-match': e[5] } : e?.[6] ? { 'if-modified-since': e[6] } : undefined;
    const nextArgs = val ? (() => {
      const n = [...args], base = bypassCache(o) ?? {};
      if (op === 10) { n[2] = { ...lowerHeaders(n[2]), ...val }; n[idx] = base; }
      else n[idx] = cloneProto(base, { headers: { ...lowerHeaders(base.headers), ...val } });
      return n;
    })() : args;
    return sendDedupe(client, st, op, name, idx, nextArgs).then((r) => {
      storeCache(cs, key, r, hdrs);
      return { ...r, cached: false, revalidated: false };
    }, (err) => {
      if (e && val && err?.kind === 'HttpError' && err.status === 304 && cs[0].get(key) === e) {
        e[1] = Date.now(); e[2] = 0; return cacheHit(e, true);
      }
      throw err;
    });
  }

  function sendFull(client, st, op, name, idx, args) {
    // Stage 1: resume (GET only)
    const rsm = op === 0 ? rawOpt(args[1], 'resume') : undefined;
    if (rsm !== undefined && rsm !== false) {
      const o = args[1], cfg = rsm === true ? {} : rsm;
      if (cfg === null || typeof cfg !== 'object') return Promise.reject(invalidInput('resume', 'must be true or { maxResumes }'));
      const { maxResumes = 3, ...unknown } = cfg;
      if (!Number.isInteger(maxResumes) || maxResumes < 1 || Object.keys(unknown).length) return Promise.reject(invalidInput('resume', 'maxResumes must be a positive integer'));
      if (rawOpt(o, 'responseType') !== 'stream') return Promise.reject(invalidInput('resume', "needs responseType: 'stream'"));
      const { resume: _, ...rest } = o;
      return sendFull(client, st, 0, 'get', 1, [args[0], rest]).then((r) => followResume(client, args[0], rest, r, maxResumes));
    }
    // Stage 2: schema
    let std;
    try { std = checkSchema(args[idx]); } catch (e) { return Promise.reject(e); }
    const pending = sendCache(client, st, op, name, idx, args);
    return std ? pending.then((r) => runSchema(String(methodOf(name, args, args[1])).toUpperCase(), r, std)) : pending;
  }

  // --- Single unified WasmClient class ---------------------------------------
  // state tuple: [0:obs, 1:transport, 2:auth, 3:dedupe, 4:cache, 5:savedOpts, 6:fast, 7:interceptors]
  // interceptors tuple: [0:nextId, 1:reqList, 2:resList, 3:clientDeadlineMs]
  const mkState = () => [obsStateFor(), undefined, undefined, [false, new Map()], undefined, { __proto__: null }, true, [0, [], [], undefined]];
  class Client extends Base {
    constructor(options) {
      const cacheCfg = ownProp(options, 'httpCache');
      if (cacheCfg !== undefined && cacheCfg !== true && cacheCfg !== false && (cacheCfg === null || typeof cacheCfg !== 'object')) {
        throw invalidInput('httpCache', 'must be true or an object');
      }
      const lim = cacheCfg ? cacheLimits(cacheCfg) : undefined;
      const dedupeOpt = ownProp(options, 'dedupe');
      if (dedupeOpt !== undefined && typeof dedupeOpt !== 'boolean') throw invalidInput('dedupe', 'must be a boolean');
      const authOpt = ownProp(options, 'auth'), baseUrl = option(options, 'baseUrl');
      const authOrigins = authOpt === undefined ? undefined : validateAuth(authOpt, baseUrl);
      const tr = ownProp(options, 'transport');
      if (tr != null && typeof tr !== 'function') throw invalidInput('transport', 'must be a function');
      const obs = obsStateFor(options);
      super(options);
      const sens = option(options, 'sensitiveHeaders');
      obs[1] = [option(options, 'baseUrl'), obs[0][8] ? safeHeaders(option(options, 'headers'), new Set()) : undefined, Array.isArray(sens) ? [...sens] : undefined];
      const rawDl = rawOpt(options, 'deadlineMs');
      const ic = [0, [], [], typeof rawDl === 'number' && rawDl > 0 ? rawDl : undefined];
      const auth = authOpt === undefined ? undefined : [authOpt, authOrigins, baseUrl, 0, undefined, undefined];
      if (auth) installAuth(ic, auth);
      const cache = lim ? [new Map(), 0, lim, baseUrl] : undefined;
      const fast = !obs[0][0] && !obs[0][3] && !tr && !auth && !dedupeOpt && !cache;
      _st.set(this, [obs, tr ?? undefined, auth, [dedupeOpt === true, new Map()], cache, Object.assign({ __proto__: null }, options), fast, ic]);
    }
    addRequestInterceptor(fn) {
      let st = _st.get(this); if (!st) _st.set(this, st = mkState());
      const id = ++st[7][0];
      st[7][1].push([id, fn, false]);
      st[6] = false;
      return id;
    }
    addResponseInterceptor(onF, onR) {
      let st = _st.get(this); if (!st) _st.set(this, st = mkState());
      const id = ++st[7][0];
      st[7][2].push([id, onF ?? undefined, onR ?? undefined]);
      st[6] = false;
      return id;
    }
    ejectInterceptor(id) {
      const ic = _st.get(this)?.[7];
      if (!ic) return false;
      const before = ic[1].length + ic[2].length;
      ic[1] = ic[1].filter((e) => e[2] || e[0] !== id);
      ic[2] = ic[2].filter((e) => e[0] !== id);
      return before !== ic[1].length + ic[2].length;
    }
    clearInterceptors() {
      const ic = _st.get(this)?.[7];
      if (ic) { ic[1] = ic[1].filter((e) => e[2]); ic[2] = []; }
    }
    extend(overrides) {
      if (overrides != null && typeof overrides !== 'object') throw invalidInput('options', 'must be an object');
      const st = _st.get(this), opts = Object.assign({ __proto__: null }, st?.[5]);
      for (const [k, v] of Object.entries(overrides ?? {})) {
        if (v === undefined) continue;
        if (k === 'headers' && v !== null && typeof v !== 'object') throw invalidInput('headers', 'must be an object, Headers, Map or array of pairs');
        opts[k] = k === 'headers' ? mergeHeaders(opts.headers, v) : v;
      }
      const child = new Client(opts);
      if (st) {
        for (const [, fn, isAuth] of st[7][1]) if (!isAuth) child.addRequestInterceptor(fn);
        for (const [, f, r] of st[7][2]) child.addResponseInterceptor(f, r);
      }
      return child;
    }
    stats() {
      let st = _st.get(this); if (!st) _st.set(this, st = mkState());
      const obs = st[0];
      obs[2] ??= mkMetrics(); obs[0][0] = true; st[6] = false;
      const m = obs[2], s = [...m[6]].sort((a, b) => a - b);
      const p = (n) => (s.length ? s[Math.min(s.length - 1, Math.ceil(n * s.length) - 1)] : null);
      return {
        requests: { started: m[0], completed: m[1], failed: m[2], active: m[3] }, attempts: m[4], retries: m[5],
        latency: { count: m[8], minMs: m[8] ? m[10] : null, maxMs: m[8] ? m[11] : null, meanMs: m[8] ? m[9] / m[8] : null, p50Ms: p(0.5), p95Ms: p(0.95), p99Ms: p(0.99), sampleCount: s.length },
        origins: Object.fromEntries([...m[12]].map(([k, v]) => [k, { ...v }])), pools: nodeDiagnostics ? nodeDiagnostics() : null,
      };
    }
    async *paginate(url, options) {
      if (options != null && typeof options !== 'object') throw invalidInput('options', 'must be an object');
      const { items, next = linkNext, maxPages = 1000, crossOrigin = false, ...request } = options ?? {};
      if (items !== undefined && typeof items !== 'function') throw invalidInput('items', 'must be a function');
      if (typeof next !== 'function') throw invalidInput('next', 'must be a function');
      if (!Number.isInteger(maxPages) || maxPages < 1) throw invalidInput('maxPages', 'must be a positive integer');
      const seen = new Set();
      let target = url, init = request;
      for (let page = 0; page < maxPages; page++) {
        const res = await this.get(target, init);
        if (items) yield* await items(res); else yield res;
        const more = await next(res);
        if (!more) return;
        const spec = typeof more === 'string' ? { url: more } : more;
        if (spec === null || typeof spec !== 'object' || (spec.url !== undefined && typeof spec.url !== 'string')) {
          throw invalidInput('next', 'must return a URL, { url?, params? } or nothing');
        }
        if (spec.url !== undefined) {
          const resolved = new URL(spec.url, res.url);
          if (resolved.origin !== new URL(res.url).origin && !crossOrigin) throw invalidInput('next', `points to another origin (${resolved.origin}); set crossOrigin: true to follow it`);
          target = resolved.href; init = { ...request, params: spec.params };
        } else init = { ...request, params: { ...request.params, ...spec.params } };
        const key = JSON.stringify([target, init.params]);
        if (seen.has(key)) return;
        seen.add(key);
      }
    }
  }

  for (const name of ['events', 'websocket']) {
    const raw = bp[name];
    defineMethod(Client.prototype, name, function (url, options) {
      const obs = _st.get(this)?.[0] ?? obsStateFor(), c = obs[0];
      let target = resolveObsUrl(obs[1], url, ownProp(options, 'params'));
      if (name === 'websocket') target = target.replace(/^http(s?):/, 'ws$1:');
      const method = name === 'websocket' ? 'GET' : ownProp(options, 'method') ?? 'GET';
      let attempts = 0;
      const init = cloneProto(options ?? {});
      if (name === 'events' && c[7]) init.__trace = traceHook(c);
      for (const hook of ['onOpen', 'onError', 'onClose', 'onReconnect']) {
        const app = prop(init, hook);
        if (app != null && typeof app !== 'function') continue;
        Object.defineProperty(init, hook, { __proto__: null, value: (ev) => {
          if (hook === 'onReconnect') attempts++;
          if (hook === 'onError') errCtx(ev, method, target, Math.max(1, attempts), c[3]);
          logObs(c, { type: name + ':' + hook.slice(2).toLowerCase(), method, url: safeUrl(target, c[3]), error: hook === 'onError' ? { kind: ev?.kind } : undefined });
          return app?.(ev);
        }, enumerable: true });
      }
      try {
        const conn = raw.call(this, url, init);
        if (name === 'websocket') {
          target = conn.url;
          for (const m of ['send', 'sendJson', 'close']) {
            const fn = conn[m].bind(conn);
            conn[m] = (...a) => { try { return fn(...a); } catch (e) { throw errCtx(e, 'GET', target, Math.max(1, attempts), c[3]); } };
          }
        }
        attempts = 1;
        const opened = conn.opened.catch((e) => { throw errCtx(e, method, target, Math.max(1, attempts), c[3]); });
        opened.catch(() => {});
        Object.defineProperty(conn, 'opened', { __proto__: null, value: opened, configurable: true });
        if (name === 'events') {
          const nxt = conn.next.bind(conn);
          conn.next = (...a) => nxt(...a).catch((e) => { throw errCtx(e, method, target, Math.max(1, attempts), c[3]); });
        }
        return conn;
      } catch (e) { throw errCtx(e, method, target, attempts, c[3]); }
    });
  }

  for (const [name, op] of [
    ['get', 0], ['head', 1], ['delete', 2], ['post', 3], ['put', 4], ['patch', 5],
    ['post_json', 6], ['put_json', 7], ['patch_json', 8], ['fetch', 9], ['request', 10],
  ]) {
    const idx = optionsArgIndex(name);
    defineMethod(Client.prototype, name, function (...args) {
      let st = _st.get(this); if (!st) _st.set(this, st = mkState());
      const o = args[idx];
      if (st[6] && (o == null || (typeof o === 'object' && (rawOpt(o, 'resume') === undefined || rawOpt(o, 'resume') === false) && rawOpt(o, 'schema') === undefined && rawOpt(o, 'dedupe') === undefined && rawOpt(o, 'responseType') !== 'blob' && rawOpt(o, 'responseType') !== 'stream' && rawOpt(o, 'responseType') !== 'ndjson'))) {
        return rawCall(this, op, args);
      }
      return sendFull(this, st, op, name, idx, args);
    });
  }

  _sseSnap = (client) => [...(_st.get(client)?.[7][1] ?? [])];
  _sseSend = (client, reqSnap, target, method, body, attemptOpts) => {
    let st = _st.get(client); if (!st) _st.set(client, st = mkState());
    return dispatchWithInterceptors(client, st, 10, 'request', 4, [method, target, undefined, body, attemptOpts], reqSnap, []);
  };

  setFnName(Client, 'WasmClient');
  WasmClient = Client;

  fetch_json = fetch_json_promise = fetch_wasm_json = fetch_wasm_map = fetch_wasm_api = (url) => new WasmClient().get(url, { responseType: 'json' }).then((r) => r.body);
  fetch_text = fetch_wasm_html = (url) => new WasmClient().get(url, { responseType: 'text' }).then((r) => r.body);
  fetch_with_options = (url, method, headers, body) => new WasmClient().request(method, url, headers, body ?? undefined);
})();
