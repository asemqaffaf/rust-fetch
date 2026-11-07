// The `transport` client option (#47): a function that answers this client's buffered requests. createMockTransport() in testing.js builds one.
(() => {
  const Base = WasmClient, custom = new WeakMap();
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  class TransportClient extends Base {
    constructor(options) {
      const transport = options != null && Object.hasOwn(Object(options), 'transport') ? options.transport : undefined;
      if (transport != null && typeof transport !== 'function') throw invalid('transport', 'must be a function');
      super(options);
      if (transport != null) custom.set(this, transport);
    }
  }
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const index = name === 'request' ? 4 : name.endsWith('_json') ? 2 : 1;
    TransportClient.prototype[name] = function (...args) {
      const transport = custom.get(this);
      if (transport) {
        const given = args[index];
        args.length = Math.max(args.length, index + 1);
        args[index] = Object.assign({ __proto__: given == null ? Object.prototype : Object.getPrototypeOf(given) }, given, { __transport: transport });
      }
      return Base.prototype[name].apply(this, args);
    };
  }
  Object.defineProperty(TransportClient, 'name', { value: 'WasmClient' });
  WasmClient = TransportClient;
})();
