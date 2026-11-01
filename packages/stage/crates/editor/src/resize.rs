//! Resizing by the handles (`edit/core/resize.ts`): an item's eight, a board's eight, and an item's
//! corner radius. Each move of the pointer is one call here (`resize_step`, `page_resize_step`,
//! `radius_at`), with the box the drag started from and how far the pointer has gone; letting go is
//! an op builder (`resize_op`, `hug_again_op`, `radius_op`). The pointer loop itself is the page's.

use crate::model::{BoxPart, Corners, Guide, Mods, Op, Pt, Rect};
use crate::pen;
use crate::scene::Props;
use crate::snap::{snap_edges, Edge};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// One of the eight handles round a single selection, named by the compass.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Handle {
	Nw,
	N,
	Ne,
	E,
	Se,
	S,
	Sw,
	W,
}

/// The eight handles, in the order they go round.
pub const HANDLES: [Handle; 8] = [Handle::Nw, Handle::N, Handle::Ne, Handle::E, Handle::Se, Handle::S, Handle::Sw, Handle::W];

impl Handle {
	pub fn name(self) -> &'static str {
		match self {
			Handle::Nw => "nw",
			Handle::N => "n",
			Handle::Ne => "ne",
			Handle::E => "e",
			Handle::Se => "se",
			Handle::S => "s",
			Handle::Sw => "sw",
			Handle::W => "w",
		}
	}
	pub fn parse(name: &str) -> Option<Handle> {
		HANDLES.into_iter().find(|h| h.name() == name)
	}
	/// It drags the top edge.
	pub fn north(self) -> bool {
		self.name().contains('n')
	}
	/// It drags the bottom edge.
	pub fn south(self) -> bool {
		self.name().contains('s')
	}
	/// It drags the right edge.
	pub fn east(self) -> bool {
		self.name().contains('e')
	}
	/// It drags the left edge.
	pub fn west(self) -> bool {
		self.name().contains('w')
	}
	/// A corner, which drags an edge of each way.
	pub fn corner(self) -> bool {
		self.name().len() == 2
	}
}

/// What the keys held say about a resize: Shift keeps the shape, ⌘ or Ctrl (`free`) turns snapping off.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ResizeMods {
	pub shift: bool,
	pub free: bool,
}

impl From<Mods> for ResizeMods {
	fn from(mods: Mods) -> ResizeMods {
		ResizeMods { shift: mods.shift, free: mods.free() }
	}
}

/// What a resize snaps to: the boxes around it, and how near is near, in stage units.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SnapOptions<'a> {
	pub targets: &'a [Rect],
	pub threshold: f64,
}

/// The least an item's resize leaves: `floor` tall and `narrowest` wide (`size_floor`, `size_narrowest`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Least {
	pub floor: f64,
	pub narrowest: f64,
}

impl Default for Least {
	fn default() -> Least {
		Least { floor: 4.0, narrowest: 4.0 }
	}
}

/// A step of a resize: the box drawn now, and the guides to draw.
#[derive(Clone, Debug, PartialEq)]
pub struct Step {
	pub area: Rect,
	pub guides: Vec<Guide>,
}

/// A width and a height.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Size {
	pub w: f64,
	pub h: f64,
}

/// Never smaller than a board can be.
pub const PAGE_MIN: Size = Size { w: 320.0, h: 200.0 };

/// A card's least width: 48, the least height a card hugs its words at and the height one is made at,
/// so at its smallest it is square.
pub const CARD_MIN_W: f64 = 48.0;

/// A card's padding, each side (`@decks/pen`'s `NOTE_PAD`).
const NOTE_PAD: f64 = 16.0;

/// `Math.round`: a half goes up, not away from zero.
fn js_round(v: f64) -> f64 {
	let r = v.round();
	if v - r == 0.5 {
		r + 1.0
	} else {
		r
	}
}

/// The edges a handle drags.
pub fn handle_edges(handle: Handle) -> Vec<Edge> {
	[(handle.west(), Edge::X1), (handle.east(), Edge::X2), (handle.north(), Edge::Y1), (handle.south(), Edge::Y2)].into_iter().filter(|(on, _)| *on).map(|(_, e)| e).collect()
}

/// The box's edges with the handle's ones moved by the pointer.
fn dragged(start: &Rect, handle: Handle, delta: Pt) -> Corners {
	Corners {
		x1: start.x + if handle.west() { delta.x } else { 0.0 },
		x2: start.x + start.w + if handle.east() { delta.x } else { 0.0 },
		y1: start.y + if handle.north() { delta.y } else { 0.0 },
		y2: start.y + start.h + if handle.south() { delta.y } else { 0.0 },
	}
}

/// The edges being dragged snap to what is around, unless ⌘ or Ctrl is held.
fn snapped(area: Corners, edges: &[Edge], mods: ResizeMods, snap: &SnapOptions) -> (Corners, Vec<Guide>) {
	if mods.free {
		return (area, Vec::new());
	}
	let got = snap_edges(&area, edges, snap.targets, snap.threshold);
	(got.area, got.guides)
}

