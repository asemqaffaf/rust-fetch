/** What a mock handler or route receives: the request as the client sent it. */
export interface MockCall {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  /** Lower-case names; repeated headers are joined with `, ` */
  headers: Record<string, string>;
  /** Parsed for JSON bodies, text for text bodies, bytes otherwise; undefined without a body */
  body: any;
}
/** A mocked response. `body` is serialised by type: objects as JSON, strings as text, bytes as they are. */
export interface MockResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Wait this long before answering (to test timeouts and cancellation) */
  delayMs?: number;
  /** Fail like a network error: `true`, a message or an `Error` */
  error?: boolean | string | Error;
}
export type MockHandler = MockResponse | Error | ((call: MockCall) => MockResponse | Error | void | Promise<MockResponse | Error | void>);
/** A function for the client's `transport` option, with routes and recorded calls. */
export interface MockTransport {
  (request: any): PromiseLike<any>;
  /** Every request the client made, in order */
  readonly calls: MockCall[];
  /** Answer requests of `method` whose path (or full URL) equals `matcher`, matches the RegExp, or satisfies the function; the first route that matches wins */
  on(method: string, matcher: string | RegExp | ((call: MockCall) => boolean), response: MockHandler): MockTransport;
  /** Answer every request no route matched */
  onAny(response: MockHandler): MockTransport;
  /** Forget routes and recorded calls */
  reset(): MockTransport;
}
/** A transport for the `transport` client option that answers from the routes you add, for unit tests. */
export function createMockTransport(): MockTransport;
