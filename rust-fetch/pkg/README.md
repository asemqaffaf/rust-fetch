# Rust Fetch - World-Class HTTP Client for WebAssembly

[![License: MIT/Apache-2.0](https://img.shields.io/badge/License-MIT%2FApache--2.0-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-%23000000.svg?style=flat&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=flat&logo=WebAssembly&logoColor=white)](https://webassembly.org/)

A production-ready, world-class HTTP client library for WebAssembly with excellent error handling, retry logic, and a clean API design.

## 🚀 Features

- **Type-safe HTTP Client**: Builder pattern for constructing requests with compile-time safety
- **Comprehensive Error Handling**: Detailed error types with context and proper error chaining
- **Automatic Retries**: Built-in retry logic with exponential backoff for transient failures
- **Multiple Response Formats**: Support for JSON, text, and binary responses
- **Platform Optimized**: Specific optimizations for both WASM and native targets
- **Developer Friendly**: Clean API with both simple functions and advanced client builders
- **Backward Compatible**: Maintains compatibility with legacy API while providing modern alternatives

## 📦 Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
rust-fetch = "1.0.0"
```

For WebAssembly projects, make sure to include:

```toml
[dependencies]
wasm-bindgen = "0.2"
wasm-bindgen-futures = "0.4"
```

## 🔧 Usage

### Simple API

For quick and easy HTTP requests:

```rust
use rust_fetch::prelude::*;

// Fetch JSON data
let data = fetch_json("https://api.example.com/data").await?;

// Fetch text/HTML
let html = fetch_text("https://example.com").await?;

// Advanced request with options
let response = fetch_with_options(
    "https://api.example.com/users",
    "POST",
    headers_obj, // JavaScript headers object
    Some(r#"{"name": "John Doe"}"#.to_string()),
).await?;
```

### Advanced Client API

For more control and configuration:

```rust
use rust_fetch::client::Client;
use rust_fetch::types::RetryConfig;
use std::time::Duration;

// Create a configured client
let client = Client::builder()
    .base_url("https://api.example.com")
    .default_header("Authorization", "Bearer token")
    .timeout(Duration::from_secs(10))
    .retry_config(RetryConfig {
        max_retries: 3,
        initial_delay: Duration::from_millis(100),
        ..Default::default()
    })
    .build()?;

// Make requests
let response = client
    .post("/users")
    .json(&serde_json::json!({
        "name": "Jane Doe",
        "email": "jane@example.com"
    }))?
    .send()
    .await?;

// Access response data
println!("Status: {}", response.status);
if let Some(json) = response.json() {
    println!("Response: {:?}", json);
}
```

### WebAssembly JavaScript API

When compiled to WebAssembly, the library exposes a JavaScript-friendly API:

```javascript
import init, { WasmClient, fetch_json, fetch_text } from './rust_fetch.js';

await init();

// Simple API
const data = await fetch_json("https://api.example.com/data");
const html = await fetch_text("https://example.com");

// Client API
const client = new WasmClient();
const response = await client.get("https://api.example.com/users");
console.log(response);
```

## 🏗️ Architecture

The library is organized into several modules:

- **`error`**: Comprehensive error types with detailed context
- **`types`**: Core types like `Method`, `Headers`, `Response`, etc.
- **`client`**: The main HTTP client with builder pattern
- **`http`**: High-level convenience functions for common use cases

### Error Handling

The library provides rich error types that preserve context:

```rust
use rust_fetch::error::{Error, Result};

match fetch_json(url).await {
    Ok(data) => println!("Success: {:?}", data),
    Err(Error::Network { message, source }) => {
        eprintln!("Network error: {}", message);
    }
    Err(Error::Http { status, status_text, body }) => {
        eprintln!("HTTP {}: {}", status, status_text);
    }
    Err(e) => eprintln!("Other error: {}", e),
}
```

### Request Building

The client provides a fluent API for building requests:

```rust
let response = client
    .request(Method::Put, "/users/123")
    .header("Content-Type", "application/json")
    .header("X-Custom-Header", "value")
    .timeout(Duration::from_secs(5))
    .json(&updated_user)?
    .send()
    .await?;
```

## 🧪 Testing

Run tests for native target:

```bash
cargo test
```

Run tests for WebAssembly target:

```bash
wasm-pack test --headless --chrome
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

## 🙏 Acknowledgments

Built with love using:
- [reqwest](https://github.com/seanmonstar/reqwest) - HTTP client
- [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen) - WebAssembly bindings
- [serde](https://github.com/serde-rs/serde) - Serialization framework
