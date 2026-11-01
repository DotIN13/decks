//! The engine in the browser: one wasm module, loaded by the page and by the render worker.
//!
//! `engine.rs` is what each keeps and does, testable without a browser; `bind.rs` carries calls
//! across to JavaScript, opening the graphics API `select.rs` picks; `wire.rs` is the changes' JSON;
//! `editor_scene.rs` answers the editor crate's questions about the scene from the engine's own, and
//! `editing.rs` keeps the editor beside the page, applying its preview and painting its overlay.

pub mod engine;
pub mod editing;
pub mod editing_wire;
pub mod editor_scene;
pub mod wire;

#[cfg(target_arch = "wasm32")]
mod bind;
#[cfg(target_arch = "wasm32")]
mod select;
