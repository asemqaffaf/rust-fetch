// Local fault comparison. Library timeouts: 150ms, retries off, full body read.
// The 1000ms watchdog is recorded separately from the library's own deadline.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { startServers } from '../../wasm-module/js/test/conformance/server.mjs';
const root = new URL('../../', import.meta.url);
const paths = {
  success: '/echo', reset: '/fault/reset', truncated: '/fault/truncated', oversizedHeaders: '/fault/headers',
  stalledHeaders: '/fault/half-open', stalledBody: '/fault/idle', trickleBody: '/fault/drip',
  redirectLoop: '/loop', rateLimited: '/status?code=429', unavailable: '/status?code=503',
};
const adapters = ['rust-fetch/native', 'rust-fetch/node:http', 'fetch', 'undici', 'axios', 'ky', 'got'];
if (process.env.RELIABILITY_CHILD) {
  const { adapter, base } = JSON.parse(process.env.RELIABILITY_CHILD);
  let request;
  if (adapter.startsWith('rust-fetch/')) {
    const { WasmClient } = await import('../../wasm-module/pkg/node.js');
    const client = new WasmClient({ timeoutMs: 150, retries: 0 });
    // A missing or incompatible addon must not silently benchmark node:http twice.
    const probe = new WasmClient({ timings: true });
    const transport = (await probe.get(base + paths.success)).timings.attempts[0].transport;
    probe.free();
    const expected = adapter === 'rust-fetch/native' ? 'native' : 'node:http';
    if (transport !== expected) throw Error(adapter + ' selected ' + transport + '; rebuild the native addon and check proxy settings');
    request = async (url, signal) => { const r = await client.get(url, { responseType: 'binary', signal }); return r.status; };
  } else if (adapter === 'axios') {
    const { default: axios } = await import('axios');
    request = async (url, signal) => (await axios.get(url, { signal, timeout: 150, responseType: 'arraybuffer', validateStatus: () => true, maxRedirects: 20, proxy: false })).status;
  } else if (adapter === 'got') {
    const { default: got } = await import('got');
    request = async (url, signal) => (await got(url, { signal, timeout: { request: 150 }, retry: { limit: 0 }, throwHttpErrors: false, maxRedirects: 20, responseType: 'buffer' })).statusCode;
  } else if (adapter === 'ky') {
    const { default: ky } = await import('ky');
    request = async (url, signal) => { const r = ky(url, { signal, timeout: 150, retry: 0, throwHttpErrors: false }); await r.arrayBuffer(); return (await r).status; };
  } else {
    const fetcher = adapter === 'undici' ? (await import('undici')).fetch : globalThis.fetch;
    request = async (url, signal) => { const r = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(150)]) }); await r.arrayBuffer(); return r.status; };
  }
  const results = {};
  for (const [name, path] of Object.entries(paths)) {
    const rounds = [];
    for (let n = 0; n < 3; n++) {
      const abort = new AbortController();
      let watchdog = false;
      const timer = setTimeout(() => { watchdog = true; abort.abort(); }, 1000);
      const started = performance.now();
      try {
        const status = await request(base + path, abort.signal);
        rounds.push({ outcome: status >= 400 ? 'http:' + status : 'ok', status, elapsedMs: performance.now() - started, watchdog });
      } catch (error) {
        const timeout = error.kind === 'TimeoutError' || /timeout|timed.out/i.test(error.name + ' ' + error.code + ' ' + error.message);
        rounds.push({ outcome: watchdog ? 'watchdog' : error.status >= 400 ? 'http:' + error.status : timeout ? 'timeout' : 'network', error: error.kind ?? error.name, code: error.code, elapsedMs: performance.now() - started, watchdog });
      } finally { clearTimeout(timer); }
    }
    results[name] = rounds;
  }
  console.log(JSON.stringify(results));
  process.exit(0);
}
const servers = await startServers();
const observations = {};
try {
  for (const adapter of adapters) {
    const env = { ...process.env, RELIABILITY_CHILD: JSON.stringify({ adapter, base: servers.a }) };
    if (adapter === 'rust-fetch/node:http') env.RUST_FETCH_NATIVE = '0';
    else delete env.RUST_FETCH_NATIVE;
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], { env, timeout: 30000, maxBuffer: 2 ** 20 });
    observations[adapter] = JSON.parse(stdout.trim().split('\n').pop());
  }
} finally { servers.close(); }
const packageVersion = (name) => JSON.parse(readFileSync(new URL('node_modules/' + name + '/package.json', root))).version;
const data = {
  method: { timeoutMs: 150, watchdogMs: 1000, retries: 0, rounds: 3, body: 'fully consumed', endpoints: 'loopback only', note: 'Axios timeout is inactivity-based; the watchdog identifies missing total deadlines. HTTP statuses are normalized after full-body consumption.' },
  versions: { node: process.version, rustFetchManifest: JSON.parse(readFileSync(new URL('package.json', root))).version, axios: packageVersion('axios'), ky: packageVersion('ky'), got: packageVersion('got'), undici: packageVersion('undici') },
  bundleSha256: createHash('sha256').update(readFileSync(new URL('wasm-module/pkg/rust_fetch_bg.wasm', root))).update(readFileSync(new URL('wasm-module/pkg/node.js', root))).update(readFileSync(new URL('wasm-module/pkg/rust_fetch.js', root))).digest('hex'),
  observations,
};
const expected = { success: 'ok', reset: 'network', truncated: 'network', oversizedHeaders: 'network', stalledHeaders: 'timeout', stalledBody: 'timeout', trickleBody: 'timeout', redirectLoop: 'network', rateLimited: 'http:429', unavailable: 'http:503' };
for (const adapter of adapters.slice(0, 2)) for (const [name, rounds] of Object.entries(observations[adapter])) {
  if (rounds.some((r) => r.outcome !== expected[name] || r.watchdog)) throw Error(adapter + ' regressed ' + name + ': ' + JSON.stringify(rounds));
}
const jsonPath = new URL('benchmarks/reliability/results.json', root);
const docPath = new URL('docs/reliability.md', root);
const label = (rounds) => [...new Set(rounds.map((r) => r.outcome))].join('/') + ' (' + Math.round([...rounds].sort((a,b) => a.elapsedMs - b.elapsedMs)[1].elapsedMs) + ' ms)';
const lines = [
  '# Reliability under injected faults', '',
  'Generated by npm run reliability:compare. Local loopback server, full body consumption, retries disabled, three rounds per case. Each client gets its own 150 ms timeout; the shared 1,000 ms abort watchdog is reported as watchdog, rather than credited to the client. HTTP error statuses are normalized so exception defaults do not determine the result.', '',
  'Versions: Node ' + data.versions.node + '; axios ' + data.versions.axios + '; ky ' + data.versions.ky + '; got ' + data.versions.got + '; undici ' + data.versions.undici + '. rust-fetch is the unreleased 2.7.0 implementation (manifest ' + data.versions.rustFetchManifest + ').', '',
  '| Fault | ' + adapters.join(' | ') + ' |', '| --- | ' + adapters.map(() => '---').join(' | ') + ' |',
  ...Object.keys(paths).map((name) => '| ' + name + ' | ' + adapters.map((a) => label(observations[a][name])).join(' | ') + ' |'), '',
  'The table measures these configurations and faults, not a general reliability ranking. Network error names differ. Some clients reject oversized headers sooner; lower failure latency is not necessarily better error handling. Axios uses an inactivity timeout, so a peer that keeps sending bytes can outlive its timeout. A total deadline or AbortSignal is needed for that case. The fault server and raw results are committed under benchmarks/reliability/.', '',
  'CI runs the fault cases in the transport conformance matrix on native, node:http, fetch, Chromium, Firefox and WebKit. Dedicated WebSocket/SSE tests cover drops, reconnects, silent idle timeouts, cancellation bursts and server restarts. The Node comparison also fails if either rust-fetch transport misses an expected outcome or needs the watchdog.', '',
  'Sixteen concurrent SSE streams and sixteen WebSockets also face repeated immediate closes in every adapter, checking recovery, retry counts and jitter bounds. Each storm must recover within 30 seconds (SSE within 5 seconds), allowing for browser connection scheduling in addition to configured backoff. Separate Node listener-restart tests drop all sixteen live connections, stop accepting for 50 ms, then reopen the same port; SSE must resume with Last-Event-ID and both APIs must recover with jittered backoff.', '',
  '## Gap decisions', '',
  '- WebSocket silent stalls use opt-in idleTimeoutMs, reset on received messages, and the existing reconnection policy. No unsolicited ping messages are sent: browser WebSocket does not expose control ping frames, and an application heartbeat must match the server protocol.', '',
  '- SSE uses idleTimeoutMs and the existing reconnect/jitter policy. Comment keep-alives count as activity. Both APIs retain the documented rule that opening a connection resets consecutive-retry failures; retries remain spaced by configured backoff. A lifetime reconnect cap would change that policy and is not introduced here.', '',
  '- DNS and TLS failures, refused connections, server restarts, socket limits, overload and bounded streams have dedicated existing transport/security tests. They complement this deterministic comparison; DNS and TLS browser errors expose fewer details than Node.', '',
  '- HTTP/2 and automatic replay of a one-shot upload remain outside this release. A body factory is required for a replayable streaming upload.', '',
  '## Reproduce', '', 'Run npm ci, npm run build, npm run build:native, then npm run reliability:compare on Node 22+. Raw outcomes, elapsed times, timeout settings, dependency versions and the bundle fingerprint are in the generated JSON.', '',
];
if (process.argv.includes('--write')) { writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n'); writeFileSync(docPath, lines.join('\n')); }
console.log(lines.join('\n'));
