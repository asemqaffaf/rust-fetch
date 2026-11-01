// Runs in a child process (see prototype-pollution.test.mjs), because it
// pollutes Object.prototype. For every name an attacker with a prototype
// pollution primitive could set, and a few hostile values for it, runs the
// same requests as an unpolluted baseline and reports every difference:
// a changed result, a request that reached the attacker's proxy or dispatcher,
// a certificate that was trusted, or an uncaught exception.
import { fork } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const { WasmClient } = await import(process.env.POLLUTION_PKG);
// Pollution through __proto__ leaves enumerable properties (which for...in loops see too); POLLUTION_ENUMERABLE=0 uses hidden ones
const enumerable = process.env.POLLUTION_ENUMERABLE !== '0';

const problems = [];
const crashes = [];
const describe = (error) => (process.env.POLLUTION_VERBOSE ? String(error?.stack ?? error).split('\n').slice(0, 7).join(' | ') : String(error?.message ?? error)).slice(0, 600);
process.on('uncaughtException', (error) => crashes.push(describe(error)));
process.on('unhandledRejection', (error) => crashes.push(describe(error)));

// The servers run in their own process, so that polluting this one breaks
// neither them nor their sockets
const servers = fork(fileURLToPath(new URL('./pollution-servers.mjs', import.meta.url)));
const ports = await new Promise((resolve, reject) => { servers.once('message', resolve); servers.once('exit', () => reject(new Error('the test servers exited'))); });
const proxyHits = async () => {
  servers.send('hits');
  return (await new Promise((resolve) => servers.once('message', resolve))).hits;
};
const T = `http://127.0.0.1:${ports.target}`;
const P = `http://127.0.0.1:${ports.proxy}`;
const S = `https://127.0.0.1:${ports.secure}`;

// An attacker's undici dispatcher: records what it is asked to send
const dispatched = [];
const recorder = {
  dispatch(options) { dispatched.push(`${options.origin}${options.path}`); throw new Error('captured by the attacker'); },
  close() {},
  destroy() {},
};

// The harness's own values mustn't read the polluted prototype either: errors
// are read by own property, and stream sources spell out every optional member
const own = (value, name) => (value != null && Object.hasOwn(Object(value), name) ? value[name] : undefined);
const bytes = () => new ReadableStream({
  __proto__: null,
  start(controller) { controller.enqueue(new Uint8Array(1000)); controller.enqueue(new Uint8Array(500)); controller.close(); },
  pull: undefined, cancel: undefined, type: undefined, autoAllocateChunkSize: undefined,
}, { __proto__: null, highWaterMark: undefined, size: undefined });

