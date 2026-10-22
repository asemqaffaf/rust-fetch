// Node.js entry point (selected through the "node" export condition).
//
// Browsers load the .wasm file with fetch(), which Node.js can't do for
// file: URLs. Here the module is compiled synchronously on import instead, so
// the API is ready to use immediately; calling `init()` is optional and
// returns the already-initialized module.
//
// It also registers a transport built on node:http/node:https. Node's global
// fetch() implements browser semantics (WHATWG streams) on top of the same
// sockets and is considerably slower; this transport only moves bytes.
// Retries, timeouts, validation and decoding stay in the Rust core.
//
// Where the native addon (rust-fetch-native.<platform>-<arch>.node) loads,
// requests go through it instead: the same rules, implemented in Rust on
// Tokio threads, so the JS thread only builds requests and decodes bodies.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { initSync } from './rust_fetch.js';

initSync({ module: readFileSync(new URL('./rust_fetch_bg.wasm', import.meta.url)) });

/**
 * The native addon, or undefined. RUST_FETCH_NATIVE overrides its path;
 * anything that doesn't load (e.g. `0`) keeps the node:http transport.
 */
function loadNative() {
  const path = process.env.RUST_FETCH_NATIVE ?? `./rust-fetch-native.${process.platform}-${process.arch}.node`;
  try {
    const addon = createRequire(import.meta.url)(path);
    const extraCaCerts = process.env.NODE_EXTRA_CA_CERTS;
    addon.configure({
      zstd: typeof zlib.zstdDecompressSync === 'function',
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
      extraCaCerts: extraCaCerts ? readFileSync(extraCaCerts) : undefined,
    });
    return addon;
  } catch {
    return undefined;
  }
}

const native = loadNative();

// Node's default global agents open a socket for every request that finds no
// idle one, but keep only 256 of them idle afterwards. Under a burst the rest
// are closed and sit in TIME_WAIT, and once the ephemeral port range is used
// up every connect fails with EADDRNOTAVAIL. A bounded pool that keeps all of
// its sockets queues requests instead, reusing the same connections.
const MAX_SOCKETS = 256;
const POOL_OPTIONS = { keepAlive: true, scheduling: 'lifo', timeout: 5000, maxSockets: MAX_SOCKETS, maxFreeSockets: MAX_SOCKETS };
const pools = new Map([
  [http, new http.Agent(POOL_OPTIONS)],
  [https, new https.Agent(POOL_OPTIONS)],
]);
// The options Node's own global agents are created with. Newer versions also
// list unset ones (e.g. `proxyEnv: undefined` unless NODE_USE_ENV_PROXY is on).
const NODE_AGENT_OPTIONS = { keepAlive: true, scheduling: 'lifo', timeout: 5000, noDelay: true, defaultPort: 443, protocol: 'https:' };

/**
 * The bounded pool while `globalAgent` is still Node's unbounded default;
 * an agent the application installed (a proxy, TLS options, its own limits)
 * is used as is.
 */
function agentFor(transport) {
  const global = transport.globalAgent;
  const isNodeDefault =
    global.constructor === transport.Agent &&
    global.maxSockets === Infinity &&
    Object.entries(global.options).every(([key, value]) => value == null || NODE_AGENT_OPTIONS[key] === value);
  return isNodeDefault ? pools.get(transport) : global;
}

const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACCEPT_ENCODING = typeof zlib.zstdDecompressSync === 'function' ? 'gzip, deflate, br, zstd' : 'gzip, deflate, br';

const textDecoder = new TextDecoder();
// Response body types, numbered like `BodyType` in src/wasm/mod.rs
const AUTO = 0;
const JSON_BODY = 1;
const TEXT = 2;
const BINARY = 3;

// Same rules as is_json_content_type / is_text_content_type in src/types.rs
function mimeEssence(contentType) {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}
function isJsonType(essence) {
  return essence === 'application/json' || essence.endsWith('+json');
}
function isTextType(essence) {
  return (
    essence.startsWith('text/') ||
    essence.endsWith('+xml') ||
    essence === 'application/xml' ||
    essence === 'application/javascript' ||
    essence === 'application/x-www-form-urlencoded'
  );
}

function coded(error, code) {
  error.code = code;
  return error;
}

/**
 * Decode a body like `decode_body` in src/wasm/transport.rs, in JS so the
 * text never crosses into wasm. TextDecoder replaces invalid UTF-8 and strips
 * a BOM; the length is checked first, since a BOM-only body is not empty.
 */
