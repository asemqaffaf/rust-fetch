// rust-fetch/testing (#47): createMockTransport() answers a client's requests from routes you write, keeping the real retry, timeout and error behaviour.
export function createMockTransport() {
  const routes = [], calls = [], encoder = new TextEncoder(), decoder = new TextDecoder();
  const essence = (type) => String(type ?? '').split(';')[0].trim().toLowerCase();
  const isJson = (type) => type === 'application/json' || type.endsWith('+json');
  const isText = (type) => type.startsWith('text/') || type.endsWith('+xml') || type === 'application/xml' || type === 'application/x-www-form-urlencoded';
  const coded = (error, code, extra) => Object.assign(error, { code }, extra);
  const matches = (matcher, call) => typeof matcher === 'function' ? matcher(call) : matcher instanceof RegExp ? matcher.test(call.path) : matcher === call.path || matcher === call.url;
  const read = (request) => {
    const url = new URL(request.url), type = essence(request.headers['content-type']);
    let body = request.body;
    if (body && isJson(type)) { try { body = JSON.parse(decoder.decode(body)); } catch {} } else if (body && (isText(type) || type === '')) body = decoder.decode(body);
    return { method: request.method, url: request.url, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : String(value)])), body };
  };
  function respond(spec, request) {
    const { status = 200, statusText = '', headers = {}, body } = spec;
    const out = { __proto__: null };
    for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = String(value);
    let bytes;
    if (body === undefined || body === null) bytes = new Uint8Array(0);
    else if (body instanceof Uint8Array) bytes = body;
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else if (typeof body === 'string') { bytes = encoder.encode(body); out['content-type'] ??= 'text/plain;charset=utf-8'; }
    else { bytes = encoder.encode(JSON.stringify(body)); out['content-type'] ??= 'application/json'; }
    const type = essence(out['content-type']), kind = request.bodyType ?? 0;
    const json = kind === 1 || (kind === 0 && isJson(type)), text = json || kind === 2 || (kind === 0 && isText(type));
    let decoded = bytes;
    if (bytes.length === 0) decoded = kind === 2 ? '' : kind === 3 ? new Uint8Array(0) : null;
    else if (text) {
      decoded = decoder.decode(bytes);
      if (json) { try { decoded = JSON.parse(decoded); } catch (error) { if (kind === 1) throw coded(error, 'RUST_FETCH_PARSE'); } }
    }
    return { status, statusText, ok: status >= 200 && status < 300, url: request.url, headers: out, body: status >= 200 && status < 300 || (status >= 300 && status < 400) ? decoded : typeof decoded === 'string' ? decoded : decoder.decode(bytes) };
  }
  function transport(request) {
    let timer, settle;
    const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    const finish = (fn, value) => { clearTimeout(timer); fn(value); };
    const call = read(request);
    calls.push(call);
    (async () => {
      if (request.stream) throw new Error('The mock transport does not support streamed responses');
      const route = routes.find((entry) => (entry.method === '*' || entry.method === request.method) && matches(entry.matcher, call));
      if (!route) throw new Error(`No mock response for ${request.method} ${call.path}`);
      let spec = typeof route.response === 'function' ? await route.response(call) : route.response;
      if (spec instanceof Error) throw spec;
      spec ??= {};
      if (spec.error) throw spec.error instanceof Error ? spec.error : new Error(typeof spec.error === 'string' ? spec.error : 'Mock network error');
      if (spec.delayMs > 0) await new Promise((resolve) => { timer = setTimeout(resolve, spec.delayMs); });
      return respond(spec, request);
    })().then((response) => finish(settle.resolve, response), (error) => finish(settle.reject, error));
    // The core hands over its timers: an attempt that outlasts them fails like a real one
    for (const [field, phase] of [['responseTimeout', 'response'], ['timeout', 'total']]) {
      const limit = request[field];
      if (limit > 0) {
        const wait = setTimeout(() => finish(settle.reject, coded(new Error(`Request timed out after ${limit}ms`), 'RUST_FETCH_TIMEOUT', { phase, timeoutMs: limit })), limit);
        done.then(() => clearTimeout(wait), () => clearTimeout(wait));
      }
    }
    done.cancel = () => { clearTimeout(timer); settle.reject(Object.assign(new Error('Request was cancelled'), { name: 'AbortError' })); };
    return done;
  }
  const add = (method, matcher, response) => { routes.push({ method, matcher, response }); return transport; };
  return Object.assign(transport, {
    calls,
    on: (method, matcher, response) => add(String(method).toUpperCase(), matcher, response),
    onAny: (response) => add('*', () => true, response),
    reset() { routes.length = 0; calls.length = 0; return transport; },
  });
}
