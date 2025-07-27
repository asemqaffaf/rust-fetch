# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
