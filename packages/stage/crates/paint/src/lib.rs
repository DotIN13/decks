//! What the stage looks like, without a graphics card: the draw list, the [`Backend`] interface
//! every graphics backend implements, the painter that writes draw lists, and the tile grid.

pub mod backend;
pub mod list;
pub mod mesh;
pub mod painter;
pub mod tiles;

pub use backend::{Backend, Recording, Target, TextureKind, flush_glyphs};
pub use list::{Affine, Align, Clip, Color, DrawList, GlyphQuad, Op, Paint, Shape};

#[cfg(test)]
mod tests;
