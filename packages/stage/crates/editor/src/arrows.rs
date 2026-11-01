//! Editing an arrow (`edit/core/arrows.ts`): what its ends join, the side they keep to, a join slid
//! along its side, its middle pulled, and the ops that letting go writes. Each move of the pointer is
//! one call here, with the camera's zoom passed in (reaches are in screen pixels, from the rules
//! table); the pointer loops are the page's.
//!
//! The routes are the scene crate's (`stage_scene::arrows`, pen's router ported), as the drawing's
//! are: a handle's dashed draft is the line the arrow will be drawn on once the op lands.

use crate::model::{Offset, Op, Pt, Rect, Side};
use crate::pen;
use crate::pick::{PickOptions, Policy, pick_at};
use crate::rules::Rules;
use crate::scene::{Props, Scene};
use serde::{Serialize, Serializer};
use serde_json::{Map, Value};
use stage_scene::arrows as router;

/// The sides an end can keep to, in the order a tie is settled (`@decks/pen`'s `ARROW_SIDES`).
const ARROW_SIDES: [Side; 4] = [Side::Top, Side::Right, Side::Bottom, Side::Left];

/// However small a box, an end let go this many screen pixels from a side's middle still keeps to it.
const SIDE_FLOOR_PX: f64 = 6.0;

/// Which end of an arrow.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Which {
	From,
	To,
}

impl Which {
	/// Its key in the arrow's metadata.
	pub fn key(self) -> &'static str {
		match self {
			Which::From => "from",
			Which::To => "to",
		}
	}
	/// The other end.
	pub fn other(self) -> Which {
		match self {
			Which::From => Which::To,
			Which::To => Which::From,
		}
	}
}

/// How an arrow's line runs (`@decks/pen`'s `ArrowRoute`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArrowRoute {
	Straight,
	Curved,
	Elbow,
}

impl ArrowRoute {
	pub fn name(self) -> &'static str {
		match self {
			ArrowRoute::Straight => "straight",
			ArrowRoute::Curved => "curved",
			ArrowRoute::Elbow => "elbow",
		}
	}
	/// The route an arrow's metadata names, straight when it names none.
	pub fn of(metadata: &Value) -> ArrowRoute {
		match router::style(metadata).0 {
			router::Route::Straight => ArrowRoute::Straight,
			router::Route::Curved => ArrowRoute::Curved,
			router::Route::Elbow => ArrowRoute::Elbow,
		}
	}
}

/// What an end would join at a point: an item or a board, its box to light up, and the side it is near.
#[derive(Clone, Debug, PartialEq)]
pub struct Join {
	pub name: String,
	pub area: Rect,
	pub side: Option<Side>,
}

/// An end as the arrow's metadata writes it: an item, an item and a side (and where along it), or a point.
#[derive(Clone, Debug, PartialEq)]
pub enum ArrowEnd {
	Item(String),
	Side { item: String, side: Side, at: Option<f64> },
	Point([f64; 2]),
}

impl ArrowEnd {
	/// The end as JSON, as `@decks/pen` writes it: `"a"`, `{ "item": "a", "side": "top" }` or `[x, y]`.
	pub fn to_value(&self) -> Value {
		match self {
			ArrowEnd::Item(name) => Value::String(name.clone()),
			ArrowEnd::Side { item, side, at } => {
				let mut end = Map::new();
				end.insert("item".into(), item.clone().into());
				end.insert("side".into(), side_name(*side).into());
				if let Some(at) = at {
					end.insert("at".into(), js_num(*at));
				}
				Value::Object(end)
			}
			ArrowEnd::Point([x, y]) => Value::Array(vec![js_num(*x), js_num(*y)]),
		}
	}
}

impl Serialize for ArrowEnd {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		self.to_value().serialize(serializer)
	}
}

/// What a joined end of the selected arrow joins, for its drag to slide along (`slide_join`).
#[derive(Clone, Debug, PartialEq)]
pub struct JoinedEnd {
	pub item: String,
	pub area: Rect,
	pub side: Side,
	pub at: Option<f64>,
}

/// A join slid along its side: what `slide_join` gives, written as the end it becomes.
#[derive(Clone, Debug, PartialEq)]
pub struct SlidJoin {
	pub item: String,
	pub side: Side,
	pub at: f64,
}

impl SlidJoin {
	pub fn end(&self) -> ArrowEnd {
		ArrowEnd::Side { item: self.item.clone(), side: self.side, at: Some(self.at) }
	}
}

/// The handles of a selected arrow: its two ends, what they join, and its middle when it has one to pull.
#[derive(Clone, Debug, PartialEq)]
pub struct ArrowHandles {
	pub id: String,
	pub route: ArrowRoute,
	pub from: Pt,
	pub to: Pt,
	pub from_join: Option<JoinedEnd>,
	pub to_join: Option<JoinedEnd>,
	pub middle: Option<Pt>,
	pub bent: bool,
}

/// A route drawn dashed while a handle is dragged: the path's geometry and where it sits.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RouteDraft {
	pub d: String,
	pub x: f64,
	pub y: f64,
}

/// The start of a middle handle's drag: the metadata with no bend, and the automatic route it gives.
#[derive(Clone, Debug, PartialEq)]
pub struct BendStart {
	pub unbent: Map<String, Value>,
	pub auto: Vec<[f64; 2]>,
}

/// The two ends of a new arrow.
#[derive(Clone, Debug, PartialEq)]
pub struct NewEnds {
	pub from: ArrowEnd,
	pub to: ArrowEnd,
}

/// The board under a stage point, the last on top: an arrow may start or end on it.
pub fn page_at(scene: &dyn Scene, point: Pt) -> Option<String> {
	scene.boards().into_iter().rfind(|b| point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h).map(|b| b.path)
}

