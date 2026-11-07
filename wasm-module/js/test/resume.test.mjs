// The `resume` option (#51): a streamed download that continues after the connection breaks.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import init, { WasmClient } from '../../pkg/node.js';
import { rejection, startServer } from './helpers.mjs';

const FILE = crypto.randomBytes(100_000);
let server;
let log;
let plan; // per request number: how many bytes to send before the connection is cut (undefined: all)
let etag;
before(async () => {
  await init();
  server = await startServer((req, res, ctx) => {
    const path = new URL(req.url, 'http://x').pathname;
    log.push({ path, range: req.headers.range, ifRange: req.headers['if-range'] });
    if (path === '/plain') { res.writeHead(200, { etag: '"p"', 'content-length': FILE.length }); return res.end(FILE); } // no Accept-Ranges
    if (path === '/noetag') { res.writeHead(200, { 'accept-ranges': 'bytes', 'content-length': FILE.length }); return res.end(FILE); }
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    const matches = !range || req.headers['if-range'] === etag;
    const from = range && matches ? start : 0;
    const status = range && matches ? 206 : 200;
    const headers = { 'accept-ranges': 'bytes', etag, 'content-length': FILE.length - from, 'content-type': 'application/octet-stream' };
    if (status === 206) headers['content-range'] = `bytes ${from}-${FILE.length - 1}/${FILE.length}`;
    res.writeHead(status, headers);
    const cut = plan[log.length - 1];
    if (cut === undefined) return res.end(FILE.subarray(from));
    res.write(FILE.subarray(from, from + cut));
    setTimeout(() => res.socket.destroy(), 20);
  });
});
after(() => server.close());
beforeEach(() => { log = []; plan = []; etag = '"v1"'; });

const client = () => new WasmClient({ baseUrl: server.url('').replace(/\/$/, ''), retries: 0 });
const read = async (body) => {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

describe('resume', () => {
  it('continues from the last received byte after a broken connection, and the bytes are exact', async () => {
    plan = [30_000, 20_000]; // the first two requests are cut; the third finishes
    const response = await client().get('/file', { responseType: 'stream', resume: true });
    const bytes = await read(response.body);
    assert.ok(bytes.equals(FILE), `${bytes.length} bytes`);
    assert.equal(response.resumes, 2);
    assert.equal(response.status, 200);
    assert.equal(log.length, 3);
    assert.equal(log[1].ifRange, '"v1"');
    assert.match(log[1].range, /^bytes=\d+-$/);
    assert.ok(Number(/\d+/.exec(log[2].range)[0]) > Number(/\d+/.exec(log[1].range)[0]));
  });

  it('does nothing extra when the download finishes at once', async () => {
    const response = await client().get('/file', { responseType: 'stream', resume: true });
    assert.ok((await read(response.body)).equals(FILE));
    assert.equal(response.resumes, 0);
    assert.equal(log.length, 1);
  });

  it('fails like any stream after maxResumes', async () => {
    plan = [10_000, 10_000, 10_000];
    const response = await client().get('/file', { responseType: 'stream', resume: { maxResumes: 2 } });
    const error = await rejection(read(response.body));
    assert.equal(error.kind, 'NetworkError');
    assert.equal(response.resumes, 2);
  });

  it('refuses to splice when the file changed (If-Range fails and the server sends 200)', async () => {
    plan = [20_000];
    const response = await client().get('/file', { responseType: 'stream', resume: true });
    etag = '"v2"'; // changed while downloading
    const error = await rejection(read(response.body));
    assert.equal(error.kind, 'NetworkError');
    assert.match(error.cause.message, /could not be resumed/);
  });

  it('streams as usual when the server cannot resume it', async () => {
    for (const path of ['/plain', '/noetag']) {
      const response = await client().get(path, { responseType: 'stream', resume: true });
      assert.equal('resumes' in response, false, path);
      assert.ok((await read(response.body)).equals(FILE));
    }
  });

  it('carries the request options into the continuation, and can be cancelled', async () => {
    plan = [10_000];
    const headers = [];
    const c = client();
    c.addRequestInterceptor((request) => { headers.push(request.headers['x-trace']); });
    const response = await c.get('/file', { responseType: 'stream', resume: true, headers: { 'X-Trace': 'abc' } });
    await read(response.body);
    assert.deepEqual(headers, ['abc', 'abc']);
    log = [];
    plan = [];
    const second = await c.get('/file', { responseType: 'stream', resume: true });
    const reader = second.body.getReader();
    await reader.read();
    await reader.cancel('enough');
  });

  it('validates the option', async () => {
    for (const [resume, options, parameter] of [['yes', {}, 'resume'], [{ maxResumes: 0 }, {}, 'resume'], [{ other: 1 }, {}, 'resume'], [true, { responseType: 'json' }, 'resume']]) {
      const error = await rejection(client().get('/file', { resume, responseType: 'stream', ...options }));
      assert.deepEqual([error.kind, error.parameter], ['InvalidInputError', parameter], JSON.stringify(resume));
    }
  });

  it('works on a derived client', async () => {
    plan = [15_000];
    const response = await client().extend({ headers: { 'x-d': '1' } }).get('/file', { responseType: 'stream', resume: true });
    assert.ok((await read(response.body)).equals(FILE));
    assert.equal(response.resumes, 1);
  });
});
