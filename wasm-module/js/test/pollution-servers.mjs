// The servers pollution-child.mjs talks to. They run in their own process so
// that polluting Object.prototype breaks neither them nor Node's own sockets:
// only the client under test is polluted.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let proxyHits = [];
const target = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url === '/redirect') { res.writeHead(302, { location: '/json' }); return res.end(); }
    if (req.url === '/404') { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"missing":true}'); }
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('one,');
      return setTimeout(() => res.end('two'), 5);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, method: req.method, size: body.length, authorization: req.headers.authorization ?? null, extra: req.headers['x-polluted'] ?? null, url: req.url }));
  });
});
const proxy = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    proxyHits.push({ url: req.url, authorization: req.headers.authorization ?? null, body: Buffer.concat(chunks).toString() });
    res.writeHead(502);
    res.end();
  });
});

// A self-signed certificate that nothing trusts
const dir = mkdtempSync(join(tmpdir(), 'rust-fetch-pollution-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
  '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(dir, 'key'), '-out', join(dir, 'crt')], { stdio: 'ignore' });
const secure = https.createServer({ key: readFileSync(join(dir, 'key')), cert: readFileSync(join(dir, 'crt')) }, (req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"secret":true}');
});
// Idle connections the client keeps would be closed by the server after 5 s,
// racing the next request that reuses one; stay open for the whole run instead
for (const server of [target, proxy, secure]) server.keepAliveTimeout = Number(process.env.SERVER_KEEPALIVE_MS ?? 120_000);
await Promise.all([target, proxy, secure].map(listen));

// Requests from the client come back as proxy hits since the last question
process.on('message', (message) => {
  if (message === 'hits') { process.send({ hits: proxyHits }); proxyHits = []; }
});
process.send({ target: target.address().port, proxy: proxy.address().port, secure: secure.address().port, ca: readFileSync(join(dir, 'crt'), 'utf8') });
