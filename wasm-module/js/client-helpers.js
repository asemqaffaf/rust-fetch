// Shared helpers for the JavaScript client wrapper layers appended by scripts/postbuild.mjs.
const optionsArgIndex = (name) => (name === 'request' ? 4 : name.endsWith('_json') ? 2 : 1);
const REQUEST_METHODS = ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch'];
const invalidInput = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
const ownProp = (o, k) => (o != null && Object.hasOwn(Object(o), k) ? o[k] : undefined);
const headerEntries = (value) => (value == null ? [] : typeof value === 'object' && typeof value[Symbol.iterator] === 'function' ? [...value] : Object.entries(value));
const setFnName = (fn, name) => Object.defineProperty(fn, 'name', { __proto__: null, value: name, configurable: true });
const defineMethod = (proto, name, fn) => {
  setFnName(fn, name);
  Object.defineProperty(proto, name, { __proto__: null, value: fn, writable: true, configurable: true });
};
