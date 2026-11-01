//! Everything the editor draws over the canvas (`edit/core/overlay.ts` and `overlay-json.ts`): the
//! selection's outlines and handles, its parents and children, the hover, the guides, the drop
//! slots, an arrow's ends, the marquee and a draft, worked out from the editor's state and the scene,
//! and handed to the painter as its own `Overlay` (`stage_paint::overlay`), with no JSON between.
//! What differs by form (handles' size, shape and number, anchors, the size label, arrow handles) is
//! the rules table's.

use crate::model::{Corners, Guide, GuideKind, Offset, PageBox, Pt, Rect, Side};
use crate::pen;
use crate::pick::{children_of, parent_of};
use crate::rules::Rules;
use crate::scene::Scene;
use stage_paint::overlay::{Overlay, OverlayBox, OverlayDot, OverlayLine, OverlayPath};
use std::collections::{HashMap, HashSet};

pub const SIDES: [Side; 4] = [Side::Top, Side::Right, Side::Bottom, Side::Left];

/// What an outline goes round.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
	Item,
	Page,
	Marquee,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Outline {
	pub id: String,
	pub role: Role,
	pub rect: Rect,
	/// Drawn with round corners: a note, or a board.
	pub round: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kin {
	Parent,
	Child,
}

#[derive(Clone, Debug, PartialEq)]
pub struct KinBox {
	pub id: String,
	pub kin: Kin,
	pub rect: Rect,
	pub round: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MeasureLine {
	pub x1: f64,
	pub y1: f64,
	pub x2: f64,
	pub y2: f64,
	pub label: Option<String>,
	pub dashed: bool,
}

/// A selected arrow's two ends and its middle, as drawn (`arrows.rs` works them out).
#[derive(Clone, Debug, PartialEq)]
pub struct ArrowEnds {
	pub from: Pt,
	pub to: Pt,
	pub from_joined: bool,
	pub to_joined: bool,
	pub middle: Option<Pt>,
	pub bent: bool,
}

/// The one selected item's corner-radius handle: its box, its radius now and the most it can be (`resize.rs`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RadiusAt {
	pub rect: Rect,
	pub radius: f64,
	pub most: f64,
}

/// A side an arrow's end can keep to on what it would join, and the one it is near.
#[derive(Clone, Debug, PartialEq)]
pub struct SideHint {
	pub rect: Rect,
	pub side: Option<Side>,
}

/// A route drawn while an arrow's end or middle is carried, as an SVG path from (`x`, `y`).
#[derive(Clone, Debug, PartialEq)]
pub struct Route {
	pub x: f64,
	pub y: f64,
	pub d: String,
}

/// A shape being drawn with a tool, corner to corner.
#[derive(Clone, Debug, PartialEq)]
pub struct Draft {
	pub corners: Corners,
	/// `arrow`, `ellipse`, or any other tool's name.
	pub tool: String,
}

/// What the overlay is worked out from: the editor's state as it stands, and the caller's answers for arrows and radius.
#[derive(Clone, Debug, Default)]
pub struct Input {
	pub selection: Vec<String>,
	pub typing: Option<String>,
	/// The selection's drag as the canvas shows it.
	pub drag: Offset,
	/// The drag as the pointer has it: the radius handle hides for it at once.
	pub pointer_drag: Offset,
	/// A drop's glide in hand: how far each gliding item is still drawn from where it lands.
	pub glide: HashMap<String, Offset>,
	pub resize: Option<(String, Rect)>,
	pub boards: Vec<PageBox>,
	pub page_picks: Vec<String>,
	pub page_drag: Option<(Vec<String>, Offset)>,
	/// The board the app has selected.
	pub selected: Option<String>,
	pub page_resize: Option<(String, Rect)>,
	pub marquee: Option<Corners>,
	pub editable: bool,
	pub drafting: bool,
	pub resizing: bool,
	pub editing: bool,
	pub hover_item: Option<String>,
	pub hover_page: Option<String>,
	pub panning: bool,
	pub zoom: f64,
	/// A press in hand: what is hovered is not outlined with its kin, nor measured to.
	pub gesture: bool,
	pub alt: bool,
	pub resizable: bool,
	pub drop_into: Option<String>,
	pub drop_line: Option<Rect>,
	pub drop_slots: Vec<Rect>,
	pub drop_frames: Vec<Rect>,
	pub radius_drag: Option<(String, f64)>,
	pub joins: Vec<Rect>,
	pub sides: Vec<SideHint>,
	pub guides: Vec<Guide>,
	pub draft: Option<Draft>,
	pub route: Option<Route>,
	pub end_draft: Option<Corners>,
	/// The one selected arrow's ends (`arrows::arrow_handles`), and the one selected item's radius (`resize::radius_start`).
	pub arrow: Option<ArrowEnds>,
	pub radius: Option<RadiusAt>,
}

/// Everything drawn over the canvas, as places: what the painter draws, and what the page keeps hit areas for.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Drawn {
	pub outlines: Vec<Outline>,
	pub kin: Vec<KinBox>,
	/// One box round every selected item and board, and whether there are several.
	pub frame: Option<(Rect, bool)>,
	pub distances: Option<(Rect, Rect, Vec<MeasureLine>)>,
	pub handles: Option<Outline>,
	pub anchors: Option<Rect>,
	pub page_handles: Option<(String, Rect)>,
	pub radius: Option<RadiusAt>,
	pub radius_drag: Option<(String, f64)>,
	pub arrow: Option<ArrowEnds>,
	pub hover: Option<(Rect, bool)>,
	pub drop: Option<Rect>,
	pub insert: Option<Rect>,
	pub slots: Vec<Rect>,
	pub slot_frames: Vec<Rect>,
	pub joins: Vec<Rect>,
	pub sides: Vec<SideHint>,
	pub guides: Vec<Guide>,
	pub draft: Option<Draft>,
	pub route: Option<Route>,
	pub end_draft: Option<Corners>,
}

