//! What the editor draws over the canvas, painted by the engine in the same frame as the drawing
//! (`stage-web`, `Page::frame`): outlines, handles, guides, slots and drafts. The page sends the
//! geometry in canvas units with its sizes in screen pixels (`edit/core/overlay-json.ts`), and keeps
//! its own elements only as hit areas (`canvas.css`, `[data-engine-overlays]`), so an outline moves
//! with the drawing it marks, never a frame behind it.
use crate::list::{Affine, Align, Color, Op, Paint, Shape};
use crate::mesh;
use kurbo::BezPath;
use lyon_tessellation::LineCap;
use serde::Deserialize;

/// The overlay as the page sends it, in canvas units; `kind` says how each piece is drawn.
#[derive(Deserialize, Default, Clone, Debug, PartialEq)]
pub struct Overlay {
	/// The accent, the guides' red, and the panel colour handles are filled with: red, green, blue, 0 to 1.
	#[serde(default = "accent_default")]
	pub accent: [f32; 3],
	#[serde(default = "guide_default")]
	pub guide: [f32; 3],
	#[serde(default = "panel_default")]
	pub panel: [f32; 3],
	#[serde(default)]
	pub boxes: Vec<OverlayBox>,
	#[serde(default)]
	pub lines: Vec<OverlayLine>,
	#[serde(default)]
	pub paths: Vec<OverlayPath>,
	#[serde(default)]
	pub dots: Vec<OverlayDot>,
}

fn accent_default() -> [f32; 3] {
	[0.173, 0.361, 0.937]
}
fn guide_default() -> [f32; 3] {
	[0.949, 0.306, 0.118]
}
fn panel_default() -> [f32; 3] {
	[1.0, 1.0, 1.0]
}

/// A box, with its corner radius in canvas units: `kin`, `kin-child`, `selection`, `selection-thin`,
/// `selection-box`, `hover`, `join`, `slot-frame`, `draft`, `draft-ellipse`, `measure`.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct OverlayBox {
	pub x: f64,
	pub y: f64,
	pub w: f64,
	pub h: f64,
	#[serde(default)]
	pub r: f64,
	pub kind: String,
}

/// A line: `slot`, `insert`, `guide`, `measure`, `measure-dashed`, `draft`.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct OverlayLine {
	pub x1: f64,
	pub y1: f64,
	pub x2: f64,
	pub y2: f64,
	pub kind: String,
}

/// An SVG path in canvas units, from (`x`, `y`): `route`.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct OverlayPath {
	pub x: f64,
	pub y: f64,
	pub d: String,
	pub kind: String,
}

/// A handle or a mark centred on a point, `px` screen pixels across: `handle` (a square), `handle-round`,
/// `radius`, `end` (a free arrow end), `diamond` (a joined one), `bend`, `bend-bent`, `anchor`, `side`, `side-on`.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct OverlayDot {
	pub x: f64,
	pub y: f64,
	pub px: f32,
	pub kind: String,
}

impl Overlay {
	pub fn parse(json: &str) -> Option<Overlay> {
		serde_json::from_str(json).ok()
	}
	pub fn is_empty(&self) -> bool {
		self.boxes.is_empty() && self.lines.is_empty() && self.paths.is_empty() && self.dots.is_empty()
	}
}

