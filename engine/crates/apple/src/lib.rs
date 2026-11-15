//! The drawing engine for Apple platforms: see README.md for its rules.
//!
//! [`Engine`] is the browser's `Page` and `Worker` on one Metal device; [`ffi`] is the C interface
//! the iPad app calls through `DecksEngine`. There is no drawing logic here.

#![cfg(target_vendor = "apple")]

pub mod device;
pub mod engine;
pub mod ffi;
pub mod frame;
pub mod gesture;

pub use engine::Engine;
pub use frame::View;
