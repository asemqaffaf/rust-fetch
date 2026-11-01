// With Object.prototype polluted, a plain request must behave exactly as it
// does without pollution, on both Node.js transports: no internal field
// (the transport request, per-request state, upload records, the native
// addon's request and response, the options Node's own http and tls modules
// read) and no documented option may be filled in from the prototype. Nothing
// may redirect a request to a proxy or dispatcher, send it a body or
// credentials, weaken TLS verification or the private-network rule, or take the
// process down.
//
// The pollution happens in child processes (pollution-child.mjs), one value at
// a time, restored after each.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const child = fileURLToPath(new URL('./pollution-child.mjs', import.meta.url));
const crashChild = fileURLToPath(new URL('./pollution-crash-child.mjs', import.meta.url));
// POLLUTION_PKG points the test at another build, e.g. a published release
const pkg = process.env.POLLUTION_PKG ?? new URL('../../pkg/node.js', import.meta.url).href;

// Each name is tried with true, 1, 'x', {}, ['x'] and a function, and with the
// hostile values listed here. '$proxy', '$dispatcher' and '$ca' stand for the
// attacker's proxy and dispatcher and for the certificate nothing trusts.
const TRANSPORT_REQUEST = {
  method: ['DELETE'], url: ['http://127.0.0.1:1/'], headers: [{ authorization: 'Bearer stolen', 'x-polluted': '1' }], body: ['injected'],
  timeout: [1], connectTimeout: [1], responseTimeout: [1], idleTimeout: [1], redirect: ['manual', 'error'], maxRedirects: [0],
  proxy: ['$proxy'], blockPrivateNetwork: [true], sensitiveHeaders: [['authorization']], allowInsecureRedirects: [false],
  maxResponseBytes: [1], bodyType: ['text'], stream: [true], upload: [{ open: {} }], onUploadProgress: [], onDownloadProgress: [],
  __observe: [], __trace: [],
};
const REQUEST_STATE = {
  phases: [], waiting: [], observe: [], manual: [true], cancelled: [true], request: [{ destroy: 1 }], credentials: [[]], publicOnly: [true],
};
const UPLOAD_RECORDS = {
  reader: [], pending: [], claimed: [true], failure: [{ done: true }], web: [], source: [], done: [true], loaded: [1], used: [true],
  factory: [], restart: [], report: [], next: [], cancel: [], open: [], replayable: [true], data: [], end: [true], error: ['x'],
  invalidInput: [true], cause: [], nativeNext: [],
};
const ADDON_REQUEST_AND_RESPONSE = {
  extra: [{ observe: true }], code: ['RUST_FETCH_TOO_LARGE'], phase: ['connect'], timeoutMs: [1], connectMs: [1], tlsMs: [1],
  connectionReused: [true], ttfbMs: [1], redirects: [[{}]], uploadNext: [], uploadCancel: [], uploadRestart: [], connectTimeoutRemaining: [1],
  statusText: ['x'], ok: [false], status: [500],
};
// What Node.js's http, net and tls modules read from their option objects
const NODE_OPTIONS = {
  socketPath: ['/nonexistent/rust-fetch.sock'], host: ['203.0.113.1'], hostname: ['203.0.113.1'], port: [1], path: ['/404'], agent: [false],
  auth: ['user:password'], localAddress: ['203.0.113.7'], localPort: [1], family: [6], rejectUnauthorized: [false], ca: ['not a certificate', '$ca', ['$ca']],
  cert: [], key: [], servername: ['example.com'], checkServerIdentity: [], setHost: [false], setDefaultHeaders: [false], insecureHTTPParser: [true],
  joinDuplicateHeaders: [true], uniqueHeaders: [[]], maxHeaderSize: [1], signal: [{ aborted: true }], lookup: [], createConnection: [], hints: [],
  protocol: ['https:'], defaultPort: [1], ALPNProtocols: [['h2']], minVersion: ['TLSv1.3'], maxVersion: ['TLSv1'], secureProtocol: ['TLSv1_method'],
  ciphers: ['NULL'], pfx: [], passphrase: [], noDelay: [false], keepAlive: [false], keepAliveInitialDelay: [1], scheduling: ['fifo'], maxSockets: [1],
  maxFreeSockets: [0], highWaterMark: [1], autoSelectFamily: [false], autoSelectFamilyAttemptTimeout: [1], blockList: [], onread: [], fd: [0],
  handle: [], allowHalfOpen: [true], optimizeEmptyRequests: [false], secureContext: [], honorCipherOrder: [true], ecdhCurve: ['none'], dhparam: [],
  secureOptions: [1], crl: [], sigalgs: ['x'], clientCertEngine: ['x'], privateKeyEngine: ['x'], privateKeyIdentifier: ['x'], sessionIdContext: ['x'],
  ticketKeys: [], sessionTimeout: [1], session: [], minDHSize: [1], pskCallback: [], requestOCSP: [true], enableTrace: [true], ALPNCallback: [],
  isServer: [true], requestCert: [true], SNICallback: [],
  // Read by net.SocketAddress, which BlockList.check builds from the string it is given and treats as not blocked when it can't
  flowlabel: [1, 'x'], address: ['8.8.8.8'],
};
const DIAGNOSTICS = {
  metrics: [{}], config: [{ enabled: true }], enabled: [true], debug: [], redactUrl: [], samples: [], origins: [], last: [], traceOrigins: [],
  timings: [{}], options: [{ baseUrl: 'http://127.0.0.1:1' }], traceContext: [], propagateTrace: [true],
};
// Documented client and request options, which plain objects must ignore
const DOCUMENTED_OPTIONS = {
  baseUrl: ['http://127.0.0.1:1'], params: [{ polluted: '1' }], timeoutMs: [1], retries: [5], responseType: ['text'], deadlineMs: [1],
  maxPendingRequests: [1], allowPrivateNetwork: [false], allowAbsoluteUrls: [false], circuitBreaker: [{ failureThreshold: 1 }],
  maxConcurrent: [1], rateLimit: [{ requests: 1, perMs: 60000 }], idempotencyKey: [true], idempotencyHeader: ['x-polluted'],
  retryNonIdempotent: [true], retryOn: [[500]], retryBudget: [{ ratio: 1 }], maxRetries: [9], initialDelayMs: [1], maxDelayMs: [1], multiplier: [9],
  retryOnNetworkError: [false], retryOnTimeout: [false], dispatcher: ['$dispatcher'], protocols: [['x']], reconnect: [{ maxRetries: 9 }],
  messageType: ['json'], idleTimeoutMs: [1], maxLineBytes: [1], maxEventBytes: [1], failureThreshold: [1], resetAfterMs: [1], requests: [1], perMs: [1],
};
const TABLE = { ...TRANSPORT_REQUEST, ...REQUEST_STATE, ...UPLOAD_RECORDS, ...ADDON_REQUEST_AND_RESPONSE, ...NODE_OPTIONS, ...DIAGNOSTICS, ...DOCUMENTED_OPTIONS };