// A request that never settles is a difference too, and mustn't stall the run
const outcome = async (run) => {
  let timer;
  const hung = new Promise((resolve) => { timer = setTimeout(resolve, 10_000, { error: 'HANG' }); });
  try { return await Promise.race([run(), hung]); } catch (error) { return { error: own(error, 'kind') ?? own(error, 'name') ?? String(error), status: own(error, 'status') }; } finally { clearTimeout(timer); }
};
const scenarios = {
  get: () => outcome(async () => { const c = new WasmClient({ retries: 0 }); const r = await c.get(`${T}/json`); c.free(); return [r.status, r.body, Object.keys(r.headers).sort().join()]; }),
  gzip: () => outcome(async () => { const c = new WasmClient({ retries: 0 }); const r = await c.get(`${T}/gzip`); c.free(); return [r.status, r.body]; }),
  post: () => outcome(async () => {
    const c = new WasmClient({ retries: 0 });
    const r = await c.post(`${T}/json`, { body: 'hello', headers: { authorization: 'Bearer secret' } });
    c.free();
    return [r.status, r.body];
  }),
  // An interceptor that returns a new object, which has no body of its own
  interceptor: () => outcome(async () => {
    const c = new WasmClient({ retries: 0 });
    c.addRequestInterceptor((request) => ({ method: request.method, url: request.url, headers: request.headers }));
    const r = await c.post(`${T}/json`, { body: 'hello' });
    c.free();
    return [r.status, r.body.size];
  }),
  upload: () => outcome(async () => { const c = new WasmClient({ retries: 0 }); const r = await c.post(`${T}/json`, { body: bytes }); c.free(); return [r.status, r.body.size]; }),
  redirect: () => outcome(async () => { const c = new WasmClient({ retries: 0 }); const r = await c.get(`${T}/redirect`, { headers: { authorization: 'Bearer secret' } }); c.free(); return [r.status, r.url.replace(T, ''), r.body.authorization]; }),
  stream: () => outcome(async () => {
    const c = new WasmClient({ retries: 0 });
    const r = await c.get(`${T}/stream`, { responseType: 'stream' });
    let text = '';
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    for (let step = await reader.read(); !step.done; step = await reader.read()) text += decoder.decode(step.value, { stream: true });
    c.free();
    return [r.status, text];
  }),
  // A stream the Wasm core builds itself, from a source and a strategy it creates
  ndjson: () => outcome(async () => {
    const c = new WasmClient({ retries: 0 });
    const r = await c.get(`${T}/nd`, { responseType: 'ndjson' });
    const values = [];
    const reader = r.body.getReader();
    for (let step = await reader.read(); !step.done; step = await reader.read()) values.push(step.value);
    c.free();
    return [r.status, values];
  }),
  httpError: () => outcome(async () => { const c = new WasmClient({ retries: 0 }); try { await c.get(`${T}/404`); } finally { c.free(); } }),
  progress: () => outcome(async () => {
    const c = new WasmClient({ retries: 0 });
    let down = 0, up = 0;
    const r = await c.post(`${T}/json`, { body: 'x'.repeat(100), onDownloadProgress: () => { down++; }, onUploadProgress: () => { up++; } });
    c.free();
    return [r.status, down > 0, up > 0];
  }),
  // A certificate nothing trusts is still refused
  untrustedTls: () => outcome(async () => { const c = new WasmClient({ retries: 0 }); try { await c.get(`${S}/json`); return 'ACCEPTED'; } finally { c.free(); } }),
  // The private-network rule still applies
  privateNetwork: () => outcome(async () => {
    const c = new WasmClient({ retries: 0, allowPrivateNetwork: false });
    try { await c.get(`${T}/json`); return 'ALLOWED'; } catch (error) { return /Blocked: /.test(error.message) ? 'blocked' : `failed: ${error.message}`.slice(0, 80); } finally { c.free(); }
  }),
  // Explicit limits still apply
  maxResponseBytes: () => outcome(async () => {
    const c = new WasmClient({ retries: 0, maxResponseBytes: 5 });
    try { await c.get(`${T}/json`); return 'ALLOWED'; } catch (error) { return own(error, 'maxResponseBytes') ?? `failed: ${error.message}`.slice(0, 80); } finally { c.free(); }
  }),
  diagnostics: () => outcome(async () => {
    const c = new WasmClient({ retries: 0, timings: true, metrics: true, debug: () => {} });
    const r = await c.get(`${T}/json`);
    const stats = c.stats();
    c.free();
    return [r.status, r.timings?.attempts?.length, stats.requests.completed, stats.requests.failed];
  }),
  // The WebSocket handshake fails against a plain HTTP server, the same way each time
  websocket: () => outcome(() => new Promise((resolve) => {
    const c = new WasmClient({ retries: 0 });
    const done = (result) => { clearTimeout(timer); resolve(result); }; // not freed: the connection still uses the client
    const timer = setTimeout(done, 1500, 'pending');
    try { c.websocket(`${T.replace('http', 'ws')}/json`, { onError: () => done('error'), onClose: () => done('closed') }); } catch (error) { done(`threw: ${error.message}`.slice(0, 80)); }
  })),
};
const run = async () => {
  const results = {};
  for (const [name, scenario] of Object.entries(scenarios)) results[name] = await scenario();
  return results;
};

const baseline = JSON.stringify(await run());
const expected = JSON.parse(baseline);
if (expected.untrustedTls?.error !== 'NetworkError') throw new Error(`the baseline accepted an untrusted certificate: ${baseline}`);
// Releases before 2.5 have no private-network rule: the scenario then only checks that nothing changes
if (expected.privateNetwork !== 'blocked') console.error(`note: the baseline allowed a private address: ${JSON.stringify(expected.privateNetwork)}`);
await proxyHits();
dispatched.length = 0;

// Placeholders in the hostile values: the attacker's proxy and dispatcher, and
// the certificate of the server that nothing trusts (which a polluted `ca`
// would make trusted)
const substitute = (value) => {
  if (value === '$proxy') return P;
  if (value === '$ca') return ports.ca;
  if (value === '$dispatcher') return recorder;
  return Array.isArray(value) ? value.map(substitute) : value;
};
const noop = () => {};
const dataOnly = new Set(JSON.parse(process.env.POLLUTION_DATA_ONLY ?? '[]'));
const generic = [true, 1, 'x', {}, ['x'], noop];
const hostile = JSON.parse(process.env.POLLUTION_NAMES);

