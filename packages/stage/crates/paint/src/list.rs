//! The draw list: the one boundary between what the stage looks like and the graphics card.
//!
//! The painter writes it; a [`crate::Backend`] turns it into GPU work and never sees the document.
//! Everything is in plain terms (boxes, corners, colours, triangles, textures by our own ids) so a
//! backend for WebGPU, WebGL 2 or Metal reads the same list, and a test can read it with no GPU.

/// A colour with its alpha multiplied in, as the graphics card blends it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Color(pub [f32; 4]);

impl Color {
	pub const TRANSPARENT: Color = Color([0.0; 4]);

	/// From straight (not premultiplied) red, green, blue and alpha, times an extra opacity.
	pub fn straight(rgba: [f32; 4], opacity: f32) -> Color {
		let a = (rgba[3] * opacity).clamp(0.0, 1.0);
		Color([rgba[0] * a, rgba[1] * a, rgba[2] * a, a])
	}

	pub fn is_clear(&self) -> bool {
		self.0[3] <= 0.0
	}
}

/// A 2-D affine map: `(x, y)` → `(a·x + c·y + e, b·x + d·y + f)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine(pub [f32; 6]);

impl Default for Affine {
	fn default() -> Self {
		Affine::IDENTITY
	}
}

impl Affine {
	pub const IDENTITY: Affine = Affine([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

	pub fn translate(x: f32, y: f32) -> Affine {
		Affine([1.0, 0.0, 0.0, 1.0, x, y])
	}

	pub fn scale(s: f32) -> Affine {
		Affine([s, 0.0, 0.0, s, 0.0, 0.0])
	}

	/// `self` after `then`: a point goes through `then` first.
	pub fn then(&self, first: &Affine) -> Affine {
		let [a, b, c, d, e, f] = self.0;
		let [a2, b2, c2, d2, e2, f2] = first.0;
		Affine([a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f])
	}

	pub fn apply(&self, x: f32, y: f32) -> (f32, f32) {
		let [a, b, c, d, e, f] = self.0;
		(a * x + c * y + e, b * x + d * y + f)
	}

	/// How much the map stretches lengths, at most: what an edge's softness is measured in.
	pub fn scale_factor(&self) -> f32 {
		let [a, b, c, d, ..] = self.0;
		(a * a + b * b).sqrt().max((c * c + d * d).sqrt())
	}
}

/// A rounded rectangle in an item's own space: its corner at the origin, then its size, then its
/// radii (top-left, top-right, bottom-right, bottom-left). An ellipse is the box it fills.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Shape {
	pub w: f32,
	pub h: f32,
	pub radii: [f32; 4],
	pub ellipse: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
	Inside,
	Center,
	Outside,
}

/// What fills an area.
#[derive(Clone, Debug, PartialEq)]
pub enum Paint {
	Solid(Color),
	/// From `from` to `to` in the item's own space, through colour stops at 0 to 1.
	Linear { from: (f32, f32), to: (f32, f32), stops: Vec<(f32, Color)> },
	/// About `center`, reaching `radius` (x and y), through colour stops at 0 to 1.
	Radial { center: (f32, f32), radius: (f32, f32), stops: Vec<(f32, Color)> },
	/// A picture by our own texture id at an opacity. `uv` is the part of the picture across the
	/// shape's box (0 to 1 is all of it); past the picture's edge is transparent.
	Image { texture: u32, opacity: f32, uv: [f32; 4] },
}

/// A clip: everything drawn while it holds is cut to a rounded rectangle.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Clip {
	pub shape: Shape,
	pub transform: Affine,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Op {
	/// A shape filled, or its outline when `stroke` is set: `(width, align)` in its own units.
	Shape { shape: Shape, transform: Affine, paint: Paint, stroke: Option<(f32, Align)> },
	/// The soft shadow of a shape, already offset; `blur` is the CSS blur radius in its own units.
	Shadow { shape: Shape, transform: Affine, color: Color, blur: f32, spread: f32 },
	/// Triangles in an item's own space, filled with one paint: paths, strokes of paths, polygons.
	Mesh { vertices: Vec<[f32; 2]>, indices: Vec<u32>, transform: Affine, paint: Paint },
	/// Glyphs: quads cut from a glyph texture, already placed in target pixels, in one colour.
	Glyphs { texture: u32, quads: Vec<GlyphQuad>, color: Color },
	/// A picture laid on target pixels with hard edges, for tiles that meet edge to edge: no soft
	/// rim, so no seam. `x, y, w, h` in target pixels; `uv` the part of the texture shown.
	Picture { texture: u32, x: f32, y: f32, w: f32, h: f32, uv: [f32; 4], opacity: f32 },
	PushClip(Clip),
	PopClip,
	/// What follows until the matching pop is drawn on its own and laid down at this opacity.
	PushLayer { opacity: f32 },
	PopLayer,
}

/// One glyph: where it goes in target pixels, and the part of the glyph texture it shows, in texels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlyphQuad {
	pub x: f32,
	pub y: f32,
	pub w: f32,
	pub h: f32,
	pub u: f32,
	pub v: f32,
}

/// A frame's or a tile's whole drawing: cleared to `clear`, then each op in order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DrawList {
	pub clear: Color,
	pub ops: Vec<Op>,
}

impl DrawList {
	pub fn new(clear: Color) -> DrawList {
		DrawList { clear, ops: Vec::new() }
	}

	pub fn push(&mut self, op: Op) {
		self.ops.push(op);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn affine_composes_in_order() {
		let m = Affine::scale(2.0).then(&Affine::translate(10.0, 0.0));
		assert_eq!(m.apply(1.0, 1.0), (22.0, 2.0));
		assert_eq!(Affine::translate(10.0, 0.0).then(&Affine::scale(2.0)).apply(1.0, 1.0), (12.0, 2.0));
	}
}
