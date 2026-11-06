import { readFileSync } from 'node:fs';

// Differential check of URL resolution (#217). Offline: the transport is a recorder.
//
// For every (baseUrl, allowAbsoluteUrls, input) the real Wasm client is asked
// to resolve a request, and what reaches the transport boundary (the URL handed
// to the transport) is compared with an oracle built from Node's WHATWG `URL`.
// Where a credential or a connection goes is decided by the origin, so the
// origin is what is compared. The oracle never calls into the library.
//
// Rules the oracle enforces (docs/security.md, "Absolute URLs and baseUrl"):
//   1. Only http: and https: are ever sent.
//   2. With a baseUrl and allowAbsoluteUrls: false, an input that WHATWG parses
//      as an absolute URL is rejected and nothing is sent.
//   3. With a baseUrl, an input that WHATWG does not parse as absolute stays on
//      the baseUrl origin, whatever slashes, backslashes, userinfo, tabs or
//      newlines it contains.
//   4. An input that WHATWG parses as absolute (and allowAbsoluteUrls is on)
//      is sent to exactly the origin WHATWG computes.
//   5. Without a baseUrl, only absolute http(s) inputs are sent.
//   6. With a baseUrl, a relative path is appended to the base path: the URL
//      sent has the base path as its prefix (dot segments excepted, see KNOWN).
//   7. Whatever is sent is canonical: parsing it again gives the same string,
//      and it holds no control character, space or backslash.
//
// Disagreements are failures unless listed in KNOWN with the reason, and each
// KNOWN entry is documented in docs/security.md.

const rf = await import('../wasm-module/pkg/rust_fetch.js');
rf.initSync({ module: readFileSync(new URL('../wasm-module/pkg/rust_fetch_bg.wasm', import.meta.url)) });

let seed = Number(process.env.FUZZ_SEED ?? 217217) >>> 0;
const initial = seed;
const count = Number(process.env.FUZZ_CASES ?? 20000);
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const pick = (xs) => xs[Math.floor(random() * xs.length)];

const BASES = [
  'https://api.example.com',
  'https://api.example.com/v1',
  'https://api.example.com/v1/',
  'http://localhost:8080/api',
  'https://[::1]:3000/base',
  'https://API.Example.COM:443/v1',
  // Accepted by the builder, so the join has to keep them safe too.
  ' https://api.example.com/v1 ',
  '\thttps://api.example.com/v1\n',
  'https://user:pass@api.example.com/v1',
  'https://api.example.com\\@evil.example/v1',
  'https://api.example.com/v1\t//evil.example',
  'https://api.example.com/v1/../v2',
  'https://api.example.com//',
  'https://api.example.com/v1;p',
  'https://api.example.com:/v1',
  'HTTPS://API.EXAMPLE.COM/V1',
];

// A path appended after a query or fragment would become part of it, so the
// builder has to refuse these (found by this script, see CHANGELOG).
const REFUSED_BASES = [
  'https://api.example.com/v1?x=1', 'https://api.example.com/v1#frag', 'https://api.example.com?x=1', 'https://api.example.com#frag',
  'https://api.example.com/v1?', 'https://api.example.com/v1#', ' https://api.example.com/v1?x=1 ',
];

