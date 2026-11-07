import { existsSync, readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';

// Fuzzing of the Node.js transport's parsers through the real client (#231). Offline: every
// server is on 127.0.0.1. Four targets, each with seeds under wasm-module/fuzz/corpus/node-<target>/:
//
//   proxy          the `proxy` option and NO_PROXY: any input is refused with a typed error or sent;
//                  a NO_PROXY that names the target (or `*`) never reaches the proxy
//   redirect       a fuzzed `Location`: credentials follow the hop only when WHATWG says same origin
//   content-type   fuzzed `Content-Type` values and bodies (BOM, invalid UTF-8, bad JSON) decode or reject
//   decompression  random and mutated gzip, deflate, br and zstd bodies under a `maxResponseBytes`
//                  limit: the body is never longer than the limit and nothing hangs
//
// A failure is an untyped error (anything without a library `kind`), a hang, an exceeded limit or
// a violated invariant above. Seeds: proxy: "<proxy>\n<NO_PROXY>"; redirect: the `Location`;
// content-type: "<Content-Type>\n<body>"; decompression: "<encoding>\n<bytes>". Run one target with
// FUZZ_TARGET=<name>; FUZZ_SEED and FUZZ_CASES make a run repeatable.

const pkg = new URL('../wasm-module/pkg/', import.meta.url);
const { WasmClient } = await import(new URL('node.js', pkg).href);

const only = process.env.FUZZ_TARGET;
let seed = Number(process.env.FUZZ_SEED ?? 231001) >>> 0;
const initial = seed;
const count = Number(process.env.FUZZ_CASES ?? 500);
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const int = (n) => Math.floor(random() * n);
const pick = (xs) => xs[int(xs.length)];
const bytes = (n) => Uint8Array.from({ length: n }, () => int(256));

const KINDS = new Set(['NetworkError', 'HttpError', 'ParseError', 'TimeoutError', 'InvalidInputError', 'JsInteropError', 'CancelledError', 'CircuitOpenError']);
const failures = [];
const outcomes = {};
const count_ = (target, kind) => { outcomes[target] ??= {}; outcomes[target][kind] = (outcomes[target][kind] ?? 0) + 1; };
const fail = (target, i, message, input) => failures.push({ target, case: i, message, input: String(input).slice(0, 200) });
/** An error is fine when it carries a library kind, or is the TypeError for an invalid proxy */
const typed = (error) => (error && KINDS.has(error.kind)) || (error instanceof TypeError && /proxy/i.test(error.message));
const seeds = (target) => {
  const dir = new URL(`../wasm-module/fuzz/corpus/node-${target}/`, import.meta.url);
  return existsSync(dir) ? readdirSync(dir).sort().map((name) => readFileSync(new URL(name, dir))) : [];
};
const withEnv = async (vars, fn) => {
  const before = {};
  for (const key of Object.keys(vars)) { before[key] = process.env[key]; if (vars[key] === undefined) delete process.env[key]; else process.env[key] = vars[key]; }
  try { return await fn(); } finally { for (const key of Object.keys(vars)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } }
};
const listen = async (onRequest) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    req.resume();
    req.on('end', () => { try { onRequest(req, res); } catch { res.destroy(); } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, seen, port: server.address().port, close: () => { server.closeAllConnections?.(); return new Promise((resolve) => server.close(resolve)); } };
};
const run = (target, i, input, attempt, check) => Promise.resolve().then(attempt).then(
  (result) => { count_(target, 'ok'); check?.(result); },
  (error) => { count_(target, typed(error) ? error.kind ?? 'TypeError' : 'untyped'); if (!typed(error)) fail(target, i, `untyped error: ${error?.name}: ${error?.message}`, input); },
);

async function proxy() {
  const proxyServer = await listen((_, res) => { res.statusCode = 502; res.end(); });
  const target = await listen((_, res) => res.end('ok'));
  const targetUrl = `http://127.0.0.1:${target.port}/`;
  const names = ['127.0.0.1', `127.0.0.1:${target.port}`, '*', '127.0.0.1,example.com', ' , 127.0.0.1 '];
  const generated = () => [pick(['', 'localhost', `127.0.0.1:${proxyServer.port}`, `http://127.0.0.1:${proxyServer.port}`, 'http://', '://', 'socks5://x', 'http://u:p@[::1', '\0', 'http://a b/', 'x:99999', 'http://127.0.0.1:0']), pick([...names, '', '.', '*.', ':', '[', '[::1]:', 'a,'.repeat(50), '\n'])];
  const cases = [...seeds('proxy').map((b) => b.toString('latin1').split('\n')), ...Array.from({ length: count }, generated)];
  for (const [i, [proxyValue, noProxy = '']] of cases.entries()) {
    await run('proxy', i, `${proxyValue} | ${noProxy}`, () => new WasmClient({ retries: 0, timeoutMs: 500, proxy: proxyValue || undefined }).get(targetUrl));
    await withEnv({ HTTP_PROXY: `http://127.0.0.1:${proxyServer.port}`, NO_PROXY: noProxy }, async () => {
      const before = proxyServer.seen.length;
      await run('proxy', i, `env NO_PROXY=${noProxy}`, () => new WasmClient({ retries: 0, timeoutMs: 500, proxy: 'env' }).get(targetUrl));
      // A NO_PROXY that lists the target by name, name and port, or `*` must keep the request off the proxy
      const listed = noProxy.toLowerCase().split(/[\s,]+/).some((entry) => entry === '*' || entry === '127.0.0.1' || entry === `127.0.0.1:${target.port}`);
      if (listed && proxyServer.seen.length !== before) fail('proxy', i, 'NO_PROXY names the target but the request went through the proxy', noProxy);
    });
  }
  await proxyServer.close();
  await target.close();
}

async function redirect() {
  const locations = new Map();
  const b = await listen((_, res) => res.end('b'));
  const a = await listen((req, res) => {
    const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
    if (!locations.has(id)) return res.end('a');
    res.statusCode = pick([301, 302, 303, 307, 308]);
    res.setHeader('location', locations.get(id));
    res.end();
  });
  const base = `http://127.0.0.1:${a.port}`;
  // Structured: scheme, slashes, user info, host, port and path from lists of hostile spellings, so most
  // inputs are URLs that really lead to a or b
  const schemes = ['http:', 'HTTP:', 'https:', 'file:', 'javascript:', 'data:', '', 'http:/', 'http:\\'];
  const slashes = ['//', '/', '\\\\', '/\\', '\\/', '///', '\t//', '/\t/'];
  const userinfo = ['', 'u:p@', 'u@', '@', '127.0.0.1@', `127.0.0.1:${a.port}@`, ':@'];
  const hosts = ['127.0.0.1', `127.0.0.1`, 'localhost', '0x7f.1', '2130706433', '127.1', '[::1]', '[::ffff:127.0.0.1]', '127.0.0.1.', '127.0.0.1%00', '127。0。0。1', '\u{1d7d9}27.0.0.1', 'example.invalid'];
  const ports = [`:${b.port}`, `:${a.port}`, `:${b.port}`, '', ':80', ':0', `:0${b.port}`, ':', `:${b.port}:`];
  const paths = ['/', '', '/x', '/../x', '/%2e%2e/x', '/?id=0', '#x', '/\\x', '/\t'];
  const generated = () => random() < 0.15 ? pick(['/x', '//127.0.0.1', `//127.0.0.1:${b.port}/`, '?x', '#', '.', '..', '../x']) : pick(schemes) + pick(slashes) + pick(userinfo) + pick(hosts) + pick(ports) + pick(paths);
  const cases = [...seeds('redirect').map((x) => x.toString('latin1')), ...Array.from({ length: count }, generated)];
  for (const [i, location] of cases.entries()) {
    const id = locations.size;
    if (/[\r\n\0]/.test(location)) continue; // not a valid header value: refused by the server, not a client input
    locations.set(id, location);
    const before = { a: a.seen.length, b: b.seen.length };
    await run('redirect', i, location, () => new WasmClient({ retries: 0, timeoutMs: 500, maxRedirects: 2, headers: { authorization: 'Bearer S', cookie: 'sid=S', 'x-api-key': 'S' }, sensitiveHeaders: ['x-api-key'] }).get(`${base}/?id=${id}`));
    // Credentials may only ever reach the origin the request started at: a's own host and port
    for (const server of [a, b]) {
      for (const request of server.seen.slice(before[server === a ? 'a' : 'b'])) {
        // By value: a `Location` with user info legitimately becomes a Basic Authorization for that user, which is not the client's secret
        const leaked = request.headers.authorization === 'Bearer S' || request.headers.cookie === 'sid=S' || request.headers['x-api-key'] === 'S';
        if (leaked && request.headers.host !== `127.0.0.1:${a.port}`) fail('redirect', i, `credentials sent to host ${request.headers.host} for Location ${JSON.stringify(location)}`, location);
      }
    }
  }
  await a.close();
  await b.close();
}

async function contentType() {
  let current = { type: '', body: Buffer.alloc(0) };
  const s = await listen((_, res) => {
    try { res.setHeader('content-type', current.type); } catch { /* an unrepresentable header value is the server's problem */ }
    res.end(current.body);
  });
  const types = ['application/json', 'application/json; charset=utf-16', 'text/plain;charset="x', 'TEXT/HTML', 'application/vnd.api+json', 'application/x-ndjson', 'text/event-stream', 'multipart/form-data; boundary=', '*/*', ';', '', 'application/', '/json', 'application/json;;;', 'text/é', 'image/png'];
  const bodies = [Buffer.alloc(0), Buffer.from('﻿{"a":1}'), Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from([0xff, 0xfe, 0x00]), Buffer.from('{'), Buffer.from('[1,2'), Buffer.from('null'), Buffer.from('"\\ud800"'), Buffer.from(bytes(50))];
  const generated = () => [pick(types) + (random() < 0.3 ? pick(['; charset=utf-8', '; q=1', '; boundary=x', ' ;  a=b']) : ''), pick(bodies)];
  const cases = [...seeds('content-type').map((b) => { const text = b.toString('latin1'); const cut = text.indexOf('\n'); return [text.slice(0, cut), b.subarray(cut + 1)]; }), ...Array.from({ length: count }, generated)];
  for (const [i, [type, body]] of cases.entries()) {
    current = { type, body: Buffer.from(body) };
    for (const responseType of [undefined, 'json', 'text', 'binary']) {
      await run('content-type', i, `${type} as ${responseType}`, () => new WasmClient({ retries: 0, timeoutMs: 500 }).get(`http://127.0.0.1:${s.port}/`, responseType ? { responseType } : undefined));
    }
  }
  await s.close();
}

async function decompression() {
  let current = { encoding: 'gzip', body: Buffer.alloc(0) };
  const s = await listen((_, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': current.encoding }); res.end(current.body); });
  const limit = 4096;
  const encoders = { gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync, ...(zlib.zstdCompressSync ? { zstd: zlib.zstdCompressSync } : {}) };
  const mutate = (buf) => { const out = Buffer.from(buf); for (let k = 0; k < 1 + int(4); k++) if (out.length) out[int(out.length)] = int(256); return random() < 0.2 ? out.subarray(0, int(out.length + 1)) : out; };
  const plain = () => pick([Buffer.alloc(int(100000)), Buffer.from(bytes(int(5000))), Buffer.from('x'.repeat(int(50000)))]);
  const generated = () => { const encoding = pick(Object.keys(encoders)); const kind = random(); return [encoding, kind < 0.4 ? Buffer.from(bytes(int(300))) : kind < 0.7 ? mutate(encoders[encoding](plain())) : encoders[encoding](plain())]; };
  const cases = [...seeds('decompression').map((b) => { const cut = b.indexOf(10); return [b.subarray(0, cut).toString(), b.subarray(cut + 1)]; }), ...Array.from({ length: count }, generated)];
  for (const [i, [encoding, body]] of cases.entries()) {
    current = { encoding, body: Buffer.from(body) };
    const started = Date.now();
    await run('decompression', i, `${encoding} ${body.length} bytes`, () => new WasmClient({ retries: 0, timeoutMs: 2000, maxResponseBytes: limit }).get(`http://127.0.0.1:${s.port}/`, { responseType: 'binary' }), (response) => {
      if (response.body.length > limit) fail('decompression', i, `body of ${response.body.length} bytes passed a limit of ${limit}`, encoding);
    });
    if (Date.now() - started > 1500) fail('decompression', i, `took ${Date.now() - started} ms`, `${encoding} ${body.length} bytes`);
  }
  await s.close();
}

const targets = { proxy, redirect, 'content-type': contentType, decompression };
for (const [name, fn] of Object.entries(targets)) if (!only || only === name) await fn();

console.log(JSON.stringify({ seed: initial, cases: count, targets: only ?? Object.keys(targets), outcomes, failures: failures.length }));
if (failures.length) {
  for (const f of failures.slice(0, 20)) console.error(JSON.stringify(f));
  process.exit(1);
}
