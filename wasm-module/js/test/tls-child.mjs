// Runs in a child process (see tls-verification.test.mjs): NODE_EXTRA_CA_CERTS
// and NODE_TLS_REJECT_UNAUTHORIZED are read when the process starts. Makes one
// request per case and prints the outcomes as JSON on the last line of stdout.
const { WasmClient } = await import(process.env.TLS_PKG);
const cases = JSON.parse(process.env.TLS_CASES);
const warnings = [];
process.on('warning', (warning) => warnings.push(`${warning.name}: ${warning.message}`.slice(0, 160)));

const results = [];
for (const { name, url, options } of cases) {
  const client = new WasmClient({ retries: 0, timeoutMs: 8000, ...options });
  try {
    const response = await client.get(url);
    results.push({ name, ok: true, status: response.status, body: String(response.body).slice(0, 40) });
  } catch (error) {
    results.push({ name, ok: false, kind: error.kind ?? error.name, message: String(error.message).slice(0, 300), code: error.cause?.code ?? error.code ?? null });
  }
}
await new Promise((resolve) => setImmediate(resolve));
console.log(JSON.stringify({ results, warnings }));
process.exit(0);
