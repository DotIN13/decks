//! Outlines that are not a rounded rectangle or an ellipse (paths, polygons, arcs, dashed lines),
//! cut into triangles in the item's own space, flat enough for the pixels they will cover.

use kurbo::{Arc, BezPath, Ellipse, PathEl, Point, RoundedRect, Shape as _, Vec2};
use lyon_tessellation::path::Path;
use lyon_tessellation::{BuffersBuilder, FillOptions, FillRule, FillTessellator, FillVertex, LineCap, LineJoin, StrokeOptions, StrokeTessellator, StrokeVertex, VertexBuffers};
use serde_json::Value;
use stage_scene::tree::Item;

pub type Mesh = (Vec<[f32; 2]>, Vec<u32>);

/// A `path` item's geometry, mapped from its `viewBox` (or its own bounds) onto its box.
pub fn geometry_path(item: &Item, w: f64, h: f64) -> Option<BezPath> {
	let d = item.get("geometry").and_then(Value::as_str).filter(|d| !d.trim().is_empty())?;
	let mut path = BezPath::from_svg(d).ok()?;
	let vb = item
		.get("viewBox")
		.and_then(Value::as_array)
		.and_then(|v| Some([v.first()?.as_f64()?, v.get(1)?.as_f64()?, v.get(2)?.as_f64()?, v.get(3)?.as_f64()?]))
		.or_else(|| {
			let b = path.bounding_box();
			Some([b.x0, b.y0, b.width(), b.height()])
		})?;
	let sx = if vb[2] != 0.0 { w / vb[2] } else { 1.0 };
	let sy = if vb[3] != 0.0 { h / vb[3] } else { 1.0 };
	path.apply_affine(kurbo::Affine::new([sx, 0.0, 0.0, sy, -vb[0] * sx, -vb[1] * sy]));
	Some(path)
}

/// Each segment's bounds in the path's own units, `[x0, y0, x1, y1]`: where a stroke along it can
/// paint, before the stroke's own width. `None` past `most` segments, when one box is as good.
pub fn segment_bounds(path: &BezPath, most: usize) -> Option<Vec<[f64; 4]>> {
	let mut out = Vec::new();
	for seg in path.segments() {
		if out.len() == most {
			return None;
		}
		let b = kurbo::ParamCurveExtrema::bounding_box(&seg);
		out.push([b.x0, b.y0, b.x1, b.y1]);
	}
	Some(out)
}

pub fn rounded_rect_path(w: f64, h: f64, r: f64) -> BezPath {
	RoundedRect::new(0.0, 0.0, w, h, r.min(w.min(h) / 2.0).max(0.0)).to_path(0.01)
}

pub fn ellipse_path(w: f64, h: f64) -> BezPath {
	Ellipse::new((w / 2.0, h / 2.0), (w / 2.0, h / 2.0), 0.0).to_path(0.01)
}

/// An arc of an ellipse: a ring when `inner` (0 to 1 of the radius) is set, a wedge otherwise.
/// pen's angles are degrees counter-clockwise from the right.
pub fn arc_path(w: f64, h: f64, inner: f64, start: f64, sweep: f64) -> BezPath {
	let c = Point::new(w / 2.0, h / 2.0);
	let outer = Vec2::new(w / 2.0, h / 2.0);
	let mut path = BezPath::new();
	if sweep.abs() >= 360.0 {
		path.extend(Ellipse::new(c, outer, 0.0).path_elements(0.01));
		if inner > 0.0 {
			path.extend(Ellipse::new(c, outer * inner, 0.0).path_elements(0.01));
		}
		return path;
	}
	// On a screen whose y grows down, counter-clockwise is a negative angle.
	let (a0, da) = (-start.to_radians(), -sweep.to_radians());
	let arc = Arc::new(c, outer, a0, da, 0.0);
	let at = |r: Vec2, a: f64| Point::new(c.x + r.x * a.cos(), c.y + r.y * a.sin());
	if inner > 0.0 {
		path.move_to(at(outer, a0));
		for el in arc.append_iter(0.01) {
			path.push(el);
		}
		let back = Arc::new(c, outer * inner, a0 + da, -da, 0.0);
		path.line_to(at(outer * inner, a0 + da));
		for el in back.append_iter(0.01) {
			path.push(el);
		}
	} else {
		path.move_to(c);
		path.line_to(at(outer, a0));
		for el in arc.append_iter(0.01) {
			path.push(el);
		}
	}
	path.close_path();
	path
}

