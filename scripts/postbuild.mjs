// Turns wasm-pack's output in wasm-module/pkg into the published npm package:
// adds the Node.js entry point, conditional exports and package metadata.
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const root = new URL('../', import.meta.url);
const pkgDir = new URL('wasm-module/pkg/', root);

copyFileSync(new URL('wasm-module/js/node.js', root), new URL('node.js', pkgDir));
copyFileSync(new URL('wasm-module/js/testing.js', root), new URL('testing.js', pkgDir));
copyFileSync(new URL('wasm-module/js/testing.d.ts', root), new URL('testing.d.ts', pkgDir));
copyFileSync(new URL('README.md', root), new URL('README.md', pkgDir));
copyFileSync(new URL('llms.txt', root), new URL('llms.txt', pkgDir));
const policies = ['LICENSE-MIT', 'LICENSE-APACHE', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md'];
for (const policy of policies) {
  copyFileSync(new URL(policy, root), new URL(policy, pkgDir));
}
rmSync(new URL('.gitignore', pkgDir), { force: true });

// wasm-bindgen declares `[Symbol.dispose]()` on exported classes; pull in the
// lib that defines it so consumers type-check without `skipLibCheck` (TS 5.2+)
const typesUrl = new URL('rust_fetch.d.ts', pkgDir);
let types = readFileSync(typesUrl, 'utf8');
const disposable = '/// <reference lib="esnext.disposable" />\n';
if (types.includes('Symbol.dispose') && !types.startsWith(disposable)) {
  types = disposable + types;
}

// Compatibility declarations for the unconstructible classes previously
// emitted by wasm-streams (kept so the public TypeScript snapshot stays exact).
if (!types.includes('export type ReadableStreamType')) {
  types = types.replace(
    '/* eslint-disable */\n\n/** Headers as a plain object,',
    `/* eslint-disable */
/**
 * The \`ReadableStreamType\` enum.
 *
 * *This API requires the following crate features to be activated: \`ReadableStreamType\`*
 */

export type ReadableStreamType = "bytes";

/** Headers as a plain object,`,
  );
}
if (!types.includes('export class EventStream')) {
  types = types.replace(
    '/**\n * HTTP client for JavaScript\n */\nexport class WasmClient {\n',
    `/**
 * A Server-Sent Events stream created by \`WasmClient.events()\`; also an async iterator of events
 */
export class EventStream {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    [Symbol.asyncIterator](): AsyncIterator<ServerSentEvent>;
    /**
     * Close the stream and stop reconnecting
     */
    close(): void;
    /**
     * The next buffered event (async iterator protocol)
     */
    next(): Promise<IteratorResult<ServerSentEvent>>;
    /**
     * Stop iterating: closes the stream (async iterator protocol, e.g. \`break\`)
     */
    return(): Promise<IteratorResult<ServerSentEvent>>;
    /**
     * Resolves once the stream is closed for good
     */
    readonly closed: Promise<void>;
    /**
     * The last event ID received, sent as \`Last-Event-ID\` when reconnecting
     */
    readonly lastEventId: string;
    /**
     * Resolves when the first connection opens; rejects if it never does
     */
    readonly opened: Promise<void>;
    /**
     * \`connecting\`, \`open\`, \`reconnecting\` or \`closed\`
     */
    readonly state: EventStreamState;
    /**
     * The stream's URL, resolved against the client's base URL
     */
    readonly url: string;
}

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

/**
 * HTTP client for JavaScript
 */
export class WasmClient {\n`,
  );
}
// Client verb shortcuts, EventStream/WebSocketConnection, and standalone functions
// live in js/*.js; restore their exact TypeScript declarations on WasmClient and at module top level.
types = types.replace(
  '    clearInterceptors(): void;\n',
  `    clearInterceptors(): void;
    /**
     * Make a DELETE request
     */
    delete(url: string, options?: RequestOptions | null): Promise<HttpResponse>;\n`,
);
types = types.replace(
  '    ejectInterceptor(id: number): boolean;\n',
  `    ejectInterceptor(id: number): boolean;
    /**
     * Open a Server-Sent Events stream. Relative URLs are resolved against the base URL.
     */
    events(url: string, options?: EventStreamOptions | null): EventStream;
    /**
     * Make a request described by a \`fetch\`-style init object
     */
    fetch(url: string, init?: FetchInit | null): Promise<HttpResponse>;
    /**
     * Make a GET request
     */
    get(url: string, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Make a HEAD request
     */
    head(url: string, options?: RequestOptions | null): Promise<HttpResponse>;\n`,
);
types = types.replace(
  '    constructor(options?: ClientOptions | null);\n',
  `    constructor(options?: ClientOptions | null);
    /**
     * Make a PATCH request; the body is taken from \`init.body\`
     */
    patch(url: string, init?: FetchInit | null): Promise<HttpResponse>;
    /**
     * Make a PATCH request with a JSON body
     */
    patch_json(url: string, body: any, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Make a POST request; the body is taken from \`init.body\`
     */
    post(url: string, init?: FetchInit | null): Promise<HttpResponse>;
    /**
     * Make a POST request with a JSON body
     */
    post_json(url: string, body: any, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Make a PUT request; the body is taken from \`init.body\`
     */
    put(url: string, init?: FetchInit | null): Promise<HttpResponse>;
    /**
     * Make a PUT request with a JSON body
     */
    put_json(url: string, body: any, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Make a request with any method, headers and body
     */
    request(method: string, url: string, headers?: HeadersLike | null, body?: RequestBody | null, options?: RequestOptions | null): Promise<HttpResponse>;
    /**
     * Open a WebSocket connection. Relative URLs are resolved against the
     * base URL, with \`http:\` and \`https:\` becoming \`ws:\` and \`wss:\`.
     */
    websocket(url: string, options?: WebSocketOptions | null): WebSocketConnection;\n`,
);
types = types.replace(
  '\nexport type InitInput =',
  `
/**
 * A WebSocket connection created by \`WasmClient.websocket()\`
 */
export class WebSocketConnection {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Close the connection and stop reconnecting. \`code\` is 1000 (the
     * default) or 3000-4999; \`reason\` is at most 123 bytes of UTF-8.
     */
    close(code?: number | null, reason?: string | null): void;
    /**
     * Send a value as JSON text
     */
    sendJson(value: any): void;
    /**
     * Send a message. Before the connection opens (or while reconnecting),
     * messages are queued and sent once it does.
     */
    send(data: WebSocketData): void;
    /**
     * Bytes queued by the socket but not yet sent
     */
    readonly bufferedAmount: number;
    /**
     * Resolves with the close code and reason once the connection is closed for good
     */
    readonly closed: Promise<WebSocketCloseInfo>;
    /**
     * Resolves when the first connection opens; rejects if it never does
     */
    readonly opened: Promise<void>;
    /**
     * The subprotocol the server selected, or \`""\`
     */
    readonly protocol: string;
    /**
     * \`connecting\`, \`open\`, \`reconnecting\`, \`closing\` or \`closed\`
     */
    readonly state: WebSocketState;
    /**
     * The connection URL (\`ws:\` or \`wss:\`)
     */
    readonly url: string;
}

/**
 * Create a configured HTTP client (exported for advanced use)
 */
export function create_client(): WasmClient;

/**
 * Fetch a URL and parse the body as JSON (whatever its Content-Type).
 * An empty body resolves to \`null\`.
 */
export function fetch_json(url: string): Promise<any>;

/**
 * Fetch JSON data and return as a Promise
 */
export function fetch_json_promise(url: string): Promise<any>;

/**
 * Fetch a URL and return the body as text
 */
export function fetch_text(url: string): Promise<string>;

/**
 * Fetch API data (deprecated, use fetch_json instead)
 */
export function fetch_wasm_api(url: string): Promise<any>;

/**
 * Fetch HTML data (deprecated, use fetch_text instead)
 */
export function fetch_wasm_html(url: string): Promise<string>;

/**
 * Fetch JSON data (deprecated, use fetch_json instead)
 */
export function fetch_wasm_json(url: string): Promise<any>;

/**
 * Fetch data and return as map (deprecated, use fetch_json instead)
 */
export function fetch_wasm_map(url: string): Promise<any>;

/**
 * Fetch with a method, headers and an optional string body.
 *
 * Resolves to \`{ status, statusText, ok, url, headers, body }\`.
 */
export function fetch_with_options(url: string, method: string, headers: any, body?: string | null): Promise<any>;

export type InitInput =`,
);
for (const expected of [
  'delete(url: string',
  'fetch(url: string',
  'get(url: string',
  'head(url: string',
  'patch(url: string',
  'patch_json(url: string',
  'post(url: string',
  'post_json(url: string',
  'put(url: string',
  'put_json(url: string',
  'request(method: string',
  'export function create_client(',
  'export function fetch_json(',
  'export function fetch_json_promise(',
  'export function fetch_text(',
  'export function fetch_wasm_api(',
  'export function fetch_wasm_html(',
  'export function fetch_wasm_json(',
  'export function fetch_wasm_map(',
  'export function fetch_with_options(',
]) {
  if (!types.includes(expected)) {
    throw new Error(`postbuild: missing injected declaration '${expected}' in rust_fetch.d.ts`);
  }
}

// wasm-bindgen can't declare generic methods, so its request methods resolve to
// `HttpResponse` (with `body: any`). Make them generic, `get<User>(…)` style;
// the `any` default keeps untyped calls as they were.
// Methods taking request options also get a `schema` overload that infers the body type (#43)
types = types.replace(
  /^(\s+)(get|head|delete|post|put|patch|fetch)\(url: string, (options|init)\?: (RequestOptions|FetchInit) \| null\): Promise<HttpResponse>;$/gm,
  '$1$2<S extends StandardSchema>(url: string, $3: $4 & { schema: S }): Promise<HttpResponse<InferSchemaOutput<S>>>;\n$&',
);
types = types.replace(
  /^(\s+)(post_json|put_json|patch_json)\(url: string, body: any, options\?: RequestOptions \| null\): Promise<HttpResponse>;$/gm,
  '$1$2<S extends StandardSchema>(url: string, body: any, options: RequestOptions & { schema: S }): Promise<HttpResponse<InferSchemaOutput<S>>>;\n$&',
);
const generic = /^(\s+\w+)\((.*)\): Promise<HttpResponse>;$/gm;
const typedMethods = types.match(generic)?.length ?? 0;
if (typedMethods === 0 && !types.includes('Promise<HttpResponse<T>>')) {
  throw new Error('postbuild: no WasmClient request methods found to make generic');
}
types = types.replace(generic, '$1<T = any>($2): Promise<HttpResponse<T>>;');
const glueUrl = new URL('rust_fetch.js', pkgDir);
// Stream plumbing stays in JavaScript, so upload chunks never take a round
// trip through WebAssembly memory. Ship it inside the existing glue file.
const methods = readFileSync(new URL('wasm-module/js/methods.js', root), 'utf8');
const browserTransport = readFileSync(new URL('wasm-module/js/browser-transport.js', root), 'utf8');
const connections = readFileSync(new URL('wasm-module/js/connections.js', root), 'utf8');
const upload = readFileSync(new URL('wasm-module/js/upload.js', root), 'utf8');
const clientHelpers = readFileSync(new URL('wasm-module/js/client-helpers.js', root), 'utf8');
const observability = readFileSync(new URL('wasm-module/js/observability.js', root), 'utf8');
const blob = readFileSync(new URL('wasm-module/js/blob.js', root), 'utf8');
const transport = readFileSync(new URL('wasm-module/js/transport.js', root), 'utf8');
const auth = readFileSync(new URL('wasm-module/js/auth.js', root), 'utf8');
const dedupe = readFileSync(new URL('wasm-module/js/dedupe.js', root), 'utf8');
const cache = readFileSync(new URL('wasm-module/js/cache.js', root), 'utf8');
const schema = readFileSync(new URL('wasm-module/js/schema.js', root), 'utf8');
const paginate = readFileSync(new URL('wasm-module/js/paginate.js', root), 'utf8');
const resume = readFileSync(new URL('wasm-module/js/resume.js', root), 'utf8');
const extend = readFileSync(new URL('wasm-module/js/extend.js', root), 'utf8');
const guards = readFileSync(new URL('wasm-module/js/guards.js', root), 'utf8');
// Minifying renames the exported functions (`isHttpError.name` would be `"Et"`). Put
// back the names 2.8.x reported, with the pollution-safe `setFnName`. The aliases
// (`fetch_json_promise`, `fetch_wasm_*`) are the same function as `fetch_json` and
// `fetch_text`, as before.
const exportedFunctionNames = [
  '__bindNodeTransport', '__setNodeDiagnostics', 'create_client', 'initSync',
  'fetch_json', 'fetch_text', 'fetch_with_options',
  'isRustFetchError', 'isHttpError', 'isTimeoutError', 'isNetworkError', 'isParseError', 'isInvalidInputError', 'isCancelledError', 'isCircuitOpenError', 'isJsInteropError', 'isValidationError',
];
const restoreFunctionNames = `for (const [k, v] of Object.entries({ __wbg_init, ${exportedFunctionNames.join(', ')} })) setFnName(v, k);`;
let baseGlue = readFileSync(glueUrl, 'utf8');
if (!baseGlue.includes('export function __bindBrowserTransport(')) {
  throw new Error('postbuild: __bindBrowserTransport not found in rust_fetch.js');
}
baseGlue = baseGlue.replace('export function __bindBrowserTransport(', 'function __bindBrowserTransport(');
if (!baseGlue.includes('export class __SseParser ')) {
  throw new Error('postbuild: __SseParser not found in rust_fetch.js');
}
baseGlue = baseGlue.replace('export class __SseParser ', 'class __SseParser ');
const startCall = 'wasm.__wbindgen_start();';
if (baseGlue.split(startCall).length !== 2) {
  throw new Error('postbuild: expected exactly one __wbindgen_start() in rust_fetch.js');
}
baseGlue = baseGlue.replace(startCall, `${startCall}\n    __bindBrowserTransport(__browserTransport, __browserTransport.finalizeStream, __browserTransport.encodeBody);`);
const combinedGlue = `${baseGlue}
${clientHelpers.trimEnd()}
${browserTransport.trimEnd()}
${methods.trimEnd()}
${upload.trimEnd()}
${connections.trimEnd()}
${observability.trimEnd()}
${blob.trimEnd()}
${transport.trimEnd()}
${auth.trimEnd()}
${dedupe.trimEnd()}
${cache.trimEnd()}
${schema.trimEnd()}
${resume.trimEnd()}
${extend.trimEnd()}
${paginate.trimEnd()}
${guards.trimEnd()}
${restoreFunctionNames}
`;
const minifiedGlue = transformSync(combinedGlue, {
  minify: true,
  treeShaking: true,
  loader: 'js',
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
  banner: '/* @ts-self-types="./rust_fetch.d.ts" */',
}).code;
writeFileSync(glueUrl, minifiedGlue);

// extend() is added in JavaScript (wasm-module/js/extend.js)
types = types.replace(/(export class WasmClient \{\n)/, '$1    /** A new client with this client\'s options and interceptors, and `overrides` on top: headers are merged by name, every other option is replaced. Circuit breakers, rate limits, concurrency limits and retry budgets are not shared: the new client has its own. */\n    extend(overrides?: ClientOptions | null): WasmClient;\n    /** Pages of a paginated API, or its items with `items`. Follows the `Link: rel="next"` header unless `next` says otherwise; each page is a normal GET. */\n    paginate<T>(url: string, options: PaginateOptions & { items: (response: HttpResponse) => Iterable<T> | Promise<Iterable<T>> }): AsyncGenerator<T, void, undefined>;\n    paginate(url: string, options?: PaginateOptions): AsyncGenerator<HttpResponse, void, undefined>;\n');
if (!types.includes('extend(overrides?: ClientOptions | null): WasmClient;') || !types.includes('paginate<T>(')) {
  throw new Error('postbuild: could not declare WasmClient.extend and paginate');
}

writeFileSync(typesUrl, types);

const manifestUrl = new URL('package.json', pkgDir);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

manifest.files = ['rust_fetch_bg.wasm', 'rust_fetch_bg.wasm.d.ts', 'rust_fetch.js', 'rust_fetch.d.ts', 'node.js', 'testing.js', 'testing.d.ts', 'llms.txt', ...policies];
manifest.exports = {
  '.': {
    types: './rust_fetch.d.ts',
    node: './node.js',
    default: './rust_fetch.js',
  },
  './rust_fetch.js': {
    types: './rust_fetch.d.ts',
    default: './rust_fetch.js',
  },
  './testing': {
    types: './testing.d.ts',
    default: './testing.js',
  },
  './rust_fetch_bg.wasm': './rust_fetch_bg.wasm',
  './package.json': './package.json',
};
manifest.engines = { node: '>=20' };
// Both entry modules run setup on import (initSync/transport binding in node.js,
// EventStream/WasmClient wrapping in rust_fetch.js).
manifest.sideEffects = ['./node.js', './rust_fetch.js', './snippets/*'];
// crates.io allows five keywords (Cargo.toml); npm search uses as many as are relevant
manifest.keywords = [
  'http', 'http-client', 'fetch', 'fetch-api', 'request', 'rest', 'api-client', 'axios-alternative',
  'retry', 'retries', 'backoff', 'timeout', 'interceptors', 'typed-errors', 'abortcontroller',
  'upload-progress', 'download-progress', 'streaming', 'websocket', 'websockets', 'reconnect',
  'typescript', 'nodejs', 'browser', 'isomorphic', 'webassembly', 'wasm', 'rust', 'napi',
];
manifest.homepage = 'https://asemqaffaf.github.io/rust-fetch/';
manifest.bugs = { url: 'https://github.com/asemqaffaf/rust-fetch/issues' };

writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(`postbuild: prepared ${manifest.name}@${manifest.version}`);
