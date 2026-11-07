// client.extend(overrides) (#69): a new client with the parent's options and interceptors, and the overrides on top.
(() => {
  const Base = WasmClient, saved = new WeakMap();
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const entries = (value) => value == null ? [] : typeof value === 'object' && typeof value[Symbol.iterator] === 'function' ? [...value] : Object.entries(value);
  const merge = (parent, child) => {
    const headers = new Map();
    for (const [name, value] of [...entries(parent), ...entries(child)]) headers.set(String(name).toLowerCase(), [name, value]);
    return Object.fromEntries(headers.values());
  };
  class ExtendableClient extends Base {
    constructor(options) {
      super(options);
      saved.set(this, { options: Object.assign({ __proto__: null }, options), request: [], response: [] });
    }
    addRequestInterceptor(interceptor) {
      const id = super.addRequestInterceptor(interceptor);
      saved.get(this)?.request.push([id, interceptor]);
      return id;
    }
    addResponseInterceptor(onFulfilled, onRejected) {
      const id = super.addResponseInterceptor(onFulfilled, onRejected);
      saved.get(this)?.response.push([id, onFulfilled, onRejected]);
      return id;
    }
    ejectInterceptor(id) {
      const state = saved.get(this);
      if (state) { state.request = state.request.filter((entry) => entry[0] !== id); state.response = state.response.filter((entry) => entry[0] !== id); }
      return super.ejectInterceptor(id);
    }
    clearInterceptors() {
      const state = saved.get(this);
      if (state) { state.request = []; state.response = []; }
      return super.clearInterceptors();
    }
    extend(overrides) {
      if (overrides != null && typeof overrides !== 'object') throw invalid('options', 'must be an object');
      const state = saved.get(this) ?? { options: { __proto__: null }, request: [], response: [] };
      const options = Object.assign({ __proto__: null }, state.options);
      for (const [name, value] of Object.entries(overrides ?? {})) {
        if (value === undefined) continue;
        if (name === 'headers' && value !== null && typeof value !== 'object') throw invalid('headers', 'must be an object, Headers, Map or array of pairs');
        options[name] = name === 'headers' ? merge(options.headers, value) : value;
      }
      const child = new ExtendableClient(options);
      for (const [, interceptor] of state.request) child.addRequestInterceptor(interceptor);
      for (const [, onFulfilled, onRejected] of state.response) child.addResponseInterceptor(onFulfilled, onRejected);
      return child;
    }
  }
  Object.defineProperty(ExtendableClient, 'name', { value: 'WasmClient' });
  WasmClient = ExtendableClient;
})();