const NO_SHIFT: Offset = Offset { dx: 0.0, dy: 0.0 };

fn rounded(scene: &dyn Scene, id: &str) -> bool {
	matches!(scene.kind(id), "note" | "prompt" | "context")
}

/// How far a drop's glide still draws an item from where it lands: its own shift, or that of the nearest parent that glides.
pub fn glide_shift(glide: &HashMap<String, Offset>, scene: &dyn Scene, id: &str) -> Offset {
	if glide.is_empty() {
		return NO_SHIFT;
	}
	let mut at = Some(id.to_string());
	while let Some(one) = at {
		if let Some(shift) = glide.get(&one) {
			return *shift;
		}
		at = scene.parent(&one);
	}
	NO_SHIFT
}

fn moved(r: Rect, by: Offset) -> Rect {
	Rect { x: r.x + by.dx, y: r.y + by.dy, ..r }
}

/// Where each selected item is now, moved by a drag and sized by a resize; each board picked up and the app's selected board; the marquee.
/// Never an arrow (its end handles show it) or the item typed into, and only an item the sheet has drawn.
pub fn selection_outlines(input: &Input, scene: &dyn Scene) -> Vec<Outline> {
	let mut out = Vec::new();
	for id in &input.selection {
		if input.typing.as_ref() == Some(id) {
			continue;
		}
		if let Some((rid, rect)) = &input.resize {
			if rid == id {
				out.push(Outline { id: id.clone(), role: Role::Item, rect: *rect, round: rounded(scene, id) });
				continue;
			}
		}
		if scene.node(id).is_some_and(pen::is_arrow) {
			continue;
		}
		if let Some(b) = scene.drawn(id) {
			let glide = glide_shift(&input.glide, scene, id);
			out.push(Outline { id: id.clone(), role: Role::Item, rect: moved(moved(b, input.drag), glide), round: rounded(scene, id) });
		}
	}
	let shift_of = |path: &str| input.page_drag.as_ref().filter(|(paths, _)| paths.iter().any(|p| p == path)).map(|(_, by)| *by).unwrap_or(NO_SHIFT);
	for path in &input.page_picks {
		if let Some(board) = input.boards.iter().find(|b| &b.path == path) {
			out.push(Outline { id: format!("page:{path}"), role: Role::Page, rect: moved(board.rect(), shift_of(path)), round: true });
		}
	}
	if let Some(chosen) = input.selected.as_ref().filter(|chosen| !input.page_picks.contains(chosen)) {
		if let Some(board) = input.boards.iter().find(|b| &b.path == chosen) {
			let rect = match &input.page_resize {
				Some((path, sized)) if path == chosen => *sized,
				_ => moved(board.rect(), shift_of(chosen)),
			};
			out.push(Outline { id: format!("page:{chosen}"), role: Role::Page, rect, round: true });
		}
	}
	if let Some(m) = &input.marquee {
		out.push(Outline { id: String::new(), role: Role::Marquee, rect: m.rect(), round: false });
	}
	out
}