/// Where an end's item or board is placed: an item's box first, then a board's.
pub fn end_box(scene: &dyn Scene, name: &str) -> Option<Rect> {
	scene.placed(name).or_else(|| scene.boards().into_iter().find(|one| one.path == name).map(|b| b.rect()))
}

/// The line an arrow's metadata describes through where its ends are now (the scene crate's router).
pub fn arrow_line(scene: &dyn Scene, metadata: &Value) -> Option<Vec<[f64; 2]>> {
	router::points(metadata, &|name| end_box(scene, name))
}

/// The side of a box whose middle a point is close to, if any: an end let go there keeps to that
/// side. Close is `side_px` on screen, or a quarter of a small box, but never under 6.
pub fn side_near(area: Rect, point: Pt, zoom: f64, rules: &Rules) -> Option<Side> {
	let reach = (rules.side_px / zoom).min((SIDE_FLOOR_PX / zoom).max(area.w.min(area.h) / 4.0));
	let mut best: Option<(Side, f64)> = None;
	for side in ARROW_SIDES {
		let [x, y] = side_point(area, side, 0.5);
		let d = (point.x - x).hypot(point.y - y);
		if d <= reach && best.is_none_or(|(_, was)| d < was) {
			best = Some((side, d));
		}
	}
	best.map(|(side, _)| side)
}

/// The side of a box a point on its edge lies on: the nearest, top before bottom before left before right on a tie.
pub fn on_side(area: Rect, point: Pt) -> Side {
	let d = [(Side::Top, (point.y - area.y).abs()), (Side::Bottom, (point.y - area.bottom()).abs()), (Side::Left, (point.x - area.x).abs()), (Side::Right, (point.x - area.right()).abs())];
	let mut best = d[0];
	for one in &d[1..] {
		if one.1 < best.1 {
			best = *one;
		}
	}
	best.0
}

/// What an arrow's end joins at a point: the item a press picks there (the outermost group round
/// it), or else the board, with the side it is near. Never an arrow (one line does not join
/// another) and never `not`, the arrow whose end it is.
pub fn join_at(scene: &dyn Scene, point: Pt, zoom: f64, not: Option<&str>, rules: &Rules) -> Option<Join> {
	let skip = |id: &str, node: &Props| pen::is_arrow(node) || Some(id) == not;
	let hit = pick_at(scene, point, PickOptions { policy: Policy::Outermost, deep: false, skip: Some(&skip) });
	let (name, area) = match hit {
		Some(hit) => (hit.id, hit.bounds),
		None => {
			let path = page_at(scene, point)?;
			let board = scene.boards().into_iter().find(|b| b.path == path)?;
			(board.path.clone(), board.rect())
		}
	};
	let side = side_near(area, point, zoom, rules);
	Some(Join { name, area, side })
}

/// How a join is written as an arrow's end: an item, or an item and the side it keeps to.
pub fn end_of(join: &Join) -> ArrowEnd {
	match join.side {
		Some(side) => ArrowEnd::Side { item: join.name.clone(), side, at: None },
		None => ArrowEnd::Item(join.name.clone()),
	}
}

/// A point end, to a tenth of a pixel.
pub fn point_end(point: Pt) -> ArrowEnd {
	ArrowEnd::Point([router::round(point.x), router::round(point.y)])
}

/// The handles of an arrow as drawn, moved by `drag` (the selection's carried offset). `None` for
/// anything that is not an arrow, or an arrow an end of which cannot be found. A joined end's side
/// is the one it names, or else the side its point is on. The middle handle is there when an elbow
/// has a middle segment to slide, and always on a line or a curve.
pub fn arrow_handles(scene: &dyn Scene, id: &str, drag: Offset) -> Option<ArrowHandles> {
	let node = scene.node(id)?;
	if !pen::is_arrow(node) {
		return None;
	}
	let metadata = node.get("metadata").cloned().unwrap_or(Value::Null);
	// On the line as it is drawn, so a handle sits on the arrow the person sees; the route its
	// metadata would take now only for an arrow not drawn yet.
	let points = scene.placed(id).and_then(|placed| drawn_line(node, placed)).or_else(|| arrow_line(scene, &metadata))?;
	let [fx, fy] = points[0];
	let [tx, ty] = points[points.len() - 1];
	let route = ArrowRoute::of(&metadata);
	let [mx, my] = arrow_middle(&points, route);
	let joined = |end: Option<&Value>, x: f64, y: f64| -> Option<JoinedEnd> {
		let item = end_item(end)?;
		let area = end_box(scene, item)?;
		let side = end_side(end).unwrap_or_else(|| on_side(area, Pt::new(x, y)));
		Some(JoinedEnd { item: item.into(), area, side, at: end_at(end) })
	};
	let bendable = route != ArrowRoute::Elbow || points.len() == 4;
	Some(ArrowHandles {
		id: id.into(),
		route,
		from: Pt::new(fx + drag.dx, fy + drag.dy),
		to: Pt::new(tx + drag.dx, ty + drag.dy),
		from_join: joined(metadata.get("from"), fx, fy),
		to_join: joined(metadata.get("to"), tx, ty),
		middle: bendable.then(|| Pt::new(mx + drag.dx, my + drag.dy)),
		bent: arrow_bent(&metadata),
	})
}

