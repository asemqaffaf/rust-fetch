//! URLs: the `url` crate natively, and in WebAssembly the runtime's own
//! WHATWG `URL`, which implements the same standard. That keeps `url`,
//! `idna` and their Unicode tables out of the browser bundle (#93).

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use reqwest::Url;

#[cfg(target_arch = "wasm32")]
pub(crate) use crate::wasm::url::Url;