// Entries from the issue, then the usual bypass shapes, then anything else the
// generator below composes. Kept as plain strings so they can be saved as seeds.
const FIXED = [
  '', ' ', '?', '#', '?a=b', '#frag', 'users', '/users', './users', '../users', '../../users', '%2e%2e/users',
  '//evil.example', '//evil.example/x', '///evil.example', '////evil.example', '/\\evil.example', '\\/evil.example',
  '\\\\evil.example', '\\evil.example', '/\\/evil.example', '/ /evil.example', '/\t/evil.example', '/\n/evil.example',
  '/\r/evil.example', '\t//evil.example', '\n//evil.example', ' //evil.example', '//\tevil.example',
  'http://evil.example', 'https://evil.example', 'HTTPS://EVIL.example', 'https:evil.example', 'https:/evil.example',
  'https:\\\\evil.example', 'https:\\evil.example', 'ht\ttps://evil.example', 'h\nttps://evil.example',
  ' https://evil.example', '\thttps://evil.example', '\u0000https://evil.example', '\u0001https://evil.example',
  'https://evil.example ', 'https://evil.example\t', 'https://evil.example\n', 'https://evil.example\u0000',
  'https://user@evil.example', 'https://user:pass@evil.example', 'https://api.example.com@evil.example',
  'https://api.example.com:443@evil.example', 'https://api.example.com#@evil.example', 'https://evil.example#@api.example.com',
  'https://evil.example\\@api.example.com', 'https://api.example.com\\@evil.example', 'https://a@b@evil.example',
  'https://:@evil.example', 'https://@evil.example', '@evil.example', ':@evil.example', ':80@evil.example',
  'https://evil.example:80', 'https://evil.example:443', 'https://evil.example:0443', 'https://evil.example:65536',
  'https://evil.example:abc', 'https://evil.example:', 'http://evil.example:80', 'http://evil.example:8080',
  'https://%65vil.example', 'https://ev%69l.example', 'https://evil%2eexample', 'https://evil.example%2f', 'https://evil.example%00',
  'https://evil.example.', 'https://evil..example', 'https://.evil.example', 'https://EVIL.EXAMPLE',
  'https://ｅｖｉｌ.example', 'https://evil。example', 'https://evil．example', 'https://évil.example',
  'https://xn--evil.example', 'https://xn--e-9ia.example', 'https://­evil.example', 'https://ev​il.example',
  'https://127.1', 'https://127.0.1', 'https://0x7f.1', 'https://0177.0.0.1', 'https://2130706433', 'https://0x7f000001',
  'https://017700000001', 'https://1.2.3.4.5', 'https://256.256.256.256', 'https://0x100000000', 'https://127.0.0.1.',
  'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[::ffff:7f00:1]', 'https://[0:0:0:0:0:0:0:1]',
  'https://[fe80::1%25eth0]', 'https://[fe80::1%eth0]', 'https://[::1%25]', 'https://[::1', 'https://::1]', 'https://[evil.example]',
  'https://[::1]:80', 'https://[::1]:abc', 'https://[v1.fe]',
  'file:///etc/passwd', 'file://evil.example/x', 'javascript:alert(1)', 'data:text/plain,hi', 'blob:https://evil.example/x',
  'ws://evil.example', 'wss://evil.example', 'ftp://evil.example', 'gopher://evil.example', 'mailto:a@evil.example',
  'about:blank', 'view-source:https://evil.example', 'http:', 'https:', 'http://', 'https://', 'https:///', 'https:////evil.example',
  'HtTpS://evil.example', 'https://evil.example/\\..\\x', 'https://evil.example/%2e%2e/x', 'https://evil.example/x?y#z',
  '\\\\?\\evil.example', '//?/evil.example', '/ /evil.example', '/ /evil.example', '/﻿/evil.example',
  '　//evil.example', ' https://evil.example', ' https://evil.example',
];

const SCHEMES = ['http:', 'https:', 'HtTp:', 'ws:', 'file:', 'javascript:', 'data:', 'blob:', 'x:', '', '', '', ' http:', 'http\t:', 'ht\ntp:'];
const SLASHES = ['', '/', '//', '///', '////', '\\', '\\\\', '/\\', '\\/', '/\\/', '/ /', '/\t/', '/\n/', '/\r/'];
const USERINFO = ['', '', '', 'u@', 'u:p@', '@', ':@', 'a:b@c:d@', 'api.example.com@', 'api.example.com:443@', '%40@', 'u%00@', '\\@'];
const HOSTS = [
  'evil.example', 'EVIL.example', 'evil.example.', 'ex%61mple.com', '%65vil.example', 'evil%2eexample', '0x7f.1', '127.1', '2130706433',
  '0177.0.0.1', '[::1]', '[::ffff:127.0.0.1]', '[fe80::1%25eth0]', '[fe80::1%eth0]', 'ev il.example', 'ev\til.example', 'ev\nil.example',
  'ｅｖｉｌ.example', 'evil。example', 'évil.example', 'xn--evil.example', 'evil.example%00', 'api.example.com', 'localhost',
  '­evil.example', 'evil_.example', 'ev<il>.example', 'evil.example|x', 'ev^il.example', '{evil}.example', 'ev"il.example',
];
const PORTS = ['', '', '', ':', ':80', ':443', ':0443', ':65535', ':65536', ':-1', ':abc', ':8_0', ': 80', ':\t80'];
const PATHS = ['', '', '/', '/x', '/../x', '/..\\x', '/%2e%2e/x', '/%2E%2e/x', '/.%2e/x', '?q', '#f', '/x?y#z', '/;a', '/x y', '/é', '/x\ty', '/x\ny'];
const SPLICE = ['\t', '\n', '\r', '\u0000', '\u0001', ' ', ' ', ' ', '﻿', '\\', '/', '@', '%', '#', '?', ':', '[', ']'];