function decodeBody(bytes, contentType, bodyType) {
  if (bytes.length === 0) return bodyType === TEXT ? '' : bodyType === BINARY ? new Uint8Array(0) : null;
  const essence = mimeEssence(contentType);
  const json = bodyType === JSON_BODY || (bodyType === AUTO && isJsonType(essence));
  const text = json || bodyType === TEXT || (bodyType === AUTO && isTextType(essence));
  if (!text) return bytes;
  const decoded = textDecoder.decode(bytes);
  if (!json) return decoded;
  try {
    return JSON.parse(decoded);
  } catch (error) {
    if (bodyType === AUTO) return decoded; // mislabelled responses fall back to text
    throw coded(error, 'RUST_FETCH_PARSE');
  }
}

/** Undo one Content-Encoding; unknown encodings are passed through, like fetch() */
function decode(body, encoding) {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return zlib.gunzipSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    case 'deflate':
      // Servers send both zlib-wrapped and raw deflate under this name
      return body[0] === 0x78 ? zlib.inflateSync(body) : zlib.inflateRawSync(body);
    case 'br':
      return zlib.brotliDecompressSync(body);
    case 'zstd':
      return typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync(body) : body;
    default:
      return body;
  }
}

function decompress(body, contentEncoding) {
  if (!contentEncoding || body.length === 0) return body;
  // Encodings are listed in the order they were applied
  const encodings = contentEncoding.toLowerCase().split(',').map((e) => e.trim()).filter((e) => e && e !== 'identity');
  for (let i = encodings.length - 1; i >= 0; i--) body = decode(body, encodings[i]);
  return body;
}