/// Shift on a corner keeps the shape: the wider of the two changes sets both, the opposite corner stays.
fn keep_shape(area: Corners, start: &Rect, handle: Handle) -> Corners {
	let Corners { mut x1, mut y1, mut x2, mut y2 } = area;
	let scale = ((x2 - x1) / start.w).max((y2 - y1) / start.h);
	if handle.west() {
		x1 = x2 - start.w * scale;
	} else {
		x2 = x1 + start.w * scale;
	}
	if handle.north() {
		y1 = y2 - start.h * scale;
	} else {
		y2 = y1 + start.h * scale;
	}
	Corners { x1, y1, x2, y2 }
}

/// Shift on a corner, then snapping: the shape is kept first, then whichever of the two dragged edges
/// is nearer a line snaps to it and the other follows the shape. So a snapped edge stays on the guide
/// drawn for it, which snapping first and keeping the shape after did not promise.
fn snapped_shape(area: Corners, start: &Rect, handle: Handle, mods: ResizeMods, snap: &SnapOptions) -> (Corners, Vec<Guide>) {
	let shaped = keep_shape(area, start, handle);
	if mods.free {
		return (shaped, Vec::new());
	}
	let x_edge = if handle.west() { Edge::X1 } else { Edge::X2 };
	let y_edge = if handle.north() { Edge::Y1 } else { Edge::Y2 };
	let by_x = snap_edges(&shaped, &[x_edge], snap.targets, snap.threshold);
	let by_y = snap_edges(&shaped, &[y_edge], snap.targets, snap.threshold);
	let dx = if by_x.guides.is_empty() { f64::INFINITY } else { (x_edge.of(&by_x.area) - x_edge.of(&shaped)).abs() };
	let dy = if by_y.guides.is_empty() { f64::INFINITY } else { (y_edge.of(&by_y.area) - y_edge.of(&shaped)).abs() };
	if dx == f64::INFINITY && dy == f64::INFINITY {
		return (shaped, Vec::new());
	}
	let mut out = shaped;
	if dx <= dy {
		x_edge.put(&mut out, x_edge.of(&by_x.area));
		let h = (start.h * (out.x2 - out.x1).abs()) / start.w;
		if y_edge == Edge::Y1 {
			out.y1 = out.y2 - h;
		} else {
			out.y2 = out.y1 + h;
		}
	} else {
		y_edge.put(&mut out, y_edge.of(&by_y.area));
		let w = (start.w * (out.y2 - out.y1).abs()) / start.h;
		if x_edge == Edge::X1 {
			out.x1 = out.x2 - w;
		} else {
			out.x2 = out.x1 + w;
		}
	}
	// The guide drawn round the box as it now is, on the edge that snapped.
	let guides = snap_edges(&out, &[if dx <= dy { x_edge } else { y_edge }], snap.targets, 0.01).guides;
	(out, guides)
}

/// The dragged box, snapped: with Shift on a corner of a box with a size, its shape kept first.
fn moved(start: &Rect, handle: Handle, delta: Pt, mods: ResizeMods, snap: &SnapOptions) -> (Corners, Vec<Guide>) {
	let shaping = mods.shift && handle.corner() && start.w > 0.0 && start.h > 0.0;
	if shaping {
		snapped_shape(dragged(start, handle, delta), start, handle, mods, snap)
	} else {
		snapped(dragged(start, handle, delta), &handle_edges(handle), mods, snap)
	}
}

/// One move of an item's handle: the box it is drawn at now, and the guides to draw. The dragged
/// edges snap; with Shift on a corner the start's shape is kept first and the nearer edge snaps
/// after, the other following, so a snapped edge stays on its guide. Then the box is rounded, never
/// under `least.narrowest` wide (4, or a card's least) nor `least.floor` tall. Dragged past the
/// opposite edge, the box flips, unless that would take it under a card's least width.
pub fn resize_step(start: &Rect, handle: Handle, delta: Pt, mods: ResizeMods, snap: &SnapOptions, least: Least) -> Step {
	let (area, guides) = moved(start, handle, delta, mods, snap);
	let Corners { mut x1, y1, mut x2, y2 } = area;
	let narrowest = least.narrowest;
	// A card's least width holds the edge that is not dragged where it is, rather than flipping the card.
	if narrowest > 4.0 && x2 - x1 < narrowest {
		if handle.west() {
			x1 = x2 - narrowest;
		} else if handle.east() {
			x2 = x1 + narrowest;
		}
	}
	let area = Rect {
		x: js_round(x1.min(x2)),
		y: js_round(y1.min(y2)),
		w: narrowest.max(js_round((x2 - x1).abs())),
		h: least.floor.max(js_round((y2 - y1).abs())),
	};
	Step { area, guides }
}

/// One move of a board's handle. As an item's, but the edge being dragged stops at `PAGE_MIN` (the
/// other stays put) rather than flipping.
pub fn page_resize_step(start: &Rect, handle: Handle, delta: Pt, mods: ResizeMods, snap: &SnapOptions) -> Step {
	let (area, guides) = moved(start, handle, delta, mods, snap);
	let Corners { mut x1, mut y1, mut x2, mut y2 } = area;
	if x2 - x1 < PAGE_MIN.w {
		if handle.west() {
			x1 = x2 - PAGE_MIN.w;
		} else {
			x2 = x1 + PAGE_MIN.w;
		}
	}
	if y2 - y1 < PAGE_MIN.h {
		if handle.north() {
			y1 = y2 - PAGE_MIN.h;
		} else {
			y2 = y1 + PAGE_MIN.h;
		}
	}
	Step { area: Rect { x: js_round(x1), y: js_round(y1), w: js_round(x2 - x1), h: js_round(y2 - y1) }, guides }
}

