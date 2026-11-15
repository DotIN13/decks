//! Running a batched draw on wgpu, the same on every wgpu target: the pipelines and their layouts
//! ([`pipelines`]), what is kept on the device between frames ([`resources`]), and the passes of one
//! draw ([`draw`]).

pub mod draw;
pub mod mips;
pub mod pipelines;
pub mod resources;
