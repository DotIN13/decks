//! Arrows that stay joined to what they join: pen's router (`packages/pen/src/arrows.ts`), ported
//! so a drag can bend the arrows on what it carries in the page's own scene, every frame, with
//! nothing crossing from the page's JavaScript.
//!
//! An arrow is a `path` whose `metadata` is `{ type: "decks.arrow", from, to }`: each end names an
//! item or board, `{ item, side, at }` for one that keeps to a side, or `[x, y]` for a point. Its
//! style is `route` (straight, curved, elbow), `heads` (end, both, none) and `bend` (an elbow's turn
//! from 0 to 1, or a curve's pull `[dx, dy]`). The two routers must agree to the 0.1 px pen rounds
//! to: `tests.rs` checks this one against cases pen writes (`fixtures/arrows.json`).

use crate::Rect;
use serde_json::Value;

pub const ARROW: &str = "decks.arrow";

/// The head's length and half-width, per unit of stroke width, with a floor for thin lines.
const HEAD: f64 = 5.0;

pub type Pt = [f64; 2];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
	Straight,
	Curved,
	Elbow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Heads {
	End,
	Both,
	None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
	Top,
	Right,
	Bottom,
	Left,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Bend {
	Turn(f64),
	Pull(f64, f64),
}

/// Whether an item's fields make it an arrow.
pub fn is_arrow(props: &serde_json::Map<String, Value>) -> bool {
	props.get("type").and_then(Value::as_str) == Some("path") && props.get("metadata").and_then(|m| m.get("type")).and_then(Value::as_str) == Some(ARROW)
}

/// The items or boards an arrow's two ends join; `None` for a point end.
pub fn end_items(metadata: &Value) -> [Option<&str>; 2] {
	[end_item(metadata.get("from")), end_item(metadata.get("to"))]
}

fn end_item(end: Option<&Value>) -> Option<&str> {
	match end? {
		Value::String(s) => Some(s),
		Value::Object(o) => o.get("item").and_then(Value::as_str),
		_ => None,
	}
}

fn point_end(end: Option<&Value>) -> Option<Pt> {
	let a = end?.as_array()?;
	if a.len() != 2 {
		return None;
	}
	Some([a[0].as_f64()?, a[1].as_f64()?])
}

fn end_side(end: Option<&Value>) -> Option<Side> {
	match end?.get("side")?.as_str()? {
		"top" => Some(Side::Top),
		"right" => Some(Side::Right),
		"bottom" => Some(Side::Bottom),
		"left" => Some(Side::Left),
		_ => None,
	}
}

fn end_at(end: Option<&Value>) -> Option<f64> {
	let at = end?.as_object()?.get("at")?.as_f64()?;
	at.is_finite().then(|| at.clamp(0.0, 1.0))
}

fn bend_of(metadata: &Value) -> Option<Bend> {
	match metadata.get("bend")? {
		Value::Number(n) => n.as_f64().filter(|v| v.is_finite()).map(|v| Bend::Turn(v.clamp(0.0, 1.0))),
		Value::Array(a) if a.len() == 2 => Some(Bend::Pull(a[0].as_f64()?, a[1].as_f64()?)),
		_ => None,
	}
}

/// An arrow's route and heads from its metadata, with the defaults for what it does not say.
pub fn style(metadata: &Value) -> (Route, Heads) {
	let route = match metadata.get("route").and_then(Value::as_str) {
		Some("curved") => Route::Curved,
		Some("elbow") => Route::Elbow,
		_ => Route::Straight,
	};
	let heads = match metadata.get("heads").and_then(Value::as_str) {
		Some("both") => Heads::Both,
		Some("none") => Heads::None,
		_ => Heads::End,
	};
	(route, heads)
}

/// The line an arrow's metadata describes, through where its ends are now (`find` gives an item's
/// or board's box on the stage); `None` when an end cannot be found.
pub fn points(metadata: &Value, find: &dyn Fn(&str) -> Option<Rect>) -> Option<Vec<Pt>> {
	let end = |e: Option<&Value>| -> Option<Rect> {
		if let Some([x, y]) = point_end(e) {
			return Some(Rect { x, y, w: 0.0, h: 0.0 });
		}
		find(end_item(e)?)
	};
	let (from_v, to_v) = (metadata.get("from"), metadata.get("to"));
	let from = end(from_v)?;
	let to = end(to_v)?;
	let (route, _) = style(metadata);
	let (fs, ts) = (end_side(from_v), end_side(to_v));
	let bend = bend_of(metadata);
	let pts = if fs.is_some() || ts.is_some() { sided(from, to, route, fs, ts, end_at(from_v), end_at(to_v), bend) } else { auto(from, to, route, bend) };
	Some(pulled(pts, route, bend))
}

/// A curve's middle pulled by a `[dx, dy]` bend: both controls move by 4/3 of the pull.
fn pulled(points: Vec<Pt>, route: Route, bend: Option<Bend>) -> Vec<Pt> {
	let Some(Bend::Pull(bx, by)) = bend else { return points };
	if route != Route::Curved {
		return points;
	}
	let (p, q) = (points[0], points[points.len() - 1]);
	let controls = if points.len() == 4 { [points[1], points[2]] } else { [[p[0] + (q[0] - p[0]) / 3.0, p[1] + (q[1] - p[1]) / 3.0], [p[0] + (q[0] - p[0]) * 2.0 / 3.0, p[1] + (q[1] - p[1]) * 2.0 / 3.0]] };
	let k = 4.0 / 3.0;
	vec![p, [controls[0][0] + bx * k, controls[0][1] + by * k], [controls[1][0] + bx * k, controls[1][1] + by * k], q]
}

fn side_point(b: Rect, side: Side, at: f64) -> Pt {
	match side {
		Side::Top => [b.x + b.w * at, b.y],
		Side::Bottom => [b.x + b.w * at, b.y + b.h],
		Side::Left => [b.x, b.y + b.h * at],
		Side::Right => [b.x + b.w, b.y + b.h * at],
	}
}

fn normal(side: Side) -> Pt {
	match side {
		Side::Top => [0.0, -1.0],
		Side::Right => [1.0, 0.0],
		Side::Bottom => [0.0, 1.0],
		Side::Left => [-1.0, 0.0],
	}
}

/// The side of `b` that faces a point: across when the point is further across than down.
fn facing(b: Rect, toward: Pt) -> Side {
	let dx = toward[0] - (b.x + b.w / 2.0);
	let dy = toward[1] - (b.y + b.h / 2.0);
	if dx.abs() * b.h.max(1.0) >= dy.abs() * b.w.max(1.0) {
		if dx >= 0.0 { Side::Right } else { Side::Left }
	} else if dy >= 0.0 {
		Side::Bottom
	} else {
		Side::Top
	}
}

#[allow(clippy::too_many_arguments)]
fn sided(a: Rect, b: Rect, route: Route, a_side: Option<Side>, b_side: Option<Side>, from_at: Option<f64>, to_at: Option<f64>, bend: Option<Bend>) -> Vec<Pt> {
	// An end's `at` counts only on the side it keeps to: a side chosen for it moves as things move.
	let a_at = if a_side.is_some() { from_at.unwrap_or(0.5) } else { 0.5 };
	let b_at = if b_side.is_some() { to_at.unwrap_or(0.5) } else { 0.5 };
	let sa = a_side.unwrap_or_else(|| facing(a, match b_side { Some(s) => side_point(b, s, b_at), None => [b.x + b.w / 2.0, b.y + b.h / 2.0] }));
	let sb = b_side.unwrap_or_else(|| facing(b, side_point(a, sa, a_at)));
	let p = if a.w == 0.0 && a.h == 0.0 { [a.x, a.y] } else { side_point(a, sa, a_at) };
	let q = if b.w == 0.0 && b.h == 0.0 { [b.x, b.y] } else { side_point(b, sb, b_at) };
	let turn = if let Some(Bend::Turn(t)) = bend { t } else { 0.5 };
	match route {
		Route::Straight => vec![p, q],
		Route::Curved => {
			let (na, nb) = (normal(sa), normal(sb));
			let reach = 24f64.max((q[0] - p[0]).hypot(q[1] - p[1]) / 3.0);
			vec![p, [p[0] + na[0] * reach, p[1] + na[1] * reach], [q[0] + nb[0] * reach, q[1] + nb[1] * reach], q]
		}
		Route::Elbow => {
			let across = |s: Side| matches!(s, Side::Left | Side::Right);
			if across(sa) && across(sb) {
				let mid = p[0] + (q[0] - p[0]) * turn;
				if p[1] == q[1] { vec![p, q] } else { vec![p, [mid, p[1]], [mid, q[1]], q] }
			} else if !across(sa) && !across(sb) {
				let mid = p[1] + (q[1] - p[1]) * turn;
				if p[0] == q[0] { vec![p, q] } else { vec![p, [p[0], mid], [q[0], mid], q] }
			} else if across(sa) {
				vec![p, [q[0], p[1]], q]
			} else {
				vec![p, [p[0], q[1]], q]
			}
		}
	}
}

/// From the edge of `a` that faces `b` to the edge of `b` that faces `a` (pen's `arrowRoute`).
fn auto(a: Rect, b: Rect, route: Route, bend: Option<Bend>) -> Vec<Pt> {
	let turn = if let Some(Bend::Turn(t)) = bend { t } else { 0.5 };
	let curve = |start: Pt, end: Pt, across: bool| -> Vec<Pt> {
		let reach = 24f64.max(if across { (end[0] - start[0]).abs() } else { (end[1] - start[1]).abs() } / 2.0);
		let sign = |v: f64| if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { 1.0 };
		let s = if across { sign(end[0] - start[0]) } else { sign(end[1] - start[1]) };
		let c1 = if across { [start[0] + s * reach, start[1]] } else { [start[0], start[1] + s * reach] };
		let c2 = if across { [end[0] - s * reach, end[1]] } else { [end[0], end[1] - s * reach] };
		vec![start, c1, c2, end]
	};
	let ac = [a.x + a.w / 2.0, a.y + a.h / 2.0];
	let bc = [b.x + b.w / 2.0, b.y + b.h / 2.0];
	let (dx, dy) = (bc[0] - ac[0], bc[1] - ac[1]);
	let gap_x = (b.x - (a.x + a.w)).max(a.x - (b.x + b.w));
	let gap_y = (b.y - (a.y + a.h)).max(a.y - (b.y + b.h));
	let shared = |a0: f64, a1: f64, b0: f64, b1: f64| -> Option<f64> {
		let (lo, hi) = (a0.max(b0), a1.min(b1));
		(hi > lo).then(|| (lo + hi) / 2.0)
	};
	if gap_x >= gap_y {
		let level = shared(a.y, a.y + a.h, b.y, b.y + b.h);
		let start = [if dx >= 0.0 { a.x + a.w } else { a.x }, level.unwrap_or(ac[1])];
		let end = [if dx >= 0.0 { b.x } else { b.x + b.w }, level.unwrap_or(bc[1])];
		if route == Route::Curved && start[1] != end[1] {
			return curve(start, end, true);
		}
		if route != Route::Elbow || start[1] == end[1] {
			return vec![start, end];
		}
		let mid = start[0] + (end[0] - start[0]) * turn;
		return vec![start, [mid, start[1]], [mid, end[1]], end];
	}
	let column = shared(a.x, a.x + a.w, b.x, b.x + b.w);
	let start = [column.unwrap_or(ac[0]), if dy >= 0.0 { a.y + a.h } else { a.y }];
	let end = [column.unwrap_or(bc[0]), if dy >= 0.0 { b.y } else { b.y + b.h }];
	if route == Route::Curved && start[0] != end[0] {
		return curve(start, end, false);
	}
	if route != Route::Elbow || start[0] == end[0] {
		return vec![start, end];
	}
	let mid = start[1] + (end[1] - start[1]) * turn;
	vec![start, [start[0], mid], [end[0], mid], end]
}

/// A path's fields: its corner on the stage, its size and its geometry (pen's `arrowShape`).
#[derive(Clone, Debug, PartialEq)]
pub struct Shape {
	pub x: f64,
	pub y: f64,
	pub width: f64,
	pub height: f64,
	pub geometry: String,
}

/// A line through `points` with its heads, as pen writes it: the line first, then each head.
pub fn shape(points: &[Pt], stroke: f64, route: Route, heads: Heads) -> Shape {
	let head = 8f64.max(stroke * HEAD);
	let curved = route == Route::Curved && points.len() == 4;
	let mut arms: Vec<[Pt; 3]> = Vec::new();
	if heads != Heads::None {
		arms.push(head_points(points, head));
	}
	if heads == Heads::Both {
		let back: Vec<Pt> = points.iter().rev().copied().collect();
		arms.push(head_points(&back, head));
	}
	let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
	for p in points.iter().chain(arms.iter().flatten()) {
		min_x = min_x.min(p[0]);
		min_y = min_y.min(p[1]);
		max_x = max_x.max(p[0]);
		max_y = max_y.max(p[1]);
	}
	let pad = stroke;
	let (min_x, min_y, max_x, max_y) = (min_x - pad, min_y - pad, max_x + pad, max_y + pad);
	let local = |p: Pt| format!("{} {}", num(round(p[0] - min_x)), num(round(p[1] - min_y)));
	let mut geometry = if curved {
		format!("M{} C{} {} {}", local(points[0]), local(points[1]), local(points[2]), local(points[3]))
	} else {
		format!("M{}", points.iter().map(|p| local(*p)).collect::<Vec<_>>().join(" L"))
	};
	for [a, b, c] in &arms {
		geometry.push_str(&format!(" M{} L{} L{}", local(*a), local(*b), local(*c)));
	}
	Shape { x: round(min_x), y: round(min_y), width: round(max_x - min_x), height: round(max_y - min_y), geometry }
}

/// The chevron at the end of the last segment: one arm, the tip, the other arm.
fn head_points(points: &[Pt], head: f64) -> [Pt; 3] {
	let tip = points[points.len() - 1];
	let from = points[points.len() - 2];
	let len = match (tip[0] - from[0]).hypot(tip[1] - from[1]) {
		l if l == 0.0 => 1.0,
		l => l,
	};
	let (ux, uy) = ((tip[0] - from[0]) / len, (tip[1] - from[1]) / len);
	let back = [tip[0] - ux * head, tip[1] - uy * head];
	let half = head * 0.6;
	[[back[0] - uy * half, back[1] + ux * half], tip, [back[0] + uy * half, back[1] - ux * half]]
}

/// JavaScript's `Math.round(n * 10) / 10`: halves go up, toward positive infinity.
pub fn round(n: f64) -> f64 {
	(n * 10.0 + 0.5).floor() / 10.0
}

/// A number as JavaScript writes it in a template string (`-0` is `0`).
fn num(n: f64) -> String {
	if n == 0.0 { "0".into() } else { format!("{n}") }
}