/// Paint the overlay for a camera at `(x, y)` and `s` target pixels per canvas unit, after everything else.
/// `s` is the camera's scale in device pixels (zoom × `dpr`); every screen size here (a handle's width, a
/// line's, a dash's) is in CSS pixels and is multiplied by `dpr`, so it is the same size on every screen.
pub fn paint_overlay(o: &Overlay, cam_x: f64, cam_y: f64, s: f64, dpr: f64, ops: &mut Vec<Op>) {
	let k = dpr as f32;
	let tx = |x: f64| ((x - cam_x) * s) as f32;
	let ty = |y: f64| ((y - cam_y) * s) as f32;
	let rgba = |c: [f32; 3], a: f32| Color::straight([c[0], c[1], c[2], a], 1.0);
	let accent = |a: f32| rgba(o.accent, a);
	let guide = |a: f32| rgba(o.guide, a);
	let panel = rgba(o.panel, 1.0);
	for b in &o.boxes {
		let (x, y) = (tx(b.x), ty(b.y));
		let (w, h) = ((b.w * s) as f32, (b.h * s) as f32);
		let r = (b.r * s) as f32;
		let shape = |ellipse: bool| Shape { w, h, radii: [r; 4], ellipse };
		let at = Affine::translate(x, y);
		match b.kind.as_str() {
			"kin" => ops.push(Op::Shape { shape: shape(false), transform: at, paint: Paint::Solid(accent(0.45)), stroke: Some((1.0 * k, Align::Outside)) }),
			"kin-child" => dashed_box(ops, w, h, r, at, 1.0 * k, &[4.0 * dpr, 3.0 * dpr], accent(0.55)),
			"selection" => ops.push(Op::Shape { shape: shape(false), transform: at, paint: Paint::Solid(accent(1.0)), stroke: Some((1.5 * k, Align::Outside)) }),
			"selection-thin" => ops.push(Op::Shape { shape: shape(false), transform: at, paint: Paint::Solid(accent(1.0)), stroke: Some((1.0 * k, Align::Outside)) }),
			"selection-box" => ops.push(Op::Shape { shape: shape(false), transform: at, paint: Paint::Solid(accent(1.0)), stroke: Some((1.5 * k, Align::Outside)) }),
			"hover" => ops.push(Op::Shape { shape: shape(false), transform: at, paint: Paint::Solid(accent(1.0)), stroke: Some((2.0 * k, Align::Outside)) }),
			"join" => {
				ops.push(Op::Shape { shape: shape(false), transform: at, paint: Paint::Solid(accent(0.1)), stroke: None });
				ops.push(Op::Shape { shape: shape(false), transform: at, paint: Paint::Solid(accent(1.0)), stroke: Some((2.0 * k, Align::Outside)) });
			}
			"slot-frame" => dashed_box(ops, w, h, r, at, 1.5 * k, &[4.0 * dpr, 3.0 * dpr], accent(0.6)),
			"draft" | "draft-ellipse" => {
				let ellipse = b.kind == "draft-ellipse";
				ops.push(Op::Shape { shape: shape(ellipse), transform: at, paint: Paint::Solid(accent(0.08)), stroke: None });
				if ellipse {
					dashed_path(ops, &mesh::ellipse_path(w as f64, h as f64), at, 1.5 * k, &[4.0 * dpr, 3.0 * dpr], accent(1.0));
				} else {
					dashed_box(ops, w, h, r, at, 1.5 * k, &[4.0 * dpr, 3.0 * dpr], accent(1.0));
				}
			}
			"measure" => ops.push(Op::Shape { shape: shape(false), transform: at, paint: Paint::Solid(guide(1.0)), stroke: Some((1.0 * k, Align::Center)) }),
			_ => {}
		}
	}
	for l in &o.lines {
		let mut path = BezPath::new();
		path.move_to((tx(l.x1) as f64, ty(l.y1) as f64));
		path.line_to((tx(l.x2) as f64, ty(l.y2) as f64));
		match l.kind.as_str() {
			"slot" => line(ops, &path, 1.5 * k, LineCap::Round, Some(&[4.0 * dpr, 3.0 * dpr]), accent(0.7)),
			"insert" => line(ops, &path, 3.0 * k, LineCap::Round, None, accent(1.0)),
			"guide" => line(ops, &path, 1.0 * k, LineCap::Butt, None, guide(1.0)),
			"measure" => line(ops, &path, 1.0 * k, LineCap::Butt, None, guide(1.0)),
			"measure-dashed" => line(ops, &path, 1.0 * k, LineCap::Butt, Some(&[3.0 * dpr, 3.0 * dpr]), guide(1.0)),
			"draft" => line(ops, &path, 2.0 * k, LineCap::Butt, Some(&[6.0 * dpr, 6.0 * dpr]), accent(1.0)),
			_ => {}
		}
	}
	for p in &o.paths {
		let Ok(mut path) = BezPath::from_svg(&p.d) else { continue };
		path.apply_affine(kurbo::Affine::new([s, 0.0, 0.0, s, tx(p.x) as f64, ty(p.y) as f64]));
		if p.kind == "route" {
			line(ops, &path, 2.0 * k, LineCap::Butt, Some(&[6.0 * dpr, 6.0 * dpr]), accent(1.0));
		}
	}
	for d in &o.dots {
		let (cx, cy) = (tx(d.x), ty(d.y));
		let px = d.px * k;
		let square = |radii: f32, ellipse: bool| Shape { w: px, h: px, radii: [radii; 4], ellipse };
		let at = Affine::translate(cx - px / 2.0, cy - px / 2.0);
		match d.kind.as_str() {
			"handle" => {
				ops.push(Op::Shape { shape: square(2.0 * k, false), transform: at, paint: Paint::Solid(panel), stroke: None });
				ops.push(Op::Shape { shape: square(2.0 * k, false), transform: at, paint: Paint::Solid(accent(1.0)), stroke: Some((1.5 * k, Align::Inside)) });
			}
			"handle-round" | "radius" | "end" | "bend" => {
				ops.push(Op::Shape { shape: square(0.0, true), transform: at, paint: Paint::Solid(panel), stroke: None });
				ops.push(Op::Shape { shape: square(0.0, true), transform: at, paint: Paint::Solid(accent(1.0)), stroke: Some((1.5 * k, Align::Inside)) });
			}
			"bend-bent" => {
				ops.push(Op::Shape { shape: square(0.0, true), transform: at, paint: Paint::Solid(panel), stroke: None });
				ops.push(Op::Shape { shape: square(0.0, true), transform: at, paint: Paint::Solid(accent(1.0)), stroke: Some((2.5 * k, Align::Inside)) });
			}
			"diamond" => {
				// A square turned 45° about its centre: the joined end, which slides along the side it joins.
				let (c, sn) = (std::f32::consts::FRAC_1_SQRT_2, std::f32::consts::FRAC_1_SQRT_2);
				let half = px / 2.0;
				let turned = Affine([c, sn, -sn, c, cx - c * half + sn * half, cy - sn * half - c * half]);
				ops.push(Op::Shape { shape: square(2.0 * k, false), transform: turned, paint: Paint::Solid(panel), stroke: None });
				ops.push(Op::Shape { shape: square(2.0 * k, false), transform: turned, paint: Paint::Solid(accent(1.0)), stroke: Some((1.5 * k, Align::Inside)) });
			}
			"anchor" => {
				ops.push(Op::Shape { shape: square(0.0, true), transform: at, paint: Paint::Solid(panel), stroke: None });
				ops.push(Op::Shape { shape: square(0.0, true), transform: at, paint: Paint::Solid(accent(1.0)), stroke: Some((1.5 * k, Align::Inside)) });
			}
			"side" => ops.push(Op::Shape { shape: square(0.0, true), transform: at, paint: Paint::Solid(accent(0.55)), stroke: None }),
			"side-on" => ops.push(Op::Shape { shape: square(0.0, true), transform: at, paint: Paint::Solid(accent(1.0)), stroke: None }),
			_ => {}
		}
	}
}

