// The application every bundler fixture builds: initialise rust-fetch the way its README says, make a request, report.
import init, { WasmClient } from 'rust-fetch';

const api = new URLSearchParams(location.search).get('api');
const report = (value) => { document.body.dataset.result = JSON.stringify(value); };

try {
  await init();
  const client = new WasmClient({ baseUrl: api, retries: 0, timeoutMs: 5000 });
  const response = await client.get('/hello');
  const upload = await client.post('/echo', { body: { n: 1 }, onUploadProgress() {} });
  report({ status: response.status, body: response.body, echoed: upload.body });
} catch (error) {
  report({ error: String(error?.kind ?? error), message: String(error?.message ?? error) });
}
