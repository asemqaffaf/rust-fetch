// Installs the packed npm tarball into a scratch project and uses it the way a
// consumer would: `import 'rust-fetch'`, `require('rust-fetch')`, the browser
// entry, and the TypeScript definitions.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, startServer } from './helpers.mjs';

const pkgDir = fileURLToPath(new URL('../../pkg/', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let project;
let server;
let packed;

before(async () => {
  project = mkdtempSync(join(tmpdir(), 'rust-fetch-consumer-'));
  [packed] = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', project], { cwd: pkgDir }));
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  execFileSync(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts', join(project, packed.filename)], {
    cwd: project,
    stdio: 'ignore',
  });
  server = await startServer((req, res) => json(res, { hello: 'world', path: req.url }));
});

after(async () => {
  await server?.close();
  if (project) rmSync(project, { recursive: true, force: true });
});

/** Run a script inside the consumer project; resolves with { code, stdout, stderr, ms }. */
function run(file, source) {
  writeFileSync(join(project, file), source);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { cwd: project });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr, ms: Date.now() - started }));
  });
}

describe('published package', () => {
  it('ships exactly the runtime files and project policies', () => {
    const files = packed.files.map((f) => f.path).sort();
    assert.deepEqual(files, [
      'CODE_OF_CONDUCT.md',
      'CONTRIBUTING.md',
      'LICENSE-APACHE',
      'LICENSE-MIT',
      'README.md',
      'SECURITY.md',
      'llms.txt',
      'node.js',
      'package.json',
      'rust_fetch.d.ts',
      'rust_fetch.js',
      'rust_fetch_bg.wasm',
      'rust_fetch_bg.wasm.d.ts',
    ]);
  });

  it('works via `import` in Node.js without calling init()', async () => {
    const result = await run(
      'esm.mjs',
      `import { WasmClient, fetch_json } from 'rust-fetch';
       const res = await new WasmClient().get(${JSON.stringify(server.url('/esm'))});
       const data = await fetch_json(${JSON.stringify(server.url('/fn'))});
       console.log(JSON.stringify([res.body, data.path]));`,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [{ hello: 'world', path: '/esm' }, '/fn']);
  });

  it('keeps the documented `await init()` pattern working in Node.js', async () => {
    const result = await run(
      'init.mjs',
      `import init, { WasmClient } from 'rust-fetch';
       await init();
       console.log((await new WasmClient().get(${JSON.stringify(server.url('/init'))})).body.path);`,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '/init');
    assert.doesNotMatch(result.stderr, /deprecated/);
  });

  it('works via `require` where Node.js supports require(esm)', { skip: !process.features?.require_module }, async () => {
    const result = await run(
      'cjs.cjs',
      `const { WasmClient } = require('rust-fetch');
       new WasmClient().get(${JSON.stringify(server.url('/cjs'))}).then((r) => console.log(r.body.path));`,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '/cjs');
  });

  it('exposes the browser entry, which initializes from bytes', async () => {
    const result = await run(
      'web.mjs',
      `import { readFileSync } from 'node:fs';
       import { createRequire } from 'node:module';
       import init, { WasmClient } from 'rust-fetch/rust_fetch.js';
       const wasm = createRequire(import.meta.url).resolve('rust-fetch/rust_fetch_bg.wasm');
       await init({ module_or_path: readFileSync(wasm) });
       console.log((await new WasmClient().get(${JSON.stringify(server.url('/web'))})).body.path);`,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '/web');
  });

  it('lets the process exit as soon as requests finish (no lingering timers)', async () => {
    // Default timeout is 30s; a leaked timer would keep Node alive that long
    const result = await run(
      'exit.mjs',
      `import { WasmClient } from 'rust-fetch';
       const c = new WasmClient({ retries: 2 });
       await Promise.all([c.get(${JSON.stringify(server.url('/a'))}), c.get(${JSON.stringify(server.url('/b'))})]);
       await c.get(${JSON.stringify(server.url('/c'))}, { signal: new AbortController().signal });`,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.ms < 5000, `process took ${result.ms}ms to exit`);
  });

  it('type-checks a strict TypeScript consumer without skipLibCheck, with TypeScript 7 and 5.2', () => {
    writeFileSync(
      join(project, 'consumer.ts'),
      `import init, { WasmClient, fetch_json, type HttpResponse, type RustFetchError, type ClientOptions,
         type RequestOptions, type FetchInit, type DownloadProgress, type InterceptedRequest } from 'rust-fetch';
       interface User { id: number; name: string }
       await init();
       const options: ClientOptions = { baseUrl: 'https://api.example.com', timeoutMs: 1000, retries: { maxRetries: 2, retryOn: [503] } };
       const client = new WasmClient(options);
       const res: HttpResponse<User> = await client.get('/users/1');
       const name: string = res.body.name;
       // Request methods are generic over the body type; untyped calls stay \`any\`
       const typed = await client.get<User>('/users/1');
       const id: number = typed.body.id;
       // @ts-expect-error the body is a User, not a string
       const wrong: string = typed.body;
       const created = await client.post<User>('/users', { body: { name } });
       const createdName: string = created.body.name;
       const viaFetch: HttpResponse<User[]> = await client.fetch<User[]>('/users');
       const untyped = await client.get('/anything');
       const anything: number = untyped.body;
       const socket = client.websocket('/live', { reconnect: true, messageType: 'json', onMessage: (m: unknown) => m });
       const state: 'connecting' | 'open' | 'reconnecting' | 'closing' | 'closed' = socket.state;
       await client.post('/upload', { body: new Blob(['x']), onUploadProgress: ({ loaded, total }) => loaded / total });
       const requestOptions: RequestOptions = { retries: 0, params: { tag: ['a', 'b'] }, responseType: 'stream', signal: AbortSignal.timeout(10),
         onDownloadProgress: (p: DownloadProgress) => p.loaded };
       const init2: FetchInit = { retries: { maxRetries: 1, retryNonIdempotent: true }, method: 'POST', body: new FormData() };
       await client.fetch('/upload', init2);
       await client.get('/x', requestOptions);
       client.events('/events', { retries: { maxRetries: 1 }, reconnect: false }).close();
       // @ts-expect-error retries must be a count or RetryOptions
       await client.get('/x', { retries: true });
       client.addRequestInterceptor((r: InterceptedRequest) => { r.headers.authorization = name; });
       client.addResponseInterceptor((r) => r, async (e: RustFetchError) => { throw e; });
       await fetch_json('https://example.com');`,
    );
    // The current compiler, and the oldest one the README supports
    const args = ['--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--lib', 'es2022,dom', 'consumer.ts'];
    for (const compiler of ['typescript', 'typescript-5.2']) {
      const tsc = fileURLToPath(new URL(`../../../node_modules/${compiler}/bin/tsc`, import.meta.url));
      const result = spawnSync(process.execPath, [tsc, ...args], { cwd: project, encoding: 'utf8' });
      assert.equal(result.status, 0, `${compiler}: ${result.stdout}${result.stderr}`);
    }
  });

  it('ships TypeScript definitions for the public API', () => {
    const types = readFileSync(join(project, 'node_modules/rust-fetch/rust_fetch.d.ts'), 'utf8');
    for (const name of [
      'export interface ClientOptions',
      'export interface RequestOptions',
      'export interface FetchInit',
      'export interface HttpResponse',
      'export interface RustFetchError',
      'export class WasmClient',
      'constructor(options?: ClientOptions | null)',
      'get<T = any>(url: string, options?: RequestOptions | null): Promise<HttpResponse<T>>',
      'export function fetch_json(url: string): Promise<any>',
    ]) {
      assert.ok(types.includes(name), `missing: ${name}`);
    }
  });
});
