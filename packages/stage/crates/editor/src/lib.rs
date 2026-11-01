//! The canvas editor: what a press, a drag, a handle, a hold and a key do to the drawing, answered
//! inside the engine's own frame and built to the rules table (`rules.rs`, `device/rules.json`).
//!
//! It reads the scene (`scene.rs`), keeps its own state, and answers each input with the ops to send,
//! the effects the page must do and the overlay the painter draws. The TypeScript editor in
//! `packages/canvas/src/edit/core` does the same until this one takes over.
//!
//! One file per concern, each the counterpart of a file in `edit/core`:
//! `model` (model.ts), `rules` (device/rules.ts), `scene` (scene.ts), `pen` (the pen predicates),
//! `pick` (pick.ts), `snap` (edit/snap.ts), `snapping` (snapping.ts), `drop` (drop.ts),
//! `resize` (resize.ts), `arrows` (arrows.ts), `ops` (ops.ts), `keys` (keys.ts),
//! `overlay` (overlay.ts and overlay-json.ts), `dispatch` (dispatch.ts), `gesture` (gesture.ts).

pub mod arrows;
pub mod dispatch;
pub mod drop;
pub mod gesture;
pub mod keys;
pub mod model;
pub mod ops;
pub mod overlay;
pub mod pen;
pub mod pick;
pub mod resize;
pub mod rules;
pub mod scene;
pub mod snap;
pub mod snapping;
