//! Ink: the stroke still under the pen, painted by the page in every frame rather than into tiles,
//! until it is saved as a path.

use super::*;

/// The stroke still under the pen: an SVG path in stage units, filled or stroked `size` wide.
#[derive(Clone, Debug)]
pub struct LiveInk {
	pub d: String,
	pub filled: bool,
	pub color: [f32; 4],
	pub size: f32,
	pub opacity: f32,
}

/// Live strokes, drawn with `target` (stage units to target pixels).
pub fn paint_ink(strokes: &[LiveInk], target: &Mat, ops: &mut Vec<Op>) {
	let transform = to_affine(target);
	let pixels = transform.scale_factor().max(1e-3);
	for stroke in strokes {
		let Ok(path) = kurbo::BezPath::from_svg(&stroke.d) else { continue };
		let mesh = if stroke.filled { mesh::fill(&path, false, pixels) } else { mesh::stroke(&path, stroke.size, lyon_tessellation::LineCap::Round, lyon_tessellation::LineJoin::Round, None, pixels) };
		if let Some((vertices, indices)) = mesh {
			ops.push(Op::Mesh { vertices, indices, transform, paint: Paint::Solid(Color::straight(stroke.color, stroke.opacity)) });
		}
	}
}