/// Whether a box is too small on the screen, both ways, at this zoom, to wear handles (`handle.min-px`).
pub fn too_small_for_handles(r: &Rect, zoom: f64, rules: &Rules) -> bool {
	r.w * zoom < rules.handle_min && r.h * zoom < rules.handle_min
}

/// One item selected, not an arrow or a group, and big enough on the screen: it gets handles.
pub fn item_handles(outlines: &[Outline], scene: &dyn Scene, zoom: f64, rules: &Rules) -> Option<Outline> {
	let [one] = outlines else { return None };
	if one.role != Role::Item || too_small_for_handles(&one.rect, zoom, rules) {
		return None;
	}
	let node = scene.node(&one.id)?;
	if pen::tag(node) == pen::ARROW || pen::kind(node) == "group" {
		return None;
	}
	Some(one.clone())
}

/// Where an arrow can leave the one selected item from: not a line or words, nothing being drawn or sized, and only where the rules show anchors.
pub fn arrow_anchors(handles: Option<&Outline>, input: &Input, scene: &dyn Scene, rules: &Rules) -> Option<Rect> {
	let handles = handles?;
	if input.drafting || input.resizing || !input.editable || !rules.arrow_anchors {
		return None;
	}
	let kind = scene.kind(&handles.id);
	(kind != "path" && kind != "text" && !kind.is_empty()).then_some(handles.rect)
}

/// The selected board's box, when it alone is selected, can be resized, is not carried, and is big enough to wear handles.
pub fn page_handles(outlines: &[Outline], input: &Input, rules: &Rules) -> Option<(String, Rect)> {
	let [one] = outlines else { return None };
	if !input.resizable || input.page_drag.is_some() || one.role != Role::Page || too_small_for_handles(&one.rect, input.zoom, rules) {
		return None;
	}
	let path = one.id.strip_prefix("page:")?;
	input.boards.iter().any(|b| b.path == path).then(|| (path.to_string(), one.rect))
}

/// The hovered item's box as drawn now, or the board under the pointer; none in browse mode, nor round an arrow, the item typed into, or the selected board.
pub fn hover_box(input: &Input, scene: &dyn Scene) -> Option<(Rect, bool)> {
	if !input.editing {
		return None;
	}
	if let Some(id) = &input.hover_item {
		if input.typing.as_ref() != Some(id) && !scene.node(id).is_some_and(pen::is_arrow) {
			if let Some(b) = scene.drawn(id) {
				return Some((moved(b, glide_shift(&input.glide, scene, id)), rounded(scene, id)));
			}
		}
	}
	let busy = input.page_drag.is_some() || input.panning;
	let path = input.hover_page.as_ref().filter(|path| input.selected.as_ref() != Some(*path) && !busy)?;
	input.boards.iter().find(|b| &b.path == path).map(|b| (b.rect(), true))
}

/// What the selection sits in and holds, and what the hovered item does: parents solid all the way up, the one selected item's children
/// dashed while it is still; in edit mode the hovered item's parent and children. Never the selection itself, the item typed into, or an arrow.
pub fn kin_outlines(input: &Input, scene: &dyn Scene) -> Vec<KinBox> {
	let mut out = Vec::new();
	let selected: HashSet<&String> = input.selection.iter().collect();
	let mut seen = HashSet::new();
	let mut add = |id: String, kin: Kin, out: &mut Vec<KinBox>| {
		if selected.contains(&id) || seen.contains(&id) || input.typing.as_ref() == Some(&id) || scene.node(&id).is_some_and(pen::is_arrow) {
			return;
		}
		let Some(b) = scene.drawn(&id) else { return };
		let rect = moved(b, glide_shift(&input.glide, scene, &id));
		let round = rounded(scene, &id);
		seen.insert(id.clone());
		out.push(KinBox { id, kin, rect, round });
	};
	let moving = input.drag.dx != 0.0 || input.drag.dy != 0.0;
	if input.typing.is_none() {
		for id in &input.selection {
			let mut up = parent_of(scene, id);
			while let Some(parent) = up {
				up = parent_of(scene, &parent);
				add(parent, Kin::Parent, &mut out);
			}
		}
		if let [one] = input.selection.as_slice() {
			if !moving && !input.resizing {
				for child in children_of(scene, one) {
					add(child, Kin::Child, &mut out);
				}
			}
		}
	}
	let busy = input.page_drag.is_some() || input.panning || input.gesture;
	if let Some(over) = input.hover_item.as_ref().filter(|over| input.editing && !busy && !selected.contains(over) && input.typing.as_ref() != Some(*over)) {
		if let Some(up) = parent_of(scene, over) {
			add(up, Kin::Parent, &mut out);
		}
		for child in children_of(scene, over) {
			add(child, Kin::Child, &mut out);
		}
	}
	out
}

