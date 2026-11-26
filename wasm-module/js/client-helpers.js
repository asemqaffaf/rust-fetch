// Shared helpers for the JavaScript client wrapper layers appended by scripts/postbuild.mjs.
const ERROR_KINDS = new Set(['CircuitOpenError', 'NetworkError', 'HttpError', 'ParseError', 'TimeoutError', 'InvalidInputError', 'JsInteropError', 'CancelledError', 'ValidationError']);
const optionsArgIndex = (name) => (name === 'request' ? 4 : name.endsWith('_json') ? 2 : 1);
const REQUEST_METHODS = ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch'];
const invalidInput = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
const ownProp = (o, k) => (o != null && Object.hasOwn(Object(o), k) ? o[k] : undefined);
const headerEntries = (value) => (value == null ? [] : typeof value === 'object' && typeof value[Symbol.iterator] === 'function' ? [...value] : Object.entries(value));
const lowerHeaders = (headers) => Object.fromEntries(headerEntries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)]));
const cloneProto = (o, extra) => ({ __proto__: o == null ? Object.prototype : Object.getPrototypeOf(o), ...o, ...extra });
const cloneValue = (v) => (v !== null && typeof v === 'object' ? structuredClone(v) : v);
const originOf = (value, base) => { try { return new URL(value, base).origin; } catch { return undefined; } };
const methodOf = (name, args, options) => (name === 'request' ? args[0] : name === 'fetch' ? ownProp(options, 'method') ?? 'GET' : name.replace('_json', '').toUpperCase());
const safeStream = (source, hwm) => new ReadableStream(Object.assign({ __proto__: null, type: undefined, autoAllocateChunkSize: undefined, start: undefined }, source), hwm === undefined ? undefined : new CountQueuingStrategy({ highWaterMark: hwm }));
const setFnName = (fn, name) => Object.defineProperty(fn, 'name', { __proto__: null, value: name, configurable: true });
const defineMethod = (proto, name, fn) => {
  setFnName(fn, name);
  Object.defineProperty(proto, name, { __proto__: null, value: fn, writable: true, configurable: true });
};
const wrapClient = (Sub, wrap) => {
  if (wrap) for (const name of REQUEST_METHODS) defineMethod(Sub.prototype, name, wrap(name, optionsArgIndex(name), Object.getPrototypeOf(Sub).prototype[name]));
  setFnName(Sub, 'WasmClient');
  WasmClient = Sub;
};
