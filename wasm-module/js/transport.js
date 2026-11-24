// The `transport` client option (#47): a function that answers this client's buffered requests. createMockTransport() in testing.js builds one.
(() => {
  const Base = WasmClient, custom = new WeakMap();
  class TransportClient extends Base {
    constructor(options) {
      const transport = ownProp(options, 'transport');
      if (transport != null && typeof transport !== 'function') throw invalidInput('transport', 'must be a function');
      super(options);
      if (transport != null) custom.set(this, transport);
    }
  }
  for (const name of REQUEST_METHODS) {
    const index = optionsArgIndex(name);
    defineMethod(TransportClient.prototype, name, function (...args) {
      const transport = custom.get(this);
      if (transport) {
        const given = args[index];
        args.length = Math.max(args.length, index + 1);
        args[index] = Object.assign({ __proto__: given == null ? Object.prototype : Object.getPrototypeOf(given) }, given, { __transport: transport });
      }
      return Base.prototype[name].apply(this, args);
    });
  }
  setFnName(TransportClient, 'WasmClient');
  WasmClient = TransportClient;
})();
