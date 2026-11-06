// TLS certificate and protocol verification (#229), on both Node transports.
// Certificates are generated here with the openssl command line tool, so the
// bad ones are real: expired, not yet valid, wrong name, self-signed, signed by
// an unknown root, missing their intermediate, weak. HTTPS servers run in this
// process; the requests run in child processes, because NODE_EXTRA_CA_CERTS
// (how a private root is trusted) is read when a process starts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgDir = process.env.RUST_FETCH_PKG ?? fileURLToPath(new URL('../../pkg', import.meta.url));
const pkg = pathToFileURL(join(pkgDir, 'node.js')).href;
const nativeAvailable = process.env.RUST_FETCH_NATIVE !== '0' && existsSync(join(pkgDir, `rust-fetch-native.${process.platform}-${process.arch}.node`));
const child = fileURLToPath(new URL('./tls-child.mjs', import.meta.url));

let haveOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { haveOpenssl = false; }

const dir = mkdtempSync(join(tmpdir(), 'rust-fetch-tls-'));
const openssl = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
const fmt = (date) => date.toISOString().replace(/[-:T]/g, '').replace(/\.\d+/, '');
const DAY = 86_400_000;

/** A certificate authority that can issue: a key, a certificate and a signing database */
function makeCa(name, { parent, keyAlgorithm = 'EC' } = {}) {
  const key = `${name}.key`;
  openssl('genpkey', '-algorithm', keyAlgorithm, ...(keyAlgorithm === 'EC' ? ['-pkeyopt', 'ec_paramgen_curve:prime256v1'] : []), '-out', key);
  writeFileSync(join(dir, `${name}.index`), '');
  writeFileSync(join(dir, `${name}.serial`), '01');
  writeFileSync(join(dir, `${name}.cnf`), `[ca]\ndefault_ca=c\n[c]\ndatabase=${dir}/${name}.index\nnew_certs_dir=${dir}\nserial=${dir}/${name}.serial\ndefault_md=sha256\npolicy=p\nunique_subject=no\ncopy_extensions=none\n[p]\ncommonName=supplied\n`);
  const ca = { name, key, cert: `${name}.pem` };
  if (!parent) {
    openssl('req', '-x509', '-new', '-key', key, '-subj', `/CN=${name}`, '-days', '3650', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', ca.cert);
  } else {
    sign(parent, name, { cn: name, ext: ['basicConstraints=critical,CA:TRUE,pathlen:0', 'keyUsage=critical,keyCertSign,cRLSign'], key });
  }
  return ca;
}

/** Issue `<name>.pem` for a new key (or `key`), signed by `issuer` */
function sign(issuer, name, { cn = 'localhost', san = 'DNS:localhost,IP:127.0.0.1', ext, start = new Date(Date.now() - DAY), end = new Date(Date.now() + 30 * DAY), md = 'sha256', key, bits } = {}) {
  if (!key) {
    key = `${name}.key`;
    openssl('genpkey', '-algorithm', bits ? 'RSA' : 'EC', ...(bits ? ['-pkeyopt', `rsa_keygen_bits:${bits}`] : ['-pkeyopt', 'ec_paramgen_curve:prime256v1']), '-out', key);
  }
  openssl('req', '-new', '-key', key, '-subj', `/CN=${cn}`, '-out', `${name}.csr`);
  const extensions = ext ?? ['basicConstraints=CA:FALSE', 'extendedKeyUsage=serverAuth', ...(san ? [`subjectAltName=${san}`] : [])];
  writeFileSync(join(dir, `${name}.ext`), `${extensions.join('\n')}\n`);
  openssl('ca', '-batch', '-config', `${issuer.name}.cnf`, '-cert', issuer.cert, '-keyfile', issuer.key, '-in', `${name}.csr`, '-out', `${name}.pem`, '-notext', '-startdate', fmt(start), '-enddate', fmt(end), '-md', md, '-extfile', `${name}.ext`);
  return { key, cert: `${name}.pem` };
}

const read = (file) => readFileSync(join(dir, file), 'utf8');
const chain = (...files) => files.map(read).join('');

const servers = [];
/** An HTTPS server on localhost (both address families where there are two) */
async function serve({ key, cert, ...tlsOptions }) {
  const seen = [];
  const requests = [];
  const server = https.createServer({ key: read(key), cert, ...tlsOptions }, (req, res) => { requests.push(req.headers.connection); res.end('secure-ok'); });
  server.on('secureConnection', (socket) => seen.push({ alpn: socket.alpnProtocol, servername: socket.servername, protocol: socket.getProtocol() }));
  server.on('tlsClientError', () => {});
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '::', resolve); }); } catch { await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve)); }
  servers.push(server);
  return { port: server.address().port, seen, requests, server };
}

