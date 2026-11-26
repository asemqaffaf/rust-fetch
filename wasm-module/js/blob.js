// responseType: 'blob' (#81): the bytes of a binary response, as a Blob typed with the response's Content-Type.
(() => {
  class BlobClient extends WasmClient {}
  wrapClient(BlobClient, (_name, index, raw) => function (...args) {
    const options = args[index];
    if (options?.responseType !== 'blob') return raw.apply(this, args);
    if (typeof Blob === 'undefined') return Promise.reject(invalidInput('responseType', "responseType 'blob' needs a runtime with Blob"));
    args[index] = cloneProto(options, { responseType: 'binary' });
    return raw.apply(this, args).then((response) => ({
      ...response,
      body: new Blob(response.body ? [response.body] : [], { type: String(response.headers['content-type'] ?? '').toLowerCase() }),
    }));
  });
})();