/*
 * Lines and dashes are painted as small boxes, one a straight piece, never as triangles: a frame with any
 * triangle in it is drawn with four samples a pixel over the whole page canvas (`gpu`, `samples_for`), and
 * a dashed draft or a guide made every frame of a drag do that, which on a large screen held the frame to
 * about 48 ms. A box's soft edge is its own, at any angle.
 */
fn line(ops: &mut Vec<Op>, path: &BezPath, width: f32, cap: LineCap, dash: Option<&[f64]>, color: Color) {
	stroke_boxes(ops, path, Affine::IDENTITY, width, matches!(cap, LineCap::Round), dash, color);
}

fn dashed_path(ops: &mut Vec<Op>, path: &BezPath, at: Affine, width: f32, dash: &[f64], color: Color) {
	stroke_boxes(ops, path, at, width, false, Some(dash), color);
}

fn dashed_box(ops: &mut Vec<Op>, w: f32, h: f32, r: f32, at: Affine, width: f32, dash: &[f64], color: Color) {
	dashed_path(ops, &mesh::rounded_rect_path(w as f64, h as f64, r as f64), at, width, dash, color);
}

/// `path` stroked `width` wide as boxes along its flattened pieces, dashed by `dash` (on, off, …) when given,
/// each box's ends rounded when `round`; `at` places it.
fn stroke_boxes(ops: &mut Vec<Op>, path: &BezPath, at: Affine, width: f32, round: bool, dash: Option<&[f64]>, color: Color) {
	let mut polylines: Vec<Vec<(f64, f64)>> = Vec::new();
	kurbo::flatten(path.iter(), 0.25, |el| match el {
		kurbo::PathEl::MoveTo(p) => polylines.push(vec![(p.x, p.y)]),
		kurbo::PathEl::LineTo(p) => {
			if let Some(last) = polylines.last_mut() {
				last.push((p.x, p.y));
			}
		}
		kurbo::PathEl::ClosePath => {
			if let Some(last) = polylines.last_mut()
				&& let Some(&first) = last.first()
			{
				last.push(first);
			}
		}
		_ => {}
	});
	let pattern: Vec<f64> = dash.map(|d| d.iter().copied().filter(|n| *n > 0.0).collect()).unwrap_or_default();
	let piece = |ops: &mut Vec<Op>, a: (f64, f64), b: (f64, f64)| {
		let (dx, dy) = (b.0 - a.0, b.1 - a.1);
		let len = (dx * dx + dy * dy).sqrt();
		if len < 1e-3 && !round {
			return;
		}
		let (c, s) = if len < 1e-3 { (1.0, 0.0) } else { (dx / len, dy / len) };
		let half = width / 2.0;
		let ext = if round { half } else { 0.0 };
		// The box in its own space runs along x from -ext to len + ext, and across y from -half to half.
		let local = Affine([c as f32, s as f32, -s as f32, c as f32, a.0 as f32, a.1 as f32]).then(&Affine::translate(-ext, -half));
		let shape = Shape { w: len as f32 + 2.0 * ext, h: width, radii: [if round { half } else { 0.0 }; 4], ellipse: false };
		ops.push(Op::Shape { shape, transform: at.then(&local), paint: Paint::Solid(color), stroke: None });
	};
	for points in &polylines {
		if points.len() < 2 {
			continue;
		}
		if pattern.len() < 2 {
			for pair in points.windows(2) {
				piece(ops, pair[0], pair[1]);
			}
			continue;
		}
		// Dashed: walk the polyline, painting the "on" lengths of the pattern, carried across its corners.
		let (mut index, mut left, mut on) = (0usize, pattern[0], true);
		for pair in points.windows(2) {
			let (a, b) = (pair[0], pair[1]);
			let len = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
			let mut at_len = 0.0;
			while at_len < len {
				let step = left.min(len - at_len);
				if on {
					let t0 = at_len / len;
					let t1 = (at_len + step) / len;
					piece(ops, (a.0 + (b.0 - a.0) * t0, a.1 + (b.1 - a.1) * t0), (a.0 + (b.0 - a.0) * t1, a.1 + (b.1 - a.1) * t1));
				}
				at_len += step;
				left -= step;
				if left <= 1e-6 {
					index = (index + 1) % pattern.len();
					left = pattern[index];
					on = !on;
				}
			}
		}
	}
}

