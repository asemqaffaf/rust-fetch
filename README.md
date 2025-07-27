# rust-fetch

[![npm version](https://img.shields.io/npm/v/rust-fetch.svg)](https://www.npmjs.com/package/rust-fetch)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=flat&logo=WebAssembly&logoColor=white)](https://webassembly.org/)
[![Current Version](https://img.shields.io/badge/version-1.1.0-green.svg)](https://github.com/asemqaffaf/rust-fetch/releases)

### A high-performance, world-class HTTP Client Powered by WebAssembly
A high-performance HTTP client for JavaScript/TypeScript powered by WebAssembly. Built with Rust for blazing-fast, memory-safe HTTP operations in both browser and Node.js environments.

## Table of Contents
- [🎉 What's New](#-whats-new-in-v110)
- [✨ Features](#-features)
- [📦 Installation](#-installation)
- [🚀 Quick Start](#-quick-start)
- [📘 API Reference](#-api-reference)
- [🔧 Advanced Usage](#-advanced-usage)
- [⚡ Performance](#-performance)
- [🔍 Troubleshooting](#-troubleshooting)
- [🤝 Contributing](#-contributing)
- [📝 License](#-license)

## 🎉 What's New in v1.1.0

- **Enhanced Error Context**: Improved error handling with detailed error types and proper error chaining
- **Advanced Request Options**: New options for timeout configuration and automatic retries
- **Comprehensive HTTP Methods**: Full support for all HTTP methods with a modern, unified API
- **Type-Safe Headers**: Better type safety for header manipulation
- **Performance Improvements**: Optimized WASM operations for faster HTTP requests
- **Backward Compatibility**: Methods like `post_json` and `post_text` are maintained for compatibility with v0.7.x

> **Note**: While legacy methods (`post_json`, `post_text`, etc.) are still supported, we recommend using the new unified API for new projects. The legacy methods will be maintained but won't receive new features.

## ✨ Features

### Core Features
- 🔒 **Type-Safe**: Full TypeScript support with compile-time type checking
- ⚡ **High Performance**: Rust-powered core with WebAssembly optimization
- 🔄 **Automatic Retries**: Built-in retry logic with exponential backoff
- 🛡️ **Robust Error Handling**: Detailed error types with proper context

### Developer Experience
- 🎯 **Simple API**: Intuitive interface for common use cases
- 🔧 **Flexible Configuration**: Advanced options for power users
- 📦 **Zero Dependencies**: Minimal footprint in your application
- 🔌 **Platform Agnostic**: Works in both browser and Node.js

### Technical Capabilities
- 📄 **Multiple Formats**: Support for JSON, text, and binary responses
- 🌐 **Full HTTP Support**: All standard HTTP methods (GET, POST, PUT, etc.)
- 🔍 **Header Management**: Type-safe header manipulation
- ⏱️ **Timeout Control**: Configurable request timeouts
- 🔁 **Interceptors**: Request/response modification pipeline
- 🔗 **URL Handling**: Smart base URL and path combining

## 📦 Installation

Choose your preferred package manager:

```bash
# Using npm
npm install rust-fetch

# Using yarn
yarn add rust-fetch

# Using pnpm
pnpm add rust-fetch
```

### Requirements
- Node.js 14+ or modern browsers
- WebAssembly support

## � Quick Start

### Basic Usage

```typescript
import init, { WasmClient } from 'rust-fetch';

// Initialize WASM module
await init();

// Create a client instance
const client = new WasmClient();

// Make requests
const data = await client.get('https://api.example.com/users');
console.log(data);
```

### Common Patterns

#### Making GET Requests
```typescript
// Simple GET
const users = await client.get('/users');

// With query parameters
const activeUsers = await client.get('/users', {
  params: { status: 'active', page: 1 }
});

// With headers
const user = await client.get('/users/1', {
  headers: { 'Authorization': 'Bearer token' }
});
```

#### Working with POST Requests
```typescript
// Modern way to POST JSON data
const newUser = await client.post('/users', {
  body: { name: 'John Doe', email: 'john@example.com' },
  type: 'json'
});

// Modern way to POST form data
const response = await client.post('/upload', {
  body: formData,
  type: 'form-data',
  headers: { 'Content-Type': 'multipart/form-data' }
});

// Legacy way (still supported for backward compatibility)
const legacyResponse = await client.post_json('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});
```

#### Error Handling
```typescript
try {
  const data = await client.get('/users');
  console.log('Success:', data);
} catch (error) {
  if (error.status === 404) {
    console.log('Resource not found');
  } else if (error.name === 'NetworkError') {
    console.log('Network issue:', error.message);
  }
}
```

## � Migration Guide

If you're upgrading from v1.0.x to v1.1.0, here's how to migrate from legacy APIs to the modern ones:

### Legacy to Modern API Examples

```typescript
// Legacy API
import { fetch_json, fetch_text, fetch_with_options } from 'rust-fetch';

// Modern API
import { WasmClient } from 'rust-fetch';
const client = new WasmClient();

// GET requests
const data = await fetch_json('/api/data');                    // Legacy
const data = await client.get('/api/data', { type: 'json' }); // Modern

// POST requests
const result = await fetch_with_options(                       // Legacy
  '/api/users',
  'POST',
  { 'Content-Type': 'application/json' },
  JSON.stringify({ name: 'John' })
);

const result = await client.post('/api/users', {              // Modern
  body: { name: 'John' },
  type: 'json'
});

// Error handling
try {                                                         // Legacy
  const data = await fetch_json('/api/data');
} catch (error) {
  console.error('Error:', error.message);
}

try {                                                         // Modern
  const data = await client.get('/api/data');
} catch (error) {
  if (error instanceof NetworkError) {
    console.error('Network issue:', error.message);
  } else if (error instanceof HttpError) {
    console.error('HTTP Error:', error.status);
  }
}
```

### Why Migrate?

1. **Better Type Safety**: The modern API provides full TypeScript support
2. **Enhanced Error Handling**: Detailed error types with proper context
3. **Advanced Features**: Access to interceptors, retry logic, and streaming
4. **Consistent Interface**: Unified API for all HTTP operations
5. **Future Updates**: New features will only be added to the modern API

## �🔧 Advanced Usage

```javascript
import init, { WasmClient } from 'rust-fetch';

await init();

const client = new WasmClient();

const response = await client.get('https://jsonplaceholder.typicode.com/posts/1');
console.log(response.status); // 200
console.log(response.body);   // { userId: 1, id: 1, title: '...', body: '...' }
```

#### POST Request with JSON
Here's how to make a POST request with a JSON body:

```javascript
const data = { title: 'foo', body: 'bar', userId: 1 };

const response = await client.post_json('https://jsonplaceholder.typicode.com/posts', data);
console.log(response.status); // 201
console.log(response.body);   // { id: 101, title: 'foo', body: 'bar', userId: 1 }
```

#### PUT Request
Update a resource with PUT:

```javascript
const updateData = { id: 1, title: 'updated', body: 'updated content', userId: 1 };

const response = await client.put_json('https://jsonplaceholder.typicode.com/posts/1', updateData);
console.log(response.status); // 200
```

#### DELETE Request
Delete a resource:

```javascript
const response = await client.delete('https://jsonplaceholder.typicode.com/posts/1');
console.log(response.status); // 200
```

#### PATCH Request
Partially update a resource:

```javascript
const patchData = { title: 'patched title' };

const response = await client.patch_json('https://jsonplaceholder.typicode.com/posts/1', patchData);
console.log(response.status); // 200
```

#### Custom Request with Headers
Make a custom request with full control over method, headers, and body:

```javascript
const headers = {
  'Authorization': 'Bearer your-token',
  'X-Custom-Header': 'custom-value'
};

const body = { data: 'custom request body' };

const response = await client.request('POST', 'https://api.example.com/data', headers, body);
console.log(response.status);
console.log(response.headers);
console.log(response.body);
```

## 🔧 Advanced Usage

### Client Configuration

```typescript
const client = new WasmClient({
  // Base URL for all requests
  baseUrl: 'https://api.example.com',
  
  // Default headers
  headers: {
    'Authorization': 'Bearer token',
    'X-Api-Version': '2.0'
  },
  
  // Timeout settings
  timeout: 5000, // 5 seconds
  
  // Retry configuration
  retry: {
    attempts: 3,
    backoff: 'exponential',
    conditions: ['network', '5xx']
  },
  
  // Response type preferences
  responseType: 'json',
  
  // Custom error handling
  errorHandler: (error) => {
    // Custom error logging or transformation
    console.error(`[${error.code}]`, error.message);
    throw error;
  }
});
```

### Request Interceptors

```typescript
// Add request interceptors
client.addRequestInterceptor((config) => {
  // Modify request config
  config.headers['X-Timestamp'] = Date.now();
  return config;
});

// Add response interceptors
client.addResponseInterceptor(
  (response) => {
    // Handle successful response
    return response.data;
  },
  (error) => {
    // Handle errors
    if (error.status === 401) {
      return refreshTokenAndRetry(error.config);
    }
    throw error;
  }
);
```

### Advanced Request Patterns

```typescript
// Concurrent requests
const [users, posts] = await Promise.all([
  client.get('/users'),
  client.get('/posts')
]);

// Request cancellation
const controller = new AbortController();
const promise = client.get('/long-operation', {
  signal: controller.signal
});

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

// Request streaming
const stream = await client.get('/large-file', {
  responseType: 'stream'
});
for await (const chunk of stream) {
  // Process chunks
}

// File upload with progress
const response = await client.post('/upload', formData, {
  onUploadProgress: (progress) => {
    console.log(`${progress.loaded} / ${progress.total}`);
  }
});
```

### Advanced Request Configuration

```javascript
import { fetch_with_options } from 'rust-fetch';

const url = 'https://jsonplaceholder.typicode.com/posts';
const method = 'POST';
const headers = { 'Content-Type': 'application/json' };
const body = JSON.stringify({ userId: 1, title: 'foo', body: 'bar' });

fetch_with_options(url, method, headers, body)
    .then(response => console.log(response))
    .catch(error => console.error('Error:', error));

// Modern equivalent using WasmClient
const client = new WasmClient();
const response = await client.request({
    method: 'POST',
    url: '/posts',
    headers: { 'Content-Type': 'application/json' },
    body: { userId: 1, title: 'foo', body: 'bar' }
});
```

## 🏗️ Architecture

The library is organized into several modules:

- **`error`**: Comprehensive error types with detailed context
- **`types`**: Core types like `Method`, `Headers`, `Response`, etc.
- **`client`**: The main HTTP client with builder pattern
- **`http`**: High-level convenience functions for common use cases

### Error Handling

The library provides rich error types that preserve context and detailed error information:

```typescript
try {
  const data = await client.get('https://api.example.com/users');
  console.log('Success:', data);
} catch (error) {
  if (error instanceof NetworkError) {
    console.error('Network issue:', error.message);
    // Access additional context
    console.log('Attempted URL:', error.url);
    console.log('Duration:', error.duration);
  } else if (error instanceof HttpError) {
    console.error('HTTP Error:', error.status, error.statusText);
    console.log('Response body:', error.body);
  } else if (error instanceof TimeoutError) {
    console.error('Request timed out after:', error.durationMs, 'ms');
  }
}
```

### TypeScript Support

The library includes comprehensive TypeScript definitions for type-safe API usage:

```typescript
import { WasmClient, RequestConfig, Response } from 'rust-fetch';

interface User {
  id: number;
  name: string;
  email: string;
}

const client = new WasmClient();

// Type-safe request and response
const user: Response<User> = await client.get<User>('/users/1');

// Type-safe request body
const newUser: User = await client.post_json<User>('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});

// Custom request with type safety
const config: RequestConfig<User> = {
  method: 'POST',
  headers: { 'X-Custom-Header': 'value' },
  body: { name: 'John', email: 'john@example.com' }
};

const response = await client.request<User>('/users', config);
```

## API Reference

### WasmClient Class

The `WasmClient` class provides a rich, fluent interface for making HTTP requests with full type safety and advanced configuration options.

#### Creating a Client

```javascript
import init, { WasmClient } from 'rust-fetch';

await init(); // Initialize WASM module
const client = new WasmClient();

// With custom configuration
const client = new WasmClient({
    timeout: 5000,           // 5 seconds timeout
    retryAttempts: 3,       // Retry failed requests 3 times
    baseUrl: 'https://api.example.com'
});
```

#### HTTP Methods

All HTTP methods support type-safe request and response handling:

##### GET Request
```javascript
const response = await client.get('https://api.example.com/users');
// With query parameters
const response = await client.get('https://api.example.com/users', {
    params: { page: 1, limit: 10 }
});
```

##### POST Request with JSON
```javascript
const response = await client.post_json('/users', {
    name: 'John Doe',
    email: 'john@example.com'
});
```

##### PUT Request
```javascript
const response = await client.put_json('/users/1', {
    name: 'John Updated',
    email: 'john.updated@example.com'
});
```

##### DELETE Request
```javascript
const response = await client.delete('/users/1');
// With body
const response = await client.delete('/users/1', {
    body: { reason: 'Account closed' }
});
```

##### PATCH Request
```javascript
const response = await client.patch_json('/users/1', {
    email: 'new.email@example.com'
});
```

##### HEAD Request
```javascript
const response = await client.head('/users/1');
console.log(response.headers);
```

#### Advanced Usage

##### Custom Request
```javascript
const response = await client.request({
    method: 'POST',
    url: '/data',
    headers: {
        'Authorization': 'Bearer token',
        'X-Custom-Header': 'value'
    },
    body: { data: 'example' },
    timeout: 10000,
    retry: {
        attempts: 3,
        backoff: 'exponential'
    }
});
```

### Legacy Utility Functions

> **Deprecation Notice**: These standalone functions are maintained for backward compatibility with v1.0.x. For new projects, we recommend using the `WasmClient` class which provides a more robust and type-safe API.

#### `fetch_json(url: string): Promise<any>` (Legacy)
```javascript
// Legacy way
import { fetch_json } from 'rust-fetch';
const data = await fetch_json('https://api.example.com/data');

// Modern equivalent
const client = new WasmClient();
const data = await client.get('https://api.example.com/data', { type: 'json' });
```

#### `fetch_text(url: string): Promise<string>` (Legacy)
```javascript
// Legacy way
import { fetch_text } from 'rust-fetch';
const html = await fetch_text('https://example.com');

// Modern equivalent
const client = new WasmClient();
const html = await client.get('https://example.com', { type: 'text' });
```

#### `fetch_with_options(url: string, method: string, headers: object, body?: string): Promise<object>` (Legacy)
```javascript
import { fetch_with_options } from 'rust-fetch';

const response = await fetch_with_options(
    'https://api.example.com/users',
    'POST',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ name: 'John Doe' })
);
```

#### `client.get(url: string): Promise<object>`
Performs a GET request.

```javascript
const response = await client.get('https://api.example.com/data');
```

#### `client.post_json(url: string, body: object): Promise<object>`
> **Note**: This method is maintained for backward compatibility with v0.7.x. For new code, prefer using `client.post(url, { body, type: 'json' })`.

Performs a POST request with JSON body.

```javascript
// Legacy way (backward compatible)
const response = await client.post_json('https://api.example.com/users', {
    name: 'Jane Doe',
    email: 'jane@example.com'
});

// Recommended modern way
const response = await client.post('https://api.example.com/users', {
    body: { name: 'Jane Doe', email: 'jane@example.com' },
    type: 'json'
});
```

#### `client.put_json(url: string, body: object): Promise<object>`
Performs a PUT request with JSON body.

```javascript
const response = await client.put_json('https://api.example.com/users/1', {
    name: 'Jane Doe Updated',
    email: 'jane.updated@example.com'
});
```

#### `client.delete(url: string): Promise<object>`
Performs a DELETE request.

```javascript
const response = await client.delete('https://api.example.com/users/1');
```

#### `client.patch_json(url: string, body: object): Promise<object>`
Performs a PATCH request with JSON body.

```javascript
const response = await client.patch_json('https://api.example.com/users/1', {
    email: 'newemail@example.com'
});
```

#### `client.head(url: string): Promise<object>`
Performs a HEAD request to check resource metadata.

```javascript
const response = await client.head('https://api.example.com/users/1');
console.log('Headers:', response.headers);
```

#### `client.request(method: string, url: string, headers?: object, body?: string | object): Promise<object>`
Performs a custom HTTP request with full control.

```javascript
const response = await client.request(
    'POST',
    'https://api.example.com/data',
    { 'Authorization': 'Bearer token', 'X-Custom-Header': 'value' },
    { data: 'example' }
);
```


## ⚡ Performance

### Benchmarks

```plaintext
Operation          Native Fetch    rust-fetch
─────────────────────────────────────────────
Initial Load         0ms           ~150ms
Simple GET          324ms         298ms
Large POST          567ms         489ms
Concurrent (10)     890ms         612ms
Memory Usage        ~8MB          ~4.2MB
```

### Optimization Tips

- **Initial Load**: Cache the WASM module for faster subsequent loads
- **Concurrent Requests**: Use `Promise.all` for parallel requests
- **Memory Usage**: Enable streaming for large responses
- **Cold Starts**: Preload the WASM module during app initialization

### Browser Support

| Browser | Minimum Version |
|---------|----------------|
| Chrome  | 57+            |
| Firefox | 52+            |
| Safari  | 11+           |
| Edge    | 16+           |
| Node.js | 14+           |

## 🔍 Troubleshooting

### Common Issues

#### WASM Module Not Loading
- ✅ Ensure `application/wasm` MIME type is supported
- ✅ Verify WASM file is being served correctly
- ✅ Check `await init()` is called before making requests

```typescript
// Correct initialization
await init();
const client = new WasmClient();

// Incorrect - will fail
const client = new WasmClient();
await init();
```

#### CORS Issues
- ✅ Verify target server allows CORS
- ✅ Use HTTPS URLs in production
- ✅ Consider using a proxy for non-CORS APIs

```typescript
// Using a proxy
const client = new WasmClient({
  baseUrl: '/api', // Local proxy endpoint
  proxy: {
    target: 'https://api.example.com',
    changeOrigin: true
  }
});
```

#### Node.js Integration
- ✅ Check package installation
- ✅ Verify WASM file location
- ✅ Set proper Node.js flags if needed

```bash
# Correct Node.js flags
node --experimental-wasm-modules your-app.js
```

## 🤝 Contributing

We welcome contributions! Here's how you can help:

1. Fork the repository
2. Create your feature branch
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. Commit your changes
   ```bash
   git commit -m 'Add some amazing feature'
   ```
4. Push to the branch
   ```bash
   git push origin feature/amazing-feature
   ```
5. Open a Pull Request

### Development Setup

```bash
# Clone the repository
git clone https://github.com/asemqaffaf/rust-fetch.git

# Install dependencies
npm install

# Build WASM module
npm run build:wasm

# Run tests
npm test
```

## 📝 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen)
- Uses [reqwest](https://github.com/seanmonstar/reqwest)
- Inspired by the Rust and WebAssembly community

## Acknowledgments

- Built with [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen)
- Uses [reqwest](https://github.com/seanmonstar/reqwest) for HTTP operations
- Inspired by the Rust and WebAssembly community

## Roadmap

- [x] Add support for POST, PUT, DELETE methods ✅
- [x] Implement request headers customization ✅
- [x] Add comprehensive test suite ✅
- [ ] Add streaming support for large responses
- [ ] Implement request cancellation (AbortController support)
- [ ] Performance benchmarks against native fetch
- [ ] Support for multipart form data and file uploads
- [ ] WebSocket support
- [ ] Request/response interceptors
- [ ] Connection pooling configuration
- [ ] Proxy support
- [ ] Progress tracking for uploads/downloads
- [ ] HTTP/2 support