/// An arrow's line as it is drawn, on the stage: the points of its geometry's first subpath (a
/// curve's start, two controls and end; a line's corners), through its box and `viewBox`. `None`
/// when it has no geometry or the subpath is neither.
pub fn drawn_line(node: &Props, area: Rect) -> Option<Vec<[f64; 2]>> {
	let geometry = node.get("geometry")?.as_str()?.trim();
	let line = first_subpath(geometry);
	let allowed = |c: char| matches!(c, 'M' | 'm' | 'L' | 'l' | 'C' | 'c' | 'e' | 'E' | '.' | ',' | '+' | '-') || c.is_ascii_digit() || c.is_whitespace();
	if !line.starts_with(['M', 'm']) || !line.chars().all(allowed) {
		return None;
	}
	let n = numbers(line, true);
	if n.len() < 4 || !n.len().is_multiple_of(2) {
		return None;
	}
	let vb: Vec<f64> = match node.get("viewBox").and_then(Value::as_array) {
		Some(vb) if vb.len() == 4 => vb.iter().map(|v| v.as_f64().unwrap_or(f64::NAN)).collect(),
		_ => vec![0.0, 0.0, area.w, area.h],
	};
	let sx = if truthy(vb[2]) { area.w / vb[2] } else { 1.0 };
	let sy = if truthy(vb[3]) { area.h / vb[3] } else { 1.0 };
	Some(n.chunks(2).map(|p| [area.x + (p[0] - vb[0]) * sx, area.y + (p[1] - vb[1]) * sy]).collect())
}

/// The route an arrow would take with this metadata, as a dashed draft: what a handle's drag shows.
pub fn route_draft(scene: &dyn Scene, metadata: &Value, node: &Props) -> Option<RouteDraft> {
	let points = arrow_line(scene, metadata)?;
	let stroke = node.get("strokeWidth").and_then(Value::as_f64).unwrap_or(2.0);
	let (route, heads) = router::style(metadata);
	let shape = router::shape(&points, stroke, route, heads);
	Some(RouteDraft { d: shape.geometry, x: shape.x, y: shape.y })
}

/// Where along a side a point slides a join: 0 at its top or left end, 1 at the other, to a
/// thousandth. It clicks to the ends and the middle within `join_px` on screen, unless `free`.
pub fn slide_at(area: Rect, side: Side, point: Pt, zoom: f64, free: bool, rules: &Rules) -> f64 {
	let along = matches!(side, Side::Top | Side::Bottom);
	let length = if along { area.w } else { area.h };
	// A side of no length has one place on it: its middle.
	if length.is_nan() || length <= 0.0 {
		return 0.5;
	}
	let mut at = ((if along { point.x - area.x } else { point.y - area.y }) / length).clamp(0.0, 1.0);
	if !free {
		for stop in [0.0, 0.5, 1.0] {
			if (at - stop).abs() * length * zoom <= rules.join_px {
				at = stop;
			}
		}
	}
	js_round(at * 1000.0) / 1000.0
}

/// Whether a point is within `slide_px` on screen of a box's side, along its length (and that far past its ends).
pub fn near_side(area: Rect, side: Side, point: Pt, zoom: f64, rules: &Rules) -> bool {
	let reach = rules.slide_px / zoom;
	let along = matches!(side, Side::Top | Side::Bottom);
	let line = match side {
		Side::Top => area.y,
		Side::Bottom => area.bottom(),
		Side::Left => area.x,
		Side::Right => area.right(),
	};
	let off = ((if along { point.y } else { point.x }) - line).abs();
	let within = if along { point.x >= area.x - reach && point.x <= area.right() + reach } else { point.y >= area.y - reach && point.y <= area.bottom() + reach };
	off <= reach && within
}

/// One move of a joined end's drag near its side: the join slid there; `None` once it is away from the side.
pub fn slide_join(own: Option<&JoinedEnd>, point: Pt, zoom: f64, free: bool, rules: &Rules) -> Option<SlidJoin> {
	let own = own?;
	near_side(own.area, own.side, point, zoom, rules).then(|| SlidJoin { item: own.item.clone(), side: own.side, at: slide_at(own.area, own.side, point, zoom, free, rules) })
}

/// An arrow's metadata with one end set.
pub fn with_end(metadata: &Map<String, Value>, which: Which, end: Value) -> Map<String, Value> {
	let mut next = metadata.clone();
	next.insert(which.key().into(), end);
	next
}

/// The op that writes an arrow's metadata.
pub fn arrow_op(id: &str, metadata: Map<String, Value>) -> Op {
	let mut set = Map::new();
	set.insert("metadata".into(), Value::Object(metadata));
	Op::set(id, set)
}

/// An end let go at a point, away from its side: it joins what is there, or is a point on bare
/// canvas. An arrow from a thing to itself is a point on it instead.
pub fn dropped_end(scene: &dyn Scene, id: &str, metadata: &Map<String, Value>, which: Which, point: Pt, zoom: f64, rules: &Rules) -> ArrowEnd {
	let other = end_item(metadata.get(which.other().key()));
	match join_at(scene, point, zoom, Some(id), rules) {
		Some(join) if Some(join.name.as_str()) != other => end_of(&join),
		_ => point_end(point),
	}
}

/// A double-click on a joined end: the join goes back to the middle of its side. `None` when it has no `at`.
pub fn reset_end_op(id: &str, metadata: Option<&Map<String, Value>>, which: Which) -> Option<Op> {
	let metadata = metadata?;
	let end = metadata.get(which.key())?.as_object()?;
	if !end.contains_key("at") {
		return None;
	}
	let mut kept = end.clone();
	kept.shift_remove("at");
	Some(arrow_op(id, with_end(metadata, which, Value::Object(kept))))
}

/// The start of a middle handle's drag: the metadata with no bend, and the automatic route it gives.
pub fn bend_start(scene: &dyn Scene, metadata: &Map<String, Value>) -> Option<BendStart> {
	let mut unbent = metadata.clone();
	unbent.shift_remove("bend");
	let auto = arrow_line(scene, &Value::Object(unbent.clone()))?;
	Some(BendStart { unbent, auto })
}