/** Response headers as one string per name; repeated headers joined with ", " */
function flattenHeaders(raw) {
  const headers = {};
  for (const name in raw) {
    const value = raw[name];
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

/**
 * A plain Uint8Array that owns its memory. Small Node Buffers share a pooled
 * ArrayBuffer, so those are copied; larger ones are wrapped without copying.
 */
function ownedBytes(bytes) {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? new Uint8Array(bytes.buffer)
    : new Uint8Array(bytes);
}

function withoutHeaders(headers, names) {
  const copy = { ...headers };
  for (const name of names) delete copy[name];
  return copy;
}

function send(state, method, url, headers, body, redirects, resolve, reject) {
  if (state.cancelled) return;
  const transport = url.protocol === 'https:' ? https : http;
  const request = transport.request(url, { method, headers, agent: agentFor(transport) }, (response) => {
    const status = response.statusCode;
    const location = response.headers.location;

    if (REDIRECT_STATUSES.has(status) && location) {
      response.resume();
      if (redirects >= MAX_REDIRECTS) return reject(new TypeError(`Too many redirects (more than ${MAX_REDIRECTS})`));
      let next;
      try {
        next = new URL(location, url);
      } catch {
        return reject(new TypeError(`Invalid redirect location: ${location}`));
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return reject(new TypeError(`Unsupported redirect to ${next.protocol}`));
      }
      // Same rules as fetch(): 303, and 301/302 after POST, become a bodiless GET
      let nextMethod = method;
      let nextBody = body;
      let nextHeaders = headers;
      if ((status === 303 && method !== 'GET' && method !== 'HEAD') || ((status === 301 || status === 302) && method === 'POST')) {
        nextMethod = 'GET';
        nextBody = undefined;
        nextHeaders = withoutHeaders(nextHeaders, ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location']);
      }
      // Never forward credentials to another origin
      if (next.origin !== url.origin) {
        nextHeaders = withoutHeaders(nextHeaders, ['authorization', 'cookie', 'proxy-authorization']);
      }
      return send(state, nextMethod, next, nextHeaders, nextBody, redirects + 1, resolve, reject);
    }

    // With a Content-Length, fill one preallocated buffer (a single copy);
    // otherwise collect chunks and join them at the end.
    const expected = Number(response.headers['content-length']);
    const preallocated = !response.headers['content-encoding'] && Number.isSafeInteger(expected) && expected > 0 && expected <= 512 * 1024 * 1024;
    const buffer = preallocated ? new Uint8Array(expected) : undefined;
    let received = 0;
    const chunks = [];
    response.on('data', (chunk) => {
      if (buffer && received + chunk.length <= expected) buffer.set(chunk, received);
      else chunks.push(chunk);
      received += chunk.length;
    });
    response.on('error', reject);
    // A socket closed mid-body may emit 'close' without 'end' (a settled promise ignores this)
    response.on('close', () => {
      if (!response.complete) reject(new TypeError('The connection closed before the response body was complete'));
    });
    response.on('end', () => {
      if (!response.complete) return reject(new TypeError('The connection closed before the response body was complete'));
      try {
        let body;
        if (buffer && received === expected && chunks.length === 0) {
          body = buffer;
        } else {
          const raw = buffer ? Buffer.concat([buffer.subarray(0, Math.min(received, expected)), ...chunks]) : Buffer.concat(chunks);
          body = ownedBytes(method === 'HEAD' ? raw : decompress(raw, response.headers['content-encoding']));
        }
        resolve({ status, url: url.href, headers: flattenHeaders(response.headers), body });
      } catch (error) {
        reject(error);
      }
    });
  });
  request.on('error', reject);
  request.end(body);
  state.request = request;
}

/**
 * One attempt, called by the Rust core with
 * `{ method, url, headers, body?, timeout?, bodyType }`. Resolves to the
 * finished `{ status, statusText, ok, url, headers, body }` (the core fills
 * in statusText). Rejects with code RUST_FETCH_TIMEOUT or RUST_FETCH_PARSE,
 * or any other error for network failures.
 *
 * The promise has a `cancel()` method, which the core calls only when it
 * abandons an attempt (e.g. AbortSignal); this is much cheaper than wiring an
 * AbortSignal into every request.
 */
function nodeTransport(request) {
  // The native transport makes its own connections, so only where the
  // node:http transport would use its own pool too, not an installed agent
  const transport = request.url.startsWith('https:') ? https : request.url.startsWith('http:') ? http : undefined;
  if (native && transport && agentFor(transport) === pools.get(transport)) return nativeTransport(request);

  const state = { cancelled: false, request: undefined, bodyType: request.bodyType ?? AUTO };
  let timer;
  const promise = new Promise((resolve, reject) => {
    if (request.timeout > 0) {
      // Covers the whole attempt: connecting, redirects and reading the body
      timer = setTimeout(() => {
        cancel();
        reject(coded(new Error(`Request timeout after ${request.timeout}ms`), 'RUST_FETCH_TIMEOUT'));
      }, request.timeout);
    }
    let url;
    try {
      url = new URL(request.url);
    } catch (error) {
      clearTimeout(timer);
      return reject(error);
    }
    const settle = (fn) => (value) => {
      clearTimeout(timer);
      fn(value);
    };
    send(state, request.method, url, withDefaultHeaders(request), request.body, 0, settle(resolve), settle(reject));
  });
  const cancel = () => {
    state.cancelled = true;
    state.request?.destroy();
  };
  // Decode only after the socket's event handlers have returned: decoding
  // inside them keeps the raw chunks and stream state alive during
  // JSON.parse, which costs several times more garbage collection.
  const finished = promise.then((response) => finishResponse(response, state.bodyType));
  finished.cancel = () => {
    clearTimeout(timer);
    cancel();
  };
  return finished;
}

/** The request's headers plus fetch()-like defaults */
function withDefaultHeaders(request) {
  const headers = { ...request.headers };
  headers['accept'] ??= '*/*';
  headers['accept-encoding'] ??= ACCEPT_ENCODING;
  headers['user-agent'] ??= 'rust-fetch';
  if (request.body) headers['content-length'] ??= String(request.body.length);
  return headers;
}

let nextNativeId = 0;

/** `nodeTransport` through the native addon: same contract, same rules */
function nativeTransport(request) {
  const id = (nextNativeId = (nextNativeId + 1) >>> 0);
  const headers = withDefaultHeaders(request);
  // Names and values alternating; a repeated header is sent once per value
  const pairs = [];
  for (const name in headers) {
    const value = headers[name];
    if (Array.isArray(value)) for (const item of value) pairs.push(name, item);
    else pairs.push(name, value);
  }
  const bodyType = request.bodyType ?? AUTO;
  const finished = native
    .send({ id, method: request.method, url: request.url, headers: pairs, body: request.body, timeout: request.timeout })
    .then((response) => {
      if (response.error != null) throw coded(new Error(response.error), response.code);
      const headers = {};
      const raw = response.headers;
      for (let i = 0; i < raw.length; i += 2) {
        const name = raw[i];
        headers[name] = Object.hasOwn(headers, name) ? `${headers[name]}, ${raw[i + 1]}` : raw[i + 1];
      }
      return finishResponse({ status: response.status, url: response.url, headers, body: ownedBytes(response.body) }, bodyType);
    });
  finished.cancel = () => native.cancel(id);
  return finished;
}

/** The response object handed to the Rust core (which fills in statusText) */
function finishResponse({ status, url, headers, body }, bodyType) {
  const ok = status >= 200 && status < 300;
  // Error statuses carry their body as text (for HttpError.body)
  const decoded = ok ? decodeBody(body, headers['content-type'], bodyType) : decodeBody(body, '', TEXT);
  return { status, statusText: '', ok, url, headers, body: decoded };
}

globalThis[Symbol.for('rust-fetch.transport')] = nodeTransport;

export { default } from './rust_fetch.js';
export * from './rust_fetch.js';