// Node.js's own HTTP client reads some names from the prototype chain too (an
// event called `timeout`, a `signal` stream option), which breaks it for every
// program, not only this library. A difference is excused on the node:http
// transport only when plain http.get misbehaves under the same pollution.
const nativeOff = process.env.RUST_FETCH_NATIVE === '0';
const usesNodeHttp = (scenario) => nativeOff || scenario === 'stream' || scenario === 'ndjson' || scenario === 'progress';
// Likewise a plain `new WebSocket()`, which undici builds from objects that inherit
const wsBreaks = () => new Promise((resolve) => {
  let done = false;
  const finish = (broken) => { if (!done) { done = true; clearTimeout(timer); setTimeout(() => resolve(broken), 20); } };
  const timer = setTimeout(finish, 1500, true);
  try {
    const socket = new WebSocket(`${T.replace('http', 'ws')}/json`);
    socket.onerror = () => finish(false); // a plain HTTP server refuses the handshake
    socket.onopen = () => finish(true);
  } catch { finish(true); }
});
const nodeBreaks = () => new Promise((resolve) => {
  const agent = new http.Agent({ keepAlive: true });
  const before = crashes.length;
  let done = false;
  const finish = (broken) => { if (!done) { done = true; clearTimeout(timer); agent.destroy(); setTimeout(() => resolve(broken || crashes.length > before), 20); } };
  const timer = setTimeout(finish, 2000, true);
  try {
    http.get(`${T}/json`, { agent }, (response) => {
      response.on('error', () => finish(true));
      response.on('end', () => finish(false));
      response.resume();
    }).on('error', () => finish(true));
  } catch { finish(true); }
});

const excused = [];
for (const [name, extra] of Object.entries(hostile)) {
  // Data is all that most pollution can inject; a function for `then`, `toJSON` or `toString` breaks every program (and this harness)
  const values = [...generic, ...extra.map(substitute)].filter((value) => !(dataOnly.has(name) && typeof value === 'function'));
  if (process.env.POLLUTION_VERBOSE) console.error(name);
  for (const value of values) {
    const saved = Object.getOwnPropertyDescriptor(Object.prototype, name);
    crashes.length = 0;
    dispatched.length = 0;
    await proxyHits();
    Object.defineProperty(Object.prototype, name, { configurable: true, writable: true, enumerable, value });
    let result, broken;
    try {
      result = JSON.stringify(await run());
      await new Promise((resolve) => setTimeout(resolve, 10)); // late unhandled rejections
      if (result !== baseline || crashes.length) {
        // The control's own late errors (its request may be left without a
        // listener when Node throws while constructing it) aren't the library's
        const mine = [...crashes];
        broken = { http: await nodeBreaks(), websocket: await wsBreaks() };
        await new Promise((resolve) => setTimeout(resolve, 150));
        crashes.length = 0;
        crashes.push(...mine);
      }
    } finally {
      if (saved) Object.defineProperty(Object.prototype, name, saved); else delete Object.prototype[name];
    }
    await new Promise((resolve) => setTimeout(resolve, broken?.http ? 100 : 5));
    const label = `${name}=${typeof value === 'function' ? 'fn' : JSON.stringify(value)}`;
    const hits = await proxyHits();
    if (hits.length) problems.push(`${label} sent ${hits.length} request(s) to the proxy (authorization ${hits[0].authorization}, body ${JSON.stringify(hits[0].body)})`);
    if (dispatched.length) problems.push(`${label} sent ${dispatched[0]} to the attacker's dispatcher`);
    const actual = JSON.parse(result);
    const changed = Object.keys(expected).filter((key) => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]));
    const explained = changed.every((scenario) => (scenario === 'websocket' ? broken?.websocket : usesNodeHttp(scenario) && broken?.http));
    if (changed.length || crashes.length) {
      if (broken && explained && (changed.length || broken.http)) { excused.push(label); continue; }
      if (changed.length) problems.push(`${label} changed ${changed.join(',')}: ${JSON.stringify(actual[changed[0]]).slice(0, 80)}`);
      if (crashes.length) problems.push(`${label} raised uncaught exceptions: ${crashes[0]}`);
    }
  }
}
console.log(JSON.stringify({ checked: Object.keys(hostile).length, problems, excused: [...new Set(excused.map((label) => label.split('=')[0]))] }));
servers.kill();
process.exit(0);