const run = async (names, env = {}) => {
  for (const name of names) assert.ok(TABLE[name], `${name} is not in the table`);
  const { stdout } = await promisify(execFile)(process.execPath, [child], {
    env: { ...process.env, ...env, POLLUTION_PKG: pkg, POLLUTION_NAMES: JSON.stringify(Object.fromEntries(names.map((name) => [name, TABLE[name]]))) },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 540_000,
  });
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(result.checked, names.length);
  return result.problems;
};

for (const [label, env] of [['default transport', {}], ['node:http', { RUST_FETCH_NATIVE: '0' }]]) {
  describe(`prototype pollution (${label})`, { concurrency: false }, () => {
    it('never sends a request, its credentials or its body to an inherited proxy or dispatcher', { timeout: 120_000 }, async () => {
      assert.deepEqual(await run(['proxy', 'dispatcher', 'url', 'host', 'hostname', 'socketPath', 'agent', 'lookup', 'createConnection'], env), []);
    });

    it('leaves the private-network rule, TLS verification and the response limit in force', { timeout: 120_000 }, async () => {
      assert.deepEqual(await run(['blockPrivateNetwork', 'allowPrivateNetwork', 'publicOnly', 'port', 'flowlabel', 'family', 'address', 'maxResponseBytes', 'rejectUnauthorized', 'ca', 'checkServerIdentity',
        'servername', 'minVersion', 'secureContext', 'timeout', 'responseTimeout', 'timeoutMs'], env), []);
    });

    it('reads no inherited upload state, request state or transport field', { timeout: 300_000 }, async () => {
      const names = [...Object.keys(UPLOAD_RECORDS), ...Object.keys(REQUEST_STATE), ...Object.keys(TRANSPORT_REQUEST)];
      assert.deepEqual(await run([...new Set(names)], env), []);
    });

    it('reads no inherited native addon field, Node.js option or documented option', { timeout: 540_000 }, async () => {
      const done = new Set(['proxy', 'dispatcher', 'url', 'host', 'hostname', 'socketPath', 'agent', 'lookup', 'createConnection', 'blockPrivateNetwork', 'allowPrivateNetwork',
        'publicOnly', 'port', 'flowlabel', 'family', 'address', 'maxResponseBytes', 'rejectUnauthorized', 'ca', 'checkServerIdentity', 'servername', 'minVersion', 'secureContext', 'timeout', 'responseTimeout', 'timeoutMs',
        ...Object.keys(UPLOAD_RECORDS), ...Object.keys(REQUEST_STATE), ...Object.keys(TRANSPORT_REQUEST)]);
      const rest = Object.keys(TABLE).filter((name) => !done.has(name));
      // Several child processes at once, each with its own servers
      const chunks = [0, 1, 2].map((index) => rest.filter((_, position) => position % 3 === index));
      const problems = (await Promise.all(chunks.map((names) => run(names, env)))).flat();
      assert.deepEqual(problems, []);
    });

    it('survives every upload-state name without an uncaught exception', { timeout: 300_000 }, async () => {
      const { stdout } = await promisify(execFile)(process.execPath, [crashChild], { env: { ...process.env, ...env, POLLUTION_PKG: pkg }, timeout: 280_000 });
      assert.ok(JSON.parse(stdout.trim().split('\n').at(-1)).requests > 0);
    });
  });
}
