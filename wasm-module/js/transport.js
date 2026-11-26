// The `transport` client option (#47): a function that answers this client's buffered requests. createMockTransport() in testing.js builds one.
(() => {
  const custom = new WeakMap();
  class TransportClient extends WasmClient {
    constructor(options) {
      const transport = ownProp(options, 'transport');
      if (transport != null && typeof transport !== 'function') throw invalidInput('transport', 'must be a function');
      super(options);
      if (transport != null) custom.set(this, transport);
    }
  }
  wrapClient(TransportClient, (_name, index, raw) => function (...args) {
    const transport = custom.get(this);
    if (transport) {
      args.length = Math.max(args.length, index + 1);
      args[index] = cloneProto(args[index], { __transport: transport });
    }
    return raw.apply(this, args);
  });
})();
