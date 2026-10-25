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

Redirects: `.redirect(Redirect::Manual)` or `Redirect::Error`, and `.max_redirects(n)` (default 20), on the `ClientBuilder` or per request on the `RequestBuilder`.

Request futures are `Send`, so you can `tokio::spawn` them. Progress callbacks (`on_download_progress`) must be `Send + Sync` on native targets. Upload progress, WebSockets and interceptors are only in the JavaScript API.