/// A board that reads top to bottom, as its resize shows it: the height the drag gives it is the floor
/// written to the file, and the board is drawn no shorter than its content (`least`), as it will be
/// once that floor is written. Its top is where the drag has it, by whichever handle.
pub fn shown_page_resize(area: &Rect, least: Option<f64>) -> Rect {
	match least {
		Some(least) if least != 0.0 && area.h < least => Rect { h: least, ..*area },
		_ => *area,
	}
}

/// What a board's resize changed, on the lift: where it moved to, if a left or top edge was dragged, and its new size.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct PageResizeEnd {
	#[serde(rename = "move", skip_serializing_if = "Option::is_none")]
	pub to: Option<Pt>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub size: Option<Size>,
}

/// What a board's resize changed, on the lift.
pub fn page_resize_end(start: &Rect, next: &Rect) -> PageResizeEnd {
	PageResizeEnd {
		to: (next.x != start.x || next.y != start.y).then(|| Pt::new(next.x, next.y)),
		size: (next.w != start.w || next.h != start.h).then_some(Size { w: next.w, h: next.h }),
	}
}

/// The box the file sizes for an item drawn at `drawn`. The handles are on what the item draws; the
/// file sizes the box it was given (`given`, as placed). For most items they are the same box. For a
/// path drawn in a corner of its viewBox they are not, and the given box is scaled by as much as the
/// drawn one (from `start`), about the same point.
pub fn given_for(start: &Rect, given: &Rect, drawn: &Rect) -> Rect {
	let sx = if start.w > 0.0 { drawn.w / start.w } else { 1.0 };
	let sy = if start.h > 0.0 { drawn.h / start.h } else { 1.0 };
	Rect { x: drawn.x - (start.x - given.x) * sx, y: drawn.y - (start.y - given.y) * sy, w: given.w * sx, h: given.h * sy }
}

/// A markdown item that is not a text block: a note (`@decks/pen`'s `isMarkdown`).
fn is_markdown(node: &Props) -> bool {
	pen::kind(node) != "text" && pen::tag(node) == pen::MARKDOWN
}

fn is_card_or_note(node: Option<&Props>) -> bool {
	node.is_some_and(|n| is_markdown(n) || pen::is_card(n))
}

/// A markdown card as tall as its words, which is how one starts: no `height` number of its own, so
/// the layout measures what it says at whatever width it has. Dragging its top or bottom handle pins a
/// height on it, and from then on it is an ordinary box.
pub fn hugs_words(node: Option<&Props>) -> bool {
	is_card_or_note(node) && !node.and_then(|n| n.get("height")).is_some_and(Value::is_number)
}

/// Whether a drag of this handle leaves a card's height to its words: only its sides. The top and
/// bottom handles are what pin a height on it, and a corner pins one too, since it drags an edge of each.
pub fn keeps_words(node: Option<&Props>, handle: Handle) -> bool {
	hugs_words(node) && !handle.north() && !handle.south()
}

/// The least height a resize leaves: a card's own padding twice over, which is a card with no room for a word; 4 for anything else.
pub fn size_floor(node: Option<&Props>) -> f64 {
	if is_card_or_note(node) {
		NOTE_PAD * 2.0
	} else {
		4.0
	}
}

/// The least width a resize leaves: `CARD_MIN_W` for a card or a note, 4 for anything else.
pub fn size_narrowest(node: Option<&Props>) -> f64 {
	if is_card_or_note(node) {
		CARD_MIN_W
	} else {
		4.0
	}
}

/// How the drawing previews a resize: moved from where it was given, at the new size.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct ResizePreview {
	pub dx: f64,
	pub dy: f64,
	pub w: f64,
	/// None for a card following its words, so it re-measures them.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub h: Option<f64>,
}

/// How the drawing previews a resize: moved from where it was given, at the new size; a card following its words without a height, so it re-measures them.
pub fn resize_preview(given: &Rect, area: &Rect, words: bool) -> ResizePreview {
	ResizePreview { dx: area.x - given.x, dy: area.y - given.y, w: area.w, h: (!words).then_some(area.h) }
}

/// The edit a resize writes on the lift, to a tenth of a pixel: a card still following its words gets its width alone, and no height.
pub fn resize_op(id: &str, area: &Rect, words: bool) -> Op {
	let r = |n: f64| js_round(n * 10.0) / 10.0;
	let part = BoxPart { x1: Some(r(area.x)), y1: Some(r(area.y)), x2: Some(r(area.x + area.w)), y2: (!words).then(|| r(area.y + area.h)) };
	Op::Update { id: id.into(), set: None, area: Some(part) }
}

