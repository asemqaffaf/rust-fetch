// A production-style client for a JSON API: base URL, timeouts, retries, auth, typed errors.
// Run it against your API:  BASE_URL=https://api.example.com TOKEN=… node examples/node-client/index.mjs
import { pathToFileURL } from 'node:url';
import init, { WasmClient, isHttpError, isTimeoutError, isRustFetchError } from 'rust-fetch';

export async function run({ baseUrl, token = 'dev-token', log = console.log } = {}) {
  await init();

  const client = new WasmClient({
    baseUrl,
    timeoutMs: 10_000,
    retries: { maxRetries: 3, initialDelayMs: 100 }, // 429 and 5xx, honouring Retry-After
    auth: { bearer: () => token },                    // only ever sent to baseUrl's origin
    headers: { accept: 'application/json' },
    metrics: true,                                   // client.stats() reports counts and latency
  });

  // Log every request in one place
  client.addRequestInterceptor((request) => { log(`-> ${request.method} ${request.url}`); });
  client.addResponseInterceptor((response) => { log(`<- ${response.status}`); return response; });

  const results = {};

  const user = await client.get('/users/1');
  results.user = user.body;

  const created = await client.post('/users', { body: { name: 'Ada' }, idempotencyKey: true });
  results.created = created.body;

  // Typed errors: branch on the kind, no string matching
  try {
    await client.get('/users/404');
  } catch (error) {
    if (isHttpError(error) && error.status === 404) results.notFound = true;
    else if (isTimeoutError(error)) results.timedOut = true;
    else if (isRustFetchError(error)) results.failed = error.kind;
    else throw error;
  }

  results.stats = client.stats().requests;
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) throw new Error('Set BASE_URL, for example BASE_URL=https://api.example.com');
  console.log(await run({ baseUrl, token: process.env.TOKEN }));
}
