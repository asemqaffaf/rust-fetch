// Streaming from an LLM API: Server-Sent Events (OpenAI-compatible) and NDJSON (Ollama).
// Run it:  BASE_URL=http://localhost:11434 node examples/llm-streaming/index.mjs
import { pathToFileURL } from 'node:url';
import init, { WasmClient } from 'rust-fetch';

/** Server-Sent Events, as an OpenAI-compatible chat completions API sends them */
export async function streamChat(client, prompt) {
  let text = '';
  const events = client.events('/v1/chat/completions', {
    method: 'POST',
    body: { model: 'demo', stream: true, messages: [{ role: 'user', content: prompt }] },
    messageType: 'json',
    end: '[DONE]',    // the sentinel that ends the stream
    reconnect: false, // a chat completion must not be replayed
  });
  for await (const event of events) text += event.data.choices[0].delta.content ?? '';
  return text;
}

/** Newline-delimited JSON, as Ollama's /api/generate sends it */
export async function streamGenerate(client, prompt) {
  const response = await client.post('/api/generate', { body: { model: 'demo', prompt }, responseType: 'ndjson' });
  let text = '';
  for await (const chunk of response.body) text += chunk.response;
  return text;
}

export async function run({ baseUrl }) {
  await init();
  const client = new WasmClient({ baseUrl, retries: 0 });
  return { sse: await streamChat(client, 'Hi'), ndjson: await streamGenerate(client, 'Hi') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) throw new Error('Set BASE_URL, for example BASE_URL=http://localhost:11434');
  console.log(await run({ baseUrl }));
}
