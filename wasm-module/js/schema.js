// The `schema` request option (#43): validate the response body with any Standard Schema (Zod, Valibot, ArkType…).
(() => {
  const check = (options) => {
    const schema = options?.schema;
    if (schema === undefined) return;
    if (schema === null || (typeof schema !== 'object' && typeof schema !== 'function') || typeof schema['~standard']?.validate !== 'function') throw invalidInput('schema', 'must be a Standard Schema (a validator with ~standard.validate)');
    if (options.responseType === 'stream' || options.responseType === 'ndjson') throw invalidInput('schema', 'cannot validate a streamed responseType');
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
  class SchemaClient extends WasmClient {}
  wrapClient(SchemaClient, (name, index, raw) => function (...args) {
    let standard;
    try { standard = check(args[index]); } catch (error) { return Promise.reject(error); }
    const pending = raw.apply(this, args);
    return standard ? pending.then((response) => validated(String(methodOf(name, args, args[1])).toUpperCase(), response, standard)) : pending;
  });
})();
