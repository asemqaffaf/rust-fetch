# TypeScript

Type definitions ship with the package and need TypeScript 5.2 or newer. Besides `WasmClient`, it exports the option and result types `ClientOptions`, `RequestOptions`, `BrowserRequestOptions`, `FetchInit`, `RetryOptions`, `RetryBudgetOptions`, `HttpResponse`, `RustFetchError`, `RustFetchErrorKind`, `DownloadProgress`, `UploadProgress`, `HeadersLike`, `QueryParams`, `RequestBody`, `ResponseBodyType` and `RedirectMode`, for interceptors `InterceptedRequest`, `RequestInterceptor`, `ResponseFulfilledInterceptor` and `ResponseRejectedInterceptor`, for WebSockets `WebSocketConnection`, `WebSocketOptions`, `ReconnectOptions`, `WebSocketCloseInfo`, `WebSocketReconnectInfo`, `WebSocketState` and `WebSocketData`, and for Server-Sent Events `EventStream`, `EventStreamOptions`, `EventStreamState` and `ServerSentEvent`.

Every request method takes the response body's type as a type parameter, defaulting to `any`:

```ts
import { WasmClient, type HttpResponse, type RustFetchError } from 'rust-fetch';

const client = new WasmClient({ baseUrl: 'https://api.example.com/v1' });

interface User { id: number; name: string }

const res = await client.get<User>('/users/42'); // HttpResponse<User>
res.body.name; // string

const created: HttpResponse<User> = await client.post<User>('/users', { body: { name: 'Zoë' } });

try {
  await client.get('/users/9');
} catch (e) {
  const error = e as RustFetchError;
  if (error.kind === 'HttpError') console.log(error.status);
}
```

The type parameter describes what you expect; rust-fetch doesn't check the JSON against it. Validate untrusted responses with a schema library if you need to.

## Legacy functions

These standalone functions still work. Each call uses a default client: 30 s timeout, no retries.

| Function | Resolves to |
| --- | --- |
| `fetch_json(url)` / `fetch_json_promise(url)` | Parsed JSON, whatever the `Content-Type`; `null` for an empty body |
| `fetch_text(url)` | The body as a string |
| `fetch_with_options(url, method, headers, body?)` | The full `HttpResponse` |
| `create_client()` | `new WasmClient()` |
| `fetch_wasm_json`, `fetch_wasm_map`, `fetch_wasm_api`, `fetch_wasm_html` | Deprecated aliases of `fetch_json` / `fetch_text` |
