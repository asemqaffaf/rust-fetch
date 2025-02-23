use wasm_bindgen::prelude::*;

pub mod greetings;
pub mod http;
pub mod math;

// Re-export all public items from modules
pub use greetings::*;
pub use http::*;
pub use math::*;
