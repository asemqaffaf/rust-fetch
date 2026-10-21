# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-10-22

### Breaking changes
See "Upgrading to 2.0" in the README for migration steps.
- Timeouts are enforced in browsers and Node.js (default 30 s per attempt); they were silently ignored in 1.x
- `WasmClient` JSON bodies are plain objects instead of `Map`s
- `application/*+json` responses are parsed as JSON in auto mode, and empty bodies are `null`
- Errors are `Error` instances; `message` is no longer an enumerable own property
- Invalid `headers` values reject with `InvalidInputError` instead of being silently dropped
- Response text is decoded as UTF-8 regardless of the `charset` parameter
- The package has an `exports` map (Node.js and browser entries); only the documented paths can be imported
- Node.js 20 or newer is required
- Rust: `RetryConfig` has a new `retry_non_idempotent` field; `Method::to_reqwest()` returns reqwest 0.12's `Method`; `RequestBuilder::header()` replaces default headers with the same name; `WasmClient` methods take an options argument

### Added
- `WasmClient` options: `baseUrl`, `headers`, `timeoutMs` and `retries` (count or `RetryOptions`)
- Per-request options on every method: `headers`, `params`, `timeoutMs`, `responseType`, `signal`, `onDownloadProgress`
- `post`/`put`/`patch(url, { body, ... })` and `fetch(url, init)`
- Request cancellation with `AbortSignal`, including during retry backoff and while streaming
- Streaming responses: `responseType: 'stream'` (a `ReadableStream`); `send_streaming()`/`get_streaming()` in Rust
- Download progress callbacks (`onDownloadProgress`; `on_download_progress()` in Rust)
- `multipart/form-data` uploads from `FormData` (including files); `Blob`/`File`, `ArrayBuffer`, `DataView` and `URLSearchParams` bodies; `Multipart` builder in Rust
- Request and response interceptors: `addRequestInterceptor`, `addResponseInterceptor`, `ejectInterceptor`, `clearInterceptors`
- Node.js entry point: no `init()` or manual `.wasm` loading needed; conditional `exports` for Node.js and browsers
- TypeScript definitions for all options, responses and errors
- `Retry-After` support, jittered backoff, `retry_non_idempotent` option
- Benchmark against native `fetch` (`npm run bench`)
- Test suites: Rust integration tests against a local server, wasm tests in Node.js, JS end-to-end and package-install tests; CI with a 100% line-coverage gate for the Rust core

### Changed
- Errors thrown to JS are real `Error` instances; `name` equals `kind`
- POST and PATCH are no longer retried unless `retryNonIdempotent`/`retry_non_idempotent` is set
- Only statuses listed in `retryOn` are retried (default `[408, 429, 500, 502, 503, 504]`)
- Per-request headers replace client default headers with the same name instead of being sent twice
- `fetch_json` parses JSON regardless of `Content-Type`; empty bodies are `null`
- `application/*+json` responses are parsed as JSON in auto mode; empty responses are `null`
- Long error bodies are truncated in error messages (the full body stays on `error.body`)
- Upgraded to reqwest 0.13. Native (non-wasm) Rust builds now use rustls with aws-lc instead of OpenSSL for TLS; the npm package is unaffected

### Fixed
- Timeouts were ignored in browsers and Node.js, so stuck requests could hang forever
- Retry delays used `window.setTimeout`, which crashed in Node.js and Web Workers
- `WasmClient` returned JSON objects as `Map`s
- JSON containing integers above 2^53 failed the whole request
- An explicit `Content-Type` was sent alongside a default one (e.g. `application/json, text/plain`)
- `Uint8Array` request bodies failed; `URLSearchParams` bodies were sent empty
- `baseUrl` was blindly concatenated (missing or doubled slashes; absolute URLs were broken)
- Invalid URLs and headers were reported as retryable network errors
- `TRACE`/`CONNECT` failed with an opaque "builder error"; they're now rejected with a clear message
- Retry delay calculation could panic with very large `max_delay`/`multiplier` values
- Updated dependencies with security advisories: `bytes` (RUSTSEC-2026-0007, also in the wasm build) and `openssl` (RUSTSEC-2025-0004, RUSTSEC-2025-0022, native builds only)
- The npm package's broken `client.js`/`server.js` wrappers and stale `types.d.ts` were removed

## [1.1.0]

### Added
- **Extended HTTP Methods**: Added support for PUT, DELETE, PATCH, and HEAD methods in `WasmClient`
- **Flexible Request Method**: New `request()` method in `WasmClient` for custom HTTP requests with headers and body
- **TypeScript Definitions**: Comprehensive TypeScript type definitions (`types.d.ts`) with detailed interfaces:
  - `HttpResponse` interface for type-safe responses
  - `RequestOptions` interface for request configuration
  - `HttpError` interface for structured error handling
  - `ClientConfig` interface for client configuration
- **Enhanced Error Handling**: Added `From` implementation for `serde_wasm_bindgen::Error`
- **Comprehensive Tests**: Added extensive test suite in `tests/client_tests.rs`
- **Better Documentation**: Improved inline documentation and code examples

### Changed
- **Error Conversion**: Improved error conversion from JavaScript values
- **API Consistency**: Standardized method naming (e.g., `put_json`, `patch_json` for JSON payloads)

### Fixed
- **Duplicate Implementation**: Removed duplicate `From` implementation for `serde_wasm_bindgen::Error`

## [1.0.4] - 2024-01-27

### Added
- World-class WebAssembly HTTP client library
- Excellent error handling with detailed context
- Clean API design with builder pattern

## [1.0.2] - 2024-01-20

### Added
- Basic HTTP client implementation with builder pattern
- Support for GET, POST, PUT, DELETE, PATCH methods
- Retry logic with exponential backoff
- WASM bindings for browser and Node.js
- Error handling system with structured error types
- Response format handling (JSON, text, binary)

### Features
- Type-safe HTTP client
- Comprehensive error handling
- Automatic retries for transient failures
- Platform optimizations for WASM and native targets
- Backward compatibility with legacy APIs

## [0.7.2] - 2023-12-15

### Added
- Initial WASM module structure
- Basic fetch functions for JSON and text
- Simple HTTP client wrapper

### Changed
- Project structure reorganization
- Updated dependencies

## [0.1.0] - 2023-11-01

### Added
- Initial release
- Basic HTTP functionality using reqwest
- WASM compilation support
- Simple fetch APIs

[Unreleased]: https://github.com/asemqaffaf/rust-fetch/compare/v1.0.4...HEAD
[1.0.4]: https://github.com/asemqaffaf/rust-fetch/compare/v1.0.2...v1.0.4
[1.0.2]: https://github.com/asemqaffaf/rust-fetch/compare/v0.7.2...v1.0.2
[0.7.2]: https://github.com/asemqaffaf/rust-fetch/compare/v0.1.0...v0.7.2
[0.1.0]: https://github.com/asemqaffaf/rust-fetch/releases/tag/v0.1.0