/// The floor in a `fit_content(N)` height, as written.
fn fit_floor(height: &str) -> Option<&str> {
	let inner = height.strip_prefix("fit_content(")?.strip_suffix(')')?.trim();
	(!inner.is_empty() && inner.chars().all(|c| c.is_ascii_digit() || c == '.')).then_some(inner)
}

/// A double-click on a frame's or a card's top or bottom handle: it hugs what it holds again, with the
/// floor it had (`fit_content(N)`), or 120 for a frame and 48 for a card when it had none. A drag of
/// either edge is what fixed its height; this undoes it. Nothing for any other handle, a library shape,
/// or anything that is not a frame.
pub fn hug_again_op(id: &str, node: Option<&Props>, handle: Handle) -> Option<Op> {
	if handle != Handle::N && handle != Handle::S {
		return None;
	}
	let node = node.filter(|n| pen::kind(n) == "frame" && !pen::is_shape(n))?;
	let had = node.get("height").and_then(Value::as_str).and_then(fit_floor);
	let floor = match had {
		Some(had) => had.parse::<f64>().unwrap_or(f64::NAN),
		None if pen::is_card(node) => 48.0,
		None => 120.0,
	};
	let mut set = Map::new();
	set.insert("height".into(), format!("fit_content({floor})").into());
	Some(Op::set(id, set))
}

/// Where a corner radius drag starts: the box, the radius now, the most it can be, and whether a library shape keeps it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RadiusStart {
	pub area: Rect,
	pub radius: f64,
	pub most: f64,
	pub shape: bool,
}

/// The most a corner can be rounded in a box: any more and the straight sides are gone (`@decks/pen`'s `maxRadius`).
fn max_radius(w: f64, h: f64) -> f64 {
	(w.min(h) / 2.0).max(0.0)
}

/// The library shapes that have corners to round, and how round they start, in hundredths of the shorter side.
const ROUNDED: [(&str, f64); 4] = [("rectangle", 0.0), ("rounded", 14.0), ("process", 0.0), ("speech", 8.0)];

