// responseType: 'blob' (#81): the bytes of a binary response, as a Blob typed with the response's Content-Type.
(() => {
  const Base = WasmClient;
  class BlobClient extends Base {}
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const index = optionsArgIndex(name);
    BlobClient.prototype[name] = function (...args) {
      const options = args[index];
      if (options == null || options.responseType !== 'blob') return Base.prototype[name].apply(this, args);
      if (typeof Blob === 'undefined') return Promise.reject(Object.assign(new TypeError("responseType 'blob' needs a runtime with Blob"), { kind: 'InvalidInputError', parameter: 'responseType' }));
      args[index] = Object.assign({ __proto__: Object.getPrototypeOf(options) }, options, { responseType: 'binary' });
      return Base.prototype[name].apply(this, args).then((response) => ({
        ...response,
        body: new Blob(response.body ? [response.body] : [], { type: String(response.headers['content-type'] ?? '').toLowerCase() }),
      }));
    };
  }
  Object.defineProperty(BlobClient, 'name', { value: 'WasmClient' });
  WasmClient = BlobClient;
})();
