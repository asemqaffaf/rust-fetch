//! WebAssembly HTTP Client Library
//!
//! A world-class Rust library for making HTTP requests from WebAssembly
//! with excellent error handling, retry logic, and a clean API design.
//!
//! # Features
//!
//! - Type-safe HTTP client with builder pattern
//! - Comprehensive error handling
//! - Automatic retries with exponential backoff
//! - Support for JSON, text, and binary responses
//! - Per-attempt timeouts and cancellation that work in browsers, Web Workers and Node.js
//! - Backward compatibility with deprecated APIs
//!
//! # Example
//!
//! ```rust,no_run
//! use rust_fetch::client::Client;
//!
//! async fn example() -> Result<(), rust_fetch::error::Error> {
//!     let client = Client::builder()
//!         .timeout(std::time::Duration::from_secs(10))
//!         .with_retries()
//!         .build()?;
//!
//!     let response = client
//!         .get("https://api.example.com/data")
//!         .await?;
//!
//!     println!("Status: {}", response.status);
//!     Ok(())
//! }
//! ```

#![warn(missing_docs)]
#![warn(clippy::all)]
#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]
#![allow(clippy::must_use_candidate)]

// Core modules
pub mod client;
pub mod error;
pub mod types;

// Feature modules

pub mod http;

mod budget;
mod lines;
mod runtime;
mod sse;
mod url;
mod wasm;

pub use wasm::WasmClient;

// Re-export commonly used types
pub use budget::RetryBudget;
pub use client::{Client, ClientBuilder, ProgressCallback, RequestBuilder, StreamingResponse};
pub use error::{Error, Result};
pub use types::{Headers, Method, Multipart, Progress, Redirect, Response, ResponseBody};

// Re-export all public items from feature modules for backward compatibility
pub use http::*;

// Optional: Add prelude module for convenient imports
/// Prelude module for convenient imports
pub mod prelude {
    pub use crate::{
        client::{Client, ClientBuilder, StreamingResponse},
        error::{Error, Result},
        http::{fetch_json, fetch_text, fetch_with_options},
        types::{Headers, Method, Multipart, Progress, Response, ResponseBody},
    };
}
