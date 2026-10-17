//! The engine in the browser: one wasm module, loaded by the page and by the render worker.
//!
//! `engine.rs` is what each keeps and does, testable without a browser; `bind.rs` carries calls
//! across to JavaScript; `wire.rs` is the changes' JSON.

pub mod engine;
pub mod wire;

#[cfg(target_arch = "wasm32")]
mod bind;