/// The size a box is said to be, in stage pixels, rounded.
pub fn size_label(r: &Rect) -> String {
	format!("{} × {}", r.w.round(), r.h.round())
}

/// One box round every selected item and board (not the marquee), and whether it holds several.
pub fn selection_frame(outlines: &[Outline]) -> Option<(Rect, bool)> {
	let picked: Vec<&Outline> = outlines.iter().filter(|one| one.role != Role::Marquee).collect();
	let first = picked.first()?;
	let rect = picked.iter().skip(1).fold(first.rect, |all, one| all.union(&one.rect));
	Some((rect, picked.len() > 1))
}

/// The distances between two boxes with Alt held, from `a`, the selection, to `b`, what is under the pointer.
pub fn measure(a: &Rect, b: &Rect) -> Vec<MeasureLine> {
	let mut out = Vec::new();
	let line = |x1: f64, y1: f64, x2: f64, y2: f64, label: f64| MeasureLine { x1, y1, x2, y2, label: Some(format!("{}", label.round())), dashed: false };
	let dashed = |x1: f64, y1: f64, x2: f64, y2: f64| MeasureLine { x1, y1, x2, y2, label: None, dashed: true };
	let (ay, ax) = (a.cy(), a.cx());
	let across = |x1: f64, x2: f64, y: f64, out: &mut Vec<MeasureLine>| {
		if x2 - x1 > 0.005 {
			out.push(line(x1, y, x2, y, x2 - x1));
		}
	};
	if a.right() <= b.x || b.right() <= a.x {
		let right = a.right() <= b.x;
		across(if right { a.right() } else { b.right() }, if right { b.x } else { a.x }, ay, &mut out);
		if ay < b.y || ay > b.bottom() {
			let ex = if right { b.x } else { b.right() };
			out.push(dashed(ex, ay, ex, if ay < b.y { b.y } else { b.bottom() }));
		}
	} else if b.x <= a.x && b.right() >= a.right() {
		across(b.x, a.x, ay, &mut out);
		across(a.right(), b.right(), ay, &mut out);
	}
	let down = |y1: f64, y2: f64, x: f64, out: &mut Vec<MeasureLine>| {
		if y2 - y1 > 0.005 {
			out.push(line(x, y1, x, y2, y2 - y1));
		}
	};
	if a.bottom() <= b.y || b.bottom() <= a.y {
		let below = a.bottom() <= b.y;
		down(if below { a.bottom() } else { b.bottom() }, if below { b.y } else { a.y }, ax, &mut out);
		if ax < b.x || ax > b.right() {
			let ey = if below { b.y } else { b.bottom() };
			out.push(dashed(ax, ey, if ax < b.x { b.x } else { b.right() }, ey));
		}
	} else if b.y <= a.y && b.bottom() >= a.bottom() {
		down(b.y, a.y, ax, &mut out);
		down(a.bottom(), b.bottom(), ax, &mut out);
	}
	out
}

