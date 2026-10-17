//! Shapes' outlines and the tests a pointer is answered with.

use crate::Rect;
use kurbo::{BezPath, Shape};

/// The tight box of an SVG path, which is what a `path` item's box is when it has no `viewBox`.
/// Exact, because the pointer is tested against it: a box measured larger steals clicks.
pub fn path_bounds(d: &str) -> Option<Rect> {
	let path = BezPath::from_svg(d).ok()?;
	if path.elements().is_empty() {
		return None;
	}
	let b = path.bounding_box();
	Some(Rect { x: b.x0, y: b.y0, w: b.width(), h: b.height() })
}

/// An item's turn: degrees counter-clockwise about its top-left corner, as pen.dev draws it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Turn {
	pub cos: f64,
	pub sin: f64,
}

impl Turn {
	pub fn degrees(d: f64) -> Turn {
		let r = d.to_radians();
		Turn { cos: r.cos(), sin: r.sin() }
	}

	pub fn is_none(&self) -> bool {
		self.sin == 0.0 && self.cos == 1.0
	}

	/// A point of the item (from its corner) as it lands on the stage (from the corner too).
	/// Counter-clockwise on a screen whose y grows downwards.
	pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
		(x * self.cos + y * self.sin, -x * self.sin + y * self.cos)
	}

	pub fn invert(&self, x: f64, y: f64) -> (f64, f64) {
		(x * self.cos - y * self.sin, x * self.sin + y * self.cos)
	}

	/// The box on the stage round a rectangle turned about its own corner.
	pub fn bounds(&self, r: &Rect) -> Rect {
		if self.is_none() {
			return *r;
		}
		let corners = [(0.0, 0.0), (r.w, 0.0), (0.0, r.h), (r.w, r.h)].map(|(x, y)| self.apply(x, y));
		let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
		for (x, y) in corners {
			x0 = x0.min(x);
			y0 = y0.min(y);
			x1 = x1.max(x);
			y1 = y1.max(y);
		}
		Rect { x: r.x + x0, y: r.y + y0, w: x1 - x0, h: y1 - y0 }
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn path_bounds_are_tight() {
		// A half circle from (0,50) to (100,50), bulging up to y = 0.
		let r = path_bounds("M0 50 A50 50 0 0 1 100 50").unwrap();
		assert!((r.y - 0.0).abs() < 1e-6 && (r.h - 50.0).abs() < 1e-6, "{r:?}");
		assert!(path_bounds("").is_none());
	}

	#[test]
	fn turn_round_trips() {
		let t = Turn::degrees(30.0);
		let (x, y) = t.apply(10.0, 4.0);
		let (bx, by) = t.invert(x, y);
		assert!((bx - 10.0).abs() < 1e-9 && (by - 4.0).abs() < 1e-9);
		// Ninety degrees counter-clockwise: the right edge goes up.
		let q = Turn::degrees(90.0);
		let (x, y) = q.apply(10.0, 0.0);
		assert!(x.abs() < 1e-9 && (y + 10.0).abs() < 1e-9);
	}
}
