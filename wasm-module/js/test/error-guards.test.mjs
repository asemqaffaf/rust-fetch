// Type guards for rust-fetch errors (#68): runtime behaviour on real errors.
// The compile-time narrowing is checked in package.test.mjs with TypeScript 7 and 5.2.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import init, {
  WasmClient,
  isCancelledError,
  isCircuitOpenError,
  isHttpError,
  isInvalidInputError,
  isJsInteropError,
  isNetworkError,
  isParseError,
  isRustFetchError,
  isTimeoutError,
  isValidationError,
} from '../../pkg/node.js';
import { rejection, startServer } from './helpers.mjs';

const GUARDS = {
  HttpError: isHttpError,
  TimeoutError: isTimeoutError,
  NetworkError: isNetworkError,
  ParseError: isParseError,
  InvalidInputError: isInvalidInputError,
  CancelledError: isCancelledError,
  CircuitOpenError: isCircuitOpenError,
  JsInteropError: isJsInteropError,
  ValidationError: isValidationError,
};

let server;
before(async () => {
  await init();
  server = await startServer((req, res) => {
    if (req.url === '/slow') return; // never answers
    if (req.url === '/boom') {
      res.writeHead(500);
      return res.end();
    }
    res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'text/plain' });
    res.end('not json');
  });
});
after(() => server.close());

describe('error type guards', () => {
  it('recognise every kind a client really produces, and only that kind', async () => {
    const client = new WasmClient({ retries: 0 });
    const produced = {
      HttpError: await rejection(client.get(server.url('/missing'))),
      ParseError: await rejection(client.get(server.url('/ok'), { responseType: 'json' })),
      InvalidInputError: await rejection(client.get('not a url')),
      TimeoutError: await rejection(client.get(server.url('/slow'), { timeoutMs: 30 })),
      CancelledError: await rejection(client.get(server.url('/slow'), { signal: AbortSignal.abort() })),
      ValidationError: await rejection(client.get(server.url('/ok'), { schema: { '~standard': { version: 1, vendor: 'test', validate: () => ({ issues: [{ message: 'no' }] }) } } })),
      NetworkError: await rejection(new WasmClient({ retries: 0 }).get('http://127.0.0.1:1/')),
      CircuitOpenError: await (async () => {
        const breaker = new WasmClient({ retries: 0, circuitBreaker: { failureThreshold: 1, resetAfterMs: 60_000 } });
        await rejection(breaker.get(server.url('/boom')));
        return rejection(breaker.get(server.url('/boom')));
      })(),
    };
    for (const [kind, error] of Object.entries(produced)) {
      assert.equal(error.kind, kind);
      assert.equal(isRustFetchError(error), true, kind);
      assert.equal(isRustFetchError(error, kind), true, kind);
      for (const [other, guard] of Object.entries(GUARDS)) {
        assert.equal(guard(error), other === kind, `${other} guard on ${kind}`);
        assert.equal(isRustFetchError(error, other), other === kind);
      }
    }
  });

  it('refuse everything that is not a rust-fetch error', () => {
    const lookalike = Object.assign(new Error('boom'), { kind: 'SomethingElse' });
    for (const value of [undefined, null, 0, 'HttpError', true, [], {}, new Error('x'), new TypeError('x'), lookalike, { kind: 'HttpError' }, { kind: 'HttpError', message: 7 }, Symbol('x'), () => {}]) {
      assert.equal(isRustFetchError(value), false, String(value));
      for (const guard of Object.values(GUARDS)) assert.equal(guard(value), false);
    }
    assert.equal(isRustFetchError(new Error('x'), 'NotAKind'), false);
  });

  it('recognise an error from another realm, which instanceof does not', async () => {
    const foreign = vm.runInNewContext("Object.assign(new Error('cross-realm'), { kind: 'HttpError', status: 404 })");
    assert.equal(foreign instanceof Error, false);
    assert.equal(isHttpError(foreign), true);
    assert.equal(isRustFetchError(foreign, 'HttpError'), true);
    assert.equal(isTimeoutError(foreign), false);
  });

  it('read the kind like any caller would', () => {
    const throwing = { get kind() { throw new Error('getter'); } };
    assert.throws(() => isRustFetchError(throwing), /getter/); // a property read is not hidden: same as any `error.kind`
  });
});
