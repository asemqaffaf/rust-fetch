// responseType: 'blob' (#81): the bytes of a binary response, as a Blob typed with the response's Content-Type.
(() => {
  const Base = WasmClient;
  class BlobClient extends Base {}
  for (const name of REQUEST_METHODS) {
    const index = optionsArgIndex(name);
    defineMethod(BlobClient.prototype, name, function (...args) {
      const options = args[index];
      if (options == null || options.responseType !== 'blob') return Base.prototype[name].apply(this, args);
      if (typeof Blob === 'undefined') return Promise.reject(invalidInput('responseType', "responseType 'blob' needs a runtime with Blob"));
      args[index] = Object.assign({ __proto__: Object.getPrototypeOf(options) }, options, { responseType: 'binary' });
      return Base.prototype[name].apply(this, args).then((response) => ({
        ...response,
        body: new Blob(response.body ? [response.body] : [], { type: String(response.headers['content-type'] ?? '').toLowerCase() }),
      }));
    });
  }
  setFnName(BlobClient, 'WasmClient');
  WasmClient = BlobClient;
})();
