// "Importing the Node.js entry ... does not make an outbound request" (docs/security.md, SECURITY.md).
// Hooks the JavaScript network entry points in a fresh process, imports the package and builds a
// client, and expects none of them to be used. The native addon's own sockets are not visible to
// these hooks; it has no connection code that runs at import (it only starts its worker runtime).
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgDir = process.env.RUST_FETCH_PKG ?? fileURLToPath(new URL('../../pkg', import.meta.url));

it('importing the Node.js entry and creating a client makes no JavaScript-visible network call', () => {
  const source = `
    import net from 'node:net';
    import dns from 'node:dns';
    import http from 'node:http';
    import https from 'node:https';
    const calls = [];
    const record = (name) => (...args) => { calls.push(name + ' ' + String(args[0]?.host ?? args[0]?.hostname ?? args[0]).slice(0, 80)); throw new Error('network call during import: ' + name); };
    net.Socket.prototype.connect = record('net.Socket.connect');
    net.connect = record('net.connect');
    dns.lookup = record('dns.lookup');
    dns.resolve = record('dns.resolve');
    dns.promises.lookup = record('dns.promises.lookup');
    http.request = record('http.request');
    https.request = record('https.request');
    globalThis.fetch = record('fetch');
    globalThis.WebSocket = record('WebSocket');
    const { WasmClient } = await import(${JSON.stringify(pathToFileURL(`${pkgDir}/node.js`).href)});
    new WasmClient({ baseUrl: 'https://api.example.com' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    console.log(JSON.stringify(calls));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, NODE_EXTRA_CA_CERTS: '' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), []);
});