/** Run the requests of one transport in a child process; resolves to { results, warnings } */
function runChild(cases, { native, trust, env = {} }) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, TLS_PKG: pkg, TLS_CASES: JSON.stringify(cases), NODE_EXTRA_CA_CERTS: trust ? join(dir, trust) : '', ...env };
    // Unset means the addon is used when it is built; `0` keeps node:http (an empty value would too)
    if (native) delete childEnv.RUST_FETCH_NATIVE; else childEnv.RUST_FETCH_NATIVE = '0';
    const proc = spawn(process.execPath, [child], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => { out += chunk; });
    proc.stderr.on('data', (chunk) => { err += chunk; });
    proc.on('close', (code) => {
      try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { reject(new Error(`child exited ${code}: ${err.slice(0, 500)} ${out.slice(0, 300)}`)); }
    });
  });
}

const TRANSPORTS = [['node:http', false], ...(nativeAvailable ? [['native', true]] : [])];
const IP = '127.0.0.1';
// OpenSSL 3.5 (Node 24) raised the default security level, so it refuses the 1024 bit RSA key that older ones accept
const [opensslMajor, opensslMinor] = process.versions.openssl.split('.').map(Number);
const strongDefaults = opensslMajor > 3 || (opensslMajor === 3 && opensslMinor >= 5);
const certAt = (start, end) => ({ start: new Date(start), end: new Date(end) });

