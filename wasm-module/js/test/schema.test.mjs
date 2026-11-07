// The `schema` request option (#43): Standard Schema validation with Zod, Valibot and a hand-written validator.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import * as v from 'valibot';
import init, { WasmClient, isValidationError } from '../../pkg/node.js';
import { json, rejection, startServer } from './helpers.mjs';

let server;
let hits = 0;
before(async () => {
  await init();
  server = await startServer((req, res) => {
    hits++;
    if (req.url.startsWith('/user')) return json(res, { id: 42, name: 'Ada', extra: 'x' });
    if (req.url.startsWith('/bad')) return json(res, { id: 'not a number' });
    if (req.url.startsWith('/flaky')) return hits % 2 ? json(res, {}, { status: 503 }) : json(res, { id: 1, name: 'ok' });
    json(res, { id: 7, name: 'echo', method: req.method });
  });
});
after(() => server.close());

const client = () => new WasmClient({ baseUrl: server.url('').replace(/\/$/, ''), retries: 0 });
const ZodUser = z.object({ id: z.number(), name: z.string() });
const ValibotUser = v.object({ id: v.number(), name: v.string() });

describe('schema option', () => {
  it('validates with Zod and Valibot, and the body becomes the schema output', async () => {
    for (const schema of [ZodUser, ValibotUser]) {
      const response = await client().get('/user', { schema });
      assert.deepEqual(response.body, { id: 42, name: 'Ada' }); // unknown keys stripped by the schema
      assert.equal(response.status, 200);
      assert.equal(response.url, server.url('/user'));
    }
  });

  it('rejects with a ValidationError that carries the issues, and the request context', async () => {
    for (const schema of [ZodUser, ValibotUser]) {
      const error = await rejection(client().get('/bad', { schema }));
      assert.deepEqual([error.kind, error.name, error.status, error.method], ['ValidationError', 'ValidationError', 200, 'GET']);
      assert.equal(error.url, server.url('/bad'));
      assert.ok(error.issues.length >= 1 && typeof error.issues[0].message === 'string');
      assert.equal(error.message, `Response validation failed: ${error.issues.length} issue${error.issues.length === 1 ? '' : 's'}`);
      assert.equal(isValidationError(error), true);
      assert.equal(error.message.includes('not a number'), false); // the message does not echo the body
      assert.ok(JSON.stringify(error.issues).includes('number')); // the issues say what was wrong
    }
  });

  it('accepts async validators and transforms', async () => {
    const asyncSchema = {
      '~standard': { version: 1, vendor: 'test', validate: async (value) => (value.id === 42 ? { value: { doubled: value.id * 2 } } : { issues: [{ message: 'nope' }] }) },
    };
    assert.deepEqual((await client().get('/user', { schema: asyncSchema })).body, { doubled: 84 });
    const error = await rejection(client().get('/bad', { schema: asyncSchema }));
    assert.equal(error.kind, 'ValidationError');
    assert.equal(error.issues[0].message, 'nope');
    const transform = z.object({ id: z.number() }).transform((u) => `user-${u.id}`);
    assert.equal((await client().get('/user', { schema: transform })).body, 'user-42');
  });

  it('counts several issues in the message and lists them on the error', async () => {
    const many = { '~standard': { version: 1, vendor: 'test', validate: () => ({ issues: [{ message: 'a' }, { message: 'b' }, { message: 'c' }] }) } };
    const error = await rejection(client().get('/user', { schema: many }));
    assert.equal(error.message, 'Response validation failed: 3 issues');
    assert.deepEqual(error.issues.map((i) => i.message), ['a', 'b', 'c']);
  });

  it('works for every method that takes request options', async () => {
    const c = client();
    const schema = z.object({ id: z.number(), method: z.string() });
    assert.equal((await c.post('/echo', { body: {}, schema })).body.method, 'POST');
    assert.equal((await c.put('/echo', { body: {}, schema })).body.method, 'PUT');
    assert.equal((await c.patch('/echo', { body: {}, schema })).body.method, 'PATCH');
    assert.equal((await c.delete('/echo', { schema })).body.method, 'DELETE');
    assert.equal((await c.post_json('/echo', {}, { schema })).body.method, 'POST');
    assert.equal((await c.fetch('/echo', { method: 'PUT', body: {}, schema })).body.method, 'PUT');
    assert.equal((await c.request('GET', '/echo', undefined, undefined, { schema })).body.method, 'GET');
    const head = await rejection(c.head('/echo', { schema })); // a HEAD response has no body to validate
    assert.equal(head.kind, 'ValidationError');
    const error = await rejection(c.fetch('/bad', { method: 'POST', body: {}, schema: ZodUser }));
    assert.equal(error.method, 'POST');
  });

  it('is not retried, and does not count as a failed attempt', async () => {
    hits = 0;
    const c = new WasmClient({ baseUrl: server.url('').replace(/\/$/, ''), retries: { maxRetries: 3, initialDelayMs: 1 } });
    const error = await rejection(c.get('/bad', { schema: ZodUser }));
    assert.equal(error.kind, 'ValidationError');
    assert.equal(hits, 1);
    // the retry policy still works around a schema: 503 once, then valid
    hits = 0;
    assert.equal((await c.get('/flaky', { schema: ZodUser })).body.name, 'ok');
  });

  it('refuses what cannot be validated', async () => {
    for (const [schema, options] of [['x', {}], [null, {}], [{}, {}], [{ '~standard': {} }, {}], [ZodUser, { responseType: 'stream' }], [ZodUser, { responseType: 'ndjson' }]]) {
      const error = await rejection(client().get('/user', { schema, ...options }));
      assert.deepEqual([error.kind, error.parameter], ['InvalidInputError', 'schema'], JSON.stringify(options));
    }
  });

  it('leaves requests without a schema alone', async () => {
    const response = await client().get('/user');
    assert.equal(response.body.extra, 'x');
  });
});
