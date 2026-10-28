# Using it from Rust

The same client is a Rust library, for native code (on tokio) and for your own wasm crates:

```rust
use rust_fetch::{Client, Multipart, types::RetryConfig};
use std::time::Duration;

let client = Client::builder()
    .base_url("https://api.example.com/v1")
    .timeout(Duration::from_secs(10))
    .retry_config(RetryConfig { max_retries: 3, ..Default::default() })
    .build()?;

let user = client.get("users/42").await?;
println!("{}", user.json().unwrap()["name"]);

let pdf: Vec<u8> = std::fs::read("report.pdf")?;
let form = Multipart::new().text("title", "Report").file("file", "report.pdf", Some("application/pdf".into()), pdf);
client.post("upload").multipart(&form).send().await?;

let mut chunks = client.get_streaming("export.csv").await?.into_stream(); // a futures::Stream of Vec<u8>
```

For APIs that support deduplication, `.idempotency_key("order-42")?` or `.idempotency_key_header("X-Key", "order-42")?` sets a key that allows POST/PATCH retries under the configured policy. Generate keys in the application; reuse a key only for the same operation.

Per-request retries: `.retry_config(RetryConfig { … })` replaces the client's policy; `.no_retries()` disables retries for that request, including streamed responses.

Redirects: `.redirect(Redirect::Manual)` or `Redirect::Error`, and `.max_redirects(n)` (default 20), on the `ClientBuilder` or per request on the `RequestBuilder`.

The security and load options are there too, with the same defaults as in JavaScript: `allow_absolute_urls`, `max_response_bytes`, `sensitive_headers` and `allow_insecure_redirects` (on the `ClientBuilder` and per request), and `retry_budget(RetryBudget::new())` and `max_pending_requests` (on the `ClientBuilder`; `Client::retries_refused()` counts refusals). `maxLineBytes`, `maxEventBytes` and `allowPrivateNetwork` are JavaScript only.

Request futures are `Send`, so you can `tokio::spawn` them. Progress callbacks (`on_download_progress`) must be `Send + Sync` on native targets. Upload progress, WebSockets and interceptors are only in the JavaScript API.
