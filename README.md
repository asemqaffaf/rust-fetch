# rust-fetch

[![npm version](https://img.shields.io/npm/v/rust-fetch.svg)](https://www.npmjs.com/package/rust-fetch)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=flat&logo=WebAssembly&logoColor=white)](https://webassembly.org/)

A high-performance, world-class HTTP client for JavaScript/TypeScript powered by WebAssembly. Built with Rust for blazing-fast, memory-safe HTTP operations in both browser and Node.js environments.

## 🚀 Features

- **Type-safe HTTP Client**: Builder pattern for constructing requests with compile-time safety
- **Comprehensive Error Handling**: Detailed error types with context and proper error chaining
- **Automatic Retries**: Built-in retry logic with exponential backoff for transient failures
- **Multiple Response Formats**: Support for JSON, text, and binary responses
- **Platform Optimized**: Specific optimizations for both WASM and native targets
- **Developer Friendly**: Clean API with both simple functions and advanced client builders
- **Backward Compatible**: Maintains compatibility with legacy API while providing modern alternatives

## 📦 Installation

```bash
npm install rust-fetch
```

or

```bash
yarn add rust-fetch
```

## 🔧 Usage

### Simple API

For quick and easy HTTP requests:

### WASM Client Example
How to use the imported `WasmClient` to make HTTP requests from the browser or Node.js environment:

#### Simple GET Request
Here's how to make a simple GET request using `WasmClient`:

```javascript
import init, { WasmClient } from 'rust-fetch';

await init();

const client = new WasmClient();

client.get('https://jsonplaceholder.typicode.com/posts/1')
    .then(response => console.log(response))
    .catch(error => console.error('Error:', error));
```

#### POST Request with JSON
Here's how to make a POST request with a JSON body:

```javascript
const data = { title: 'foo', body: 'bar', userId: 1 };

client.post_json('https://jsonplaceholder.typicode.com/posts', data)
    .then(response => console.log(response))
    .catch(error => console.error('Error:', error));
```

### Using Fetch Functions

```javascript
import init, { fetch_json, fetch_text } from 'rust-fetch';

// Initialize WASM module
await init();

// Fetch JSON data
try {
  const data = await fetch_json('https://api.example.com/data');
  console.log('JSON data:', data);
} catch (error) {
  console.error('Error fetching JSON:', error);
}

// Fetch text/HTML
try {
  const html = await fetch_text('https://example.com');
  console.log('HTML content:', html);
} catch (error) {
  console.error('Error fetching HTML:', error);
}
```

### Advanced Client API

For more control and enhanced configurations, use the `fetch_with_options` to fine-tune HTTP requests:

#### Using Advanced Options
You can specify HTTP method, headers, and body:

```javascript
import { fetch_with_options } from 'rust-fetch';

const url = 'https://jsonplaceholder.typicode.com/posts';
const method = 'POST';
const headers = { 'Content-Type': 'application/json' };
const body = JSON.stringify({ userId: 1, title: 'foo', body: 'bar' });

fetch_with_options(url, method, headers, body)
    .then(response => console.log(response))
    .catch(error => console.error('Error:', error));
```

## 🏗️ Architecture

The library is organized into several modules:

- **`error`**: Comprehensive error types with detailed context
- **`types`**: Core types like `Method`, `Headers`, `Response`, etc.
- **`client`**: The main HTTP client with builder pattern
- **`http`**: High-level convenience functions for common use cases

### Error Handling

The library provides rich error types that preserve context:

```javascript
try {
  const data = await fetch_json(url);
  console.log('Success:', data);
} catch (error) {
  // Error handling with detailed context
  console.error('Failed to fetch:', error.message);
}
```

## API Reference

### HTTP Functions

#### `fetch_json(url: string): Promise<any>`
Fetches JSON data from the specified URL and returns it as a JavaScript object.

```javascript
import { fetch_json } from 'rust-fetch';

const data = await fetch_json('https://jsonplaceholder.typicode.com/todos/1');
```

#### `fetch_text(url: string): Promise<string>`
Fetches text/HTML content from the specified URL and returns it as a string.

```javascript
import { fetch_text } from 'rust-fetch';

const html = await fetch_text('https://example.com');
```

#### `fetch_with_options(url: string, method: string, headers: object, body?: string): Promise<object>`
Advanced fetch function with full control over the request.

```javascript
import { fetch_with_options } from 'rust-fetch';

const response = await fetch_with_options(
    'https://api.example.com/users',
    'POST',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ name: 'John Doe' })
);
```

### WasmClient Class

#### `new WasmClient()`
Creates a new HTTP client instance.

```javascript
const client = new WasmClient();
```

#### `client.get(url: string): Promise<object>`
Performs a GET request.

```javascript
const response = await client.get('https://api.example.com/data');
```

#### `client.post_json(url: string, body: object): Promise<object>`
Performs a POST request with JSON body.

```javascript
const response = await client.post_json('https://api.example.com/users', {
    name: 'Jane Doe',
    email: 'jane@example.com'
});
```


## Performance Considerations

- The WASM module adds a small overhead for initialization (~100-200ms on first load)
- Once loaded, HTTP operations benefit from Rust's efficient memory management
- Best suited for applications that make multiple HTTP requests or need predictable performance

## Browser Support

- Chrome 57+
- Firefox 52+
- Safari 11+
- Edge 16+
- Node.js 14+

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the LICENSE file for details.

## Troubleshooting

### WASM Module Not Loading

If you encounter issues with the WASM module not loading:

1. Ensure your server supports the `application/wasm` MIME type
2. Check that the WASM file is being served correctly
3. Verify you're awaiting the `initWasm()` call before using any functions

### CORS Issues

When fetching from external APIs, ensure:

1. The target server allows CORS requests
2. You're using HTTPS URLs in production
3. Consider using a proxy server for APIs that don't support CORS

### Node.js Path Issues

If you encounter path resolution issues in Node.js:

1. Ensure the package is installed correctly
2. Check that the WASM file exists in `node_modules/rust-fetch/wasm-module/pkg/`
3. Try reinstalling the package

## Acknowledgments

- Built with [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen)
- Uses [reqwest](https://github.com/seanmonstar/reqwest) for HTTP operations
- Inspired by the Rust and WebAssembly community

## Roadmap

- [ ] Add support for POST, PUT, DELETE methods
- [ ] Implement request headers customization
- [ ] Add streaming support for large responses
- [ ] Implement request cancellation
- [ ] Add comprehensive test suite
- [ ] Performance benchmarks against native fetch
- [ ] Support for form data and file uploads
- [ ] WebSocket support
- [ ] Request/response interceptors