fn finite(v: Option<&Value>) -> Option<f64> {
	v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// How round a library shape's corners are, in pixels, or `None` for a shape that has no such corners:
/// its own `metadata.radius`, else its kind's own radius scaled to it (`@decks/pen`'s `shapeRadius`).
fn shape_radius(node: &Props) -> Option<f64> {
	if !pen::is_shape(node) {
		return None;
	}
	let data = pen::metadata(node)?;
	let kind = data.get("kind").and_then(Value::as_str)?.to_lowercase();
	let rounded = ROUNDED.iter().find(|(name, _)| *name == kind)?.1;
	let w = finite(node.get("width")).unwrap_or(0.0);
	let h = finite(node.get("height")).unwrap_or(0.0);
	let want = finite(data.get("radius")).unwrap_or(rounded / 100.0 * w.min(h));
	Some(want.min(max_radius(w, h)).max(0.0))
}

/// The radius handle for an item at `area`, when it has corners to round: a rounded shape from the
/// library (its own `metadata.radius`), or pen's own rectangle or frame (`cornerRadius`). Nothing when
/// the box is too small to round (`most` under 2), or for a library shape with no corners.
pub fn radius_start(node: &Props, area: &Rect) -> Option<RadiusStart> {
	let most = max_radius(area.w, area.h);
	if most < 2.0 {
		return None;
	}
	if let Some(radius) = shape_radius(node) {
		return Some(RadiusStart { area: *area, radius, most, shape: true });
	}
	if pen::is_shape(node) || !matches!(pen::kind(node), "rectangle" | "frame") {
		return None;
	}
	let set = match node.get("cornerRadius") {
		Some(Value::Array(all)) => all.first(),
		other => other,
	};
	let now = finite(set).unwrap_or(0.0);
	Some(RadiusStart { area: *area, radius: now.min(most).max(0.0), most, shape: false })
}

/// The radius for the pointer at `at`: along the diagonal from the top-left corner of `area`, the
/// nearer of the two reaches (so a pull across rounds as much as a pull down), rounded, from 0 up to
/// `most`, half the shorter side.
pub fn radius_at(area: &Rect, most: f64, at: Pt) -> f64 {
	let reach = (at.x - area.x).min(at.y - area.y);
	js_round(reach).min(most.floor()).max(0.0)
}

/// The edit a radius drag writes: a library shape's `metadata.radius`, or pen's `cornerRadius` (taken off at 0).
pub fn radius_op(id: &str, radius: f64, shape: bool, node: Option<&Props>) -> Op {
	let mut set = Map::new();
	if !shape {
		set.insert("cornerRadius".into(), if radius <= 0.0 { Value::Null } else { radius.into() });
		return Op::set(id, set);
	}
	let mut data = Map::new();
	data.insert("type".into(), "".into());
	if let Some(had) = node.and_then(pen::metadata) {
		data.extend(had.clone());
	}
	data.insert("radius".into(), radius.into());
	set.insert("metadata".into(), Value::Object(data));
	Op::set(id, set)
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	const BOX: Rect = Rect { x: 0.0, y: 0.0, w: 100.0, h: 50.0 };
	const NONE: SnapOptions = SnapOptions { targets: &[], threshold: 6.0 };

	fn r(x: f64, y: f64, w: f64, h: f64) -> Rect {
		Rect { x, y, w, h }
	}
	fn node(fields: Value) -> Props {
		let mut out = json!({ "id": "n", "type": "frame" }).as_object().unwrap().clone();
		out.extend(fields.as_object().unwrap().clone());
		out
	}
	fn card(fields: Value) -> Props {
		let mut out = node(json!({ "metadata": { "type": "decks.card" } }));
		out.extend(fields.as_object().unwrap().clone());
		out
	}
	fn step(start: Rect, handle: Handle, dx: f64, dy: f64, mods: ResizeMods, snap: &SnapOptions) -> Step {
		resize_step(&start, handle, Pt::new(dx, dy), mods, snap, Least::default())
	}
	fn plain() -> ResizeMods {
		ResizeMods::default()
	}
	fn shift() -> ResizeMods {
		ResizeMods { shift: true, free: false }
	}
	fn json_of(op: &Op) -> Value {
		serde_json::to_value(op).unwrap()
	}

	#[test]
	fn a_handle_drags_its_own_edges() {
		assert_eq!(handle_edges(Handle::Nw), vec![Edge::X1, Edge::Y1]);
		assert_eq!(handle_edges(Handle::Se), vec![Edge::X2, Edge::Y2]);
		assert_eq!(handle_edges(Handle::E), vec![Edge::X2]);
		assert_eq!(handle_edges(Handle::N), vec![Edge::Y1]);
		assert_eq!(HANDLES.map(Handle::name), ["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
		assert_eq!(Handle::parse("sw"), Some(Handle::Sw));
		assert_eq!(serde_json::to_value(Handle::Ne).unwrap(), json!("ne"));
	}

	#[test]
	fn an_edge_drag_moves_that_edge_and_past_the_other_one_the_box_flips() {
		assert_eq!(step(BOX, Handle::E, 50.0, 30.0, plain(), &NONE).area, r(0.0, 0.0, 150.0, 50.0));
		assert_eq!(step(BOX, Handle::S, 50.0, 30.0, plain(), &NONE).area, r(0.0, 0.0, 100.0, 80.0));
		assert_eq!(step(BOX, Handle::W, 150.0, 0.0, plain(), &NONE).area, r(100.0, 0.0, 50.0, 50.0));
	}

	#[test]
	fn a_step_is_rounded_to_whole_pixels_with_a_half_going_up() {
		assert_eq!(step(BOX, Handle::Se, 10.4, 10.6, plain(), &NONE).area, r(0.0, 0.0, 110.0, 61.0));
		assert_eq!(step(BOX, Handle::Nw, -10.5, -0.5, plain(), &NONE).area, r(-10.0, 0.0, 111.0, 51.0));
	}

	#[test]
	fn the_dragged_edge_snaps_within_the_threshold_and_draws_a_guide_marked_at_each_point_on_it() {
		let near = SnapOptions { targets: &[r(200.0, 300.0, 10.0, 10.0)], threshold: 6.0 };
		let got = step(BOX, Handle::E, 97.0, 0.0, plain(), &near);
		assert_eq!(got.area, r(0.0, 0.0, 200.0, 50.0));
		assert_eq!(got.guides.len(), 1);
		let g = &got.guides[0];
		assert_eq!((g.x1, g.y1, g.x2, g.y2), (200.0, 0.0, 200.0, 310.0));
		assert_eq!(g.points.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>(), vec![(200.0, 0.0), (200.0, 25.0), (200.0, 50.0), (200.0, 300.0), (200.0, 305.0), (200.0, 310.0)]);
	}

	#[test]
	fn with_command_or_ctrl_held_a_resize_does_not_snap() {
		let near = SnapOptions { targets: &[r(200.0, 300.0, 10.0, 10.0)], threshold: 6.0 };
		let free = ResizeMods::from(Mods { meta: true, ..Default::default() });
		let got = step(BOX, Handle::E, 97.0, 0.0, free, &near);
		assert_eq!(got.area, r(0.0, 0.0, 197.0, 50.0));
		assert!(got.guides.is_empty());
		assert!(ResizeMods::from(Mods { ctrl: true, ..Default::default() }).free);
	}

	#[test]
	fn only_the_dragged_edges_snap() {
		let near = SnapOptions { targets: &[r(200.0, 300.0, 10.0, 10.0)], threshold: 6.0 };
		// The left edge stays at 197 though a line is 3 away.
		assert_eq!(step(r(197.0, 0.0, 10.0, 10.0), Handle::E, 50.0, 0.0, plain(), &near).area.x, 197.0);
	}

	#[test]
	fn shift_on_a_corner_keeps_the_shape_first_and_snaps_after_so_the_edge_stays_on_its_guide() {
		// The shape first (214 × 107), then the bottom snaps 107 → 110 and the right edge follows to 220.
		let kept = step(BOX, Handle::Se, 20.0, 57.0, shift(), &SnapOptions { targets: &[r(300.0, 110.0, 10.0, 10.0)], threshold: 6.0 });
		assert_eq!(kept.area, r(0.0, 0.0, 220.0, 110.0));
		assert_eq!(kept.guides.iter().map(|g| g.y1).collect::<Vec<_>>(), vec![110.0]);
		// The shape first (160 × 80), the bottom snaps 80 → 78, the right edge follows to 156, the guide where the edge is.
		let stays = step(BOX, Handle::Se, 60.0, 13.0, shift(), &SnapOptions { targets: &[r(300.0, 60.0, 10.0, 18.0)], threshold: 6.0 });
		assert_eq!(stays.area, r(0.0, 0.0, 156.0, 78.0));
		assert_eq!(stays.guides.iter().map(|g| g.y1).collect::<Vec<_>>(), vec![stays.area.bottom()]);
		// The right edge snaps 197 → 200 (scale 2); the bottom follows to 100.
		assert_eq!(step(BOX, Handle::Se, 97.0, 10.0, shift(), &SnapOptions { targets: &[r(200.0, 300.0, 10.0, 10.0)], threshold: 6.0 }).area, r(0.0, 0.0, 200.0, 100.0));
	}

	#[test]
	fn shift_on_a_corner_holds_the_opposite_corner_and_does_nothing_on_a_side() {
		assert_eq!(step(r(100.0, 100.0, 100.0, 50.0), Handle::Nw, -10.0, -30.0, shift(), &NONE).area, r(40.0, 70.0, 160.0, 80.0));
		assert_eq!(step(BOX, Handle::E, 100.0, 0.0, shift(), &NONE).area, r(0.0, 0.0, 200.0, 50.0));
	}

	#[test]
	fn never_under_four_wide_nor_under_the_floor_tall_and_a_cards_floor_is_its_padding_twice() {
		assert_eq!(step(BOX, Handle::Se, -98.0, -48.0, plain(), &NONE).area, r(0.0, 0.0, 4.0, 4.0));
		let floored = resize_step(&BOX, Handle::Se, Pt::new(-98.0, -48.0), plain(), &NONE, Least { floor: 32.0, narrowest: 4.0 });
		assert_eq!(floored.area, r(0.0, 0.0, 4.0, 32.0));
		assert_eq!(size_floor(Some(&card(json!({})))), 32.0);
		assert_eq!(size_floor(Some(&node(json!({ "metadata": { "type": "decks.markdown" } })))), 32.0);
		assert_eq!(size_floor(Some(&node(json!({ "type": "rectangle" })))), 4.0);
		assert_eq!(size_floor(None), 4.0);
	}

	#[test]
	fn a_card_is_never_narrower_than_48_and_the_edge_not_dragged_stays_put() {
		assert_eq!(CARD_MIN_W, 48.0);
		assert_eq!(size_narrowest(Some(&card(json!({})))), 48.0);
		assert_eq!(size_narrowest(None), 4.0);
		let least = Least { floor: 4.0, narrowest: 48.0 };
		assert_eq!(resize_step(&BOX, Handle::W, Pt::new(90.0, 0.0), plain(), &NONE, least).area, r(52.0, 0.0, 48.0, 50.0));
		assert_eq!(resize_step(&BOX, Handle::E, Pt::new(-150.0, 0.0), plain(), &NONE, least).area, r(0.0, 0.0, 48.0, 50.0));
		// Anything else still flips.
		assert_eq!(step(BOX, Handle::E, -150.0, 0.0, plain(), &NONE).area, r(-50.0, 0.0, 50.0, 50.0));
	}

	#[test]
	fn a_card_as_tall_as_its_words_keeps_that_on_a_side_drag_only() {
		assert!(hugs_words(Some(&card(json!({})))));
		assert!(hugs_words(Some(&card(json!({ "height": "fit_content(48)" })))));
		assert!(!hugs_words(Some(&card(json!({ "height": 200 })))));
		assert!(!hugs_words(Some(&node(json!({})))));
		assert!(!hugs_words(None));
		assert!(keeps_words(Some(&card(json!({}))), Handle::E));
		assert!(keeps_words(Some(&card(json!({}))), Handle::W));
		assert!(!keeps_words(Some(&card(json!({}))), Handle::S));
		assert!(!keeps_words(Some(&card(json!({}))), Handle::Ne));
	}

	#[test]
	fn a_preview_moves_from_the_given_box_and_leaves_a_card_following_its_words_without_a_height() {
		let given = r(0.0, 0.0, 100.0, 50.0);
		assert_eq!(serde_json::to_value(resize_preview(&given, &r(5.0, 0.0, 140.0, 50.0), true)).unwrap(), json!({ "dx": 5.0, "dy": 0.0, "w": 140.0 }));
		assert_eq!(serde_json::to_value(resize_preview(&given, &r(5.0, 0.0, 140.0, 60.0), false)).unwrap(), json!({ "dx": 5.0, "dy": 0.0, "w": 140.0, "h": 60.0 }));
	}

	#[test]
	fn the_lift_writes_the_box_to_a_tenth_and_a_card_following_its_words_its_width_alone() {
		let at = r(1.04, 2.06, 100.333, 50.0);
		assert_eq!(json_of(&resize_op("c", &at, true)), json!({ "op": "update", "id": "c", "box": { "x1": 1, "y1": 2.1, "x2": 101.4 } }));
		assert_eq!(json_of(&resize_op("c", &at, false)), json!({ "op": "update", "id": "c", "box": { "x1": 1, "y1": 2.1, "x2": 101.4, "y2": 52.1 } }));
	}

	#[test]
	fn the_given_box_is_scaled_about_the_same_point_as_the_drawn_one() {
		assert_eq!(given_for(&r(10.0, 10.0, 100.0, 100.0), &r(0.0, 0.0, 120.0, 120.0), &r(10.0, 10.0, 200.0, 50.0)), r(-10.0, 5.0, 240.0, 60.0));
		assert_eq!(given_for(&BOX, &BOX, &r(3.0, 4.0, 50.0, 20.0)), r(3.0, 4.0, 50.0, 20.0));
		// A start with no size scales by nothing.
		assert_eq!(given_for(&r(0.0, 0.0, 0.0, 0.0), &r(0.0, 0.0, 10.0, 10.0), &r(5.0, 5.0, 0.0, 0.0)), r(5.0, 5.0, 10.0, 10.0));
	}

	#[test]
	fn two_presses_on_a_frames_top_or_bottom_handle_hug_again_with_the_floor_it_had() {
		let hug = |id: &str, n: Option<&Props>, h: Handle| hug_again_op(id, n, h).map(|op| json_of(&op));
		assert_eq!(hug("f", Some(&node(json!({ "height": "fit_content(80)" }))), Handle::S), Some(json!({ "op": "update", "id": "f", "set": { "height": "fit_content(80)" } })));
		assert_eq!(hug("f", Some(&node(json!({ "height": "fit_content( 2.5 )" }))), Handle::S), Some(json!({ "op": "update", "id": "f", "set": { "height": "fit_content(2.5)" } })));
		assert_eq!(hug("f", Some(&node(json!({ "height": 300 }))), Handle::N), Some(json!({ "op": "update", "id": "f", "set": { "height": "fit_content(120)" } })));
		assert_eq!(hug("c", Some(&card(json!({ "height": 300 }))), Handle::S), Some(json!({ "op": "update", "id": "c", "set": { "height": "fit_content(48)" } })));
	}

	#[test]
	fn hugging_again_is_nothing_for_another_handle_a_library_shape_or_what_is_not_a_frame() {
		assert_eq!(hug_again_op("f", Some(&node(json!({ "height": 300 }))), Handle::E), None);
		assert_eq!(hug_again_op("f", Some(&node(json!({ "height": 300 }))), Handle::Se), None);
		assert_eq!(hug_again_op("r", Some(&node(json!({ "type": "rectangle", "height": 300 }))), Handle::S), None);
		assert_eq!(hug_again_op("sh", Some(&node(json!({ "metadata": { "type": "decks.shape", "kind": "Rounded" } }))), Handle::S), None);
		assert_eq!(hug_again_op("f", None, Handle::S), None);
	}

	#[test]
	fn a_board_stops_at_its_least_size_at_the_edge_being_dragged_and_the_other_stays_put() {
		assert_eq!(PAGE_MIN, Size { w: 320.0, h: 200.0 });
		let start = r(0.0, 0.0, 800.0, 600.0);
		let page = |h: Handle, dx: f64, dy: f64, mods: ResizeMods| page_resize_step(&start, h, Pt::new(dx, dy), mods, &NONE).area;
		assert_eq!(page(Handle::W, 700.0, 0.0, plain()), r(480.0, 0.0, 320.0, 600.0));
		assert_eq!(page(Handle::N, 0.0, 500.0, plain()), r(0.0, 400.0, 800.0, 200.0));
		assert_eq!(page(Handle::Se, -900.0, -900.0, plain()), r(0.0, 0.0, 320.0, 200.0));
		assert_eq!(page(Handle::Se, 400.0, 0.0, shift()), r(0.0, 0.0, 1200.0, 900.0));
	}

	#[test]
	fn a_boards_dragged_edge_snaps_and_draws_its_guide() {
		let start = r(0.0, 0.0, 800.0, 600.0);
		let got = page_resize_step(&start, Handle::E, Pt::new(97.0, 0.0), plain(), &SnapOptions { targets: &[r(900.0, 700.0, 100.0, 100.0)], threshold: 6.0 });
		assert_eq!(got.area, r(0.0, 0.0, 900.0, 600.0));
		assert_eq!(got.guides.len(), 1);
	}

	#[test]
	fn shift_on_a_board_with_no_size_to_keep_does_not_divide_by_it() {
		let got = page_resize_step(&r(0.0, 0.0, 0.0, 0.0), Handle::Se, Pt::new(500.0, 300.0), shift(), &NONE).area;
		assert_eq!(got, r(0.0, 0.0, 500.0, 300.0));
		assert!([got.x, got.y, got.w, got.h].iter().all(|v| v.is_finite()));
	}

	#[test]
	fn a_boards_lift_moves_it_only_when_its_corner_moved_and_sizes_it_only_when_its_size_changed() {
		let start = r(0.0, 0.0, 800.0, 600.0);
		assert_eq!(serde_json::to_value(page_resize_end(&start, &start)).unwrap(), json!({}));
		assert_eq!(serde_json::to_value(page_resize_end(&start, &r(0.0, 0.0, 900.0, 600.0))).unwrap(), json!({ "size": { "w": 900.0, "h": 600.0 } }));
		assert_eq!(serde_json::to_value(page_resize_end(&start, &r(-100.0, 0.0, 900.0, 600.0))).unwrap(), json!({ "move": { "x": -100.0, "y": 0.0 }, "size": { "w": 900.0, "h": 600.0 } }));
	}

	#[test]
	fn a_documents_resize_shows_it_no_shorter_than_its_content() {
		assert_eq!(shown_page_resize(&r(0.0, 100.0, 760.0, 300.0), Some(642.0)), r(0.0, 100.0, 760.0, 642.0));
		assert_eq!(shown_page_resize(&r(0.0, 0.0, 760.0, 900.0), Some(642.0)), r(0.0, 0.0, 760.0, 900.0));
		assert_eq!(shown_page_resize(&r(0.0, 0.0, 760.0, 300.0), None), r(0.0, 0.0, 760.0, 300.0));
	}

	#[test]
	fn the_radius_follows_the_nearer_reach_along_the_diagonal_from_nothing_to_half_the_shorter_side() {
		let at = r(0.0, 0.0, 51.0, 60.0);
		assert_eq!(radius_at(&at, 25.5, Pt::new(10.0, 30.0)), 10.0);
		assert_eq!(radius_at(&at, 25.5, Pt::new(10.6, 30.0)), 11.0);
		assert_eq!(radius_at(&at, 25.5, Pt::new(100.0, 100.0)), 25.0);
		assert_eq!(radius_at(&at, 25.5, Pt::new(-5.0, 10.0)), 0.0);
	}

	#[test]
	fn a_rectangle_or_frame_has_a_radius_handle_starting_at_its_corner_radius_held_to_the_most() {
		let at = r(0.0, 0.0, 100.0, 40.0);
		assert_eq!(radius_start(&node(json!({ "type": "rectangle", "cornerRadius": 8 })), &at), Some(RadiusStart { area: at, radius: 8.0, most: 20.0, shape: false }));
		assert_eq!(radius_start(&node(json!({ "type": "rectangle", "cornerRadius": 50 })), &at).map(|s| s.radius), Some(20.0));
		assert_eq!(radius_start(&node(json!({ "cornerRadius": [6, 1, 1, 1] })), &at).map(|s| s.radius), Some(6.0));
		assert_eq!(radius_start(&node(json!({})), &at).map(|s| s.radius), Some(0.0));
	}

	#[test]
	fn there_is_no_radius_handle_on_a_box_too_small_on_text_or_on_a_library_shape_without_corners() {
		let at = r(0.0, 0.0, 100.0, 40.0);
		assert_eq!(radius_start(&node(json!({ "type": "rectangle" })), &r(0.0, 0.0, 3.0, 3.0)), None);
		assert_eq!(radius_start(&node(json!({ "type": "text" })), &at), None);
		assert_eq!(radius_start(&node(json!({ "metadata": { "type": "decks.shape", "kind": "Ellipse" } })), &at), None);
	}

	#[test]
	fn a_rounded_library_shape_starts_at_its_own_radius_or_its_kinds_scaled_to_it() {
		let at = r(0.0, 0.0, 100.0, 40.0);
		let own = node(json!({ "width": 100, "height": 50, "metadata": { "type": "decks.shape", "kind": "Rounded", "radius": 9 } }));
		assert_eq!(radius_start(&own, &at), Some(RadiusStart { area: at, radius: 9.0, most: 20.0, shape: true }));
		// No radius of its own: 14 hundredths of its shorter side, 50.
		let kinds = node(json!({ "width": 100, "height": 50, "metadata": { "type": "decks.shape", "kind": "rounded" } }));
		assert!(radius_start(&kinds, &at).is_some_and(|s| s.shape && (s.radius - 7.0).abs() < 1e-9));
		// Held to the most its own size can be rounded.
		let tight = node(json!({ "width": 10, "height": 50, "metadata": { "type": "decks.shape", "kind": "Rounded", "radius": 30 } }));
		assert_eq!(radius_start(&tight, &at).map(|s| s.radius), Some(5.0));
	}

	#[test]
	fn a_radius_is_written_as_pens_corner_radius_taken_off_at_nothing_or_a_library_shapes_metadata_radius() {
		assert_eq!(json_of(&radius_op("r", 12.0, false, None)), json!({ "op": "update", "id": "r", "set": { "cornerRadius": 12.0 } }));
		assert_eq!(json_of(&radius_op("r", 0.0, false, None)), json!({ "op": "update", "id": "r", "set": { "cornerRadius": null } }));
		let shape = node(json!({ "metadata": { "type": "decks.shape", "kind": "Rounded" } }));
		assert_eq!(json_of(&radius_op("s", 9.0, true, Some(&shape))), json!({ "op": "update", "id": "s", "set": { "metadata": { "type": "decks.shape", "kind": "Rounded", "radius": 9.0 } } }));
		assert_eq!(json_of(&radius_op("s", 9.0, true, None)), json!({ "op": "update", "id": "s", "set": { "metadata": { "type": "", "radius": 9.0 } } }));
	}
}
