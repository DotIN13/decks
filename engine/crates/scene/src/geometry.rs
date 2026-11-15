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

/// A 2-D affine map, `(x, y)` → `(a·x + c·y + e, b·x + d·y + f)`: an item's own space to the stage.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mat(pub [f64; 6]);

impl Default for Mat {
	fn default() -> Self {
		Mat::IDENTITY
	}
}

impl Mat {
	pub const IDENTITY: Mat = Mat([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

	pub fn translate(x: f64, y: f64) -> Mat {
		Mat([1.0, 0.0, 0.0, 1.0, x, y])
	}

	/// A turn of `degrees` counter-clockwise, as pen.dev turns an item, on a screen whose y grows down.
	pub fn turn(degrees: f64) -> Mat {
		let r = degrees.to_radians();
		let (s, c) = (r.sin(), r.cos());
		Mat([c, -s, s, c, 0.0, 0.0])
	}

	pub fn scale(x: f64, y: f64) -> Mat {
		Mat([x, 0.0, 0.0, y, 0.0, 0.0])
	}

	/// `self` after `first`: a point goes through `first`, then `self`.
	pub fn then(&self, first: &Mat) -> Mat {
		let [a, b, c, d, e, f] = self.0;
		let [a2, b2, c2, d2, e2, f2] = first.0;
		Mat([a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f])
	}

	pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
		let [a, b, c, d, e, f] = self.0;
		(a * x + c * y + e, b * x + d * y + f)
	}

	pub fn invert(&self) -> Option<Mat> {
		let [a, b, c, d, e, f] = self.0;
		let det = a * d - b * c;
		if det.abs() < 1e-12 {
			return None;
		}
		let (ia, ib, ic, id) = (d / det, -b / det, -c / det, a / det);
		Some(Mat([ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)]))
	}

	pub fn is_translation(&self) -> bool {
		let [a, b, c, d, ..] = self.0;
		a == 1.0 && b == 0.0 && c == 0.0 && d == 1.0
	}

	/// The box on the stage round a `w` × `h` box in the map's own space.
	pub fn bounds(&self, w: f64, h: f64) -> Rect {
		let corners = [(0.0, 0.0), (w, 0.0), (0.0, h), (w, h)].map(|(x, y)| self.apply(x, y));
		let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
		for (x, y) in corners {
			x0 = x0.min(x);
			y0 = y0.min(y);
			x1 = x1.max(x);
			y1 = y1.max(y);
		}
		Rect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
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
	fn turns_invert() {
		let m = Mat::translate(5.0, 7.0).then(&Mat::turn(30.0));
		let (x, y) = m.apply(10.0, 4.0);
		let (bx, by) = m.invert().unwrap().apply(x, y);
		assert!((bx - 10.0).abs() < 1e-9 && (by - 4.0).abs() < 1e-9);
		// Ninety degrees counter-clockwise: the right edge goes up.
		let (x, y) = Mat::turn(90.0).apply(10.0, 0.0);
		assert!(x.abs() < 1e-9 && (y + 10.0).abs() < 1e-9);
	}
}