/// Everything drawn over the canvas, from the editor's state and the scene.
pub fn derive(input: &Input, scene: &dyn Scene, rules: &Rules) -> Drawn {
	let outlines = selection_outlines(input, scene);
	let handles = item_handles(&outlines, scene, input.zoom, rules);
	let busy = input.page_drag.is_some() || input.panning;
	let hover = hover_box(input, scene);
	let frame = selection_frame(&outlines);
	let distances = match (&frame, &hover) {
		(Some((from, _)), Some((to, _))) if input.editing && input.alt && !busy && !input.gesture && input.marquee.is_none() => Some((*from, *to, measure(from, to))),
		_ => None,
	};
	let radius = handles.as_ref().and(input.radius).filter(|_| !input.resizing && input.pointer_drag.dx == 0.0 && input.pointer_drag.dy == 0.0 && input.editable);
	let arrow = (input.selection.len() == 1 && input.page_picks.is_empty()).then(|| input.arrow.clone()).flatten();
	Drawn {
		anchors: arrow_anchors(handles.as_ref(), input, scene, rules),
		page_handles: page_handles(&outlines, input, rules),
		kin: kin_outlines(input, scene),
		outlines,
		frame,
		distances,
		handles,
		radius,
		radius_drag: input.radius_drag.clone(),
		arrow,
		hover,
		drop: input.drop_into.as_ref().and_then(|into| scene.bounds(into)),
		insert: input.drop_line,
		slots: input.drop_slots.clone(),
		slot_frames: input.drop_frames.clone(),
		joins: input.joins.clone(),
		sides: input.sides.clone(),
		guides: input.guides.clone(),
		draft: input.draft.clone(),
		route: input.route.clone(),
		end_draft: input.end_draft,
	}
}

/// The top-left corner of a `size`-wide handle centred on its edge or corner of `r`.
pub fn handle_at(r: &Rect, handle: &str, size: f64) -> Pt {
	let x = if handle.contains('w') { 0.0 } else if handle.contains('e') { r.w } else { r.w / 2.0 };
	let y = if handle.contains('n') { 0.0 } else if handle.contains('s') { r.h } else { r.h / 2.0 };
	Pt::new(r.x + x - size / 2.0, r.y + y - size / 2.0)
}

/// The middle of a side of a box.
pub fn side_point(r: &Rect, side: Side) -> Pt {
	match side {
		Side::Top => Pt::new(r.cx(), r.y),
		Side::Bottom => Pt::new(r.cx(), r.bottom()),
		Side::Left => Pt::new(r.x, r.cy()),
		Side::Right => Pt::new(r.right(), r.cy()),
	}
}

/// The centre of the arrow anchor on `side`, `gap` out from the middle of that side.
pub fn anchor_at(r: &Rect, side: Side, gap: f64) -> Pt {
	let p = side_point(r, side);
	let (nx, ny) = match side {
		Side::Top => (0.0, -1.0),
		Side::Bottom => (0.0, 1.0),
		Side::Left => (-1.0, 0.0),
		Side::Right => (1.0, 0.0),
	};
	Pt::new(p.x + nx * gap, p.y + ny * gap)
}

/// How far in from the corner the radius handle sits: clear of the corner handle, never past the middle.
pub fn radius_inset(radius: f64, size: f64, most: f64) -> f64 {
	radius.max(size).min(most)
}

/// How far a handle's hit zone reaches past its drawn box on each side, in stage pixels (`handle.reach-px`).
pub fn hit_reach(size: f64, zoom: f64, rules: &Rules) -> f64 {
	((rules.handle_reach / zoom - size) / 2.0).max(0.0)
}

/// The colours the painter draws in, red, green, blue from 0 to 1: the accent, the guides' red, the panel handles are filled with.
#[derive(Clone, Copy, Debug)]
pub struct Colours {
	pub accent: [f32; 3],
	pub guide: [f32; 3],
	pub panel: [f32; 3],
}

const ROUND: f64 = 12.0;
const SQUARE: f64 = 4.0;

fn boxed(r: &Rect, radius: f64, kind: &str) -> OverlayBox {
	OverlayBox { x: r.x, y: r.y, w: r.w, h: r.h, r: radius, kind: kind.into() }
}
fn line(x1: f64, y1: f64, x2: f64, y2: f64, kind: &str) -> OverlayLine {
	OverlayLine { x1, y1, x2, y2, kind: kind.into() }
}
fn dot(at: Pt, px: f64, kind: &str) -> OverlayDot {
	OverlayDot { x: at.x, y: at.y, px: px as f32, kind: kind.into() }
}

/// The path of an arrow being drawn: a straight line from corner to corner (the route it takes is the scene's once made).
fn draft_line(c: &Corners) -> String {
	format!("M{} {}L{} {}", c.x1, c.y1, c.x2, c.y2)
}

