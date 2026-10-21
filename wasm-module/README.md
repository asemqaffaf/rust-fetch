# rust-fetch (crate)

The Rust crate behind the [`rust-fetch`](https://www.npmjs.com/package/rust-fetch) npm package: an HTTP client built on reqwest. It works natively (on tokio) and in WebAssembly, where the npm package sends requests through `fetch()` in browsers and a `node:http` transport in Node.js.

See the [main README](../README.md) for the JavaScript API, the roadmap and how to build and test.

```rust
use rust_fetch::{Client, Multipart, types::RetryConfig};
use std::time::Duration;

let client = Client::builder()
    .base_url("https://api.example.com/v1")
    .timeout(Duration::from_secs(10)) // per attempt, including the body
    .retry_config(RetryConfig { max_retries: 3, ..Default::default() })
    .build()?;

// JSON, text or bytes, detected from Content-Type
let user = client.get("users/42").await?;

// Bodies, query parameters and per-request options
client
    .post("users")
    .query([("notify", "true")])
    .json(&serde_json::json!({ "name": "Zoë" }))?
    .send()
    .await?;

// Multipart uploads
let form = Multipart::new().text("title", "Report").file("file", "report.pdf", None, pdf_bytes);
client.post("upload").multipart(&form).send().await?;

// Streaming with progress
let response = client
    .request(rust_fetch::Method::Get, "export.csv")
    .on_download_progress(|p| println!("{} / {:?} bytes", p.loaded, p.total))
    .send_streaming()
    .await?;
let mut chunks = response.into_stream();
```

Errors are `rust_fetch::Error` values (`Http`, `Timeout`, `Network`, `InvalidInput`, `Parse`, `Cancelled`, `JsInterop`). Retries apply to network errors, timeouts and the configured statuses, and only to idempotent methods unless `retry_non_idempotent` is set.
