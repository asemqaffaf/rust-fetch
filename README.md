# rust-fetch

A WebAssembly-powered HTTP client library for JavaScript/TypeScript applications, built with Rust. This library provides fast, memory-safe HTTP operations through WebAssembly bindings, allowing you to leverage Rust's performance and safety guarantees in your web applications.

## Features

- 🚀 **High Performance**: Leverage Rust's performance for HTTP operations through WebAssembly
- 🔐 **Memory Safe**: Built with Rust's memory safety guarantees
- 🌐 **Cross-Platform**: Works in both browser and Node.js environments
- 📦 **TypeScript Support**: Full TypeScript definitions included
- 🛠️ **Multiple Utilities**: HTTP fetching, JSON parsing, HTML retrieval, and utility functions

## Installation

```bash
npm install rust-fetch
```

or

```bash
yarn add rust-fetch
```

## Project Structure

```
rust-fetch/
├── rust-fetch-package/    # Main Rust package (currently basic implementation)
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
├── wasm-module/          # WebAssembly module with HTTP and utility functions
│   ├── Cargo.toml
│   ├── pkg/              # Generated WASM package
│   └── src/
│       ├── greetings/    # Greeting utilities
│       ├── http/         # HTTP client functions
│       ├── math/         # Math utilities
│       └── lib.rs
├── client.ts             # Client-side entry point
├── server.ts             # Server-side entry point
├── package.json          # NPM package configuration
└── tsconfig.json         # TypeScript configuration
```

## Usage

### Client-Side (Browser)

```typescript
import initWasm, { 
  fetch_wasm_json, 
  fetch_wasm_html, 
  greet, 
  add 
} from 'rust-fetch/client';

// Initialize WASM module
await initWasm();

// Fetch JSON data
try {
  const data = await fetch_wasm_json('https://api.example.com/data');
  console.log('JSON data:', data);
} catch (error) {
  console.error('Error fetching JSON:', error);
}

// Fetch HTML content
try {
  const html = await fetch_wasm_html('https://example.com');
  console.log('HTML content:', html);
} catch (error) {
  console.error('Error fetching HTML:', error);
}

// Use utility functions
const greeting = greet('World');
console.log(greeting); // "Hello, World!"

const sum = add(5, 3);
console.log(sum); // 8
```

### Server-Side (Node.js)

```typescript
import initWasm, { 
  fetch_wasm_json, 
  fetch_wasm_html,
  greet,
  add 
} from 'rust-fetch/server';

// WASM is automatically initialized on import

// Fetch JSON data
try {
  const data = await fetch_wasm_json('https://api.example.com/data');
  console.log('JSON data:', data);
} catch (error) {
  console.error('Error fetching JSON:', error);
}

// Use other functions similarly
```

## API Reference

### HTTP Functions

#### `fetch_wasm_json(url: string): Promise<any>`
Fetches JSON data from the specified URL and returns it as a JavaScript object.

```typescript
const data = await fetch_wasm_json('https://jsonplaceholder.typicode.com/todos/1');
```

#### `fetch_wasm_json_new(url: string): Promise<any>`
Alternative implementation that returns a Promise directly (useful for different async patterns).

```typescript
const promise = fetch_wasm_json_new('https://api.example.com/data');
const data = await promise;
```

#### `fetch_wasm_map(url: string): Promise<any>`
Fetches JSON data and returns it as a JavaScript object using `serde_wasm_bindgen`.

```typescript
const data = await fetch_wasm_map('https://api.example.com/data');
```

#### `fetch_wasm_html(url: string): Promise<string>`
Fetches HTML content from the specified URL and returns it as a string.

```typescript
const html = await fetch_wasm_html('https://example.com');
```

#### `fetch_wasm_api(): Promise<any>`
Fetches data from a predefined API endpoint (JSONPlaceholder todo item).

```typescript
const todo = await fetch_wasm_api();
```

### Utility Functions

#### `greet(name: string): string`
Returns a greeting message.

```typescript
const message = greet('Alice'); // "Hello, Alice!"
```

#### `add(a: number, b: number): number`
Adds two numbers together.

```typescript
const result = add(10, 20); // 30
```

## Building from Source

### Prerequisites

- Rust (latest stable version)
- Node.js (v14 or higher)
- wasm-pack (`cargo install wasm-pack`)

### Build Steps

1. Clone the repository:
```bash
git clone https://github.com/yourusername/rust-fetch.git
cd rust-fetch
```

2. Install dependencies:
```bash
npm install
```

3. Build the WASM module:
```bash
npm run build:wasm
```

4. Build TypeScript files:
```bash
npm run build
```

## Development

### Building the WASM Module

```bash
cd wasm-module
wasm-pack build --target web
```

This generates the `pkg` directory with JavaScript bindings and TypeScript definitions.

### Running Tests

For Rust tests:
```bash
cd wasm-module
cargo test

cd ../rust-fetch-package
cargo test
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