/// What the painter draws for the overlay: boxes, lines, paths and dots in canvas units, a handle's size on the screen by the rules.
pub fn paint(o: &Drawn, zoom: f64, rules: &Rules, colours: Colours) -> Overlay {
	let z = zoom.max(1e-6);
	let mut out = Overlay { accent: colours.accent, guide: colours.guide, panel: colours.panel, ..Default::default() };
	let many = o.frame.is_some_and(|(_, many)| many);
	for k in &o.kin {
		out.boxes.push(boxed(&k.rect, if k.round { ROUND } else { SQUARE }, if k.kin == Kin::Child { "kin-child" } else { "kin" }));
	}
	for b in &o.outlines {
		let kind = if many && b.role != Role::Marquee { "selection-thin" } else { "selection" };
		out.boxes.push(boxed(&b.rect, if b.round || b.role == Role::Page { ROUND } else { SQUARE }, kind));
	}
	if let Some((r, true)) = o.frame {
		out.boxes.push(boxed(&r, SQUARE, "selection-box"));
	}
	if let Some((r, round)) = o.hover {
		out.boxes.push(boxed(&r, if round { ROUND } else { SQUARE }, "hover"));
	}
	for j in o.joins.iter().chain(o.drop.iter()) {
		out.boxes.push(boxed(j, SQUARE, "join"));
	}
	for f in &o.slot_frames {
		out.boxes.push(boxed(f, SQUARE, "slot-frame"));
	}
	for l in &o.slots {
		out.lines.push(line(l.x, l.y, l.right(), l.bottom(), "slot"));
	}
	if let Some(l) = &o.insert {
		out.lines.push(line(l.x, l.y, l.right(), l.bottom(), "insert"));
	}
	for hint in &o.sides {
		for side in SIDES {
			let on = hint.side == Some(side);
			out.dots.push(dot(side_point(&hint.rect, side), if on { 12.0 } else { 8.0 }, if on { "side-on" } else { "side" }));
		}
	}
	if let Some(r) = &o.anchors {
		for side in SIDES {
			out.dots.push(dot(anchor_at(r, side, rules.anchor_out / z), rules.anchor_size, "anchor"));
		}
	}
	for g in &o.guides {
		out.lines.push(line(g.x1, g.y1, g.x2, g.y2, "guide"));
		if g.kind == GuideKind::Gap {
			let tick = 4.0 / z;
			let across = g.y1 == g.y2;
			for (x, y) in [(g.x1, g.y1), (g.x2, g.y2)] {
				out.lines.push(if across { line(x, y - tick, x, y + tick, "guide") } else { line(x - tick, y, x + tick, y, "guide") });
			}
		}
		for p in &g.points {
			let arm = 2.5 / z;
			out.lines.push(line(p.x - arm, p.y - arm, p.x + arm, p.y + arm, "guide"));
			out.lines.push(line(p.x + arm, p.y - arm, p.x - arm, p.y + arm, "guide"));
		}
	}
	if let Some((from, to, lines)) = &o.distances {
		out.boxes.push(boxed(from, 0.0, "measure"));
		out.boxes.push(boxed(to, 0.0, "measure"));
		for l in lines {
			out.lines.push(line(l.x1, l.y1, l.x2, l.y2, if l.dashed { "measure-dashed" } else { "measure" }));
		}
	}
	if let Some(a) = &o.arrow {
		out.dots.push(dot(a.from, rules.arrow_end, if a.from_joined { "diamond" } else { "end" }));
		out.dots.push(dot(a.to, rules.arrow_end, if a.to_joined { "diamond" } else { "end" }));
		if let Some(m) = a.middle {
			out.dots.push(dot(m, rules.arrow_bend, if a.bent { "bend-bent" } else { "bend" }));
		}
	}
	if let Some(r) = &o.route {
		out.paths.push(OverlayPath { x: r.x, y: r.y, d: r.d.clone(), kind: "route".into() });
	}
	if let Some(c) = &o.end_draft {
		out.lines.push(line(c.x1, c.y1, c.x2, c.y2, "draft"));
	}
	let size = rules.handle_size / z;
	let handle_kind = if rules.handle_round { "handle-round" } else { "handle" };
	let handle_dots = |r: &Rect, dots: &mut Vec<OverlayDot>| {
		for handle in crate::resize::HANDLES {
			// The corners only where the rules say (`handle.which`): the edges still answer a press, unseen.
			if rules.handle_corners_only && !handle.corner() {
				continue;
			}
			let at = handle_at(r, handle.name(), size);
			dots.push(dot(Pt::new(at.x + size / 2.0, at.y + size / 2.0), rules.handle_size, handle_kind));
		}
	};
	if let Some(h) = &o.handles {
		handle_dots(&h.rect, &mut out.dots);
	}
	if let Some((_, r)) = &o.page_handles {
		handle_dots(r, &mut out.dots);
	}
	if let Some(r) = &o.radius {
		let shown = o.radius_drag.as_ref().map(|(_, radius)| *radius).unwrap_or(r.radius);
		let inset = radius_inset(shown, size, r.most);
		out.dots.push(dot(Pt::new(r.rect.x + inset, r.rect.y + inset), rules.handle_size, "radius"));
	}
	if let Some(d) = &o.draft {
		if d.tool == "arrow" {
			out.paths.push(OverlayPath { x: 0.0, y: 0.0, d: draft_line(&d.corners), kind: "route".into() });
		} else {
			out.boxes.push(boxed(&d.corners.rect(), 0.0, if d.tool == "ellipse" { "draft-ellipse" } else { "draft" }));
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::rules::{Form, Rules};
	use crate::scene::{Fake, FakeItem};

	const COLOURS: Colours = Colours { accent: [0.0, 0.0, 1.0], guide: [1.0, 0.0, 0.0], panel: [1.0, 1.0, 1.0] };

	fn scene() -> Fake {
		Fake::new(vec![
			FakeItem::rect("frame", 0.0, 0.0, 400.0, 300.0).kind("frame"),
			FakeItem::rect("a", 20.0, 20.0, 100.0, 50.0).inside("frame"),
			FakeItem::rect("b", 200.0, 20.0, 100.0, 50.0).inside("frame"),
			FakeItem::rect("note", 600.0, 0.0, 200.0, 100.0).kind("note"),
			FakeItem::rect("tiny", 900.0, 0.0, 4.0, 4.0),
		])
	}
	fn selected(ids: &[&str]) -> Input {
		Input { selection: ids.iter().map(|s| s.to_string()).collect(), zoom: 1.0, editable: true, editing: true, ..Default::default() }
	}
	fn dots<'a>(o: &'a Overlay, kind: &str) -> Vec<&'a OverlayDot> {
		o.dots.iter().filter(|d| d.kind == kind).collect()
	}

	#[test]
	fn rules_handle_which_shape_and_size_eight_squares_on_a_desk_four_corner_dots_on_touch() {
		let s = scene();
		for form in Form::ALL {
			let rules = Rules::for_form(form);
			let drawn = derive(&selected(&["a"]), &s, &rules);
			let painted = paint(&drawn, 1.0, &rules, COLOURS);
			let kind = if rules.handle_round { "handle-round" } else { "handle" };
			let handles = dots(&painted, kind);
			assert_eq!(handles.len(), if rules.handle_corners_only { 4 } else { 8 }, "{form:?}");
			assert!(handles.iter().all(|d| d.px as f64 == rules.handle_size), "{form:?}");
		}
		assert_eq!(Rules::desk().handle_size, 9.0);
		assert!(Rules::phone().handle_round && Rules::phone().handle_corners_only);
	}

	#[test]
	fn rules_arrow_anchors_show_round_a_selected_item_on_a_desk_and_not_on_touch() {
		let s = scene();
		let desk = paint(&derive(&selected(&["a"]), &s, &Rules::desk()), 1.0, &Rules::desk(), COLOURS);
		assert_eq!(dots(&desk, "anchor").len(), 4);
		assert!(dots(&desk, "anchor").iter().all(|d| d.px as f64 == Rules::desk().anchor_size));
		for rules in [Rules::tablet(), Rules::phone()] {
			let touch = paint(&derive(&selected(&["a"]), &s, &rules), 1.0, &rules, COLOURS);
			assert!(dots(&touch, "anchor").is_empty());
		}
	}

	#[test]
	fn rules_handle_min_an_item_under_ten_px_on_the_screen_both_ways_wears_no_handles() {
		let s = scene();
		let rules = Rules::desk();
		assert!(derive(&selected(&["tiny"]), &s, &rules).handles.is_none());
		// At 300% the 4 px item is 12 px across: big enough.
		assert!(derive(&Input { zoom: 3.0, ..selected(&["tiny"]) }, &s, &rules).handles.is_some());
	}

	#[test]
	fn a_selection_is_outlined_where_the_drag_has_it_and_several_get_one_box_round_them() {
		let s = scene();
		let rules = Rules::desk();
		let drawn = derive(&Input { drag: Offset { dx: 10.0, dy: 5.0 }, ..selected(&["a", "b"]) }, &s, &rules);
		assert_eq!(drawn.outlines.iter().map(|o| (o.rect.x, o.rect.y)).collect::<Vec<_>>(), vec![(30.0, 25.0), (210.0, 25.0)]);
		assert_eq!(drawn.frame, Some((Rect { x: 30.0, y: 25.0, w: 280.0, h: 50.0 }, true)));
		assert!(drawn.handles.is_none(), "two selected wear no handles");
		let painted = paint(&drawn, 1.0, &rules, COLOURS);
		assert_eq!(painted.boxes.iter().filter(|b| b.kind == "selection-thin").count(), 2);
		assert_eq!(painted.boxes.iter().filter(|b| b.kind == "selection-box").count(), 1);
		assert_eq!(size_label(&drawn.frame.unwrap().0), "280 × 50");
	}

	#[test]
	fn a_selected_items_parent_is_outlined_solid_and_a_selected_frames_children_dashed() {
		let s = scene();
		let kin = derive(&selected(&["a"]), &s, &Rules::desk()).kin;
		assert_eq!(kin.iter().map(|k| (k.id.as_str(), k.kin)).collect::<Vec<_>>(), vec![("frame", Kin::Parent)]);
		let kin = derive(&selected(&["frame"]), &s, &Rules::desk()).kin;
		assert_eq!(kin.iter().map(|k| (k.id.as_str(), k.kin)).collect::<Vec<_>>(), vec![("a", Kin::Child), ("b", Kin::Child)]);
		let still = derive(&Input { drag: Offset { dx: 3.0, dy: 0.0 }, ..selected(&["frame"]) }, &s, &Rules::desk()).kin;
		assert!(still.is_empty(), "no children outlined while it moves");
	}

	#[test]
	fn the_hover_outlines_only_in_edit_mode_and_a_note_round() {
		let s = scene();
		let input = Input { hover_item: Some("note".into()), ..selected(&[]) };
		assert_eq!(derive(&input, &s, &Rules::desk()).hover, Some((Rect { x: 600.0, y: 0.0, w: 200.0, h: 100.0 }, true)));
		assert_eq!(derive(&Input { editing: false, ..input }, &s, &Rules::desk()).hover, None);
	}

	#[test]
	fn alt_measures_from_the_selection_to_what_is_hovered() {
		let s = scene();
		let input = Input { alt: true, hover_item: Some("b".into()), ..selected(&["a"]) };
		let (_, _, lines) = derive(&input, &s, &Rules::desk()).distances.expect("distances");
		assert_eq!(lines.len(), 1);
		assert_eq!(lines[0].label.as_deref(), Some("80"));
	}

	#[test]
	fn rules_arrow_end_and_bend_an_arrows_handles_are_finger_sized_on_touch() {
		let s = scene();
		let arrow = ArrowEnds { from: Pt::new(0.0, 0.0), to: Pt::new(100.0, 0.0), from_joined: true, to_joined: false, middle: Some(Pt::new(50.0, 0.0)), bent: false };
		for form in Form::ALL {
			let rules = Rules::for_form(form);
			let painted = paint(&derive(&Input { arrow: Some(arrow.clone()), ..selected(&["a"]) }, &s, &rules), 1.0, &rules, COLOURS);
			assert_eq!(dots(&painted, "diamond")[0].px as f64, rules.arrow_end);
			assert_eq!(dots(&painted, "end")[0].px as f64, rules.arrow_end);
			assert_eq!(dots(&painted, "bend")[0].px as f64, rules.arrow_bend);
		}
		assert_eq!((Rules::desk().arrow_end, Rules::tablet().arrow_end), (11.0, 18.0));
	}

	#[test]
	fn a_handle_answers_as_far_as_the_rules_reach() {
		let size = Rules::desk().handle_size;
		assert_eq!(hit_reach(size, 1.0, &Rules::desk()), (15.0 - 9.0) / 2.0);
		assert_eq!(hit_reach(Rules::tablet().handle_size, 1.0, &Rules::tablet()), (44.0 - 10.0) / 2.0);
	}
}