/// One move of the middle handle: an elbow's middle segment slides along its run (`bend`, 0 to 1
/// from start to end, to a thousandth); a curve's middle is pulled (`bend: [dx, dy]`, whole pixels
/// from the automatic middle), and a straight line pulled there becomes a curve.
pub fn bend_at(start: &BendStart, route: ArrowRoute, now: Pt) -> Map<String, Value> {
	let BendStart { unbent, auto } = start;
	let mut next = unbent.clone();
	if route == ArrowRoute::Elbow {
		let (p, q) = (auto[0], auto[auto.len() - 1]);
		// The middle segment runs down when its two points share an x, so it slides across.
		let across = auto.len() == 4 && auto[1][0] == auto[2][0];
		let span = if across { q[0] - p[0] } else { q[1] - p[1] };
		let turn = if span == 0.0 { 0.5 } else { (if across { now.x - p[0] } else { now.y - p[1] }) / span };
		next.insert("bend".into(), js_num(js_round(turn.clamp(0.0, 1.0) * 1000.0) / 1000.0));
		return next;
	}
	let [mx, my] = if route == ArrowRoute::Curved { arrow_middle(auto, ArrowRoute::Curved) } else { arrow_middle(&[auto[0], auto[auto.len() - 1]], ArrowRoute::Straight) };
	next.insert("route".into(), "curved".into());
	next.insert("bend".into(), Value::Array(vec![js_num(js_round(now.x - mx)), js_num(js_round(now.y - my))]));
	next
}

/// A double-click on the middle handle: back on the automatic route. `None` when it is not bent.
pub fn reset_bend_op(id: &str, metadata: Option<&Map<String, Value>>) -> Option<Op> {
	let metadata = metadata?;
	if !metadata.contains_key("bend") {
		return None;
	}
	let mut kept = metadata.clone();
	kept.shift_remove("bend");
	Some(arrow_op(id, kept))
}

/// The ends of a new arrow drawn from `at` to `end`: each joins what it was pressed or let go on,
/// or is a point there. `None` for a click with no drag unless it joins two different things.
pub fn new_arrow_ends(from_join: Option<&Join>, to_join: Option<&Join>, at: Pt, end: Pt, moved: bool) -> Option<NewEnds> {
	if !moved {
		match (from_join, to_join) {
			(Some(from), Some(to)) if from.name != to.name => {}
			_ => return None,
		}
	}
	let from = from_join.map(end_of).unwrap_or_else(|| point_end(at));
	let to = match to_join {
		Some(to) if Some(to.name.as_str()) != from_join.map(|f| f.name.as_str()) => end_of(to),
		_ => point_end(end),
	};
	Some(NewEnds { from, to })
}

// ---- `@decks/pen`'s arrow helpers, as this file needs them ----

fn side_name(side: Side) -> &'static str {
	match side {
		Side::Top => "top",
		Side::Right => "right",
		Side::Bottom => "bottom",
		Side::Left => "left",
	}
}

/// The item or board an end joins, whether it names a side or not; `None` for a point (`arrowEndItem`).
pub(crate) fn end_item(end: Option<&Value>) -> Option<&str> {
	match end? {
		Value::String(name) => Some(name),
		Value::Object(end) => end.get("item").and_then(Value::as_str),
		_ => None,
	}
}

/// The side an end keeps to, when it names one (`arrowEndSide`).
fn end_side(end: Option<&Value>) -> Option<Side> {
	match end?.as_object()?.get("side")?.as_str()? {
		"top" => Some(Side::Top),
		"right" => Some(Side::Right),
		"bottom" => Some(Side::Bottom),
		"left" => Some(Side::Left),
		_ => None,
	}
}

/// Where along its side an end joins, 0 to 1 (`arrowEndAt`).
fn end_at(end: Option<&Value>) -> Option<f64> {
	let at = end?.as_object()?.get("at")?.as_f64()?;
	at.is_finite().then(|| at.clamp(0.0, 1.0))
}

/// Whether an arrow is bent away from its automatic route (`arrowBend` is not undefined).
fn arrow_bent(metadata: &Value) -> bool {
	match metadata.get("bend") {
		Some(Value::Number(n)) => n.as_f64().is_some_and(f64::is_finite),
		Some(Value::Array(pair)) => pair.len() == 2 && pair.iter().all(|n| n.as_f64().is_some_and(f64::is_finite)),
		_ => false,
	}
}

/// A point on one side of a box: `at` of the way along it from its top or left end (`sidePoint`).
fn side_point(area: Rect, side: Side, at: f64) -> [f64; 2] {
	match side {
		Side::Top => [area.x + area.w * at, area.y],
		Side::Bottom => [area.x + area.w * at, area.bottom()],
		Side::Left => [area.x, area.y + area.h * at],
		Side::Right => [area.right(), area.y + area.h * at],
	}
}

