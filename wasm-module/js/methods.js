// Client verb shortcuts and standalone fetch helpers routed through WasmClient.__dispatch.
let __standaloneDispatch;
(() => {
  const proto = WasmClient.prototype;
  const dispatch = proto.__dispatch;
  __standaloneDispatch = dispatch;
  delete proto.__dispatch;
  for (const [name, method] of [['get', 'GET'], ['head', 'HEAD'], ['delete', 'DELETE']]) {
    proto[name] = function (url, options) {
      return dispatch.call(this, 1, method, url, undefined, undefined, options);
    };
  }
  for (const [name, method] of [['post', 'POST'], ['put', 'PUT'], ['patch', 'PATCH']]) {
    proto[name] = function (url, init) {
      return dispatch.call(this, 2, method, url, undefined, undefined, init);
    };
  }
  for (const [name, method] of [['post_json', 'POST'], ['put_json', 'PUT'], ['patch_json', 'PATCH']]) {
    proto[name] = function (url, body, options) {
      return dispatch.call(this, 3, method, url, undefined, body, options);
    };
  }
  proto.request = function (method, url, headers, body, options) {
    return dispatch.call(this, 0, method, url, headers, body, options);
  };
  proto.fetch = function (url, init) {
    return dispatch.call(this, 4, '', url, undefined, undefined, init);
  };
})();

const __BaseClient = WasmClient;
function __standalone(mode, method, url, headers, body, options) {
  const client = new __BaseClient();
  try {
    return __standaloneDispatch.call(client, mode, method, url, headers, body, options);
  } finally {
    client.free();
  }
}

export function create_client() {
  return new WasmClient();
}

export function fetch_json(url) {
  return __standalone(1, 'GET', url, undefined, undefined, { __proto__: null, responseType: 'json' }).then((response) => response.body);
}

export function fetch_json_promise(url) {
  return fetch_json(url);
}

export function fetch_text(url) {
  return __standalone(1, 'GET', url, undefined, undefined, { __proto__: null, responseType: 'text' }).then((response) =>
    typeof response.body === 'string' ? response.body : '',
  );
}

export function fetch_with_options(url, method, headers, body) {
  if (body != null && typeof body !== 'string') {
    return Promise.reject(new TypeError('body must be a string'));
  }
  return __standalone(0, method, url, headers, body);
}

export function fetch_wasm_json(url) {
  return fetch_json(url);
}

export function fetch_wasm_html(url) {
  return fetch_text(url);
}

export function fetch_wasm_map(url) {
  return fetch_json(url);
}

export function fetch_wasm_api(url) {
  return fetch_json(url);
}