/// A regular polygon in its box, first corner at the top, corners rounded by `radius`.
pub fn polygon_path(w: f64, h: f64, sides: usize, radius: f64) -> BezPath {
	let points: Vec<Point> = (0..sides)
		.map(|i| {
			let a = -std::f64::consts::FRAC_PI_2 + i as f64 * std::f64::consts::TAU / sides as f64;
			Point::new(w / 2.0 + w / 2.0 * a.cos(), h / 2.0 + h / 2.0 * a.sin())
		})
		.collect();
	let mut path = BezPath::new();
	if radius <= 0.0 {
		path.move_to(points[0]);
		for p in &points[1..] {
			path.line_to(*p);
		}
		path.close_path();
		return path;
	}
	let edge = (0..sides).map(|i| (points[(i + 1) % sides] - points[i]).hypot()).fold(f64::MAX, f64::min);
	let r = radius.min(edge / 2.0);
	// Each corner cut back along its two edges and joined by a curve through the corner's pull.
	let cut = |from: Point, to: Point| from + (to - from).normalize() * r;
	for i in 0..sides {
		let prev = points[(i + sides - 1) % sides];
		let here = points[i];
		let next = points[(i + 1) % sides];
		let (a, b) = (cut(here, prev), cut(here, next));
		if i == 0 {
			path.move_to(a);
		} else {
			path.line_to(a);
		}
		path.quad_to(here, b);
	}
	path.close_path();
	path
}

fn to_lyon(els: impl IntoIterator<Item = PathEl>) -> Path {
	let mut b = Path::builder();
	let mut open = false;
	let p = |p: Point| lyon_tessellation::math::point(p.x as f32, p.y as f32);
	for el in els {
		match el {
			PathEl::MoveTo(a) => {
				if open {
					b.end(false);
				}
				b.begin(p(a));
				open = true;
			}
			PathEl::LineTo(a) if open => {
				b.line_to(p(a));
			}
			PathEl::QuadTo(c, a) if open => {
				b.quadratic_bezier_to(p(c), p(a));
			}
			PathEl::CurveTo(c1, c2, a) if open => {
				b.cubic_bezier_to(p(c1), p(c2), p(a));
			}
			PathEl::ClosePath if open => {
				b.end(true);
				open = false;
			}
			_ => {}
		}
	}
	if open {
		b.end(false);
	}
	b.build()
}

/// The inside of a path. `pixels` is target pixels per unit, which sets how flat curves are cut.
pub fn fill(path: &BezPath, even_odd: bool, pixels: f32) -> Option<Mesh> {
	let lyon = to_lyon(path.elements().iter().copied());
	let mut out: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
	let rule = if even_odd { FillRule::EvenOdd } else { FillRule::NonZero };
	let options = FillOptions::tolerance((0.2 / pixels).max(1e-4)).with_fill_rule(rule);
	FillTessellator::new()
		.tessellate_path(&lyon, &options, &mut BuffersBuilder::new(&mut out, |v: FillVertex| v.position().to_array()))
		.ok()?;
	(!out.indices.is_empty()).then_some((out.vertices, out.indices))
}

/// A path's line, `width` wide, optionally dashed (`[on, off, …]` in the path's units).
pub fn stroke(path: &BezPath, width: f32, cap: LineCap, join: LineJoin, dash: Option<&[f64]>, pixels: f32) -> Option<Mesh> {
	let lyon = match dash {
		Some(pattern) => to_lyon(kurbo::dash(path.elements().iter().copied(), 0.0, pattern)),
		None => to_lyon(path.elements().iter().copied()),
	};
	let mut out: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
	// A dotted line's dots are round, as the browser draws a zero-length dash with round caps.
	let cap = if dash.is_some_and(|d| d.first().is_some_and(|on| *on < 0.1)) { LineCap::Round } else { cap };
	let options = StrokeOptions::tolerance((0.2 / pixels).max(1e-4)).with_line_width(width.max(0.0)).with_line_cap(cap).with_line_join(join);
	StrokeTessellator::new()
		.tessellate_path(&lyon, &options, &mut BuffersBuilder::new(&mut out, |v: StrokeVertex| v.position().to_array()))
		.ok()?;
	(!out.indices.is_empty()).then_some((out.vertices, out.indices))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn shapes_tessellate() {
		let tri = polygon_path(100.0, 100.0, 3, 0.0);
		let (v, i) = fill(&tri, false, 1.0).unwrap();
		assert_eq!(v.len(), 3);
		assert_eq!(i.len(), 3);
		assert!(fill(&polygon_path(100.0, 100.0, 6, 10.0), false, 1.0).is_some());
		assert!(fill(&arc_path(100.0, 100.0, 0.5, 0.0, 90.0), true, 1.0).is_some());
		assert!(stroke(&rounded_rect_path(100.0, 50.0, 6.0), 1.5, LineCap::Butt, LineJoin::Miter, Some(&[6.0, 4.0]), 1.0).is_some());
	}
}