function compose() {
  const input = pick(SCHEMES) + pick(SLASHES) + pick(USERINFO) + pick(HOSTS) + pick(PORTS) + pick(PATHS);
  if (random() < 0.3) {
    const at = Math.floor(random() * (input.length + 1));
    return input.slice(0, at) + pick(SPLICE) + input.slice(at);
  }
  return input;
}

// The Node entry point binds node:http here. This binds a recorder at the same
// boundary: it sees the exact string the Rust core hands to the transport,
// which `new URL(...)` then turns into the host and port that are connected to.
const stubbed = [];
rf.__bindNodeTransport(
  (request) => {
    stubbed.push(request.url);
    return Promise.reject(new TypeError('offline URL differential transport'));
  },
  Object.assign(() => undefined, { blocked: () => undefined }),
);

// -- oracle --------------------------------------------------------------
const parse = (value) => { try { return new URL(value); } catch { return undefined; } };
const isHttp = (url) => url?.protocol === 'http:' || url?.protocol === 'https:';
const hasBadCharacter = (value) => /[\u0000-\u0020\u007f]/u.test(value) || value.split(/[?#]/u)[0].includes('\\');

/** What WHATWG says must happen. `send` is the origin to expect, `reject` means nothing is sent. */
function expected({ base, allowAbsolute, input }) {
  const absolute = parse(input);
  if (base === undefined) return isHttp(absolute) ? { send: absolute.origin } : { reject: true };
  const baseOrigin = new URL(base).origin;
  if (absolute) {
    if (!allowAbsolute) return { reject: true };
    return isHttp(absolute) ? { send: absolute.origin } : { reject: true };
  }
  // A plain relative path is appended to the base path. A leading ? or # starts
  // a query or fragment instead, and a base without a path has none to keep.
  const parsedBase = new URL(base);
  const plainPath = !/^[\t\n\r ]*[?#]/u.test(input) && input !== '';
  const prefix = plainPath ? parsedBase.pathname.replace(/\/+$/u, '') : undefined;
  // A simple path must show up in the path that is sent, not vanish into a query or fragment of the base.
  const suffix = /^\/*[\w-]+(?:\/[\w-]+)*$/u.test(input) ? `/${input.replace(/^\/+/u, '')}` : undefined;
  return { send: baseOrigin, prefix, suffix };
}

// Disagreements that are decided and explained in docs/security.md.
// Each returns a reason when it recognises the case, so a new kind of
// disagreement is never hidden by an old entry.
const DOT_SEGMENT = /(?:^|[/\\])(?:\.|%2e){1,2}(?:[/\\?#]|$)/iu;
const KNOWN = [
  // Dot segments are removed when the joined URL is parsed, so ../ climbs out of
  // the base path. The origin never changes, and the path is the caller's own.
  (ctx, problems) => (DOT_SEGMENT.test(ctx.input) && problems.every((problem) => problem.startsWith('path ')) ? 'dot segments in a relative path can climb out of the base path (same origin)' : undefined),
];
const known = (ctx, problems) => { for (const rule of KNOWN) { const reason = rule(ctx, problems); if (reason) return reason; } return undefined; };

// -- driver ----------------------------------------------------------------
const clients = new Map();
function clientFor(base, allowAbsolute) {
  const key = JSON.stringify([base, allowAbsolute]);
  if (!clients.has(key)) {
    const options = { retries: 0, timeoutMs: 5000 };
    if (base !== undefined) options.baseUrl = base;
    if (allowAbsolute !== undefined) options.allowAbsoluteUrls = allowAbsolute;
    try { clients.set(key, new rf.WasmClient(options)); } catch (error) { clients.set(key, { rejected: error }); }
  }
  return clients.get(key);
}

async function resolveWithLibrary({ base, allowAbsolute, input }) {
  stubbed.length = 0;
  let error;
  const client = clientFor(base, allowAbsolute);
  if (client.rejected) return { sent: [], error: client.rejected, builderRejected: true };
  try { await client.get(input); } catch (caught) {
    if (caught instanceof WebAssembly.RuntimeError) throw new Error(`Wasm trap for ${JSON.stringify(input)}`, { cause: caught });
    error = caught;
  }
  return { sent: [...stubbed], error };
}

const failures = [];
for (const base of REFUSED_BASES) {
  const client = clientFor(base, undefined);
  if (!client.rejected) failures.push({ base, allowAbsolute: true, input: '(builder)', problems: [`baseUrl ${JSON.stringify(base)} was accepted; a query or fragment in the base swallows appended paths`], sent: [] });
  else if (!/baseUrl/u.test(String(client.rejected?.message))) failures.push({ base, allowAbsolute: true, input: '(builder)', problems: [`baseUrl ${JSON.stringify(base)} was refused for another reason: ${String(client.rejected?.message).slice(0, 100)}`], sent: [] });
}
const knownSeen = new Map();
let compared = 0;
const builderRejected = new Set();
function check(ctx, outcome) {
  if (outcome.builderRejected) { builderRejected.add(ctx.base); return; }
  compared++;
  const want = expected(ctx);
  const problems = [];
  if (outcome.sent.length > 1) problems.push(`sent ${outcome.sent.length} requests`);
  for (const sent of outcome.sent) {
    const url = parse(sent);
    if (!url) { problems.push(`sent a string WHATWG cannot parse: ${JSON.stringify(sent)}`); continue; }
    if (!isHttp(url)) problems.push(`sent scheme ${url.protocol}`);
    if (url.href !== sent) problems.push(`sent a non-canonical URL ${JSON.stringify(sent)} (re-parses as ${JSON.stringify(url.href)})`);
    if (hasBadCharacter(sent)) problems.push(`sent a URL with a control character, space or backslash: ${JSON.stringify(sent)}`);
    if (want.send !== undefined && url.origin !== want.send) problems.push(`origin ${url.origin}, WHATWG expects ${want.send}`);
    if (want.prefix !== undefined && !url.pathname.startsWith(want.prefix)) problems.push(`path ${JSON.stringify(url.pathname)} is not under the base path ${JSON.stringify(want.prefix)}`);
    if (want.suffix !== undefined && url.pathname !== want.prefix + want.suffix) problems.push(`path ${JSON.stringify(url.pathname)} is not the base path plus the requested ${JSON.stringify(want.suffix)} (sent ${JSON.stringify(sent)})`);
  }
  if (want.reject && outcome.sent.length > 0) problems.push(`sent ${JSON.stringify(outcome.sent[0])} where WHATWG says to reject`);
  if (want.send !== undefined && outcome.sent.length === 0) problems.push(`rejected (${String(outcome.error?.message).slice(0, 80)}) where WHATWG expects ${want.send}`);
  if (problems.length === 0) return;
  const reason = known(ctx, problems);
  if (reason) { knownSeen.set(reason, (knownSeen.get(reason) ?? 0) + 1); return; }
  failures.push({ ...ctx, problems, sent: outcome.sent });
}

const combos = [];
for (const base of [undefined, ...BASES]) {
  for (const allowAbsolute of base === undefined ? [undefined] : [undefined, false]) combos.push({ base, allowAbsolute });
}

try {
  const inputs = [...FIXED];
  while (inputs.length < Math.max(count, FIXED.length)) inputs.push(compose());
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    // Every fixed input is tried against every configuration; generated ones against random ones.
    const configs = i < FIXED.length ? combos : [pick(combos)];
    for (const { base, allowAbsolute } of configs) {
      const ctx = { base, allowAbsolute: allowAbsolute ?? true, input };
      check(ctx, await resolveWithLibrary({ base, allowAbsolute, input }));
    }
  }
} finally {
  for (const client of clients.values()) client.free?.();
}

const summary = { seed: initial, inputs: Math.max(count, FIXED.length), compared, failures: failures.length, known: Object.fromEntries(knownSeen), baseUrlsRefusedByBuilder: [...builderRejected] };
if (failures.length > 0) {
  const shown = new Map();
  for (const failure of failures) {
    const key = failure.problems[0].replace(/"[^"]*"/g, '"…"');
    if (!shown.has(key)) shown.set(key, failure);
  }
  console.error(JSON.stringify({ ...summary, failingBases: [...new Set(failures.map((failure) => failure.base))] }));
  console.error(`\n${failures.length} disagreement(s), ${shown.size} distinct kind(s). One example of each:`);
  for (const failure of shown.values()) {
    console.error(`\n  base=${JSON.stringify(failure.base)} allowAbsoluteUrls=${failure.allowAbsolute} input=${JSON.stringify(failure.input)}`);
    for (const problem of failure.problems) console.error(`    - ${problem}`);
  }
  console.error('\nReproduce: FUZZ_SEED=' + initial + ' FUZZ_CASES=' + count + ' node scripts/fuzz-url-differential.mjs');
  process.exit(1);
}
console.log(JSON.stringify({ ...summary, result: 'no disagreements with the WHATWG URL parser', network: 'recorded, not sent' }));
