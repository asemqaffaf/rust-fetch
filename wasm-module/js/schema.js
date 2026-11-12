// The `schema` request option (#43): validate the response body with any Standard Schema (Zod, Valibot, ArkType…).
(() => {
  const Base = WasmClient;
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const check = (options) => {
    const schema = options == null ? undefined : options.schema;
    if (schema === undefined) return undefined;
    if (schema === null || (typeof schema !== 'object' && typeof schema !== 'function') || typeof schema['~standard']?.validate !== 'function') throw invalid('schema', 'must be a Standard Schema (a validator with ~standard.validate)');
    if (options.responseType === 'stream' || options.responseType === 'ndjson') throw invalid('schema', 'cannot validate a streamed responseType');
    return schema['~standard'];
  };
  const validated = async (method, response, standard) => {
    const result = await standard.validate(response.body);
    if (!result.issues) return { ...response, body: result.value };
    // The message names no values: validators such as Valibot quote the received value in theirs, and error messages get logged. The issues are on `issues`.
    const issues = [...result.issues];
    throw Object.assign(new Error(`Response validation failed: ${issues.length} issue${issues.length === 1 ? '' : 's'}`), {
      name: 'ValidationError', kind: 'ValidationError', issues, method, url: response.url, status: response.status,
    });
  };
  class SchemaClient extends Base {}
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const index = optionsArgIndex(name);
    const raw = Base.prototype[name];
    const method = name === 'request' || name === 'fetch' ? undefined : name.replace('_json', '').toUpperCase();
    SchemaClient.prototype[name] = function (...args) {
      let standard;
      try { standard = check(args[index]); } catch (error) { return Promise.reject(error); }
      const pending = raw.apply(this, args);
      return standard ? pending.then((response) => validated(method ?? (name === 'request' ? String(args[0]).toUpperCase() : String(args[1]?.method ?? 'GET').toUpperCase()), response, standard)) : pending;
    };
  }
  Object.defineProperty(SchemaClient, 'name', { value: 'WasmClient' });
  WasmClient = SchemaClient;
})();
