// WebSocketConnection and EventStream built on the Rust core's client config,
// HTTP streaming pipeline, and fuzzed SSE parser (`__SseParser`).
const connPrivateCtor = () => { throw new TypeError('Illegal constructor'); };

const CONN_TOKEN = Symbol(), _conn = new WeakMap();

export class WebSocketConnection {
  constructor(t, a) { if (t !== CONN_TOKEN) connPrivateCtor(); _conn.set(this, a); }
  free() {}
  [Symbol.dispose]() {}
  get url() { return _conn.get(this)[0]; }
  get state() { return _conn.get(this)[1](); }
  get protocol() { return _conn.get(this)[2](); }
  get bufferedAmount() { return _conn.get(this)[3](); }
  get opened() { return _conn.get(this)[4]; }
  get closed() { return _conn.get(this)[5]; }
  send(d) { return _conn.get(this)[6](d); }
  sendJson(v) { return _conn.get(this)[7](v); }
  close(c, r) { return _conn.get(this)[8](c, r); }
}

export class EventStream {
  constructor(t, a) { if (t !== CONN_TOKEN) connPrivateCtor(); _conn.set(this, a); }
  free() {}
  [Symbol.dispose]() {}
  [Symbol.asyncIterator]() { return this; }
  get url() { return _conn.get(this)[0]; }
  get state() { return _conn.get(this)[1](); }
  get lastEventId() { return _conn.get(this)[2](); }
  get opened() { return _conn.get(this)[3]; }
  get closed() { return _conn.get(this)[4]; }
  close() { _conn.get(this)[5](); }
  next() { return _conn.get(this)[6](); }
  return() { return _conn.get(this)[7](); }
}