// Every case: a server certificate (or TLS setting), what the client must do, and the address it connects to.
// `make(ctx)` returns the options for https.createServer; `ctx` holds the generated authorities.
const SPECS = [
  { name: 'a valid certificate for the host name', expect: 'accept', make: ({ good }) => ({ key: good.key, cert: read(good.cert) }) },
  { name: 'a valid certificate for the IP address', expect: 'accept', host: IP, make: ({ good }) => ({ key: good.key, cert: read(good.cert) }) },
  { name: 'a complete chain (leaf and intermediate)', expect: 'accept', make: ({ viaInter }) => ({ key: viaInter.key, cert: chain('via-inter.pem', 'interA.pem') }) },
  { name: 'an IP address certificate for this address', expect: 'accept', host: IP, make: ({ ctx }) => { const c = sign(ctx.rootA, 'ip-match', { cn: IP, san: `IP:${IP}` }); return { key: c.key, cert: read(c.cert) }; } },
  { name: 'a chain missing its intermediate', expect: 'reject', make: ({ viaInter }) => ({ key: viaInter.key, cert: read(viaInter.cert) }) },
  { name: 'an expired certificate', expect: 'reject', make: ({ ctx }) => { const c = sign(ctx.rootA, 'expired', certAt('2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z')); return { key: c.key, cert: read(c.cert) }; } },
  { name: 'a certificate that is not valid yet', expect: 'reject', make: ({ ctx }) => { const c = sign(ctx.rootA, 'future', { start: new Date(Date.now() + 10 * DAY), end: new Date(Date.now() + 40 * DAY) }); return { key: c.key, cert: read(c.cert) }; } },
  { name: 'a certificate for another host name', expect: 'reject', make: ({ ctx }) => { const c = sign(ctx.rootA, 'other-name', { cn: 'other.test', san: 'DNS:other.test' }); return { key: c.key, cert: read(c.cert) }; } },
  { name: 'an IP address certificate for another address', expect: 'reject', host: IP, make: ({ ctx }) => { const c = sign(ctx.rootA, 'ip-other', { cn: '127.0.0.2', san: 'IP:127.0.0.2' }); return { key: c.key, cert: read(c.cert) }; } },
  { name: 'a host name certificate used for an IP address', expect: 'reject', host: IP, make: ({ ctx }) => { const c = sign(ctx.rootA, 'name-for-ip', { san: 'DNS:localhost' }); return { key: c.key, cert: read(c.cert) }; } },
  { name: 'a certificate with the name only in the subject', expect: 'reject', gap: { 'node:http': '#244: Node falls back to the subject common name' }, make: ({ ctx }) => { const c = sign(ctx.rootA, 'cn-only', { san: null }); return { key: c.key, cert: read(c.cert) }; } },
  { name: 'a certificate that may only be used by clients', expect: 'reject', make: ({ ctx }) => { const c = sign(ctx.rootA, 'client-auth', { ext: ['basicConstraints=CA:FALSE', 'extendedKeyUsage=clientAuth', 'subjectAltName=DNS:localhost,IP:127.0.0.1'] }); return { key: c.key, cert: read(c.cert) }; } },
  { name: 'a certificate issued by a non-CA certificate', expect: 'reject', make: ({ ctx }) => {
    const leaf = sign(ctx.rootA, 'leaf-ca', { san: 'DNS:localhost' });
    writeFileSync(join(dir, 'leaf-ca.index'), '');
    writeFileSync(join(dir, 'leaf-ca.serial'), '01');
    writeFileSync(join(dir, 'leaf-ca.cnf'), read('rootA.cnf').replaceAll('rootA', 'leaf-ca'));
    const under = sign({ name: 'leaf-ca', key: leaf.key, cert: leaf.cert }, 'under-leaf');
    return { key: under.key, cert: chain('under-leaf.pem', 'leaf-ca.pem') };
  } },
  { name: 'a self-signed certificate', expect: 'reject', make: () => {
    openssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'self.key', '-out', 'self.pem', '-subj', '/CN=localhost', '-days', '30', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1');
    return { key: 'self.key', cert: read('self.pem') };
  } },
  { name: 'a valid chain from a root that is not trusted', expect: 'reject', make: ({ ctx }) => { const c = sign(ctx.rootB, 'unknown-root'); return { key: c.key, cert: read(c.cert) }; } },
  { name: 'a 1024 bit RSA key', expect: 'reject', gap: strongDefaults ? undefined : { 'node:http': '#244: OpenSSL older than 3.5 allows 1024 bit RSA' }, make: ({ ctx }) => { const c = sign(ctx.rootA, 'rsa1024', { bits: 1024 }); return { key: c.key, cert: read(c.cert), ciphers: 'DEFAULT:@SECLEVEL=0' }; } },
  { name: 'a SHA-1 signature', expect: 'reject', make: ({ ctx }) => { const c = sign(ctx.rootA, 'sha1', { md: 'sha1' }); return { key: c.key, cert: read(c.cert), ciphers: 'DEFAULT:@SECLEVEL=0' }; } },
  { name: 'TLS 1.0 only', expect: 'reject', make: ({ good }) => ({ key: good.key, cert: read(good.cert), minVersion: 'TLSv1', maxVersion: 'TLSv1', ciphers: 'ALL:@SECLEVEL=0' }) },
  { name: 'TLS 1.1 only', expect: 'reject', make: ({ good }) => ({ key: good.key, cert: read(good.cert), minVersion: 'TLSv1.1', maxVersion: 'TLSv1.1', ciphers: 'ALL:@SECLEVEL=0' }) },
  { name: 'TLS 1.2 only', expect: 'accept', protocol: 'TLSv1.2', make: ({ good }) => ({ key: good.key, cert: read(good.cert), minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' }) },
  { name: 'TLS 1.3 only', expect: 'accept', protocol: 'TLSv1.3', make: ({ good }) => ({ key: good.key, cert: read(good.cert), minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }) },
  { name: 'a server that offers HTTP/2 through ALPN', expect: 'accept', make: ({ good }) => ({ key: good.key, cert: read(good.cert), ALPNProtocols: ['h2', 'http/1.1'] }) },
];

describe('TLS verification', { skip: !haveOpenssl && 'the openssl command line tool is not installed' }, () => {
  const live = new Map(); // spec name -> server
  const outcomes = {}; // transport -> spec name -> result
  const seen = {}; // transport -> spec name -> what the server saw
  const connectionHeader = {}; // transport -> the Connection header of a request (node:http sends keep-alive, the addon doesn't)
  const extras = {}; // transport -> extra results
  let proxy;

  before(async () => {
    const ctx = { rootA: makeCa('rootA'), rootB: makeCa('rootB') };
    ctx.interA = makeCa('interA', { parent: ctx.rootA });
    const good = sign(ctx.rootA, 'good');
    const viaInter = sign(ctx.interA, 'via-inter');
    for (const spec of SPECS) live.set(spec.name, await serve(spec.make({ ctx, good, viaInter })));

    const cases = SPECS.map(({ name, host }) => ({ name, url: `https://${host ?? 'localhost'}:${live.get(name).port}/` }));
    for (const [transport, native] of TRANSPORTS) {
      for (const server of live.values()) server.seen.length = 0;
      const { results } = await runChild(cases, { native, trust: 'rootA.pem' });
      outcomes[transport] = Object.fromEntries(results.map((result) => [result.name, result]));
      seen[transport] = Object.fromEntries([...live].map(([name, server]) => [name, server.seen.splice(0)]));
      connectionHeader[transport] = live.get('a valid certificate for the host name').requests.splice(0)[0];

      // The same good server with no extra root, and with verification switched off by the environment
      const good = live.get('a valid certificate for the host name');
      const unknownRoot = live.get('a valid chain from a root that is not trusted');
      const one = (name, server) => [{ name, url: `https://localhost:${server.port}/` }];
      const untrusted = await runChild(one('no extra root', good), { native, trust: null });
      const off = await runChild(one('verification off', unknownRoot), { native, trust: 'rootA.pem', env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' } });
      extras[transport] = { untrusted: untrusted.results[0], off: off.results[0], offWarnings: off.warnings };
    }

    // An HTTP CONNECT proxy that tunnels to wherever it is asked
    proxy = http.createServer();
    proxy.on('connect', (req, client, head) => {
      const [host, port] = req.url.split(':');
      const upstream = net.connect(Number(port), host, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.write(head); upstream.pipe(client); client.pipe(upstream); });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const viaProxy = ['a valid certificate for the host name', 'an expired certificate', 'a self-signed certificate', 'a certificate for another host name'];
    const proxyCases = viaProxy.map((name) => ({ name, url: `https://localhost:${live.get(name).port}/`, options: { proxy: `http://127.0.0.1:${proxy.address().port}` } }));
    for (const [transport, native] of TRANSPORTS) {
      const { results } = await runChild(proxyCases, { native, trust: 'rootA.pem' });
      extras[transport].proxy = Object.fromEntries(results.map((result) => [result.name, result]));
    }
  });

  after(() => {
    for (const server of servers) { server.closeAllConnections?.(); server.close(); }
    proxy?.closeAllConnections?.();
    proxy?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const describeResult = (result) => (result.ok ? `accepted (status ${result.status})` : `refused (${result.code ?? result.kind}: ${result.message})`);

  for (const [transport] of TRANSPORTS) {
    describe(transport, () => {
      for (const spec of SPECS) {
        const gap = spec.gap?.[transport];
        it(`${spec.expect === 'accept' ? 'accepts' : 'refuses'} ${spec.name}`, { todo: gap }, () => {
          const result = outcomes[transport][spec.name];
          assert.equal(result.ok, spec.expect === 'accept', describeResult(result));
          if (spec.expect === 'accept') assert.equal(result.status, 200);
        });
        // A known gap is also pinned as it is today, so this file fails (and the marker gets removed) once it is closed
        if (gap) {
          it(`KNOWN GAP (${gap.split(':')[0]}): accepts ${spec.name}`, () => {
            const result = outcomes[transport][spec.name];
            assert.equal(result.ok, true, `the gap seems to be closed: ${describeResult(result)}. Remove the gap marker from this case`);
          });
        }
      }

      it(transport === 'native' ? 'runs on the native addon' : 'runs on node:http', () => {
        assert.equal(connectionHeader[transport], transport === 'native' ? undefined : 'keep-alive');
      });

      it('a refused certificate never gets as far as an HTTP request', () => {
        // The servers answer every request they get; a refusal must come from the handshake. The TLS 1.0/1.1 servers
        // never complete one, so a completed handshake there would be a downgrade
        for (const name of ['TLS 1.0 only', 'TLS 1.1 only']) assert.deepEqual(seen[transport][name], [], name);
      });

      it('negotiates the protocol version the server is limited to', () => {
        for (const spec of SPECS.filter((entry) => entry.protocol)) {
          assert.ok(seen[transport][spec.name].some((entry) => entry.protocol === spec.protocol), `${spec.name}: ${JSON.stringify(seen[transport][spec.name])}`);
        }
      });

      it('does not negotiate HTTP/2 when the server offers it', () => {
        const entries = seen[transport]['a server that offers HTTP/2 through ALPN'];
        assert.ok(entries.length > 0);
        assert.ok(entries.every((entry) => entry.alpn !== 'h2'), JSON.stringify(entries));
      });

      it('sends the host name as SNI, and no SNI for an IP address', () => {
        assert.ok(seen[transport]['a valid certificate for the host name'].every((entry) => entry.servername === 'localhost'), JSON.stringify(seen[transport]['a valid certificate for the host name']));
        const forIp = seen[transport]['a valid certificate for the IP address'];
        assert.ok(forIp.length > 0);
        assert.ok(forIp.every((entry) => !entry.servername), `an IP address was sent as SNI: ${JSON.stringify(forIp)}`);
      });

      it('trusts a private root only when NODE_EXTRA_CA_CERTS names it', () => {
        assert.equal(extras[transport].untrusted.ok, false, describeResult(extras[transport].untrusted));
      });

      it('NODE_TLS_REJECT_UNAUTHORIZED=0 turns verification off, with a warning', () => {
        assert.equal(extras[transport].off.ok, true, describeResult(extras[transport].off));
        assert.ok(extras[transport].offWarnings.some((warning) => /NODE_TLS_REJECT_UNAUTHORIZED/.test(warning)), JSON.stringify(extras[transport].offWarnings));
      });

      it('verifies certificates through an HTTP CONNECT proxy', () => {
        const results = extras[transport].proxy;
        assert.equal(results['a valid certificate for the host name'].ok, true, describeResult(results['a valid certificate for the host name']));
        for (const name of ['an expired certificate', 'a self-signed certificate', 'a certificate for another host name']) {
          assert.equal(results[name].ok, false, `${name}: ${describeResult(results[name])}`);
        }
      });
    });
  }
});