#[cfg(test)]
mod overlay_tests {
	use super::*;

	#[test]
	fn a_selection_and_its_handles_are_painted_at_the_camera() {
		let o = Overlay::parse(r#"{"boxes":[{"x":10,"y":10,"w":100,"h":50,"r":4,"kind":"selection"}],"dots":[{"x":10,"y":10,"px":10,"kind":"handle-round"}],"lines":[{"x1":0,"y1":0,"x2":10,"y2":0,"kind":"guide"}],"paths":[{"x":0,"y":0,"d":"M0 0L10 10","kind":"route"}]}"#).unwrap();
		let mut ops = Vec::new();
		paint_overlay(&o, 0.0, 0.0, 2.0, 1.0, &mut ops);
		// The box, two ops for the dot, a box for the solid line, and three dashes for the path (28 long, 6 on, 6 off).
		assert_eq!(ops.len(), 7);
		assert!(ops.iter().all(|op| !matches!(op, Op::Mesh { .. })));
		match &ops[0] {
			Op::Shape { shape, transform, stroke, .. } => {
				assert_eq!((shape.w, shape.h), (200.0, 100.0));
				assert_eq!(transform.0[4], 20.0);
				assert_eq!(*stroke, Some((1.5, Align::Outside)));
			}
			other => panic!("{other:?}"),
		}
	}

	#[test]
	fn no_overlay_piece_is_painted_with_triangles() {
		// A triangle anywhere in a frame draws the whole page canvas with four samples a pixel (`gpu`, `samples_for`).
		let o = Overlay::parse(r#"{"boxes":[{"x":0,"y":0,"w":80,"h":40,"kind":"draft"},{"x":0,"y":0,"w":80,"h":40,"kind":"draft-ellipse"},{"x":0,"y":0,"w":80,"h":40,"kind":"kin-child"},{"x":0,"y":0,"w":80,"h":40,"kind":"slot-frame"}],"lines":[{"x1":0,"y1":0,"x2":90,"y2":30,"kind":"slot"},{"x1":0,"y1":0,"x2":90,"y2":0,"kind":"insert"},{"x1":0,"y1":0,"x2":0,"y2":90,"kind":"guide"},{"x1":0,"y1":0,"x2":90,"y2":0,"kind":"measure-dashed"},{"x1":0,"y1":0,"x2":90,"y2":90,"kind":"draft"}],"paths":[{"x":0,"y":0,"d":"M0 0C60 0 60 80 120 80","kind":"route"}]}"#).unwrap();
		let mut ops = Vec::new();
		paint_overlay(&o, 0.0, 0.0, 1.0, 2.0, &mut ops);
		assert!(ops.len() > 20);
		assert!(ops.iter().all(|op| !matches!(op, Op::Mesh { .. })));
	}

	#[test]
	fn a_dashed_line_paints_its_on_lengths_along_it() {
		// 120 long, 6 on and 6 off: ten dashes, each 6 long and 2 wide, laid along the line.
		let o = Overlay::parse(r#"{"lines":[{"x1":0,"y1":0,"x2":120,"y2":0,"kind":"draft"}]}"#).unwrap();
		let mut ops = Vec::new();
		paint_overlay(&o, 0.0, 0.0, 1.0, 1.0, &mut ops);
		assert_eq!(ops.len(), 10);
		let mut painted = 0.0;
		for op in &ops {
			match op {
				Op::Shape { shape, transform, .. } => {
					assert!((shape.h - 2.0).abs() < 1e-4);
					painted += shape.w;
					let (_, y) = transform.apply(0.0, 0.0);
					assert!((y + 1.0).abs() < 1e-3, "on the line, centred across it: {y}");
				}
				other => panic!("{other:?}"),
			}
		}
		assert!((painted - 60.0).abs() < 1e-3, "half of it painted: {painted}");
	}

	#[test]
	fn screen_sizes_are_css_pixels_on_any_screen() {
		let o = Overlay::parse(r#"{"boxes":[{"x":0,"y":0,"w":10,"h":10,"kind":"selection"}],"dots":[{"x":0,"y":0,"px":9,"kind":"handle"}]}"#).unwrap();
		let mut ops = Vec::new();
		// A 2× screen at zoom 1: the scale is 2, and a 9 px handle and a 1.5 px line are twice that in device pixels.
		paint_overlay(&o, 0.0, 0.0, 2.0, 2.0, &mut ops);
		match (&ops[0], &ops[1]) {
			(Op::Shape { stroke, .. }, Op::Shape { shape, .. }) => {
				assert_eq!(*stroke, Some((3.0, Align::Outside)));
				assert_eq!((shape.w, shape.h), (18.0, 18.0));
				assert_eq!(shape.radii, [4.0; 4]);
			}
			other => panic!("{other:?}"),
		}
	}

	#[test]
	fn an_unknown_kind_paints_nothing_and_a_bad_json_is_none() {
		let o = Overlay::parse(r#"{"boxes":[{"x":0,"y":0,"w":1,"h":1,"kind":"nope"}]}"#).unwrap();
		let mut ops = Vec::new();
		paint_overlay(&o, 0.0, 0.0, 1.0, 1.0, &mut ops);
		assert!(ops.is_empty());
		assert!(Overlay::parse("{").is_none());
	}
}