(() => {
  setFnName(EventStream, 'EventStream');
  setFnName(WebSocketConnection, 'WebSocketConnection');
  const proto = WasmClient.prototype, getMeta = proto.__clientMeta, rawRequest = proto.request;
  delete proto.__clientMeta;

  const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
  const WS_RETRY = new Set([1001, 1006, 1011, 1012, 1013, 1014]);
  const SSE_RETRY = new Set([408, 429, 500, 502, 503, 504]);
  const SSE_FWD = [
    'headers', 'params', 'timeoutMs', 'connectTimeoutMs', 'responseTimeoutMs', 'idleTimeoutMs',
    'retries', 'idempotencyHeader', 'allowAbsoluteUrls', 'credentials', 'mode', 'cache',
    'keepalive', 'priority', 'referrer', 'referrerPolicy', 'integrity', '__trace',
    // Per-request safety limits: dropping them would silently weaken SSRF and credential protection
    'allowPrivateNetwork', 'sensitiveHeaders', 'allowInsecureRedirects', 'maxResponseBytes', 'redirect', 'maxRedirects',
  ];

  const inv = (p, r) => mkErr('InvalidInputError', `Invalid input for '${p}': ${r}`, { parameter: p });
  const net = (m, x) => mkErr('NetworkError', `Network error: ${m}`, x);
  const prs = (m) => mkErr('ParseError', `Parse error: ${m}`);
  const tmo = (ms, ph) => mkErr('TimeoutError', ph ? `Request ${ph} timeout after ${ms}ms` : `Request timeout after ${ms}ms`, ph ? { phase: ph, timeoutMs: ms } : { timeoutMs: ms });
  const cnc = (sig) => mkErr('CancelledError', 'Request was cancelled', sig?.aborted ? { reason: sig.reason, cause: sig.reason } : undefined);
  const ctx = (e, m, u, a) => {
    if (e && typeof e === 'object') {
      try { if (!Object.hasOwn(e, 'method')) e.method = m; if (!Object.hasOwn(e, 'url')) e.url = u; if (!Object.hasOwn(e, 'attempts')) e.attempts = a; } catch {}
    }
    return e;
  };
  const callUser = (fn, arg) => { if (!fn) return; try { arg === undefined ? fn() : fn(arg); } catch (e) { Promise.reject(e); } };
  const u32 = (v, p, min) => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && Math.floor(v) === v && v <= 4294967295) return v;
    throw inv(p, min ? 'must be a positive integer' : 'must be a non-negative integer');
  };
  const msNum = (v, p, zeroUndef) => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return zeroUndef && v === 0 ? undefined : v;
    throw inv(p, 'must be a non-negative number of milliseconds');
  };
  const pOptBool = (o, k, d) => { const v = opt(o, k); if (v === undefined) return d; if (typeof v === 'boolean') return v; throw inv(k, 'must be a boolean'); };
  // Reconnect tuple: [maxRetries, initialDelayMs, maxDelayMs, multiplier]
  const pReconnect = (v) => {
    const c = [Infinity, 1000, 30000, 2];
    if (typeof v === 'boolean') return v ? c : undefined;
    if (typeof v === 'number') { c[0] = v === Infinity ? Infinity : u32(v, 'reconnect', 0); return c[0] > 0 ? c : undefined; }
    if (typeof v !== 'object') throw inv('reconnect', 'must be a boolean, a number or a ReconnectOptions object');
    const mr = opt(v, 'maxRetries');
    if (mr !== undefined) c[0] = mr === Infinity ? Infinity : u32(mr, 'reconnect.maxRetries', 0);
    const i = opt(v, 'initialDelayMs'), m = opt(v, 'maxDelayMs'), x = opt(v, 'multiplier');
    if (i !== undefined) c[1] = msNum(i, 'reconnect.initialDelayMs');
    if (m !== undefined) c[2] = msNum(m, 'reconnect.maxDelayMs');
    if (x !== undefined) {
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 1) throw inv('reconnect.multiplier', 'must be a number >= 1');
      c[3] = x;
    }
    return c;
  };
  const pMsgType = (o) => {
    const v = opt(o, 'messageType');
    if (v === undefined || v === 'auto') return false;
    if (v === 'json') return true;
    throw inv('messageType', "must be 'auto' or 'json'");
  };
  const pSignal = (o) => {
    const s = opt(o, 'signal');
    if (s === undefined) return;
    if (typeof s === 'object' && 'aborted' in s) return s;
    throw inv('signal', 'must be an AbortSignal');
  };
  const pCbs = (o, names) => names.map((n) => {
    const f = opt(o, n);
    if (f !== undefined && typeof f !== 'function') throw inv(n, 'must be a function');
    return f;
  });
  const pParams = (v) => {
    const out = [];
    const entries = typeof URLSearchParams === 'function' && v instanceof URLSearchParams ? [...v] : v && typeof v === 'object' ? Object.entries(v) : null;
    if (!entries) throw inv('params', 'must be an object or URLSearchParams');
    for (const [k, val] of entries) {
      for (const item of Array.isArray(val) ? val : [val]) {
        if (item == null) continue;
        const s = scalarStr(item);
        if (s === undefined) throw inv('params', `'${k}' must be a string, number or boolean`);
        out.push([k, s]);
      }
    }
    return out;
  };
  const resolveWsUrl = (base, input, params, allowAbs) => {
    // Absolute only if it parses on its own, as for HTTP requests: `//host/x` joins the base URL
    let abs;
    if (SCHEME_RE.test(input)) { try { abs = new URL(input); } catch {} }
    const isAbs = abs !== undefined;
    if (base && !allowAbs && isAbs) throw inv('url', 'absolute URLs are disabled when allowAbsoluteUrls is false');
    let u;
    if (abs && (abs.protocol === 'ws:' || abs.protocol === 'wss:')) u = abs;
    if (!u) {
      const target = base && !isAbs
        ? (!input || input[0] === '?' || input[0] === '#' ? `${base}${input}` : `${base.replace(/\/+$/, '')}/${input.replace(/^\/+/, '')}`)
        : input;
      try { u = new URL(target, typeof location !== 'undefined' ? location.href : undefined); }
      catch (e) { throw inv('url', `'${target}': ${errMsg(e)}`); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw inv('url', `unsupported scheme '${u.protocol.slice(0, -1)}'; only http and https are supported`);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    }
    for (const [k, v] of params) u.searchParams.append(k, v);
    return u.href;
  };
  const backoff = (n, c) => { const d = Math.min(c[1] * (c[3] ** (n - 1)), c[2]); return d > 0 ? Math.floor(d * (0.5 + Math.random() * 0.5)) : 0; };
  const dataLen = (d) => (typeof d === 'string' ? encodeUtf8(d).byteLength : typeof d?.byteLength === 'number' ? d.byteLength : typeof d?.size === 'number' ? d.size : 0);

  // --- WasmClient.prototype.websocket ----------------------------------------
  defineMethod(proto, 'websocket', function (url, options) {
    if (typeof WebSocket !== 'function') throw net("WebSocket isn't available in this runtime (Node.js has it from version 22, and on version 20 with --experimental-websocket)");
    const meta = getMeta.call(this, undefined, undefined);
    const rawP = opt(options, 'params');
    const resolved = resolveWsUrl(meta.baseUrl, String(url), rawP !== undefined ? pParams(rawP) : [], pOptBool(options, 'allowAbsoluteUrls', meta.allowAbsoluteUrls));

    const protocols = [], rawProtos = opt(options, 'protocols');
    if (typeof rawProtos === 'string') protocols.push(rawProtos);
    else if (Array.isArray(rawProtos)) {
      for (const p of rawProtos) { if (typeof p !== 'string') throw inv('protocols', 'must be a string or an array of strings'); protocols.push(p); }
    } else if (rawProtos !== undefined) throw inv('protocols', 'must be a string or an array of strings');

    const rawH = opt(options, 'headers'), hdrs = rawH !== undefined ? parseHeadersMap(rawH, inv) : undefined;
    const disp = opt(options, 'dispatcher');
    if (disp !== undefined && typeof disp !== 'object') throw inv('dispatcher', 'must be an undici dispatcher, e.g. a ProxyAgent');
    const blockPriv = !pOptBool(options, 'allowPrivateNetwork', meta.allowPrivateNetwork);

    let wsArg;
    if (meta.isNode) {
      let activeDisp = disp;
      if (blockPriv) {
        if (disp !== undefined) throw inv('dispatcher', "can't be combined with allowPrivateNetwork: false, which needs its own dispatcher to check where connections go");
        if (!meta.wsGuard) throw inv('allowPrivateNetwork', "needs the package's Node.js entry point to check WebSocket connections");
        try { activeDisp = meta.wsGuard(resolved); }
        catch (e) { const m = errMsg(e); throw e?.code === 'RUST_FETCH_BLOCKED' ? net(m) : inv('allowPrivateNetwork', m); }
      }
      const merged = Object.create(null);
      let hasH = false;
      if (meta.headers) for (const [k, v] of Object.entries(meta.headers)) { merged[k] = v; hasH = true; }
      if (hdrs) for (const [k, vals] of hdrs) { merged[k] = vals.join(', '); hasH = true; }
      const init = { __proto__: null, protocols };
      if (hasH) init.headers = merged;
      if (activeDisp !== undefined) init.dispatcher = activeDisp;
      wsArg = init;
    } else {
      if (hdrs !== undefined) throw inv('headers', "browsers don't allow WebSocket handshake headers; send credentials in the URL, a cookie or the first message");
      if (disp !== undefined) throw inv('dispatcher', "only Node.js's WebSocket takes a dispatcher; browsers use the system's proxy settings");
      wsArg = protocols;
    }

    const rT = opt(options, 'timeoutMs'), timeoutMs = rT !== undefined ? msNum(rT, 'timeoutMs', true) : meta.timeoutMs;
    const rI = opt(options, 'idleTimeoutMs'), idleMs = rI !== undefined ? msNum(rI, 'idleTimeoutMs', true) : meta.idleTimeoutMs;
    const rR = opt(options, 'reconnect'), reconnect = rR !== undefined ? pReconnect(rR) : undefined;
    const json = pMsgType(options);
    const rQM = opt(options, 'maxQueuedMessages'), maxQMsg = rQM !== undefined ? u32(rQM, 'maxQueuedMessages', 1) : undefined;
    const rQB = opt(options, 'maxQueuedBytes'), maxQBytes = rQB !== undefined ? u32(rQB, 'maxQueuedBytes', 1) : undefined;
    const [onOpen, onMessage, onError, onReconnect, onClose] = pCbs(options, ['onOpen', 'onMessage', 'onError', 'onReconnect', 'onClose']);
    const signal = pSignal(options);

    let [opened, resOpen, rejOpen] = deferred();
    opened.catch(() => {});
    let [closed, resClose] = deferred();

    let first;
    try { first = new WebSocket(resolved, wsArg); } catch (e) { throw inv('url', errMsg(e)); }

    let st = 'connecting', sock, timer, idleTimer, qBytes = 0, failures = 0, closing, onAbort;
    const queue = [];

    const detach = (s) => { if (s) s.onopen = s.onmessage = s.onclose = s.onerror = null; };
    const discard = (s) => { if (s) { detach(s); try { s.close(); } catch {} } };
    const armIdle = () => {
      clearTimeout(idleTimer);
      if (idleMs != null) idleTimer = setTimeout(() => { if (st === 'open') failed(tmo(idleMs, 'idle'), 1006, 'WebSocket idle timeout'); }, idleMs);
    };
    const finish = (code, reason, wasClean, error) => {
      if (st === 'closed') return;
      st = 'closed';
      clearTimeout(timer); clearTimeout(idleTimer); timer = idleTimer = undefined;
      queue.length = 0; qBytes = 0;
      const cur = sock; sock = undefined; detach(cur);
      if (signal && onAbort) { signal.removeEventListener('abort', onAbort); onAbort = undefined; }
      if (closing && (code === 1005 || code === 1006)) [code, reason] = closing;
      closing = undefined;
      if (rejOpen) { const r = rejOpen; resOpen = rejOpen = undefined; r(error ?? cnc(signal)); }
      const info = { code, reason, wasClean };
      if (resClose) { const r = resClose; resClose = undefined; r(info); }
      callUser(onClose, info);
    };
    const failed = (error, code, reason) => {
      const cur = sock; sock = undefined;
      clearTimeout(timer); clearTimeout(idleTimer); timer = idleTimer = undefined;
      let delayMs;
      if (reconnect && failures < reconnect[0]) { failures++; st = 'reconnecting'; delayMs = backoff(failures, reconnect); }
      discard(cur);
      callUser(onError, error);
      if (delayMs === undefined) return finish(code, reason, false, error);
      callUser(onReconnect, { attempt: failures, delayMs, error });
      if (st !== 'reconnecting') return;
      timer = setTimeout(() => {
        st = 'connecting';
        let next;
        try { next = new WebSocket(resolved, wsArg); }
        catch (e) { const err = inv('url', errMsg(e)); callUser(onError, err); return finish(1006, '', false, err); }
        start(next);
      }, delayMs);
    };
    const dropped = (code, reason, wasClean) => {
      if (st === 'closing') return finish(code, reason, wasClean, cnc());
      if (st === 'connecting') {
        const blocked = blockPriv && meta.isNode ? meta.wsGuard?.blocked?.(resolved) : undefined;
        return failed(net(blocked ?? `WebSocket connection to ${resolved} failed`), code, reason);
      }
      if (st === 'open') return WS_RETRY.has(code) ? failed(net(`WebSocket connection closed unexpectedly (code ${code})`), code, reason) : finish(code, reason, wasClean, undefined);
    };
    const start = (s) => {
      s.binaryType = 'arraybuffer'; sock = s;
      s.onerror = () => dropped(1006, '', false);
      s.onclose = (ev) => dropped(ev.code ?? 1006, ev.reason ?? '', !!ev.wasClean);
      s.onopen = () => {
        if (st === 'closing') return;
        st = 'open'; clearTimeout(timer); timer = undefined; failures = 0;
        const items = queue.splice(0); qBytes = 0;
        const r = resOpen; resOpen = rejOpen = undefined;
        for (const item of items) { try { s.send(item); } catch (e) { callUser(onError, net(errMsg(e))); } }
        r?.(); armIdle(); callUser(onOpen);
      };
      s.onmessage = (ev) => {
        armIdle();
        let d = ev.data;
        if (d instanceof ArrayBuffer) d = new Uint8Array(d);
        else if (json && typeof d === 'string') {
          try { d = JSON.parse(d); } catch (e) { return callUser(onError, prs(`Failed to parse JSON message: ${errMsg(e)}`)); }
        }
        callUser(onMessage, d);
      };
      if (timeoutMs != null) timer = setTimeout(() => failed(tmo(timeoutMs), 1006, ''), timeoutMs);
    };
    const doClose = (code, reason) => {
      clearTimeout(idleTimer); idleTimer = undefined;
      if (st === 'closing' || st === 'closed') return;
      if (st === 'open') { st = 'closing'; closing = [code, reason]; try { sock.close(code, reason); } catch { finish(code, reason, false); } }
      else { const cur = sock; sock = undefined; discard(cur); finish(code, reason, false, cnc(signal)); }
    };
    const sendOrQ = (data) => {
      if (st === 'open' && sock) { try { sock.send(data); return; } catch (e) { throw net(errMsg(e)); } }
      if (st === 'connecting' || st === 'reconnecting') {
        if (maxQMsg != null && queue.length >= maxQMsg) throw net(`The WebSocket send queue is full (maxQueuedMessages is ${maxQMsg})`, { maxQueuedMessages: maxQMsg });
        const sz = dataLen(data);
        if (maxQBytes != null && qBytes + sz > maxQBytes) throw net(`The WebSocket send queue is full (maxQueuedBytes is ${maxQBytes})`, { maxQueuedBytes: maxQBytes });
        queue.push(data); qBytes += sz; return;
      }
      throw net('The WebSocket connection is closed');
    };
    const handle = [
      resolved, () => st, () => sock?.protocol ?? '', () => qBytes + (sock?.bufferedAmount ?? 0), opened, closed,
      (d) => {
        if (typeof d !== 'string' && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d) && !(typeof Blob === 'function' && d instanceof Blob)) {
          throw inv('data', 'must be a string, ArrayBuffer, typed array, DataView or Blob; use sendJson() for other values');
        }
        sendOrQ(d);
      },
      (v) => { let t; try { t = JSON.stringify(v); } catch {} if (typeof t !== 'string') throw inv('value', "can't be serialized as JSON"); sendOrQ(t); },
      (code, reason) => {
        const c = code == null ? 1000 : code;
        if (typeof c !== 'number' || !Number.isInteger(c) || (c !== 1000 && (c < 3000 || c > 4999))) throw inv('code', 'must be 1000 or between 3000 and 4999');
        const r = reason == null ? '' : String(reason);
        if (encodeUtf8(r).byteLength > 123) throw inv('reason', 'must be at most 123 bytes of UTF-8');
        doClose(c, r);
      },
    ];
    if (signal) {
      if (signal.aborted) { discard(first); finish(1000, '', false, cnc(signal)); return new WebSocketConnection(CONN_TOKEN, handle); }
      onAbort = () => doClose(1000, '');
      signal.addEventListener('abort', onAbort, { __proto__: null });
    }
    start(first);
    return new WebSocketConnection(CONN_TOKEN, handle);
  });

  // --- WasmClient.prototype.events -------------------------------------------
  defineMethod(proto, 'events', function (url, options) {
    const client = this, target = String(url);
    // Rust validates method, headers, params, URL, timeouts, retries, idempotency, and stream limits.
    const meta = getMeta.call(client, target, options);
    const method = meta.method, resolved = meta.url;
    const signal = pSignal(options);
    const rR = opt(options, 'reconnect'), reconnect = rR !== undefined ? pReconnect(rR) : method === 'GET' ? pReconnect(true) : undefined;
    const body = opt(options, 'body');
    if (reconnect && body != null && typeof body === 'object' && (typeof body.getReader === 'function' || typeof body[Symbol.asyncIterator] === 'function')) {
      throw inv('reconnect', 'A one-shot streaming body cannot reconnect; use a body factory or reconnect: false');
    }
    const json = pMsgType(options), rawEnd = rawOpt(options, 'end');
    let endSent;
    if (rawEnd === undefined) endSent = json ? '[DONE]' : undefined;
    else if (rawEnd !== null) { if (typeof rawEnd !== 'string') throw inv('end', 'must be a string or null'); endSent = rawEnd; }

    const [onOpen, onEvent, onError, onReconnect, onClose] = pCbs(options, ['onOpen', 'onEvent', 'onError', 'onReconnect', 'onClose']);
    const dlMs = meta.deadlineMs, maxLine = meta.maxLineBytes, maxEvt = meta.maxEventBytes;
    const reqSnap = meta.sseInterceptors;

    const baseOpts = { __proto__: null, responseType: 'stream', deadlineMs: 0 };
    for (const k of SSE_FWD) { const v = opt(options, k); if (v !== undefined) baseOpts[k] = v; }
    if (meta.idempotencyKey !== undefined) baseOpts.idempotencyKey = meta.idempotencyKey;

    let [opened, resOpen, rejOpen] = deferred();
    opened.catch(() => {});
    let [closed, resClose] = deferred();

    const closer = new AbortController(), queue = [], waiters = [];
    let st = 'connecting', lastId = '', room, storedErr, dlTimer, onAbort, lastUrl = target, lastAtt = 0;

    const finish = (error) => {
      if (st === 'closed') return;
      st = 'closed'; clearTimeout(dlTimer); dlTimer = undefined;
      const err = error ? ctx(error, method, lastUrl, lastAtt) : undefined;
      if (room) { const r = room; room = undefined; r(); }
      closer.abort();
      if (signal && onAbort) { signal.removeEventListener('abort', onAbort); onAbort = undefined; }
      if (rejOpen) { const r = rejOpen; resOpen = rejOpen = undefined; r(err ?? cnc(signal)); }
      let iterErr = err;
      for (const [res, rej] of waiters.splice(0)) {
        if (iterErr) { const e = iterErr; iterErr = undefined; rej(e); } else res({ value: undefined, done: true });
      }
      if (!onEvent) storedErr = iterErr;
      if (resClose) { const r = resClose; resClose = undefined; r(); }
      callUser(onClose);
    };
    const handle = [
      resolved, () => st, () => lastId, opened, closed, () => finish(),
      () => new Promise((res, rej) => {
        if (queue.length) {
          const value = queue.shift();
          if (queue.length <= 32 && room) { const r = room; room = undefined; r(); }
          return res({ value, done: false });
        }
        if (st === 'closed') {
          if (storedErr) { const e = storedErr; storedErr = undefined; return rej(e); }
          return res({ value: undefined, done: true });
        }
        waiters.push([res, rej]);
      }),
      () => { finish(); return Promise.resolve({ value: undefined, done: true }); },
    ];

    if (signal) {
      if (signal.aborted) { finish(cnc(signal)); return new EventStream(CONN_TOKEN, handle); }
      onAbort = () => finish();
      signal.addEventListener('abort', onAbort, { __proto__: null });
    }
    const dlAt = dlMs != null ? performance.now() + dlMs : undefined;
    if (dlMs != null) {
      dlTimer = setTimeout(() => {
        if (st === 'closed') return;
        const err = ctx(tmo(dlMs, 'total'), method, lastUrl, lastAtt);
        callUser(onError, err); finish(err);
      }, dlMs);
    }

    const emit = (ev, rawData, id) => {
      if (endSent !== undefined && rawData === endSent) return false;
      let data = rawData;
      if (json) {
        try { data = JSON.parse(rawData); }
        catch (e) {
          const err = prs(`Failed to parse event data as JSON: ${errMsg(e)}`);
          callUser(onError, err);
          if (!onEvent) { finish(err); return false; }
          return true;
        }
      }
      const val = { event: ev, data, id };
      if (onEvent) { callUser(onEvent, val); return true; }
      if (waiters.length) waiters.shift()[0]({ value: val, done: false });
      else queue.push(val);
      return true;
    };

    (async () => {
      let failures = 0, serverRetry;
      while (st !== 'closed') {
        let kind = 'dropped', endedErr, wasOpen = false, res;
        try {
          res = await rawRequest.call(client, method, target, undefined, body, { __proto__: null, ...baseOpts, signal: closer.signal, __sse: lastId, __sseInterceptors: reqSnap });
        } catch (err) {
          if (err?.url) lastUrl = err.url;
          if (typeof err?.attempts === 'number') lastAtt = err.attempts;
          if (st === 'closed') return;
          kind = (err?.kind === 'HttpError' && SSE_RETRY.has(err.status)) || err?.kind === 'NetworkError' || err?.kind === 'TimeoutError' ? 'dropped' : 'failed';
          endedErr = err;
        }
        if (res && st === 'closed') { try { res.body?.cancel?.().catch(() => {}); } catch {} return; }
        if (res) {
          if (res.url) lastUrl = res.url;
          if (typeof res.__attempts === 'number') lastAtt = res.__attempts;
          if (res.status === 204) { try { res.body?.cancel?.().catch(() => {}); } catch {} return finish(); }
          const ct = res.headers?.['content-type'] ?? '';
          if (!ct.toLowerCase().startsWith('text/event-stream')) {
            try { res.body?.cancel?.().catch(() => {}); } catch {}
            kind = 'failed'; endedErr = prs(`Expected a text/event-stream response, got '${ct || 'no Content-Type'}'`);
          } else {
            st = 'open'; wasOpen = true;
            if (resOpen) { const r = resOpen; resOpen = rejOpen = undefined; r(); }
            callUser(onOpen);
            const parser = new __SseParser(maxLine, maxEvt), reader = res.body?.getReader?.();
            try {
              if (reader) {
                for (;;) {
                  const step = await reader.read();
                  if (step.done) break;
                  const [events, retryMs, tooLong] = parser.feed(step.value);
                  if (retryMs != null) serverRetry = retryMs;
                  for (const [ev, data, id] of events) {
                    lastId = id;
                    if (!emit(ev, data, id) || st === 'closed') { kind = 'finished'; break; }
                  }
                  if (kind === 'finished') break;
                  if (tooLong) { kind = 'failed'; endedErr = tooLong; break; }
                  if (queue.length >= 64) {
                    await new Promise((r) => { room = r; });
                    if (st === 'closed') { kind = 'finished'; break; }
                  }
                }
              }
              if (kind === 'dropped' && !endedErr) {
                if (st === 'closed') kind = 'finished'; else endedErr = net('The event stream ended');
              }
            } catch (err) {
              if (st === 'closed') kind = 'finished'; else { kind = 'dropped'; endedErr = err; }
            } finally {
              parser.free();
              if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
            }
          }
        }
        if (wasOpen) failures = 0;
        if (kind === 'finished') return finish();
        if (st === 'closed') return;
        const contextual = ctx(endedErr, method, lastUrl, lastAtt);
        callUser(onError, contextual);
        if (kind === 'failed' || !reconnect || failures >= reconnect[0] || (dlAt != null && performance.now() >= dlAt)) return finish(contextual);
        failures++;
        const delayMs = serverRetry !== undefined ? serverRetry : backoff(failures, reconnect);
        st = 'reconnecting';
        callUser(onReconnect, { attempt: failures, delayMs, error: contextual });
        if (st !== 'reconnecting') return;
        await new Promise((resolve) => {
          const onAb = () => { clearTimeout(t); resolve(); };
          const t = setTimeout(() => { closer.signal.removeEventListener('abort', onAb); resolve(); }, delayMs);
          closer.signal.addEventListener('abort', onAb, { __proto__: null, once: true });
        });
      }
    })();

    return new EventStream(CONN_TOKEN, handle);
  });
})();
