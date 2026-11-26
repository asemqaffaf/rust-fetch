// Unconstructible compatibility exports retained from the previous wasm-streams bridge.
const privateCtor = () => {
  throw new TypeError('Illegal constructor');
};
export class IntoUnderlyingByteSource {
  constructor() { privateCtor(); }
}
export class IntoUnderlyingSink {
  constructor() { privateCtor(); }
}

// Client verb shortcuts routed through WasmClient.__dispatch (observability.js wires standalone exports).
(() => {
  const OP_GET = 0;
  const OP_HEAD = 1;
  const OP_DELETE = 2;
  const OP_POST = 3;
  const OP_PUT = 4;
  const OP_PATCH = 5;
  const OP_POST_JSON = 6;
  const OP_PUT_JSON = 7;
  const OP_PATCH_JSON = 8;
  const OP_FETCH = 9;
  const OP_REQUEST = 10;
  const proto = WasmClient.prototype;
  const dispatch = proto.__dispatch;
  delete proto.__dispatch;
  for (const [name, op] of [
    ['get', OP_GET],
    ['head', OP_HEAD],
    ['delete', OP_DELETE],
    ['post', OP_POST],
    ['put', OP_PUT],
    ['patch', OP_PATCH],
    ['fetch', OP_FETCH],
  ]) {
    defineMethod(proto, name, function (url, arg) {
      return dispatch.call(this, op, url, arg);
    });
  }
  for (const [name, op] of [
    ['post_json', OP_POST_JSON],
    ['put_json', OP_PUT_JSON],
    ['patch_json', OP_PATCH_JSON],
  ]) {
    defineMethod(proto, name, function (url, body, options) {
      return dispatch.call(this, op, url, body, options);
    });
  }
  defineMethod(proto, 'request', function (method, url, headers, body, options) {
    return dispatch.call(this, OP_REQUEST, url, typeof method === 'string' ? method : String(method), headers, body, options);
  });
  // Preserve exported class names after esbuild minification without keepNames' unsafe __name helper.
  for (const [ctor, name] of [
    [EventStream, 'EventStream'],
    [WebSocketConnection, 'WebSocketConnection'],
    [IntoUnderlyingByteSource, 'IntoUnderlyingByteSource'],
    [IntoUnderlyingSink, 'IntoUnderlyingSink'],
    [IntoUnderlyingSource, 'IntoUnderlyingSource'],
  ]) setFnName(ctor, name);
})();

export function create_client() {
  return new WasmClient();
}

// Initialized at module load by observability.js on the contextual-error path.
export let fetch_json,
  fetch_json_promise,
  fetch_text,
  fetch_with_options,
  fetch_wasm_json,
  fetch_wasm_html,
  fetch_wasm_map,
  fetch_wasm_api;
