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
import dns from 'node:dns';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import { pipeline, Readable, Transform } from 'node:stream';
import tls from 'node:tls';
import v8 from 'node:v8';
import zlib from 'node:zlib';
import { __bindNodeTransport, __setNodeDiagnostics, initSync } from './rust_fetch.js';

// V8 before 13 (Node.js 20 to 23) can abort with "unreachable code" when it
// deoptimizes code that inlined a call into WebAssembly during that call, as
// bursts of cancelled requests did. No inlining, no crash, and no measurable
// cost. It applies to the whole process, unless the command line sets it
// either way. Bun reports a V8 version but throws here.
const wasmInlining = 'turbo-inline-js-wasm-calls';
// prettier-ignore
if (Number(process.versions.v8?.split('.')[0]) < 13 && !process.execArgv.includes(`--${wasmInlining}`) && !process.execArgv.includes(`--no-${wasmInlining}`)) try { v8.setFlagsFromString(`--no-${wasmInlining}`); } catch {}

/**
 * The native addon, or undefined. RUST_FETCH_NATIVE overrides its path;
 * anything that doesn't load (e.g. `0`) keeps the node:http transport.
 */
let nativeScope;
function loadNative() {
  const override = process.env.RUST_FETCH_NATIVE;
  // `0` needs no module lookup, and a missing bundled addon (the npm package
  // has none) costs a stat rather than a failed require at every import.
  if (override === '0' || override === '') return undefined;
  const path = override ?? `./rust-fetch-native.${process.platform}-${process.arch}.node`;
  if (override === undefined && !existsSync(new URL(path, import.meta.url))) return undefined;
  try {
    const addon = createRequire(import.meta.url)(path);
    // Older local binaries do not understand the current transport contract.
    if (addon.TRANSPORT_VERSION !== 5) return undefined;
    const extraCaCerts = process.env.NODE_EXTRA_CA_CERTS;
    nativeScope = addon.configure({
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

// Let the native worker initialize while the main thread compiles Wasm.
initSync({ module: readFileSync(new URL('./rust_fetch_bg.wasm', import.meta.url)) });

// With NODE_TLS_REJECT_UNAUTHORIZED=0, Node warns on its first TLS connection,
// but the addon verifies certificates itself (it honours the variable), so the
// warning is printed on the addon's first HTTPS request instead
const TLS_WARNING =
  "Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections and HTTPS requests insecure by disabling certificate verification.";
let nativeTlsWarning = native !== undefined && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

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
// Connection accounting is enabled only by observed requests.
const observedSockets = new WeakSet();
const observedPools = new Map();
const requestOrigins = new WeakMap();
function observeSocket(socket, origin, agent) {
  if (observedSockets.has(socket)) return;
  observedSockets.add(socket);
  const label = observedPools.has(origin) || observedPools.size < 128 ? origin : '[other]';
  if (!observedPools.has(label)) observedPools.set(label, { origin: label, opened: 0, closed: 0, sockets: new Map() });
  const pool = observedPools.get(label);
  pool.opened++;
  pool.sockets.set(socket, agent);
  socket.once('close', () => { pool.closed++; pool.sockets.delete(socket); });
}
function nodePoolStats() {
  return [...observedPools.values()].map((pool) => {
    let idle = 0, queued = 0;
    for (const [socket, agent] of pool.sockets) {
      if (Object.values(agent?.freeSockets ?? {}).some((sockets) => sockets.includes(socket))) idle++;
    }
    for (const agent of new Set(pool.sockets.values())) {
      for (const requests of Object.values(agent?.requests ?? {})) {
        for (const request of requests) if (requestOrigins.get(request) === pool.origin) queued++;
      }
    }
    return { origin: pool.origin, opened: pool.opened, closed: pool.closed, idle, busy: pool.sockets.size - idle, queued };
  });
}
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

// --- Proxies ------------------------------------------------------------------
//
// With the `proxy` client option ('env' or a URL), or NODE_USE_ENV_PROXY=1
// (as 'env'), requests go through an HTTP(S) proxy: plain HTTP as
// absolute-form requests to the proxy, HTTPS through a CONNECT tunnel.

const defaultPort = (url) => url.port || (url.protocol === 'https:' ? '443' : '80');

/**
 * Whether NO_PROXY (`*`, hosts and IP addresses, with an optional `:port`)
 * excludes `url`. A name also covers its subdomains; addresses match exactly.
 */
function bypassesProxy(url, noProxy) {
  if (!noProxy) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port = defaultPort(url);
  for (const raw of noProxy.toLowerCase().split(/[\s,]+/)) {
    if (raw === '*') return true;
    // host, host:port, [v6]:port or a bare IPv6 address
    const match = /^\[([^\]]+)\](?::(\d+))?$/.exec(raw) ?? /^([^:]+)(?::(\d+))?$/.exec(raw) ?? [raw, raw];
    const name = match[1].replace(/^\*?\./, '');
    const matches = host === name || (!net.isIP(host) && host.endsWith(`.${name}`));
    if (name && matches && (!match[2] || match[2] === port)) return true;
  }
  return false;
}

const proxyUrls = new Map();

/** A parsed proxy URL, cached; `source` names the setting for errors */
function parseProxy(value, source) {
  let url = proxyUrls.get(value);
  if (!url) {
    try {
      url = new URL(value.includes('://') ? value : `http://${value}`);
    } catch {
      throw new TypeError(`Invalid proxy URL in ${source}: ${value}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError(`Unsupported proxy protocol in ${source}: ${url.protocol}`);
    proxyUrls.set(value, url);
  }
  return url;
}

/** The proxy for a request to `url`, or undefined to connect directly */
function proxyFor(url, setting) {
  if (!setting) return undefined;
  if (setting !== 'env') return parseProxy(setting, 'the proxy option');
  const env = process.env;
  const [name, value] = url.protocol === 'https:' ? ['HTTPS_PROXY', env.HTTPS_PROXY ?? env.https_proxy] : ['HTTP_PROXY', env.HTTP_PROXY ?? env.http_proxy];
  if (!value || bypassesProxy(url, env.NO_PROXY ?? env.no_proxy)) return undefined;
  return parseProxy(value, name);
}

/** `Proxy-Authorization` from the proxy URL's user info, if any */
function proxyAuthorization(proxy) {
  if (!proxy.username && !proxy.password) return {};
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return { 'proxy-authorization': `Basic ${Buffer.from(credentials).toString('base64')}` };
}

const pendingTunnels = new WeakMap();

/** HTTPS through a proxy: each pooled connection is a TLS session inside a CONNECT tunnel */
class TunnelAgent extends https.Agent {
  constructor(proxy) {
    super(POOL_OPTIONS);
    this.proxy = proxy;
  }

  addRequest(request, options) {
    // Until the CONNECT reply supplies a socket, destroying the outer HTTPS
    // request must also cancel the proxy request that is acquiring its tunnel.
    const controller = new AbortController();
    const cancel = () => controller.abort();
    pendingTunnels.set(request, controller);
    request.once('close', cancel);
    request.once('socket', () => { request.removeListener('close', cancel); pendingTunnels.delete(request); });
    super.addRequest(request, { ...options, signal: controller.signal });
  }

  createConnection(options, callback) {
    const { proxy } = this;
    const target = `${options.host.includes(':') ? `[${options.host}]` : options.host}:${options.port}`;
    const connect = (proxy.protocol === 'https:' ? https : http).request({
      hostname: proxy.hostname,
      port: defaultPort(proxy),
      method: 'CONNECT',
      path: target,
      headers: { host: target, ...proxyAuthorization(proxy) },
      signal: options.signal,
      agent: false,
    });
    connect.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        return callback(new TypeError(`The proxy refused to connect to ${target}: ${response.statusCode} ${response.statusMessage}`));
      }
      const { signal: _signal, ...tlsOptions } = options;
      callback(null, tls.connect({ ...tlsOptions, socket }));
    });
    connect.once('error', callback);
    connect.end();
  }
}

// One pool per proxy: HTTP agents for plain requests, tunnels for HTTPS
const proxyAgents = new Map();

function proxyAgent(proxy, tunnel) {
  const key = `${tunnel ? 'tunnel' : 'plain'} ${proxy.href}`;
  let agent = proxyAgents.get(key);
  if (!agent) {
    agent = tunnel ? new TunnelAgent(proxy) : new (proxy.protocol === 'https:' ? https : http).Agent(POOL_OPTIONS);
    proxyAgents.set(key, agent);
  }
  return agent;
}

/** `transport.request` arguments for `url`, through `proxy` when there is one */
function requestOptions(url, method, headers, proxy, publicOnly) {
  if (!proxy) {
    const transport = url.protocol === 'https:' ? https : http;
    return [transport, url, { method, headers, agent: publicOnly ? publicPools.get(transport) : agentFor(transport) }];
  }
  if (url.protocol === 'https:') return [https, url, { method, headers, agent: proxyAgent(proxy, true) }];
  // Options override the proxy URL's fields; its credentials only go in Proxy-Authorization
  const options = {
    path: url.href,
    auth: undefined,
    method,
    headers: { ...headers, host: url.host, ...proxyAuthorization(proxy) },
    agent: proxyAgent(proxy, false),
  };
  return [proxy.protocol === 'https:' ? https : http, proxy, options];
}

// --- Private networks -----------------------------------------------------------
//
// With `allowPrivateNetwork: false`, requests may only reach public addresses:
// every address a host resolves to is checked when connecting (so DNS
// rebinding can't slip past), and IP-literal hosts before the request.

const PRIVATE_NETWORKS = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
]) {
  PRIVATE_NETWORKS.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
]) {
  PRIVATE_NETWORKS.addSubnet(address, prefix, 'ipv6');
}

/** Whether an IP address is private or reserved; IPv4-mapped and NAT64 (64:ff9b::/96) addresses by their IPv4 address */
function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return PRIVATE_NETWORKS.check(address, 'ipv4');
  if (family !== 6) return false;
  const nat64 = /^64:ff9b::(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(address);
  if (nat64) {
    const embedded = nat64[1] ?? [nat64[2], nat64[3]].flatMap((group) => [parseInt(group, 16) >> 8, parseInt(group, 16) & 255]).join('.');
    return PRIVATE_NETWORKS.check(embedded, 'ipv4');
  }
  // BlockList matches IPv4-mapped IPv6 (::ffff:a.b.c.d) against the IPv4 ranges
  return PRIVATE_NETWORKS.check(address, 'ipv6');
}

function blockedAddress(host, address) {
  return coded(
    new Error(`Blocked: ${host} is or resolves to ${address}, a private or reserved address (allowPrivateNetwork: false)`),
    'RUST_FETCH_BLOCKED',
  );
}

/** `dns.lookup` that fails when any address is private or reserved */
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (error, address, family) => {
    if (error) return callback(error);
    const addresses = Array.isArray(address) ? address : [{ address }];
    const blocked = addresses.find((entry) => isPrivateAddress(entry.address));
    if (blocked) return callback(blockedAddress(hostname, blocked.address));
    callback(null, address, family);
  });
}

// --- WebSockets with allowPrivateNetwork: false -------------------------------------
//
// Node's WebSocket connects through undici, not node:http, so it gets an undici
// Agent whose connections resolve with publicLookup. undici checks host names
// when connecting (DNS rebinding can't get past it), but connects to IP
// addresses directly, so those are checked here.
const UNDICI_DISPATCHER = Symbol.for('undici.globalDispatcher.1');
const ignore = () => {};
let checkedWebSocketDispatcher;
// Why the last connection to each host was blocked: undici reports only a
// generic error, so the core asks for the reason (websocketGuard.blocked)
const blockedWebSocketHosts = new Map();

/**
 * Called by the core for `websocket()` with `allowPrivateNetwork: false`:
 * throws RUST_FETCH_BLOCKED for a private or reserved IP address, and
 * RUST_FETCH_UNCHECKED when no checked dispatcher can be made; otherwise
 * returns the dispatcher to connect with.
 */
function websocketGuard(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (isPrivateAddress(host)) throw blockedAddress(host, host);
  // undici isn't importable, but its Agent class is the global dispatcher's,
  // which Node creates on the first fetch(); a data: URL makes no connection
  if (!globalThis[UNDICI_DISPATCHER]) fetch('data:,').catch(ignore);
  const global = globalThis[UNDICI_DISPATCHER];
  // Checked on every call: replacing a ProxyAgent from setGlobalDispatcher, even
  // one installed later, would bypass the proxy
  if (global?.constructor?.name !== 'Agent') {
    throw coded(new Error("allowPrivateNetwork: false can't check WebSocket connections while another undici global dispatcher is installed"), 'RUST_FETCH_UNCHECKED');
  }
  if (!checkedWebSocketDispatcher) {
    const lookup = (hostname, options, callback) =>
      publicLookup(hostname, options, (error, ...result) => {
        if (error?.code === 'RUST_FETCH_BLOCKED') {
          if (blockedWebSocketHosts.size >= 100) blockedWebSocketHosts.clear();
          blockedWebSocketHosts.set(hostname, error.message);
        }
        callback(error, ...result);
      });
    checkedWebSocketDispatcher = new global.constructor({ connect: { lookup } });
  }
  return checkedWebSocketDispatcher;
}

/** Why the last connection to `url`'s host was blocked, once */
websocketGuard.blocked = (url) => {
  const host = new URL(url).hostname;
  const reason = blockedWebSocketHosts.get(host);
  blockedWebSocketHosts.delete(host);
  return reason;
};

// Connections made under the check are pooled apart, so a connection another
// client made to a private address is never reused for a checked request
const publicPools = new Map([
  [http, new http.Agent({ ...POOL_OPTIONS, lookup: publicLookup })],
  [https, new https.Agent({ ...POOL_OPTIONS, lookup: publicLookup })],
]);

// --- Request queue --------------------------------------------------------------
//
// At most MAX_IN_FLIGHT requests are handed to a transport at once; the rest
// wait here, in order, as plain closures. Under overload a backlog inside a
// transport costs far more: a ClientRequest each in Node's agent (which also
// dequeues with Array#shift), or a Tokio task and copies of the request in
// the addon. Both transports run at most 256 connections per origin anyway.
// Time spent waiting here counts towards the request's timeout.
const MAX_IN_FLIGHT = 1024;
let inFlight = 0;
const waiting = [];
let waitingHead = 0;

/** Call `start` now, or once a slot frees up; returns the waiting entry, to cancel it */
function whenFree(start) {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    start();
    return undefined;
  }
  const entry = { start, cancelled: false };
  waiting.push(entry);
  return entry;
}

/** Free a slot, starting the next waiting request that wasn't cancelled */
function release() {
  inFlight--;
  while (inFlight < MAX_IN_FLIGHT && waitingHead < waiting.length) {
    const entry = waiting[waitingHead];
    waiting[waitingHead++] = undefined;
    if (!entry.cancelled) {
      inFlight++;
      entry.start();
    }
  }
  // Drop the started entries now and then, so a sustained backlog doesn't grow the array
  if (waitingHead > 4096 && waitingHead * 2 > waiting.length) {
    waiting.splice(0, waitingHead);
    waitingHead = 0;
  }
}

const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Dropped on a redirect to another origin, with the request's sensitiveHeaders
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];
// A redirect's body is drained up to this so its connection can be reused;
// a longer (or endless) one closes the connection instead
const REDIRECT_DRAIN = 64 * 1024;
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
function decode(body, encoding, limit) {
  // With a limit, zlib stops one byte past it, so a decompression bomb never expands in memory
  const bounded = limit === undefined ? {} : { maxOutputLength: limit + 1 };
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return zlib.gunzipSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH, ...bounded });
    case 'deflate':
      // Servers send both zlib-wrapped and raw deflate under this name
      return body[0] === 0x78 ? zlib.inflateSync(body, bounded) : zlib.inflateRawSync(body, bounded);
    case 'br':
      return zlib.brotliDecompressSync(body, bounded);
    case 'zstd':
      return typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync(body, bounded) : body;
    default:
      return body;
  }
}

/** Raw or zlib-wrapped deflate, decided by the first byte as in `decode` */
function inflateStream() {
  let inflate;
  return new Transform({
    transform(chunk, _, done) {
      if (!inflate) {
        inflate = chunk[0] === 0x78 ? zlib.createInflate() : zlib.createInflateRaw();
        inflate.on('data', (data) => this.push(data));
        inflate.on('error', (error) => this.destroy(error));
      }
      inflate.write(chunk, () => done());
    },
    flush(done) {
      if (!inflate) return done();
      inflate.once('end', done);
      inflate.end();
    },
  });
}

/** A decoder stream for one Content-Encoding, or undefined to pass it through */
function decoderStream(encoding) {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
    case 'deflate':
      return inflateStream();
    case 'br':
      return zlib.createBrotliDecompress();
    case 'zstd':
      return typeof zlib.createZstdDecompress === 'function' ? zlib.createZstdDecompress() : undefined;
    default:
      return undefined;
  }
}

/** A streamed response body as a web `ReadableStream`, decompressed; cancelling it closes the response */
function bodyStream(response, method, headers) {
  const encodings = (method === 'HEAD' ? '' : headers['content-encoding'] ?? '')
    .toLowerCase()
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e && e !== 'identity');
  const decoders = encodings.reverse().map(decoderStream).filter(Boolean);
  const source = decoders.length ? pipeline(response, ...decoders, ignore) : response;
  // A queue of several chunks, so the socket isn't paused after each one
  return Readable.toWeb(source, { strategy: new CountQueuingStrategy({ highWaterMark: 16 }) });
}

function decompress(body, contentEncoding, limit) {
  if (!contentEncoding || body.length === 0) return body;
  // Encodings are listed in the order they were applied
  const encodings = contentEncoding.toLowerCase().split(',').map((e) => e.trim()).filter((e) => e && e !== 'identity');
  for (let i = encodings.length - 1; i >= 0; i--) {
    try {
      body = decode(body, encodings[i], limit);
    } catch (error) {
      throw error.code === 'ERR_BUFFER_TOO_LARGE' ? tooLarge(limit) : error;
    }
  }
  return body;
}

/** The error for a body larger than `maxResponseBytes` (a NetworkError with the limit) */
function tooLarge(limit) {
  const error = coded(new RangeError(`Response body larger than maxResponseBytes (${limit} bytes)`), 'RUST_FETCH_TOO_LARGE');
  error.maxResponseBytes = limit;
  return error;
}

function timeoutError(phase, timeoutMs) {
  const label = phase === 'total' ? '' : `${phase} `;
  return Object.assign(coded(new Error(`Request ${label}timeout after ${timeoutMs}ms`), 'RUST_FETCH_TIMEOUT'), { phase, timeoutMs });
}

/** Only allocated when phase limits are configured. */
function phaseTimers(options, fail) {
  const handles = new Map();
  const clear = (phase) => { clearTimeout(handles.get(phase)); handles.delete(phase); };
  const arm = (phase) => {
    clear(phase);
    const ms = options[`${phase}Timeout`];
    if (ms > 0) handles.set(phase, setTimeout(() => fail(timeoutError(phase, ms)), ms));
  };
  return {
    start() { arm('connect'); arm('response'); },
    connect() { if (!handles.has('connect')) arm('connect'); },
    connected() { clear('connect'); },
    headers(redirecting, streamed) { clear('connect'); if (!redirecting) { clear('response'); if (!streamed) arm('idle'); } },
    data() { arm('idle'); },
    bodyEnd() { clear('idle'); },
    clear() { for (const handle of handles.values()) clearTimeout(handle); handles.clear(); },
  };
}

function firstTimeout(options) {
  let first;
  for (const [phase, ms] of [['total', options.timeout], ['connect', options.connectTimeout], ['response', options.responseTimeout]]) {
    if (ms > 0 && (!first || ms < first.ms)) first = { phase, ms };
  }
  return first;
}

// Compressed bodies may be this much larger than the decompressed limit before reading stops
const COMPRESSED_SLACK = 1024 * 1024;

/** Own data properties from the addon's lowercase pairs. */
function ownHeaders(raw) {
  const headers = {};
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i];
    if (Object.hasOwn(headers, name)) headers[name] = `${headers[name]}, ${raw[i + 1]}`;
    else if (name in headers) Object.defineProperty(headers, name, { value: raw[i + 1], writable: true, enumerable: true, configurable: true });
    else headers[name] = raw[i + 1];
  }
  return headers;
}

/** Response headers as one string per name; repeated headers joined with ", " */
function flattenHeaders(raw) {
  // Parse raw pairs ourselves: IncomingMessage's lazy header map can join or
  // discard genuine headers when Object.prototype contains the same name.
  const headers = { __proto__: null };
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i].toLowerCase();
    headers[name] = headers[name] === undefined ? raw[i + 1] : `${headers[name]}, ${raw[i + 1]}`;
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

/** Call a progress callback with `{ loaded, total }`, ignoring its exceptions */
function report(callback, loaded, total) {
  try {
    callback({ loaded, total });
  } catch {}
}

// Request bodies are written in chunks of this size when upload progress is reported
const UPLOAD_CHUNK = 64 * 1024;

/**
 * Send the body and end the request. With `onProgress`, the body is written
 * a chunk at a time, reporting each chunk once it has been handed to the OS.
 */
function writeBody(request, body, onProgress) {
  if (!onProgress || !body) return request.end(body);
  let loaded = 0;
  const next = () => {
    const chunk = body.subarray(loaded, loaded + UPLOAD_CHUNK);
    request.write(chunk, (error) => {
      if (error) return; // the request's 'error' event rejects
      loaded += chunk.length;
      report(onProgress, loaded, body.length);
      if (loaded < body.length) next();
      else request.end();
    });
  };
  next();
}

function uploadError(step) {
  const error = coded(new Error(step.error), step.invalidInput ? 'RUST_FETCH_UPLOAD_INPUT' : 'RUST_FETCH_UPLOAD_ERROR');
  error.cause = step.cause;
  return error;
}

async function writeUpload(request, upload) {
  let loaded = 0;
  while (!request.destroyed) {
    const step = await upload.next();
    if (request.destroyed) return;
    if (step.error !== undefined) throw uploadError(step);
    if (step.done) return new Promise((resolve, reject) => request.end((error) => error ? reject(error) : resolve()));
    await new Promise((resolve, reject) => request.write(step.data, (error) => error ? reject(error) : resolve()));
    loaded += step.data.byteLength;
    upload.report(loaded);
  }
}

function withoutHeaders(headers, names) {
  const copy = { ...headers };
  for (const name of names) delete copy[name];
  return copy;
}

function send(state, method, url, headers, body, redirects, resolve, reject) {
  const rejectAttempt = reject;
  reject = (error) => { if (error && typeof error === 'object' && !Object.hasOwn(error, 'url')) error.url = url.href; rejectAttempt(error); };
  // Settle even when cancelled, so the request's slot is released
  if (state.cancelled) return reject(new Error('The request was cancelled'));
  let args;
  try {
    // IP-literal hosts don't go through DNS, so they're checked here
    if (state.publicOnly) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (isPrivateAddress(host)) throw blockedAddress(url.hostname, host);
    }
    args = requestOptions(url, method, headers, proxyFor(url, state.proxy), state.publicOnly);
  } catch (error) {
    return reject(error);
  }
  const [transport, target, options] = args;
  const upload = state.upload;
  let uploading;
  state.phases?.connect();
  const request = transport.request(target, options, (response) => {
    const status = response.statusCode;
    state.observe?.('headers', { status, url: url.href });
    const receivedHeaders = flattenHeaders(response.rawHeaders);
    // The keep-alive agent must use the safe map too.
    response.headers = receivedHeaders;
    const location = receivedHeaders.location;
    const success = (status >= 200 && status < 300) || (state.manual && REDIRECT_STATUSES.has(status));
    state.phases?.headers(REDIRECT_STATUSES.has(status) && location && !state.manual, state.stream && success);

    if (REDIRECT_STATUSES.has(status) && location && !state.manual) {
      let drained = 0;
      response.on('data', (chunk) => {
        if ((drained += chunk.length) > REDIRECT_DRAIN) response.destroy();
      });
      if (redirects >= state.maxRedirects) {
        return reject(
          new TypeError(state.maxRedirects === 0 ? `Redirect not allowed: ${status} to ${location}` : `Too many redirects (more than ${state.maxRedirects})`),
        );
      }
      let next;
      try {
        next = new URL(location, url);
      } catch {
        return reject(new TypeError(`Invalid redirect location: ${location}`));
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return reject(new TypeError(`Unsupported redirect to ${next.protocol}`));
      }
      if (!state.allowInsecureRedirects && url.protocol === 'https:' && next.protocol === 'http:') {
        return reject(new TypeError(`Insecure redirect refused (allowInsecureRedirects is false): https: to ${next.origin}`));
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
        nextHeaders = withoutHeaders(nextHeaders, state.credentials);
      }
      if (upload) {
        try {
          if (nextMethod === 'GET' || nextMethod === 'HEAD') { upload.cancel(); state.upload = undefined; }
          else {
            if (!upload.restart) throw coded(new Error('A streaming body cannot be replayed for a redirect; provide a body factory'), 'RUST_FETCH_UPLOAD_INPUT');
            upload.restart();
          }
        } catch (error) { upload.cancel(); request.destroy(); return reject(error); }
        // The unfinished upload cannot be reused with the redirect's connection.
        request.destroy();
      }
      state.observe?.('redirect', { status, url: next.href });
      return send(state, nextMethod, next, nextHeaders, nextBody, redirects + 1, resolve, reject);
    }

    // Streamed: resolve with the body as it arrives (error statuses are read in full)
    if (state.stream && success) {
      const body = bodyStream(response, method, receivedHeaders);
      const value = { status, url: url.href, headers: Object.setPrototypeOf(receivedHeaders, Object.prototype), body };
      if (uploading) { uploading.then(() => resolve(value), reject); return; }
      return resolve(value);
    }

    // With a Content-Length, fill one preallocated buffer (a single copy);
    // otherwise collect chunks and join them at the end.
    const expected = Number(receivedHeaders['content-length']);
    // maxResponseBytes limits the decompressed body: check what the server
    // declares, then what arrives (a compressed body gets some slack, and its
    // decompression is bounded too)
    const limit = state.maxResponseBytes;
    const encoded = !!receivedHeaders['content-encoding'] && receivedHeaders['content-encoding'].trim().toLowerCase() !== 'identity';
    const rawLimit = limit === undefined ? Infinity : encoded ? limit + COMPRESSED_SLACK : limit;
    if (Number.isSafeInteger(expected) && expected > rawLimit && method !== 'HEAD') {
      response.destroy();
      return reject(tooLarge(limit));
    }
    const preallocated = !receivedHeaders['content-encoding'] && Number.isSafeInteger(expected) && expected > 0 && expected <= 512 * 1024 * 1024;
    const buffer = preallocated ? new Uint8Array(expected) : undefined;
    let received = 0;
    let buffered = 0;
    const chunks = [];
    const onProgress = status >= 200 && status < 300 ? state.onDownloadProgress : undefined;
    const total = Number.isSafeInteger(expected) ? expected : null;
    response.on('data', (chunk) => {
      state.phases?.data();
      if (buffer && received + chunk.length <= expected) { buffer.set(chunk, received); buffered += chunk.length; }
      else chunks.push(chunk);
      received += chunk.length;
      if (received > rawLimit) {
        response.destroy();
        return reject(tooLarge(limit));
      }
      if (onProgress) report(onProgress, received, total);
    });
    response.on('error', reject);
    // A socket closed mid-body may emit 'close' without 'end' (a settled promise ignores this)
    response.on('close', () => {
      if (!response.complete) reject(new TypeError('The connection closed before the response body was complete'));
    });
    response.on('end', () => {
      state.phases?.bodyEnd();
      if (!response.complete) return reject(new TypeError('The connection closed before the response body was complete'));
      try {
        let body;
        if (buffer && received === expected && chunks.length === 0) {
          body = buffer;
        } else {
          const raw = buffer ? Buffer.concat([buffer.subarray(0, buffered), ...chunks]) : Buffer.concat(chunks);
          body = ownedBytes(method === 'HEAD' ? raw : decompress(raw, receivedHeaders['content-encoding'], limit));
          if (body.length > (limit ?? Infinity)) throw tooLarge(limit);
        }
        const value = { status, url: url.href, headers: Object.setPrototypeOf(receivedHeaders, Object.prototype), body };
        if (uploading && success) uploading.then(() => resolve(value), reject);
        else { if (upload) { upload.cancel(); if (!request.writableFinished) request.destroy(); } resolve(value); }
      } catch (error) {
        reject(error);
      }
    });
  });
  if (state.observe) {
    requestOrigins.set(request, url.origin);
    const start = performance.now();
    request.on('socket', (socket) => {
      observeSocket(socket, url.origin, request.agent);
      let tcpAt = socket.connecting ? undefined : start;
      if (socket.connecting && socket.encrypted) socket.once('connect', () => { tcpAt = performance.now(); });
      const connected = () => state.observe('connection', {
        connectMs: request.reusedSocket ? 0 : performance.now() - start,
        tlsMs: socket.encrypted && !request.reusedSocket && tcpAt !== undefined ? performance.now() - tcpAt : 0,
        connectionReused: !!request.reusedSocket,
      });
      if (!socket.connecting && (!socket.encrypted || socket.getProtocol())) connected();
      else socket.once(socket.encrypted ? 'secureConnect' : 'connect', connected);
    });
  }
  if (state.phases) request.on('socket', (socket) => {
    if (!socket.connecting && (!socket.encrypted || socket.getProtocol())) state.phases.connected();
    else socket.once(socket.encrypted ? 'secureConnect' : 'connect', () => state.phases.connected());
  });
  request.on('error', upload ? (error) => { if (state.request === request) reject(error); } : reject);
  if (upload) {
    uploading = writeUpload(request, upload);
    uploading.catch((error) => {
      if (state.request !== request) return;
      upload.cancel(); request.destroy(error); reject(error);
    });
  } else writeBody(request, body, state.onUploadProgress);
  state.request = request;
}

/**
 * One attempt, called by the Rust core with `{ method, url, headers, body?,
 * timeout?, bodyType, onUploadProgress?, onDownloadProgress?, redirect?,
 * maxRedirects?, proxy?, stream?, maxResponseBytes?, blockPrivateNetwork?, sensitiveHeaders?, allowInsecureRedirects? }`
 * (`redirect` is only ever `'manual'`; `maxRedirects: 0` fails on any redirect; `proxy` is `'env'` or a proxy URL;
 * `sensitiveHeaders` are lowercase names dropped on cross-origin redirects; `allowInsecureRedirects` is only ever `false`).
 * With `stream`, a successful response resolves as soon as its headers
 * arrive, with `body` a `ReadableStream` of the decompressed bytes. Resolves to the finished `{ status, statusText,
 * ok, url, headers, body }` (the core fills in statusText). Rejects with code RUST_FETCH_TIMEOUT or RUST_FETCH_PARSE,
 * or any other error for network failures.
 *
 * The promise has a `cancel()` method, which the core calls only when it
 * abandons an attempt (e.g. AbortSignal); this is much cheaper than wiring an
 * AbortSignal into every request.
 */
function nodeTransport(request) {
  if (!request.__observe) return dispatchNodeTransport(request);
  const pending = dispatchNodeTransport(request);
  const observed = pending.catch((error) => { request.__observe('cause', error); throw error; });
  observed.cancel = pending.cancel;
  return observed;
}

function dispatchNodeTransport(request) {
  // The native transport makes its own connections, so only where the
  // node:http transport would use its own pool too, not an installed agent.
  // Progress callbacks run on this thread, so those requests stay here.
  // Proxied requests, and those checked for private addresses, stay on node:http as well.
  const { onUploadProgress, onDownloadProgress } = request;
  let upload, contentLength;
  if (request.upload) {
    try {
      if (Object.hasOwn(request.headers, 'transfer-encoding')) throw uploadError({ error: 'Streaming body transfer encoding is set by the transport', invalidInput: true });
      contentLength = Object.hasOwn(request.headers, 'content-length') ? request.headers['content-length'] : undefined;
      upload = request.upload.open(onUploadProgress, contentLength);
    }
    catch (error) { const failed = Promise.reject(error); failed.cancel = () => {}; return failed; }
  }
  const proxy = request.proxy ?? (process.env.NODE_USE_ENV_PROXY === '1' ? 'env' : undefined);
  const transport = request.url.startsWith('https:') ? https : request.url.startsWith('http:') ? http : undefined;
  const publicOnly = request.blockPrivateNetwork === true;
  if (native && transport && (!upload || contentLength !== '0') && !request.stream && !onUploadProgress && !onDownloadProgress && !proxy && !publicOnly && agentFor(transport) === pools.get(transport)) {
    request.__observe?.('transport', 'native');
    return nativeTransport(request, upload);
  }

  request.__observe?.('transport', 'node:http');
  const state = {
    observe: request.__observe,
    cancelled: false,
    request: undefined,
    bodyType: request.bodyType ?? AUTO,
    onUploadProgress,
    onDownloadProgress,
    manual: request.redirect === 'manual',
    maxRedirects: request.maxRedirects ?? MAX_REDIRECTS,
    proxy,
    stream: request.stream === true,
    maxResponseBytes: request.maxResponseBytes,
    publicOnly,
    credentials: request.sensitiveHeaders ? [...CREDENTIAL_HEADERS, ...request.sensitiveHeaders] : CREDENTIAL_HEADERS,
    allowInsecureRedirects: request.allowInsecureRedirects !== false,
  };
  if (upload) state.upload = upload;
  let timer;
  const promise = new Promise((resolve, reject) => {
    if (request.connectTimeout > 0 || request.responseTimeout > 0 || request.idleTimeout > 0) {
      state.phases = phaseTimers(request, (error) => { cancel(); reject(error); });
      state.phases.start();
    }
    if (request.timeout > 0) {
      // Covers the whole attempt: connecting, redirects and reading the body
      timer = setTimeout(() => {
        cancel();
        reject(timeoutError('total', request.timeout));
      }, request.timeout);
    }
    let url;
    try {
      url = new URL(request.url);
    } catch (error) {
      clearTimeout(timer);
      state.phases?.clear();
      return reject(error);
    }
    let released = false;
    const settle = (fn) => (value) => {
      clearTimeout(timer);
      state.phases?.clear();
      if (state.upload) {
        state.upload.cancel();
        if (!state.request?.writableFinished) state.request?.destroy();
      }
      if (!released) {
        released = true;
        release();
      }
      fn(value);
    };
    const headers = withDefaultHeaders(request);
    state.observe?.('transportQueued');
    state.waiting = whenFree(() => { state.observe?.('transportStart'); return send(state, request.method, url, headers, request.body, 0, settle(resolve), settle(reject)); });
  });
  const cancel = () => {
    state.phases?.clear();
    state.cancelled = true;
    if (state.waiting) state.waiting.cancelled = true;
    state.upload?.cancel();
    if (state.proxy) pendingTunnels.get(state.request)?.abort();
    state.request?.destroy();
  };
  // Decode only after the socket's event handlers have returned: decoding
  // inside them keeps the raw chunks and stream state alive during
  // JSON.parse, which costs several times more garbage collection.
  const finished = promise.then((response) =>
    response.body instanceof ReadableStream ? response : finishResponse(response, state.bodyType, state.manual),
  );
  finished.cancel = () => {
    clearTimeout(timer);
    cancel();
  };
  return finished;
}

/** The request's headers plus fetch()-like defaults */
function withDefaultHeaders(request) {
  const headers = { __proto__: null, ...request.headers };
  headers['accept'] ??= '*/*';
  headers['accept-encoding'] ??= ACCEPT_ENCODING;
  headers['user-agent'] ??= 'rust-fetch';
  if (request.body) headers['content-length'] ??= String(request.body.length);
  return headers;
}

let nextNativeId = 0;

/** `nodeTransport` through the native addon: same contract, same rules */
function nativeTransport(request, upload) {
  // prettier-ignore
  if (nativeTlsWarning && request.url.startsWith('https:')) { nativeTlsWarning = false; process.emitWarning(TLS_WARNING); }
  const id = (nextNativeId = (nextNativeId + 1) >>> 0);
  const headers = withDefaultHeaders(request);
  // Alternating names/values, preserving repeats.
  const pairs = [];
  for (const name in headers) {
    const value = headers[name];
    if (Array.isArray(value)) for (const item of value) pairs.push(name, item);
    else pairs.push(name, value);
  }
  const bodyType = request.bodyType ?? AUTO;
  const manual = request.redirect === 'manual';
  const options = {
    extra: undefined,
    id,
    method: request.method,
    url: request.url,
    headers: pairs,
    body: request.body,
    timeout: request.timeout,
    manual,
    maxRedirects: request.maxRedirects,
    maxResponseBytes: request.maxResponseBytes,
    sensitiveHeaders: request.sensitiveHeaders,
    allowInsecureRedirects: request.allowInsecureRedirects,
  };
  let extra;
  if (request.__observe || request.connectTimeout > 0 || request.responseTimeout > 0 || request.idleTimeout > 0 || upload) {
    extra = options.extra = {
      observe: !!request.__observe,
      connectTimeout: request.connectTimeout,
      connectTimeoutRemaining: undefined,
      responseTimeout: request.responseTimeout,
      idleTimeout: request.idleTimeout,
      uploadNext: upload?.nativeNext,
      uploadCancel: upload?.cancel,
      uploadRestart: upload?.restart,
    };
  }
  let dispatched = false;
  let giveUp;
  const sent = new Promise((resolve) => {
    let timer;
    const queuedAt = performance.now();
    request.__observe?.('transportQueued');
    const entry = whenFree(() => {
      request.__observe?.('transportStart');
      dispatched = true;
      clearTimeout(timer);
      // The timeout covers the wait here too
      const elapsed = performance.now() - queuedAt;
      let pending = options;
      if (extra?.connectTimeout > 0 || extra?.responseTimeout > 0) {
        for (const [phase, ms] of [['total', options.timeout], ['connect', extra.connectTimeout], ['response', extra.responseTimeout]]) {
          if (ms > 0) {
            if (elapsed >= ms) {
              release();
              return resolve({ error: timeoutError(phase, ms).message, code: 'RUST_FETCH_TIMEOUT', phase });
            }
            if (pending === options) pending = { ...options, extra: { ...extra } };
            if (phase === 'total') pending.timeout = ms - elapsed;
            else if (phase === 'connect') pending.extra.connectTimeoutRemaining = ms - elapsed;
            else pending.extra.responseTimeout = ms - elapsed;
          }
        }
      } else if (options.timeout > 0) {
        pending = { ...options, timeout: Math.max(1, options.timeout - elapsed) };
      }
      native.send(pending, nativeScope).then((response) => {
        release();
        resolve(response);
      });
    });
    if (!entry) return;
    // Drop queued calls without involving the addon.
    giveUp = (response) => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      clearTimeout(timer);
      resolve(response);
    };
    const first = firstTimeout(request);
    if (first) {
      timer = setTimeout(() => giveUp({ error: timeoutError(first.phase, first.ms).message, code: 'RUST_FETCH_TIMEOUT', phase: first.phase }), first.ms);
    }
  });
  const finished = sent.then((response) => {
    const failed = (error) => { error.url = response.url || request.url; return error; };
    if (response.code === 'RUST_FETCH_TOO_LARGE') throw failed(tooLarge(options.maxResponseBytes));
    if (response.error != null) {
      upload?.cancel();
      if (response.code === 'RUST_FETCH_TIMEOUT') {
        const phase = response.phase ?? 'total';
        throw failed(timeoutError(phase, phase === 'total' ? request.timeout : request[`${phase}Timeout`]));
      }
      throw failed(coded(new Error(response.error), response.code));
    }
    if (request.__observe) {
      request.__observe('headers', { status: response.status, url: response.url });
      request.__observe('connection', { connectMs: response.connectMs ?? null, tlsMs: response.tlsMs ?? null, connectionReused: response.connectionReused ?? null, ttfbMs: response.ttfbMs ?? null });
      for (const redirect of response.redirects ?? []) request.__observe('redirect', redirect);
    }
    const headers = ownHeaders(response.headers);
    return finishResponse({ status: response.status, url: response.url, headers, body: ownedBytes(response.body) }, bodyType, manual);
  });
  finished.cancel = () => {
    upload?.cancel();
    if (dispatched) native.cancel(id, nativeScope);
    else giveUp({ error: 'The request was cancelled', code: 'ABORT_ERR' });
  };
  return finished;
}

/**
 * The response object handed to the Rust core (which fills in statusText).
 * With `manual`, a redirect is decoded like a successful response.
 */
function finishResponse({ status, url, headers, body }, bodyType, manual) {
  const ok = status >= 200 && status < 300;
  const success = ok || (manual && REDIRECT_STATUSES.has(status));
  // Error statuses carry their body as text (for HttpError.body)
  let decoded;
  try { decoded = success ? decodeBody(body, Object.hasOwn(headers, 'content-type') ? headers['content-type'] : undefined, bodyType) : decodeBody(body, '', TEXT); }
  catch (error) { error.url = url; throw error; }
  return { status, statusText: '', ok, url, headers, body: decoded };
}

// Bind before consumers can construct a client: later package imports must not
// select this Wasm instance's TLS policy or WebSocket guard through a global.
__bindNodeTransport(nodeTransport, websocketGuard);
__setNodeDiagnostics(() => ({
  queued: waiting.slice(waitingHead).filter((entry) => !entry.cancelled).length,
  native: native?.stats ? native.stats(nativeScope) : null,
  http: nodePoolStats(),
}));
// Retain the discovery hooks; this instance uses only its explicit binding.
globalThis[Symbol.for('rust-fetch.transport')] = nodeTransport;
globalThis[Symbol.for('rust-fetch.websocketGuard')] = websocketGuard;

export { default } from './rust_fetch.js';
export * from './rust_fetch.js';