/// The middle of an arrow's line as drawn: a curve's at t = 1/2, an elbow's middle segment's, a line's (`arrowMiddle`).
fn arrow_middle(points: &[[f64; 2]], route: ArrowRoute) -> [f64; 2] {
	if route == ArrowRoute::Curved && points.len() == 4 {
		let [a, b, c, d] = [points[0], points[1], points[2], points[3]];
		return [(a[0] + 3.0 * b[0] + 3.0 * c[0] + d[0]) / 8.0, (a[1] + 3.0 * b[1] + 3.0 * c[1] + d[1]) / 8.0];
	}
	if points.len() == 4 {
		return [(points[1][0] + points[2][0]) / 2.0, (points[1][1] + points[2][1]) / 2.0];
	}
	let (p, q) = (points[0], points[points.len() - 1]);
	[(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0]
}

// ---- reading a path's geometry, and numbers as JavaScript writes them ----

/// A geometry's first subpath: up to the next `M` (either case) after its first letter.
pub(crate) fn first_subpath(geometry: &str) -> &str {
	match geometry.char_indices().skip(1).find(|(_, c)| matches!(c, 'M' | 'm')) {
		Some((at, _)) => &geometry[..at],
		None => geometry,
	}
}

/// The numbers in a path, as `/-?\d*\.?\d+(?:e[+-]?\d+)?/gi` finds them (`/-?\d*\.?\d+(?:e-?\d+)?/gi` without `plus`).
pub(crate) fn numbers(text: &str, plus: bool) -> Vec<f64> {
	let s = text.as_bytes();
	let digits = |from: usize| s[from.min(s.len())..].iter().take_while(|c| c.is_ascii_digit()).count();
	let mut found = Vec::new();
	let mut i = 0;
	while i < s.len() {
		let start = i;
		let j = if s[i] == b'-' { i + 1 } else { i };
		let whole = digits(j);
		let k = j + whole;
		let end = if k < s.len() && s[k] == b'.' && digits(k + 1) > 0 {
			k + 1 + digits(k + 1)
		} else if whole > 0 {
			k
		} else {
			i += 1;
			continue;
		};
		let mut stop = end;
		if end < s.len() && (s[end] == b'e' || s[end] == b'E') {
			let mut e = end + 1;
			if e < s.len() && (s[e] == b'-' || (plus && s[e] == b'+')) {
				e += 1;
			}
			let n = digits(e);
			if n > 0 {
				stop = e + n;
			}
		}
		if let Ok(n) = text[start..stop].parse::<f64>() {
			found.push(n);
		}
		i = stop;
	}
	found
}

/// JavaScript's truthiness of a number: not 0 and not NaN.
pub(crate) fn truthy(n: f64) -> bool {
	n != 0.0 && !n.is_nan()
}

/// JavaScript's `Math.round`: halves go up, toward positive infinity.
pub(crate) fn js_round(n: f64) -> f64 {
	(n + 0.5).floor()
}

/// A number as JSON from JavaScript has it: a whole one without a decimal point, `-0` as `0`.
pub(crate) fn js_num(n: f64) -> Value {
	if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 {
		Value::from(n as i64)
	} else {
		serde_json::Number::from_f64(n).map(Value::Number).unwrap_or(Value::Null)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::model::PageBox;
	use crate::rules::{Form, Rules};
	use crate::scene::{Fake, FakeItem};
	use serde_json::json;

	fn rules() -> Rules {
		Rules::for_form(Form::Desk)
	}
	fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
		Rect { x, y, w, h }
	}
	const BOX: Rect = Rect { x: 0.0, y: 0.0, w: 100.0, h: 50.0 };
	const BOARD: &str = "boards/x.html";

	fn meta(v: Value) -> Map<String, Value> {
		v.as_object().unwrap().clone()
	}
	fn props(v: Value) -> Props {
		v.as_object().unwrap().clone()
	}

	/// Two boxes side by side, a board under them, and an arrow `ar` with the given ends and style.
	fn scene_with(more: Value) -> Fake {
		let mut metadata = meta(json!({ "type": pen::ARROW }));
		for (k, v) in meta(more) {
			metadata.insert(k, v);
		}
		let mut arrow = FakeItem::rect("ar", 0.0, 0.0, 400.0, 50.0).kind("path").set("strokeWidth", json!(2)).set("metadata", Value::Object(metadata));
		arrow.line = Some(true);
		Fake::new(vec![FakeItem::rect("a", 0.0, 0.0, 100.0, 50.0), FakeItem::rect("b", 300.0, 0.0, 100.0, 50.0), arrow])
			.with_boards(vec![PageBox { path: BOARD.into(), x: 0.0, y: 200.0, w: 400.0, h: 300.0, least: None }])
	}
	fn scene() -> Fake {
		scene_with(json!({ "from": "a", "to": "b" }))
	}

	#[test]
	fn an_end_near_a_sides_middle_keeps_to_that_side_within_the_side_reach_or_a_quarter_of_a_small_box() {
		let r = rules();
		assert_eq!(side_near(BOX, Pt::new(99.0, 26.0), 1.0, &r), Some(Side::Right));
		assert_eq!(side_near(BOX, Pt::new(50.0, 12.0), 1.0, &r), Some(Side::Top));
		// A quarter of this box is 12.5, under the side reach.
		assert!(BOX.h / 4.0 < r.side_px);
		assert_eq!(side_near(BOX, Pt::new(50.0, 13.0), 1.0, &r), None);
		assert_eq!(side_near(BOX, Pt::new(50.0, 25.0), 1.0, &r), None);
	}

	#[test]
	fn the_side_reach_is_in_screen_pixels_so_zooming_in_narrows_it() {
		let r = rules();
		let wide = rect(0.0, 0.0, 400.0, 400.0);
		assert_eq!(side_near(wide, Pt::new(200.0, r.side_px), 1.0, &r), Some(Side::Top));
		assert_eq!(side_near(wide, Pt::new(200.0, r.side_px + 0.5), 1.0, &r), None);
		assert_eq!(side_near(wide, Pt::new(200.0, r.side_px / 2.0 + 0.5), 2.0, &r), None);
		assert_eq!(side_near(wide, Pt::new(200.0, r.side_px / 2.0), 2.0, &r), Some(Side::Top));
	}

	#[test]
	fn a_small_box_still_has_a_six_pixel_reach_round_each_sides_middle() {
		let r = rules();
		let small = rect(0.0, 0.0, 20.0, 20.0);
		assert_eq!(side_near(small, Pt::new(10.0, 6.0), 1.0, &r), Some(Side::Top));
		assert_eq!(side_near(small, Pt::new(10.0, 7.0), 1.0, &r), None);
	}

	#[test]
	fn a_point_on_a_boxs_edge_is_on_the_nearest_side_top_first_on_a_tie() {
		assert_eq!(on_side(BOX, Pt::new(100.0, 25.0)), Side::Right);
		assert_eq!(on_side(BOX, Pt::new(50.0, 50.0)), Side::Bottom);
		assert_eq!(on_side(BOX, Pt::new(0.0, 0.0)), Side::Top);
	}

	#[test]
	fn an_end_joins_the_item_picked_there_else_the_board_and_never_an_arrow() {
		let (s, r) = (scene(), rules());
		assert_eq!(join_at(&s, Pt::new(99.0, 26.0), 1.0, None, &r), Some(Join { name: "a".into(), area: BOX, side: Some(Side::Right) }));
		assert_eq!(join_at(&s, Pt::new(40.0, 30.0), 1.0, None, &r), Some(Join { name: "a".into(), area: BOX, side: None }));
		// The arrow's own line is looked through, to nothing (the board is lower down).
		assert_eq!(join_at(&s, Pt::new(200.0, 25.0), 1.0, None, &r), None);
		let board = rect(0.0, 200.0, 400.0, 300.0);
		assert_eq!(join_at(&s, Pt::new(50.0, 300.0), 1.0, None, &r), Some(Join { name: BOARD.into(), area: board, side: None }));
		assert_eq!(join_at(&s, Pt::new(200.0, 200.0), 1.0, None, &r), Some(Join { name: BOARD.into(), area: board, side: Some(Side::Top) }));
		assert_eq!(page_at(&s, Pt::new(50.0, 1000.0)), None);
	}

	#[test]
	fn an_end_never_joins_the_item_it_is_told_to_look_through() {
		let r = rules();
		let s = Fake::new(vec![FakeItem::rect("under", 0.0, 0.0, 100.0, 100.0), FakeItem::rect("self", 0.0, 0.0, 100.0, 100.0)]);
		assert_eq!(join_at(&s, Pt::new(50.0, 50.0), 1.0, None, &r).map(|j| j.name), Some("self".into()));
		assert_eq!(join_at(&s, Pt::new(50.0, 50.0), 1.0, Some("self"), &r).map(|j| j.name), Some("under".into()));
	}

	#[test]
	fn a_join_is_written_as_an_item_or_an_item_and_its_side_and_a_point_to_a_tenth() {
		let a = Join { name: "a".into(), area: BOX, side: None };
		assert_eq!(serde_json::to_value(end_of(&a)).unwrap(), json!("a"));
		assert_eq!(serde_json::to_value(end_of(&Join { side: Some(Side::Top), ..a })).unwrap(), json!({ "item": "a", "side": "top" }));
		assert_eq!(serde_json::to_value(point_end(Pt::new(10.04, 3.06))).unwrap(), json!([10, 3.1]));
	}

	#[test]
	fn a_selected_arrows_handles_are_its_ends_their_sides_and_its_middle() {
		let s = scene();
		let b = rect(300.0, 0.0, 100.0, 50.0);
		assert_eq!(
			arrow_handles(&s, "ar", Offset::default()),
			Some(ArrowHandles {
				id: "ar".into(),
				route: ArrowRoute::Straight,
				from: Pt::new(100.0, 25.0),
				to: Pt::new(300.0, 25.0),
				from_join: Some(JoinedEnd { item: "a".into(), area: BOX, side: Side::Right, at: None }),
				to_join: Some(JoinedEnd { item: "b".into(), area: b, side: Side::Left, at: None }),
				middle: Some(Pt::new(200.0, 25.0)),
				bent: false,
			})
		);
	}

	#[test]
	fn the_handles_move_with_the_selections_drag() {
		let moved = arrow_handles(&scene(), "ar", Offset { dx: 10.0, dy: -5.0 }).unwrap();
		assert_eq!((moved.from, moved.to, moved.middle), (Pt::new(110.0, 20.0), Pt::new(310.0, 20.0), Some(Pt::new(210.0, 20.0))));
	}

	#[test]
	fn an_elbow_with_no_middle_segment_has_no_middle_handle_and_named_sides_and_at_are_read() {
		assert_eq!(arrow_handles(&scene_with(json!({ "from": "a", "to": "b", "route": "elbow" })), "ar", Offset::default()).unwrap().middle, None);
		let sided = arrow_handles(&scene_with(json!({ "from": { "item": "a", "side": "bottom", "at": 0.25 }, "to": { "item": "b", "side": "top" }, "route": "elbow", "bend": 0.5 })), "ar", Offset::default()).unwrap();
		let (from, to) = (sided.from_join.unwrap(), sided.to_join.unwrap());
		assert_eq!((from.side, from.at, to.side, sided.bent), (Side::Bottom, Some(0.25), Side::Top, true));
		assert!(sided.middle.is_some());
	}

	#[test]
	fn handles_are_only_for_an_arrow_whose_ends_are_found() {
		assert_eq!(arrow_handles(&scene(), "a", Offset::default()), None);
		assert_eq!(arrow_handles(&scene_with(json!({ "from": "a", "to": "gone" })), "ar", Offset::default()), None);
		assert_eq!(arrow_line(&scene(), &json!({ "from": "a", "to": BOARD })), Some(vec![[50.0, 50.0], [50.0, 200.0]]), "a board end is found by its path");
	}

	#[test]
	fn a_drawn_arrows_handles_sit_on_its_line_as_drawn_through_its_box_and_view_box() {
		let mut arrow = FakeItem::rect("ar", 100.0, 10.0, 200.0, 20.0)
			.kind("path")
			.set("geometry", json!("M0 5 L100 5 M90 9 L100 5 L90 1"))
			.set("viewBox", json!([0, 0, 100, 10]))
			.set("metadata", json!({ "type": pen::ARROW, "from": "a", "to": "b" }));
		arrow.line = Some(true);
		let s = Fake::new(vec![FakeItem::rect("a", 0.0, 0.0, 100.0, 50.0), FakeItem::rect("b", 300.0, 0.0, 100.0, 50.0), arrow]);
		let h = arrow_handles(&s, "ar", Offset::default()).unwrap();
		assert_eq!((h.from, h.to), (Pt::new(100.0, 20.0), Pt::new(300.0, 20.0)));
	}

	#[test]
	fn only_a_lines_corners_or_a_cubics_points_are_read_as_a_drawn_line() {
		assert_eq!(drawn_line(&props(json!({ "geometry": "M1 2 Q3 4 5 6" })), BOX), None, "a quadratic is neither");
		assert_eq!(drawn_line(&props(json!({ "geometry": "M1 2 L3" })), BOX), None, "an odd count of numbers");
		assert_eq!(drawn_line(&props(json!({})), BOX), None);
		assert_eq!(drawn_line(&props(json!({ "geometry": " M1 2 C3 4 5 6 7 8 M0 0" })), rect(10.0, 10.0, 0.0, 0.0)), Some(vec![[11.0, 12.0], [13.0, 14.0], [15.0, 16.0], [17.0, 18.0]]));
	}

	#[test]
	fn a_handles_dashed_draft_is_the_arrows_shape_on_the_new_route() {
		let s = scene();
		let node = s.node("ar").unwrap().clone();
		assert_eq!(
			route_draft(&s, &json!({ "type": pen::ARROW, "from": "a", "to": [350, 300] }), &node),
			Some(RouteDraft { d: "M2 2 L252 277 M240.8 273.6 L252 277 L249.7 265.6".into(), x: 98.0, y: 23.0 })
		);
		assert_eq!(route_draft(&s, &json!({ "type": pen::ARROW, "from": "a", "to": "gone" }), &node), None);
	}

	#[test]
	fn a_join_slides_along_its_side_to_a_thousandth_clicking_to_the_ends_and_middle_unless_free() {
		let r = rules();
		assert_eq!(slide_at(BOX, Side::Top, Pt::new(30.0, 0.0), 1.0, false, &r), 0.3);
		assert_eq!(slide_at(BOX, Side::Top, Pt::new(50.0 - r.join_px + 3.0, 0.0), 1.0, false, &r), 0.5);
		assert_eq!(slide_at(BOX, Side::Top, Pt::new(45.0, 0.0), 1.0, true, &r), 0.45);
		assert_eq!(slide_at(BOX, Side::Left, Pt::new(0.0, 10.0), 1.0, false, &r), 0.2);
		assert_eq!(slide_at(BOX, Side::Left, Pt::new(0.0, 20.0), 1.0, false, &r), 0.5);
		assert_eq!(slide_at(BOX, Side::Right, Pt::new(100.0, 99.0), 1.0, false, &r), 1.0);
		assert_eq!(slide_at(BOX, Side::Top, Pt::new(-20.0, 0.0), 1.0, true, &r), 0.0, "held to the side");
	}

	#[test]
	fn the_click_to_a_stop_is_the_join_reach_on_screen() {
		let r = rules();
		// Just inside the reach clicks to the middle, just outside does not.
		assert_eq!(slide_at(BOX, Side::Top, Pt::new(50.0 - r.join_px + 1.0, 0.0), 1.0, false, &r), 0.5);
		assert_ne!(slide_at(BOX, Side::Top, Pt::new(50.0 - r.join_px - 1.0, 0.0), 1.0, false, &r), 0.5);
		// At half zoom the reach is twice as many stage pixels.
		assert_eq!(slide_at(BOX, Side::Top, Pt::new(50.0 - 2.0 * r.join_px + 2.0, 0.0), 0.5, false, &r), 0.5);
		assert_ne!(slide_at(BOX, Side::Top, Pt::new(50.0 - 2.0 * r.join_px - 2.0, 0.0), 0.5, false, &r), 0.5);
	}

	#[test]
	fn a_side_of_no_length_has_one_place_on_it_its_middle() {
		let r = rules();
		assert_eq!(slide_at(rect(0.0, 0.0, 0.0, 0.0), Side::Top, Pt::new(5.0, 0.0), 1.0, false, &r), 0.5);
		assert_eq!(slide_at(rect(0.0, 0.0, 40.0, 0.0), Side::Left, Pt::new(0.0, -3.0), 1.0, false, &r), 0.5);
		assert_eq!(slide_at(rect(0.0, 0.0, 0.0, 0.0), Side::Top, Pt::new(5.0, 0.0), 1.0, true, &r), 0.5);
	}

	#[test]
	fn the_drag_slides_the_join_within_the_slide_reach_of_its_side_past_its_ends_too() {
		let r = rules();
		let reach = r.slide_px;
		assert!(near_side(BOX, Side::Top, Pt::new(50.0, -reach), 1.0, &r));
		assert!(!near_side(BOX, Side::Top, Pt::new(50.0, -reach - 1.0), 1.0, &r));
		assert!(near_side(BOX, Side::Top, Pt::new(100.0 + reach, 5.0), 1.0, &r));
		assert!(!near_side(BOX, Side::Top, Pt::new(100.0 + reach + 1.0, 5.0), 1.0, &r));
		assert!(!near_side(BOX, Side::Right, Pt::new(100.0 + reach / 2.0 + 1.0, 25.0), 2.0, &r));
		let own = JoinedEnd { item: "a".into(), area: BOX, side: Side::Top, at: None };
		assert_eq!(slide_join(Some(&own), Pt::new(30.0, 4.0), 1.0, false, &r), Some(SlidJoin { item: "a".into(), side: Side::Top, at: 0.3 }));
		assert_eq!(slide_join(Some(&own), Pt::new(30.0, 40.0), 1.0, false, &r), None);
		assert_eq!(slide_join(None, Pt::new(30.0, 4.0), 1.0, false, &r), None);
		assert_eq!(serde_json::to_value(SlidJoin { item: "a".into(), side: Side::Top, at: 0.3 }.end()).unwrap(), json!({ "item": "a", "side": "top", "at": 0.3 }));
	}

	#[test]
	fn an_end_let_go_joins_what_is_there_or_is_a_point_and_never_the_thing_the_other_end_joins() {
		let (s, r) = (scene(), rules());
		let m = meta(json!({ "type": pen::ARROW, "from": "a", "to": "b" }));
		let v = |end: ArrowEnd| serde_json::to_value(end).unwrap();
		assert_eq!(v(dropped_end(&s, "ar", &m, Which::To, Pt::new(50.0, 300.0), 1.0, &r)), json!(BOARD));
		assert_eq!(v(dropped_end(&s, "ar", &m, Which::To, Pt::new(50.0, 1.54), 1.0, &r)), json!([50, 1.5]), "a is what from joins");
		assert_eq!(v(dropped_end(&s, "ar", &m, Which::From, Pt::new(300.0, 25.0), 1.0, &r)), json!([300, 25]));
		assert_eq!(v(dropped_end(&s, "ar", &m, Which::From, Pt::new(600.04, 25.0), 1.0, &r)), json!([600, 25]));
		let to_point = with_end(&m, Which::To, json!([0, 0]));
		assert_eq!(v(dropped_end(&s, "ar", &to_point, Which::From, Pt::new(300.0, 25.0), 1.0, &r)), json!({ "item": "b", "side": "left" }));
	}

	#[test]
	fn an_arrows_metadata_is_written_by_one_update() {
		assert_eq!(serde_json::to_value(arrow_op("ar", meta(json!({ "from": "a" })))).unwrap(), json!({ "op": "update", "id": "ar", "set": { "metadata": { "from": "a" } } }));
	}

	#[test]
	fn a_double_click_on_an_end_takes_its_at_away_and_on_the_middle_its_bend() {
		let m = meta(json!({ "type": pen::ARROW, "from": { "item": "a", "side": "top", "at": 0.3 }, "to": "b", "bend": 0.4 }));
		assert_eq!(
			serde_json::to_value(reset_end_op("ar", Some(&m), Which::From).unwrap()).unwrap(),
			json!({ "op": "update", "id": "ar", "set": { "metadata": { "type": pen::ARROW, "from": { "item": "a", "side": "top" }, "to": "b", "bend": 0.4 } } })
		);
		assert_eq!(reset_end_op("ar", Some(&m), Which::To), None);
		assert_eq!(reset_end_op("ar", None, Which::From), None);
		assert_eq!(
			serde_json::to_value(reset_bend_op("ar", Some(&m)).unwrap()).unwrap(),
			json!({ "op": "update", "id": "ar", "set": { "metadata": { "type": pen::ARROW, "from": { "item": "a", "side": "top", "at": 0.3 }, "to": "b" } } })
		);
		assert_eq!(reset_bend_op("ar", Some(&meta(json!({ "from": "a", "to": "b" })))), None);
	}

	#[test]
	fn the_middle_handle_slides_an_elbows_turn_held_between_its_ends() {
		let elbow = meta(json!({ "type": pen::ARROW, "from": { "item": "a", "side": "bottom" }, "to": { "item": "b", "side": "top" }, "route": "elbow", "bend": 0.2 }));
		let start = bend_start(&scene(), &elbow).unwrap();
		assert_eq!(start.auto, vec![[50.0, 50.0], [50.0, 25.0], [350.0, 25.0], [350.0, 0.0]]);
		assert!(!start.unbent.contains_key("bend"));
		let with = |bend: Value| {
			let mut m = start.unbent.clone();
			m.insert("bend".into(), bend);
			m
		};
		assert_eq!(bend_at(&start, ArrowRoute::Elbow, Pt::new(200.0, 40.0)), with(json!(0.2)));
		assert_eq!(bend_at(&start, ArrowRoute::Elbow, Pt::new(200.0, -100.0)), with(json!(1)));
	}

	#[test]
	fn the_middle_handle_pulls_a_straight_line_into_a_curve_by_whole_pixels() {
		let line = bend_start(&scene(), &meta(json!({ "type": pen::ARROW, "from": "a", "to": "b" }))).unwrap();
		assert_eq!(Value::Object(bend_at(&line, ArrowRoute::Straight, Pt::new(200.0, 80.6))), json!({ "type": pen::ARROW, "from": "a", "to": "b", "route": "curved", "bend": [0, 56] }));
		assert_eq!(bend_start(&scene(), &meta(json!({ "from": "a", "to": "gone" }))), None);
	}

	#[test]
	fn a_new_arrow_joins_what_each_end_was_on_and_a_click_makes_one_only_between_two_things() {
		let a = Join { name: "a".into(), area: BOX, side: None };
		let b = Join { name: "b".into(), area: BOX, side: Some(Side::Left) };
		let (p, q) = (Pt::new(1.0, 2.0), Pt::new(3.0, 4.0));
		let ends = |e: Option<NewEnds>| e.map(|e| (serde_json::to_value(e.from).unwrap(), serde_json::to_value(e.to).unwrap()));
		assert_eq!(ends(new_arrow_ends(Some(&a), Some(&b), p, q, false)), Some((json!("a"), json!({ "item": "b", "side": "left" }))));
		assert_eq!(new_arrow_ends(Some(&a), Some(&a), p, q, false), None);
		assert_eq!(new_arrow_ends(None, Some(&b), p, q, false), None);
		assert_eq!(ends(new_arrow_ends(Some(&a), Some(&a), p, Pt::new(3.25, 4.0), true)), Some((json!("a"), json!([3.3, 4]))));
		assert_eq!(ends(new_arrow_ends(None, None, p, q, true)), Some((json!([1, 2]), json!([3, 4]))));
	}

	#[test]
	fn numbers_are_read_from_a_path_as_the_pattern_reads_them() {
		assert_eq!(numbers("M-1.5 .25L3e2 4E+1 5.", true), vec![-1.5, 0.25, 300.0, 40.0, 5.0]);
		assert_eq!(numbers("4E+1", false), vec![4.0, 1.0], "without a plus the exponent stops at the sign");
	}
}
