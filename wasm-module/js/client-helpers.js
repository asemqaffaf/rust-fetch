// Shared helpers for the JavaScript client wrapper layers appended by scripts/postbuild.mjs.
const ERROR_KINDS = new Set(['CircuitOpenError', 'NetworkError', 'HttpError', 'ParseError', 'TimeoutError', 'InvalidInputError', 'JsInteropError', 'CancelledError', 'ValidationError']);
const REQUEST_METHODS = ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch'];
const optionsArgIndex = (name) => (name === 'request' ? 4 : name.endsWith('_json') ? 2 : 1);
const ownProp = (o, k) => (o != null && Object.hasOwn(Object(o), k) ? o[k] : undefined);
const rawOpt = (o, k) => {
  if (o == null || typeof o !== 'object') return undefined;
  const p = Object.getPrototypeOf(o);
  return (p === null || p === Object.prototype) && !Object.hasOwn(o, k) ? undefined : o[k];
};
const opt = (o, k) => { const v = rawOpt(o, k); return v == null ? undefined : v; };
const mkErr = (kind, msg, extra) => Object.assign(new Error(msg), { name: kind, kind }, extra);
const invalidInput = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
const errMsg = (e) => e?.message ?? String(e);
const headerEntries = (value) => (value == null ? [] : typeof value === 'object' && typeof value[Symbol.iterator] === 'function' ? [...value] : Object.entries(value));
// Values stay as given (the core validates them); null/undefined entries are dropped, as the core skips them.
const lowerHeaders = (headers) => Object.fromEntries(headerEntries(headers).filter(([, v]) => v != null).map(([k, v]) => [String(k).toLowerCase(), v]));
const cloneProto = (o, extra) => ({ __proto__: o == null ? Object.prototype : Object.getPrototypeOf(o), ...o, ...extra });
const cloneValue = (v) => (v !== null && typeof v === 'object' ? structuredClone(v) : v);
const originOf = (value, base) => { try { return new URL(value, base).origin; } catch { return undefined; } };
const methodOf = (name, args, options) => (name === 'request' ? args[0] : name === 'fetch' ? ownProp(options, 'method') ?? 'GET' : name.replace('_json', '').toUpperCase());
const safeStream = (source, hwm) => new ReadableStream(Object.assign({ __proto__: null, type: undefined, autoAllocateChunkSize: undefined, start: undefined }, source), hwm === undefined ? undefined : new CountQueuingStrategy({ __proto__: null, highWaterMark: hwm }));
const setFnName = (fn, name) => Object.defineProperty(fn, 'name', { __proto__: null, value: name, configurable: true });
const defineMethod = (proto, name, fn) => {
  setFnName(fn, name);
  Object.defineProperty(proto, name, { __proto__: null, value: fn, writable: true, configurable: true });
};
let _te, _td, _sseSnap, _sseSend;
const encodeUtf8 = (s) => (_te ??= new TextEncoder()).encode(s);
const decodeUtf8 = (b) => (_td ??= new TextDecoder()).decode(b);
const deferred = () => { let r, j; const p = new Promise((res, rej) => { r = res; j = rej; }); return [p, r, j]; };
const TCHAR_RE = /^[0-9A-Za-z!#$%&'*+\-.^_`|~]+$/;
const HVAL_RE = /^[^\x00-\x08\x0a-\x1f\x7f]*$/;
const scalarStr = (v) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined);
const parseHeadersMap = (v, inv) => {
  const map = new Map();
  if (v == null) return map;
  if (typeof v !== 'object') throw inv('headers', 'headers must be an object, Headers, Map or array of pairs');
  for (const pair of typeof v[Symbol.iterator] === 'function' ? [...v] : Object.entries(v)) {
    if (!Array.isArray(pair)) throw inv('headers', 'headers must contain [name, value] pairs');
    const [name, val] = pair;
    if (typeof name !== 'string') throw inv('headers', 'header names must be strings');
    if (val == null) continue;
    const s = scalarStr(val);
    if (s === undefined) throw inv('headers', `header '${name}' must be a string, number or boolean`);
    if (!name.length || name.length > 65535 || !TCHAR_RE.test(name)) throw inv('headers', 'invalid HTTP header name');
    if (!HVAL_RE.test(s)) throw inv('headers', 'failed to parse header value');
    const l = name.toLowerCase(), prev = map.get(l);
    if (prev) prev.push(s); else map.set(l, [s]);
  }
  return map;
};
