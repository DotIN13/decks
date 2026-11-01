//! The pen ops an edit of the drawing writes (`edit/core/ops.ts`): moving items (into a frame, out
//! of one, along its order), copying them, duplicating, deleting, and making a new one with a tool.
//! Each builder returns the ops the page sends (`model::Op`, `@decks/pen`'s own JSON), and the ids
//! of what it made where the selection should follow them; sending them, and selecting, is the page's.
//!
//! Ids come from a generator passed in (`id_maker` over the document's ids, a counter in the
//! tests), so the same call writes the same ops.

use crate::arrows::{ArrowRoute, end_item, first_subpath, js_num, js_round, numbers, truthy};
use crate::model::{BoxPart, Op, PageBox, Pt, Rect, Tool};
use crate::pen;
use crate::rules::Rules;
use crate::scene::{Props, Scene};
use serde::{Serialize, Serializer};
use serde_json::{Map, Value, json};
use std::collections::HashSet;

/// A board moved to its own new corner, as the page's `onMove` takes it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PageMove {
	pub path: String,
	#[serde(serialize_with = "whole")]
	pub x: f64,
	#[serde(serialize_with = "whole")]
	pub y: f64,
}

fn whole<S: Serializer>(n: &f64, serializer: S) -> Result<S::Ok, S::Error> {
	js_num(*n).serialize(serializer)
}

/// Copies made: the ops, and the ids they are made as, for the selection to follow.
#[derive(Clone, Debug, PartialEq)]
pub struct Copies {
	pub ops: Vec<Op>,
	pub made: Vec<String>,
}

/// The characters `@decks/pen`'s `newId` makes ids of.
const ID_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/// How long a new id is.
const ID_LENGTH: usize = 5;

/// Ids for several new items at once, none the same as another or as any already taken: five
/// letters and digits at random, as `@decks/pen`'s `newId` makes them.
pub fn id_maker<S: Into<String>>(taken: impl IntoIterator<Item = S>) -> impl FnMut() -> String {
	use std::hash::{BuildHasher, Hasher};
	let mut used: HashSet<String> = taken.into_iter().map(Into::into).collect();
	// Seeded without a clock, which a browser's wasm has none of in std: the hasher's keys, a count of the
	// makers made so far and how many ids are taken. Uniqueness is checked against `used` anyway.
	static MADE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
	let mut seed = std::collections::hash_map::RandomState::new().build_hasher();
	seed.write_u64(MADE.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
	seed.write_usize(used.len());
	let mut state = seed.finish() | 1;
	move || {
		loop {
			let mut id = String::with_capacity(ID_LENGTH);
			for _ in 0..ID_LENGTH {
				// xorshift64*: enough to spread ids; uniqueness is checked against `used`.
				state ^= state >> 12;
				state ^= state << 25;
				state ^= state >> 27;
				let n = state.wrapping_mul(0x2545_F491_4F6C_DD1D);
				id.push(ID_ALPHABET[((n >> 33) % ID_ALPHABET.len() as u64) as usize] as char);
			}
			if used.insert(id.clone()) {
				return id;
			}
		}
	}
}

/// An item's own number field, 0 when it has none.
fn own(node: &Props, key: &str) -> f64 {
	node.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

/// A point end, `[x, y]` on the stage (`isPointEnd`).
fn point_end(end: Option<&Value>) -> Option<[f64; 2]> {
	let pair = end?.as_array()?;
	if pair.len() != 2 {
		return None;
	}
	Some([pair[0].as_f64()?, pair[1].as_f64()?])
}

/// An arrow's metadata with its point ends moved by `dx dy`, to a tenth; joined ends stay joined (`moveArrowEnds`).
fn move_arrow_ends(metadata: &Map<String, Value>, dx: f64, dy: f64) -> Map<String, Value> {
	let mut next = metadata.clone();
	for key in ["from", "to"] {
		if let Some([x, y]) = point_end(metadata.get(key)) {
			next.insert(key.into(), json!([js_num(stage_scene::arrows::round(x + dx)), js_num(stage_scene::arrows::round(y + dy))]));
		}
	}
	next
}

/// What moving an item by `dx dy` sets. An arrow's point ends are on the stage rather than in its
/// box, so they move with it; its joined ends stay joined.
pub fn moved_by(node: &Props, dx: f64, dy: f64) -> Props {
	let mut set = Props::new();
	set.insert("x".into(), js_num(js_round(own(node, "x") + dx)));
	set.insert("y".into(), js_num(js_round(own(node, "y") + dy)));
	if pen::is_arrow(node)
		&& let Some(metadata) = pen::metadata(node)
	{
		set.insert("metadata".into(), Value::Object(move_arrow_ends(metadata, dx, dy)));
	}
	set
}

/// Whether an arrow's end names something still on the stage: an item, or a board by its path.
fn joins_something(scene: &dyn Scene, end: &str) -> bool {
	scene.node(end).is_some() || scene.boards().iter().any(|board| board.path == end)
}

/// An arrow joined at either end, carried while what that end joins stays: it does not move.
/// Dragging its line would only stretch it round the join, and an arrow's shape is changed by its
/// handles alone. It gets no op, so the drag lets it go back at once. A free arrow moves whole.
fn pinned(node: &Props, moving: &HashSet<&str>, scene: &dyn Scene) -> bool {
	if !pen::is_arrow(node) {
		return false;
	}
	let Some(metadata) = pen::metadata(node) else { return false };
	// An end that names an item no longer there joins nothing: it does not hold the arrow still.
	[metadata.get("from"), metadata.get("to")].into_iter().filter_map(end_item).any(|end| !moving.contains(end) && joins_something(scene, end))
}

/// Where an arrow's two ends are drawn now.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DrawnEnds {
	pub from: [f64; 2],
	pub to: [f64; 2],
}

/// Where an arrow's two ends are drawn now, on the stage, to whole pixels: the first and last point
/// of its line, the first subpath of its geometry, through its box. `None` for an arrow with no
/// geometry yet.
pub fn arrow_ends_drawn(node: &Props) -> Option<DrawnEnds> {
	let geometry = node.get("geometry")?.as_str()?;
	let n = numbers(first_subpath(geometry), false);
	if n.len() < 4 {
		return None;
	}
	let vb = node.get("viewBox").and_then(Value::as_array);
	let at = |i: usize| vb.and_then(|vb| vb.get(i)).and_then(Value::as_f64);
	let w = node.get("width").and_then(Value::as_f64);
	let h = node.get("height").and_then(Value::as_f64);
	let scale = |size: Option<f64>, i: usize| match (vb, size, at(i)) {
		(Some(_), Some(size), Some(span)) if truthy(size) && truthy(span) => size / span,
		_ => 1.0,
	};
	let (sx, sy) = (scale(w, 2), scale(h, 3));
	let (ox, oy) = (at(0).unwrap_or(0.0) * sx, at(1).unwrap_or(0.0) * sy);
	let place = |x: f64, y: f64| [js_round(own(node, "x") + x * sx - ox), js_round(own(node, "y") + y * sy - oy)];
	Some(DrawnEnds { from: place(n[0], n[1]), to: place(n[n.len() - 2], n[n.len() - 1]) })
}

/// An arrow's metadata with each end that joins something in `gone` (or no longer there at all) set
/// to the point it is drawn at now, so the arrow stays where it was, joined to nothing, and can be
/// moved. `None` when no end changes.
pub fn freed_ends(node: &Props, scene: &dyn Scene, gone: &HashSet<String>) -> Option<Map<String, Value>> {
	if !pen::is_arrow(node) {
		return None;
	}
	let metadata = pen::metadata(node)?;
	let loose = |key: &str| end_item(metadata.get(key)).is_some_and(|item| gone.contains(item) || !joins_something(scene, item));
	let (from_loose, to_loose) = (loose("from"), loose("to"));
	if !from_loose && !to_loose {
		return None;
	}
	let drawn = arrow_ends_drawn(node)?;
	let mut next = metadata.clone();
	let point = |[x, y]: [f64; 2]| json!([js_num(x), js_num(y)]);
	if from_loose {
		next.insert("from".into(), point(drawn.from));
	}
	if to_loose {
		next.insert("to".into(), point(drawn.to));
	}
	Some(next)
}

/// Move items by `dx dy`: a shift of their own `x` and `y`. A shift rather than a new corner,
/// because a group's box starts where its children do, not at its own `x` and `y`.
///
/// `into` is the parent the drag lets go in (`Some(None)` the stage), `None` when the parent is not
/// in question (the drag was held with ⌘, a nudge, nothing carried): then it is the plain move.
/// `slot` is where in a frame that stacks its children the first item goes.
pub fn move_ops<S: AsRef<str>>(scene: &dyn Scene, ids: &[S], dx: f64, dy: f64, into: Option<Option<&str>>, slot: Option<usize>) -> Vec<Op> {
	// Where the next item goes in a frame that stacks its children. The op takes the item out of the
	// tree before putting it back, so an item that was already above its new place lands one too far
	// down; `was < put` is that correction. A second item of a selection goes after the first.
	let mut put = slot;
	let moving: HashSet<&str> = ids.iter().map(AsRef::as_ref).collect();
	let mut ops = Vec::new();
	for id in ids.iter().map(AsRef::as_ref) {
		let Some(node) = scene.node(id) else { continue };
		let parent = scene.parent(id);
		let parent = parent.as_deref();
		// Not into another frame: an arrow that cannot move gets nothing.
		if into.is_none_or(|into| into == parent) && pinned(node, &moving, scene) {
			continue;
		}
		// Into a frame, or out of one onto the stage: a `move` with the parent and the box the item
		// ends up at in stage coordinates, which the server turns into the frame's own x and y. A
		// slot means the frame arranges its children, so a drag inside one reorders it: an op even
		// where the parent is unchanged.
		if let Some(into) = into
			&& (into != parent || put.is_some())
		{
			let mut index = None;
			if let Some(at) = put {
				let was = into.filter(|frame| Some(*frame) == parent).and_then(|frame| scene.children(frame).iter().position(|child| child == id));
				index = Some(at.saturating_sub(usize::from(was.is_some_and(|was| was < at))));
				put = Some(at + 1);
			}
			let to = Some(into.map_or(Value::Null, |frame| Value::String(frame.into())));
			if let Some(area) = scene.placed(id) {
				let moved = BoxPart { x1: Some(js_round(area.x + dx)), y1: Some(js_round(area.y + dy)), x2: Some(js_round(area.x + dx + area.w)), y2: Some(js_round(area.y + dy + area.h)) };
				ops.push(Op::Move { id: id.into(), parent: to, index, area: Some(moved) });
				// Markdown words in a card are as wide as it; out of one, they keep the width they had.
				if into.is_some_and(|frame| scene.node(frame).is_some_and(pen::is_card)) && pen::is_markdown_text(node) {
					let mut set = Props::new();
					set.insert("width".into(), "fill_container".into());
					set.insert("textGrowth".into(), "fixed-width".into());
					ops.push(Op::set(id, set));
				}
				continue;
			}
			if index.is_some() {
				ops.push(Op::Move { id: id.into(), parent: to, index, area: None });
				continue;
			}
		}
		// An arrow whose ends name items that are gone moves as a free one: those ends become the points they are drawn at.
		let set = match freed_ends(node, scene, &HashSet::new()) {
			Some(freed) => {
				let mut free = node.clone();
				free.insert("metadata".into(), Value::Object(freed));
				moved_by(&free, dx, dy)
			}
			None => moved_by(node, dx, dy),
		};
		ops.push(Op::set(id, set));
	}
	ops
}

/// Copies of items, `dx dy` from where they are, and the ids they are made as: an Alt-drag lets go
/// of copies and leaves the originals.
pub fn copy_ops<S: AsRef<str>>(scene: &dyn Scene, ids: &[S], dx: f64, dy: f64, next_id: &mut dyn FnMut() -> String) -> Copies {
	let mut copies = Copies { ops: Vec::new(), made: Vec::new() };
	for id in ids.iter().map(AsRef::as_ref) {
		let Some(node) = scene.node(id) else { continue };
		let made = next_id();
		copies.ops.push(Op::Copy { id: id.into(), parent: None, index: None, area: None, as_id: Some(made.clone()) });
		copies.ops.push(Op::set(&made, moved_by(node, dx, dy)));
		copies.made.push(made);
	}
	copies
}

/// A copy of each item, the rules' duplicate offset down and right of it (⌘D, the pill's Duplicate).
pub fn duplicate_ops<S: AsRef<str>>(scene: &dyn Scene, ids: &[S], next_id: &mut dyn FnMut() -> String, rules: &Rules) -> Copies {
	copy_ops(scene, ids, rules.duplicate_offset, rules.duplicate_offset, next_id)
}

/// Take items off the canvas. Given the scene, an arrow joined to something deleted is let go at
/// that end, where it is drawn now, rather than left naming an item that is gone (such an arrow
/// counted as joined and could not be moved). What is inside a deleted frame or group goes with it,
/// so its joins are let go too.
pub fn delete_ops<S: AsRef<str>>(ids: &[S], scene: Option<&dyn Scene>) -> Vec<Op> {
	let deleting = ids.iter().map(|id| Op::Delete { id: id.as_ref().into() });
	let Some(scene) = scene else { return deleting.collect() };
	let mut gone = HashSet::new();
	let mut take: Vec<String> = ids.iter().map(|id| id.as_ref().to_string()).collect();
	while let Some(id) = take.pop() {
		take.extend(scene.children(&id));
		gone.insert(id);
	}
	let mut ops = Vec::new();
	for id in scene.items() {
		if gone.contains(&id) {
			continue;
		}
		let Some(node) = scene.node(&id) else { continue };
		if let Some(freed) = freed_ends(node, scene, &gone) {
			let mut set = Props::new();
			set.insert("metadata".into(), Value::Object(freed));
			ops.push(Op::set(&id, set));
		}
	}
	ops.extend(deleting);
	ops
}

/// Boards moved by `dx dy`, each to its own new corner, rounded; a path not on the stage is left out.
pub fn page_moves<S: AsRef<str>>(boards: &[PageBox], paths: &[S], dx: f64, dy: f64) -> Vec<PageMove> {
	paths
		.iter()
		.filter_map(|path| {
			let board = boards.iter().find(|candidate| candidate.path == path.as_ref())?;
			Some(PageMove { path: board.path.clone(), x: js_round(board.x + dx), y: js_round(board.y + dy) })
		})
		.collect()
}

// What a frame starts with. The padding is what makes a frame readable as a container rather than
// an outline round its contents, and the radius is that padding plus a card's own corner: nested
// corners look right when the gap between the two curves is the same all the way round.
pub const FRAME_PAD: f64 = 18.0;
/// A note's and a card's corner (`pen/look.ts` `NOTE_RADIUS`).
pub const NOTE_CORNER: f64 = 12.0;
pub const FRAME_RADIUS: f64 = NOTE_CORNER + FRAME_PAD;

/// A tool that makes an item at a point, by a click or a drag: all but select and arrow.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MakingTool {
	Note,
	Card,
	Text,
	Rectangle,
	Ellipse,
	Frame,
	Shape,
	Icon,
}

impl MakingTool {
	/// The making tool a tool is; `None` for select and arrow.
	pub fn of(tool: Tool) -> Option<MakingTool> {
		Some(match tool {
			Tool::Note => MakingTool::Note,
			Tool::Card => MakingTool::Card,
			Tool::Text => MakingTool::Text,
			Tool::Rectangle => MakingTool::Rectangle,
			Tool::Ellipse => MakingTool::Ellipse,
			Tool::Frame => MakingTool::Frame,
			Tool::Shape => MakingTool::Shape,
			Tool::Icon => MakingTool::Icon,
			Tool::Select | Tool::Arrow => return None,
		})
	}
}

/// A width and a height.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Size {
	pub w: f64,
	pub h: f64,
}

/// What a tool makes before its box, and the size a click makes it (one row of the TS `MADE`).
#[derive(Clone, Debug, PartialEq)]
pub struct ToolItem {
	pub node: Props,
	pub w: f64,
	pub h: f64,
}

/// What each tool makes, before its box (`MADE`): pen's own items, with nothing of ours in them but
/// their colours, the drawing's own light/dark variables. `None` for a shape and an icon, which are
/// made from what the insert panel picked (`made_node`).
pub fn made(tool: MakingTool) -> Option<ToolItem> {
	let (node, w, h) = match tool {
		MakingTool::Rectangle => (json!({ "type": "rectangle", "fill": "$decks-fill-slate", "cornerRadius": 8 }), 160.0, 100.0),
		MakingTool::Ellipse => (json!({ "type": "ellipse", "fill": "$decks-fill-sky" }), 120.0, 120.0),
		// A frame made by hand is a column that hugs what it holds, the height drawn its floor.
		MakingTool::Frame => (
			json!({ "type": "frame", "name": "Frame", "layout": "vertical", "gap": 12, "padding": js_num(FRAME_PAD), "fill": "$decks-surface", "stroke": "$decks-line-subtle", "strokeWidth": 1, "cornerRadius": js_num(FRAME_RADIUS), "clip": true }),
			400.0,
			120.0,
		),
		// A text's words are markdown, as a card's blocks are.
		MakingTool::Text => (json!({ "type": "text", "content": "", "fontSize": 24, "textGrowth": "fixed-width", "metadata": { "type": pen::MARKDOWN } }), 320.0, 32.0),
		// A card is pen's own frame, a column, whose blocks are markdown texts and pictures (`MakeOptions::card`).
		MakingTool::Card => (json!({ "type": "frame", "name": "Card" }), 320.0, 48.0),
		MakingTool::Note => (json!({ "type": "note", "content": "" }), 240.0, 80.0),
		MakingTool::Shape | MakingTool::Icon => return None,
	};
	let Value::Object(node) = node else { unreachable!("each node is an object") };
	Some(ToolItem { node, w, h })
}

/// Shapes that are as tall as they are wide when made with a click: a circle, a star, a ring.
pub const SQUARE_SHAPES: [&str; 9] = ["Ellipse", "Ring", "Star", "Octagon", "Pentagon", "Hexagon", "Plus", "Heart", "Triangle"];

/// The icon picked in the insert panel.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Icon<'a> {
	pub library: &'a str,
	pub name: &'a str,
}

/// What a tool makes depends on more than the tool: the shape and the icon picked in the insert
/// panel, ids for the items inside it, and a card's first block (`pen/card-frame.ts` `newCard`,
/// passed in because it is markdown's and not the editor's).
pub struct MakeOptions<'a> {
	pub shape: &'a str,
	pub icon: Icon<'a>,
	/// Ids for what the item holds (a shape's outline, a card's first block): never the item's own.
	pub next_id: &'a mut dyn FnMut() -> String,
	/// A card with its id and its first block's.
	pub card: &'a dyn Fn(&str, &str) -> Props,
	/// From the insert panel: the item is put with its middle at the point (`make_at_op` only).
	pub centred: bool,
	/// The frame it goes in; `None` the stage.
	pub parent: Option<&'a str>,
}

/// The size a click makes, for every tool: a shape's by its kind, an icon's 48 square.
pub fn made_size(tool: MakingTool, shape: &str) -> Size {
	match tool {
		MakingTool::Shape if SQUARE_SHAPES.contains(&shape) => Size { w: 120.0, h: 120.0 },
		MakingTool::Shape if shape == "Decision" => Size { w: 160.0, h: 120.0 },
		MakingTool::Shape => Size { w: 160.0, h: 100.0 },
		MakingTool::Icon => Size { w: 48.0, h: 48.0 },
		_ => made(tool).map(|m| Size { w: m.w, h: m.h }).unwrap_or(Size { w: 0.0, h: 0.0 }),
	}
}

/// The item a tool makes, with its id: a shape from the library, the icon picked, or the tool's own.
pub fn made_node(tool: MakingTool, id: &str, size: Size, options: &mut MakeOptions) -> Props {
	match tool {
		MakingTool::Shape => {
			let outline = (options.next_id)();
			make_shape(shape_kind(options.shape).unwrap_or(&SHAPES[0]), id, &outline, size)
		}
		MakingTool::Icon => {
			let icon = json!({ "type": "icon", "id": id, "name": options.icon.name, "library": options.icon.library, "icon": options.icon.name, "fill": "$decks-text", "weight": 400 });
			icon.as_object().cloned().unwrap_or_default()
		}
		// A card is a column frame of blocks, starting with one empty one.
		MakingTool::Card => {
			let block = (options.next_id)();
			(options.card)(id, &block)
		}
		_ => {
			let mut node = made(tool).map(|m| m.node).unwrap_or_default();
			node.insert("id".into(), id.into());
			node
		}
	}
}

/// A made item: the insert op, its node, and the box it is drawn at (a card's opens 80 tall for typing).
#[derive(Clone, Debug, PartialEq)]
pub struct Made {
	pub op: Op,
	pub node: Props,
	pub area: Rect,
}

/// The height a card opens at, for typing into.
const CARD_TYPING_H: f64 = 80.0;
/// The least a drawn item is, each way.
const DRAWN_MIN: f64 = 8.0;

fn insert_op(node: Props, area: BoxPart, parent: Option<&str>) -> Op {
	Op::Insert { parent: parent.map(|p| Value::String(p.into())), index: None, node, area: Some(area) }
}

fn typing_box(tool: MakingTool, x: f64, y: f64, w: f64, h: f64) -> Rect {
	Rect { x, y, w, h: if tool == MakingTool::Card { CARD_TYPING_H } else { h } }
}

/// One item of a tool, at its own size, at a stage point: a click with a tool armed, and a pick
/// from the canvas menu. From the insert panel (`centred`) the item is put with its middle there;
/// from a click, its corner. A note's height and a text's height are its words', so their box
/// leaves them out.
pub fn make_at_op(tool: MakingTool, id: &str, at: Pt, options: &mut MakeOptions) -> Made {
	let size = made_size(tool, options.shape);
	let x1 = js_round(if options.centred { at.x - size.w / 2.0 } else { at.x });
	let y1 = js_round(if options.centred { at.y - size.h / 2.0 } else { at.y });
	let area = match tool {
		MakingTool::Note => BoxPart { x1: Some(x1), y1: Some(y1), ..Default::default() },
		MakingTool::Text => BoxPart { x1: Some(x1), y1: Some(y1), x2: Some(x1 + size.w), y2: None },
		_ => BoxPart { x1: Some(x1), y1: Some(y1), x2: Some(x1 + size.w), y2: Some(y1 + size.h) },
	};
	let node = made_node(tool, id, size, options);
	Made { op: insert_op(node.clone(), area, options.parent), node, area: typing_box(tool, x1, y1, size.w, size.h) }
}

/// One item of a tool, drawn by a drag from `at` to `end`: the box between them, at least 8 each
/// way. A text grows with its words unless a width was drawn for it; its height is always its
/// words'. A card or a frame is as tall as its words, and the height drawn is the least it is.
pub fn drawn_op(tool: MakingTool, id: &str, at: Pt, end: Pt, options: &mut MakeOptions) -> Made {
	let x1 = js_round(at.x.min(end.x));
	let y1 = js_round(at.y.min(end.y));
	let w = DRAWN_MIN.max(js_round((end.x - at.x).abs()));
	let h = DRAWN_MIN.max(js_round((end.y - at.y).abs()));
	let area = if tool == MakingTool::Text { BoxPart { x1: Some(x1), y1: Some(y1), x2: Some(x1 + w), y2: None } } else { BoxPart { x1: Some(x1), y1: Some(y1), x2: Some(x1 + w), y2: Some(y1 + h) } };
	let node = made_node(tool, id, Size { w, h }, options);
	Made { op: insert_op(node.clone(), area, options.parent), node, area: typing_box(tool, x1, y1, w, h) }
}

/// Whether a new arrow has a head at its end or none.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ArrowHeads {
	#[default]
	End,
	None,
}

/// A new arrow's look: curved with a head at its end unless asked otherwise.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ArrowLook {
	pub route: Option<ArrowRoute>,
	pub heads: ArrowHeads,
}

/// A new arrow between two ends (`arrows::new_arrow_ends`), curved unless asked otherwise, in the
/// drawing's light/dark grey (`$decks-line`).
pub fn arrow_insert_op(id: &str, from: Value, to: Value, look: ArrowLook) -> Op {
	let mut metadata = Map::new();
	metadata.insert("type".into(), pen::ARROW.into());
	metadata.insert("from".into(), from);
	metadata.insert("to".into(), to);
	metadata.insert("route".into(), look.route.unwrap_or(ArrowRoute::Curved).name().into());
	if look.heads == ArrowHeads::None {
		metadata.insert("heads".into(), "none".into());
	}
	let node = json!({ "type": "path", "id": id, "stroke": "$decks-line", "strokeWidth": 2, "strokeLinecap": "round", "strokeLinejoin": "round", "metadata": metadata });
	Op::Insert { parent: None, index: None, node: node.as_object().cloned().unwrap_or_default(), area: None }
}

// ---- `@decks/pen`'s shape library (`shapes.ts`), as `make_shape` needs it ----

const SHAPE: &str = "decks.shape";

/// One kind of shape: its outline in a 100 by 100 box, and how it is built at a size when it can be.
struct ShapeKind {
	name: &'static str,
	geometry: &'static str,
	/// Drawn as a line alone, with no fill: a brace.
	line: bool,
	evenodd: bool,
	/// Corners the person can round, as a radius in the 100 by 100 box for a new shape.
	rounded: Option<f64>,
}

const fn kind(name: &'static str, geometry: &'static str) -> ShapeKind {
	ShapeKind { name, geometry, line: false, evenodd: false, rounded: None }
}
const fn rounded(name: &'static str, geometry: &'static str, radius: f64) -> ShapeKind {
	ShapeKind { name, geometry, line: false, evenodd: false, rounded: Some(radius) }
}

const SHAPES: [ShapeKind; 32] = [
	rounded("Rectangle", "M0 0H100V100H0Z", 0.0),
	rounded("Rounded", "M14 0H86Q100 0 100 14V86Q100 100 86 100H14Q0 100 0 86V14Q0 0 14 0Z", 14.0),
	kind("Ellipse", "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z"),
	kind("Triangle", "M50 0L100 100H0Z"),
	kind("Diamond", "M50 0L100 50L50 100L0 50Z"),
	kind("Pentagon", "M50 0L100 38L81 100H19L0 38Z"),
	kind("Hexagon", "M25 0H75L100 50L75 100H25L0 50Z"),
	kind("Octagon", "M30 0H70L100 30V70L70 100H30L0 70V30Z"),
	kind("Star", "M50 0L61 35H98L68 57L79 91L50 70L21 91L32 57L2 35H39Z"),
	kind("Parallelogram", "M22 0H100L78 100H0Z"),
	kind("Trapezoid", "M20 0H80L100 100H0Z"),
	kind("Plus", "M35 0H65V35H100V65H65V100H35V65H0V35H35Z"),
	ShapeKind { name: "Ring", geometry: "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0ZM50 28A22 22 0 1 0 50 72A22 22 0 1 0 50 28Z", line: false, evenodd: true, rounded: None },
	kind("Heart", "M50 96C20 74 0 56 0 30C0 12 13 0 28 0C38 0 46 6 50 14C54 6 62 0 72 0C87 0 100 12 100 30C100 56 80 74 50 96Z"),
	rounded("Process", "M0 0H100V100H0Z", 0.0),
	kind("Decision", "M50 0L100 50L50 100L0 50Z"),
	kind("Terminator", "M22 0H78A22 50 0 0 1 78 100H22A22 50 0 0 1 22 0Z"),
	kind("Document", "M0 0H100V82C75 66 25 100 0 82Z"),
	kind("Data", "M22 0H100L78 100H0Z"),
	kind("Database", "M0 14A50 14 0 0 1 100 14V86A50 14 0 0 1 0 86ZM100 14A50 14 0 0 1 0 14"),
	kind("Manual input", "M0 28L100 0V100H0Z"),
	kind("Predefined", "M0 0H100V100H0ZM12 0V100M88 0V100"),
	kind("Delay", "M0 0H58A42 50 0 0 1 58 100H0Z"),
	kind("Off-page", "M0 0H100V68L50 100L0 68Z"),
	kind("Preparation", "M22 0H78L100 50L78 100H22L0 50Z"),
	kind("Card", "M24 0H100V100H0V24Z"),
	kind("Arrow right", "M0 30H60V6L100 50L60 94V70H0Z"),
	kind("Arrow both", "M0 50L26 14V34H74V14L100 50L74 86V66H26V86Z"),
	kind("Chevron", "M0 0H74L100 50L74 100H0L26 50Z"),
	rounded("Speech", "M8 0H92Q100 0 100 8V64Q100 72 92 72H42L20 98L26 72H8Q0 72 0 64V8Q0 0 8 0Z", 8.0),
	kind("Cloud", "M26 88C6 88 0 66 12 56C4 36 24 22 38 30C46 8 76 8 82 30C100 28 106 56 90 66C98 84 78 94 64 88Z"),
	ShapeKind { name: "Brace", geometry: "M34 0Q18 0 18 16V40Q18 50 2 50Q18 50 18 60V84Q18 100 34 100", line: true, evenodd: false, rounded: None },
];

/// The kind a name names, any case.
fn shape_kind(name: &str) -> Option<&'static ShapeKind> {
	SHAPES.iter().find(|one| one.name.eq_ignore_ascii_case(name))
}

/// A number to a hundredth, as a path writes it (`-0` as `0`).
fn n(value: f64) -> String {
	let v = js_round(value * 100.0) / 100.0;
	if v == 0.0 { "0".into() } else { format!("{v}") }
}

/// A path from points joined by straight lines and closed.
fn poly(points: &[[f64; 2]]) -> String {
	format!("M{}Z", points.iter().map(|[x, y]| format!("{} {}", n(*x), n(*y))).collect::<Vec<_>>().join("L"))
}

/// A point's depth, the run of a head or a cut, kept to its share of the side it sits on.
fn depth(along: f64, across: f64, share: f64, cap: f64) -> f64 {
	(along * share).min(across * cap)
}

/// The most a corner can be rounded in a box: any more and the straight sides are gone.
fn max_radius(w: f64, h: f64) -> f64 {
	(w.min(h) / 2.0).max(0.0)
}

/// A rounded rectangle of a size, in its own pixels, so every corner is a circle of radius `r`.
fn rounded_geometry(w: f64, h: f64, r: f64) -> String {
	let k = r.min(max_radius(w, h)).max(0.0);
	if k <= 0.0 {
		return format!("M0 0H{}V{}H0Z", n(w), n(h));
	}
	let (k_, w_, h_) = (n(k), n(w), n(h));
	format!("M{k_} 0H{}A{k_} {k_} 0 0 1 {w_} {k_}V{}A{k_} {k_} 0 0 1 {} {h_}H{k_}A{k_} {k_} 0 0 1 0 {}V{k_}A{k_} {k_} 0 0 1 {k_} 0Z", n(w - k), n(h - k), n(w - k), n(h - k))
}

/// The outline built at a size, in the frame's own pixels, for the kinds whose curves or heads
/// would distort if their 100 by 100 outline were stretched; `None` for the rest.
fn build(name: &str, w: f64, h: f64, r: f64) -> Option<String> {
	Some(match name {
		"Rectangle" | "Process" | "Rounded" => rounded_geometry(w, h, r),
		// A capsule: its ends half circles, however long.
		"Terminator" => rounded_geometry(w, h, max_radius(w, h)),
		"Delay" => {
			let ry = h / 2.0;
			let rx = ry.min(w);
			format!("M0 0H{}A{} {} 0 0 1 {} {}H0Z", n(w - rx), n(rx), n(ry), n(w - rx), n(h))
		}
		"Database" => {
			let rx = w / 2.0;
			let ry = (w * 0.12).min(h / 4.0);
			let (rx, ry_, w_, hr) = (n(rx), n(ry), n(w), n(h - ry));
			format!("M0 {ry_}A{rx} {ry_} 0 0 1 {w_} {ry_}V{hr}A{rx} {ry_} 0 0 1 0 {hr}ZM{w_} {ry_}A{rx} {ry_} 0 0 1 0 {ry_}")
		}
		"Document" => {
			let a = (h * 0.18).min(w * 0.12);
			let base = h - a;
			format!("M0 0H{}V{}C{} {} {} {} 0 {}Z", n(w), n(base), n(w * 0.75), n(base - a * 0.9), n(w * 0.25), n(h), n(base))
		}
		"Arrow right" => {
			let head = depth(h, w, 0.4, 0.6);
			poly(&[[0.0, h * 0.3], [w - head, h * 0.3], [w - head, h * 0.06], [w, h / 2.0], [w - head, h * 0.94], [w - head, h * 0.7], [0.0, h * 0.7]])
		}
		"Arrow both" => {
			let head = depth(h, w, 0.26, 0.4);
			poly(&[[0.0, h / 2.0], [head, h * 0.14], [head, h * 0.34], [w - head, h * 0.34], [w - head, h * 0.14], [w, h / 2.0], [w - head, h * 0.86], [w - head, h * 0.66], [head, h * 0.66], [head, h * 0.86]])
		}
		"Chevron" => {
			let d = depth(h, w, 0.26, 0.4);
			poly(&[[0.0, 0.0], [w - d, 0.0], [w, h / 2.0], [w - d, h], [0.0, h], [d, h / 2.0]])
		}
		"Preparation" | "Hexagon" => {
			let d = depth(h, w, if name == "Hexagon" { 0.29 } else { 0.22 }, 0.4);
			poly(&[[d, 0.0], [w - d, 0.0], [w, h / 2.0], [w - d, h], [d, h], [0.0, h / 2.0]])
		}
		"Octagon" => {
			let c = w.min(h) * 0.3;
			poly(&[[c, 0.0], [w - c, 0.0], [w, c], [w, h - c], [w - c, h], [c, h], [0.0, h - c], [0.0, c]])
		}
		"Off-page" => {
			let p = (w * 0.32).min(h * 0.5);
			poly(&[[0.0, 0.0], [w, 0.0], [w, h - p], [w / 2.0, h], [0.0, h - p]])
		}
		"Parallelogram" | "Data" => {
			let s = depth(h, w, 0.22, 0.45);
			poly(&[[s, 0.0], [w, 0.0], [w - s, h], [0.0, h]])
		}
		"Trapezoid" => {
			let s = depth(h, w, 0.2, 0.45);
			poly(&[[s, 0.0], [w - s, 0.0], [w, h], [0.0, h]])
		}
		"Manual input" => {
			let t = (h * 0.28).min(w * 0.2);
			poly(&[[0.0, t], [w, 0.0], [w, h], [0.0, h]])
		}
		"Card" => {
			let c = w.min(h) * 0.24;
			poly(&[[c, 0.0], [w, 0.0], [w, h], [0.0, h], [0.0, c]])
		}
		"Predefined" => {
			let b = (w * 0.12).min(h * 0.2);
			format!("M0 0H{}V{}H0ZM{} 0V{}M{} 0V{}", n(w), n(h), n(b), n(h), n(w - b), n(h))
		}
		// Rounded corners, and a tail that keeps its size however wide the bubble is.
		"Speech" => {
			let tail = (h * 0.26).min(28.0);
			let body = h - tail;
			let k = r.min(max_radius(w, body)).max(0.0);
			let b1 = (w * 0.26).min(60.0);
			let b2 = b1 + (w * 0.16).min(24.0);
			let tip = (b1 - (w * 0.06).min(10.0)).max(0.0);
			let arc = |x: f64, y: f64| if k > 0.0 { format!("A{} {} 0 0 1 {} {}", n(k), n(k), n(x), n(y)) } else { format!("L{} {}", n(x), n(y)) };
			format!(
				"M{} 0H{}{}V{}{}H{}L{} {}L{} {}H{}{}V{}{}Z",
				n(k),
				n(w - k),
				arc(w, k),
				n(body - k),
				arc(w - k, body),
				n(b2),
				n(tip),
				n(h),
				n(b1),
				n(body),
				n(k),
				arc(0.0, body - k),
				n(k),
				arc(k, 0.0)
			)
		}
		_ => return None,
	})
}

/// A new shape of a kind, at a size, ready to insert (`makeShape`): the frame and its outline,
/// paper with an ink line, except a line-only shape, which has no fill.
fn make_shape(kind: &ShapeKind, frame: &str, outline: &str, size: Size) -> Props {
	let w = js_round(size.w).max(DRAWN_MIN);
	let h = js_round(size.h).max(DRAWN_MIN);
	// A shape with corners to round starts at the kind's own radius, in this shape's pixels.
	let radius = kind.rounded.map(|r| js_round((r / 100.0 * w.min(h)).min(max_radius(w, h))));
	let built = build(kind.name, w, h, radius.unwrap_or(0.0));
	let mut metadata = Map::new();
	metadata.insert("type".into(), SHAPE.into());
	metadata.insert("kind".into(), kind.name.into());
	if let Some(radius) = radius {
		metadata.insert("radius".into(), js_num(radius));
	}
	let mut path = Map::new();
	path.insert("type".into(), "path".into());
	path.insert("id".into(), outline.into());
	path.insert("layoutPosition".into(), "absolute".into());
	path.insert("x".into(), 0.into());
	path.insert("y".into(), 0.into());
	path.insert("width".into(), js_num(w));
	path.insert("height".into(), js_num(h));
	// Built at its size when the kind can be; stretched from 100 by 100 when it cannot.
	path.insert("viewBox".into(), if built.is_some() { json!([0, 0, js_num(w), js_num(h)]) } else { json!([0, 0, 100, 100]) });
	path.insert("geometry".into(), built.unwrap_or_else(|| kind.geometry.into()).into());
	if kind.evenodd {
		path.insert("fillRule".into(), "evenodd".into());
	}
	if !kind.line {
		path.insert("fill".into(), "$decks-surface".into());
	}
	path.insert("stroke".into(), "$decks-line-strong".into());
	path.insert("strokeWidth".into(), json!(1.5));
	path.insert("strokeAlignment".into(), "center".into());
	path.insert("strokeLinejoin".into(), "round".into());
	let node = json!({
		"type": "frame",
		"id": frame,
		"name": kind.name,
		"width": js_num(w),
		"height": js_num(h),
		"layout": "vertical",
		"justifyContent": "center",
		"alignItems": "center",
		"padding": 10,
		"clip": false,
		"metadata": metadata,
		"children": [path],
	});
	node.as_object().cloned().unwrap_or_default()
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::rules::{Form, Rules};
	use crate::scene::{Fake, FakeItem};

	fn rules() -> Rules {
		Rules::for_form(Form::Desk)
	}
	/// Ids as a counter hands them out: the same call writes the same ops.
	fn counter(prefix: &str) -> impl FnMut() -> String {
		let prefix = prefix.to_string();
		let mut n = 0;
		move || {
			n += 1;
			format!("{prefix}{n}")
		}
	}
	/// An item placed at a box that has no `x` or `y` of its own (a child laid out by its frame).
	fn bare(id: &str, x: f64, y: f64, w: f64, h: f64) -> FakeItem {
		let mut item = FakeItem::rect(id, x, y, w, h);
		for key in ["x", "y", "width", "height"] {
			item.props.remove(key);
		}
		item
	}
	fn v<T: Serialize>(value: T) -> Value {
		serde_json::to_value(value).unwrap()
	}
	const BOARD: &str = "boards/one.html";

	/// `a` and `b` on the stage, a column frame `col` holding `c1 c2 c3`, a card `card` holding the
	/// markdown text `md`, and an arrow `ar` from a point to `a`.
	fn items() -> Vec<FakeItem> {
		vec![
			FakeItem::rect("a", 10.0, 20.0, 100.0, 50.0),
			FakeItem::rect("b", 200.0, 20.0, 100.0, 50.0),
			FakeItem::rect("col", 0.0, 200.0, 300.0, 300.0).kind("frame").set("layout", json!("vertical")),
			bare("c1", 18.0, 218.0, 264.0, 40.0).inside("col"),
			bare("c2", 18.0, 270.0, 264.0, 40.0).inside("col"),
			bare("c3", 18.0, 322.0, 264.0, 40.0).inside("col"),
			bare("card", 400.0, 200.0, 320.0, 100.0).kind("frame").set("layout", json!("vertical")).set("metadata", json!({ "type": "decks.card" })),
			bare("md", 420.0, 220.0, 280.0, 24.0).kind("text").set("metadata", json!({ "type": pen::MARKDOWN })).inside("card"),
			bare("ar", 0.0, 0.0, 10.0, 20.0).kind("path").set("metadata", json!({ "type": pen::ARROW, "from": [0, 0], "to": "a" })),
		]
	}
	fn boards() -> Vec<PageBox> {
		vec![PageBox { path: BOARD.into(), x: 1000.0, y: 0.0, w: 400.0, h: 300.0, least: None }]
	}
	fn scene() -> Fake {
		Fake::new(items()).with_boards(boards())
	}
	/// The scene with one more item.
	fn scene_and(more: FakeItem) -> Fake {
		let mut list = items();
		list.push(more);
		Fake::new(list).with_boards(boards())
	}
	/// A drawn arrow from `a` towards `b` (or whatever `meta` joins), its line through its box.
	fn drawn_arrow(id: &str, metadata: Value) -> FakeItem {
		FakeItem::rect(id, 110.0, 40.0, 90.0, 10.0).kind("path").set("viewBox", json!([0, 0, 90, 10])).set("geometry", json!("M2 5 L88 5 M80 9 L88 5 L80 1")).set("metadata", metadata)
	}

	#[test]
	fn a_nudge_shifts_each_items_own_x_and_y_by_the_rules_steps() {
		let (s, r) = (scene(), rules());
		assert_eq!(v(move_ops(&s, &["a"], r.nudge, 0.0, None, None)), json!([{ "op": "update", "id": "a", "set": { "x": 11, "y": 20 } }]));
		assert_eq!(
			v(move_ops(&s, &["a", "b"], 0.0, -r.nudge_shift, None, None)),
			json!([{ "op": "update", "id": "a", "set": { "x": 10, "y": 10 } }, { "op": "update", "id": "b", "set": { "x": 200, "y": 10 } }])
		);
	}

	#[test]
	fn an_item_with_no_x_of_its_own_moves_from_zero_rounded_and_one_not_there_writes_nothing() {
		let s = scene();
		assert_eq!(v(move_ops(&s, &["c1"], 2.6, 0.0, None, None)), json!([{ "op": "update", "id": "c1", "set": { "x": 3, "y": 0 } }]));
		assert!(move_ops(&s, &["gone"], 1.0, 0.0, None, None).is_empty());
	}

	#[test]
	fn an_arrow_moved_with_what_it_joins_carries_its_point_ends_and_its_joined_end_stays_joined() {
		let s = scene();
		assert_eq!(v(&move_ops(&s, &["ar", "a"], 10.0, 5.0, None, None)[0]), json!({ "op": "update", "id": "ar", "set": { "x": 10, "y": 5, "metadata": { "type": pen::ARROW, "from": [10, 5], "to": "a" } } }));
		let r = json!({ "type": "rectangle", "x": 1.2 });
		assert_eq!(Value::Object(moved_by(r.as_object().unwrap(), 0.4, 0.0)), json!({ "x": 2, "y": 0 }));
	}

	#[test]
	fn a_drag_into_a_frame_is_a_move_with_the_stage_box_it_ends_at_and_the_slot_it_goes_in() {
		let s = scene();
		assert_eq!(v(move_ops(&s, &["a"], 5.4, 200.0, Some(Some("col")), Some(1))), json!([{ "op": "move", "id": "a", "parent": "col", "index": 1, "box": { "x1": 15, "y1": 220, "x2": 115, "y2": 270 } }]));
		// Out onto the stage: parent null, no index.
		assert_eq!(v(move_ops(&s, &["c1"], 0.0, -300.0, Some(None), None)), json!([{ "op": "move", "id": "c1", "parent": null, "box": { "x1": 18, "y1": -82, "x2": 282, "y2": -42 } }]));
		// Into the frame it is in already, with no slot: the plain shift.
		assert_eq!(v(move_ops(&s, &["c1"], 1.0, 0.0, Some(Some("col")), None)), json!([{ "op": "update", "id": "c1", "set": { "x": 1, "y": 0 } }]));
	}

	#[test]
	fn a_reorder_in_a_column_counts_down_for_an_item_above_its_new_slot_and_a_second_item_goes_after_the_first() {
		let s = scene();
		// c1 (index 0) to slot 3, past c3: it is taken out first, so it lands at 2.
		assert_eq!(v(move_ops(&s, &["c1"], 0.0, 104.0, Some(Some("col")), Some(3))), json!([{ "op": "move", "id": "c1", "parent": "col", "index": 2, "box": { "x1": 18, "y1": 322, "x2": 282, "y2": 362 } }]));
		// c3 (index 2) to slot 0: no correction.
		assert_eq!(v(move_ops(&s, &["c3"], 0.0, -104.0, Some(Some("col")), Some(0))), json!([{ "op": "move", "id": "c3", "parent": "col", "index": 0, "box": { "x1": 18, "y1": 218, "x2": 282, "y2": 258 } }]));
		let indexes: Vec<Option<usize>> = move_ops(&s, &["a", "b"], 0.0, 0.0, Some(Some("col")), Some(1)).into_iter().map(|op| if let Op::Move { index, .. } = op { index } else { None }).collect();
		assert_eq!(indexes, vec![Some(1), Some(2)]);
	}

	#[test]
	fn markdown_words_dropped_in_a_card_are_as_wide_as_it_and_out_of_one_keep_their_width() {
		let words = scene_and(bare("w", 0.0, 600.0, 120.0, 24.0).kind("text").set("metadata", json!({ "type": pen::MARKDOWN })));
		assert_eq!(
			v(move_ops(&words, &["w"], 400.0, -360.0, Some(Some("card")), Some(1))),
			json!([
				{ "op": "move", "id": "w", "parent": "card", "index": 1, "box": { "x1": 400, "y1": 240, "x2": 520, "y2": 264 } },
				{ "op": "update", "id": "w", "set": { "width": "fill_container", "textGrowth": "fixed-width" } },
			])
		);
		assert_eq!(v(move_ops(&scene(), &["md"], 0.0, 200.0, Some(None), None)), json!([{ "op": "move", "id": "md", "parent": null, "box": { "x1": 420, "y1": 420, "x2": 700, "y2": 444 } }]));
	}

	#[test]
	fn an_alt_drag_copies_each_item_to_where_it_was_let_go_and_the_copies_are_what_is_selected() {
		let copies = copy_ops(&scene(), &["a", "gone", "b"], 30.0, -5.0, &mut counter("n"));
		assert_eq!(
			v(&copies.ops),
			json!([
				{ "op": "copy", "id": "a", "as": "n1" },
				{ "op": "update", "id": "n1", "set": { "x": 40, "y": 15 } },
				{ "op": "copy", "id": "b", "as": "n2" },
				{ "op": "update", "id": "n2", "set": { "x": 230, "y": 15 } },
			])
		);
		assert_eq!(copies.made, vec!["n1".to_string(), "n2".to_string()]);
	}

	#[test]
	fn a_duplicate_is_a_copy_the_rules_offset_down_and_right_point_ends_and_all() {
		let r = rules();
		let copies = duplicate_ops(&scene(), &["a", "ar"], &mut counter("d"), &r);
		let o = r.duplicate_offset;
		assert_eq!(
			v(&copies.ops),
			json!([
				{ "op": "copy", "id": "a", "as": "d1" },
				{ "op": "update", "id": "d1", "set": { "x": js_num(10.0 + o), "y": js_num(20.0 + o) } },
				{ "op": "copy", "id": "ar", "as": "d2" },
				{ "op": "update", "id": "d2", "set": { "x": js_num(o), "y": js_num(o), "metadata": { "type": pen::ARROW, "from": [js_num(o), js_num(o)], "to": "a" } } },
			])
		);
		assert_eq!(copies.made, vec!["d1".to_string(), "d2".to_string()]);
	}

	#[test]
	fn delete_is_one_op_per_item() {
		assert_eq!(v(delete_ops(&["a", "b"], None)), json!([{ "op": "delete", "id": "a" }, { "op": "delete", "id": "b" }]));
		assert!(delete_ops::<&str>(&[], None).is_empty());
	}

	#[test]
	fn deleting_what_an_arrow_joins_lets_that_end_go_where_it_is_drawn() {
		let s = scene_and(drawn_arrow("j", json!({ "type": pen::ARROW, "from": "a", "to": "b" })));
		// `ar` has no line drawn yet, so it has no point to be let go at: it is left as it is.
		assert_eq!(v(delete_ops(&["a"], Some(&s))), json!([{ "op": "update", "id": "j", "set": { "metadata": { "type": pen::ARROW, "from": [112, 45], "to": "b" } } }, { "op": "delete", "id": "a" }]));
	}

	#[test]
	fn deleting_a_frame_lets_go_of_arrows_joined_to_what_it_holds() {
		let s = scene_and(drawn_arrow("j", json!({ "type": pen::ARROW, "from": "c2", "to": "b" })));
		assert_eq!(v(&delete_ops(&["col"], Some(&s))[0]), json!({ "op": "update", "id": "j", "set": { "metadata": { "type": pen::ARROW, "from": [112, 45], "to": "b" } } }));
	}

	#[test]
	fn boards_move_to_their_own_rounded_corners_and_one_not_on_the_stage_is_left_out() {
		assert_eq!(v(page_moves(&boards(), &[BOARD, "boards/gone.html"], 10.6, -1.0)), json!([{ "path": BOARD, "x": 1011, "y": -1 }]));
	}

	#[test]
	fn new_ids_are_five_letters_or_digits_none_taken_and_none_the_same() {
		let mut next = id_maker(["a", "b"]);
		let made: HashSet<String> = (0..50).map(|_| next()).collect();
		assert_eq!(made.len(), 50);
		assert!(!made.contains("a") && !made.contains("b"));
		assert!(made.iter().all(|id| id.len() == 5 && id.bytes().all(|c| c.is_ascii_alphanumeric())));
	}

	#[test]
	fn an_arrow_joined_at_either_end_carried_without_what_it_joins_gets_no_op() {
		let s = scene_and(FakeItem::rect("j", 110.0, 40.0, 90.0, 10.0).kind("path").set("metadata", json!({ "type": pen::ARROW, "from": "a", "to": { "item": "b", "side": "left" } })));
		assert!(move_ops(&s, &["j"], 30.0, 60.0, None, None).is_empty());
		assert!(move_ops(&s, &["j"], 30.0, 60.0, Some(None), None).is_empty());
		// Carried with one item it joins while the other stays: no op of its own.
		assert_eq!(move_ops(&s, &["j", "a"], 30.0, 0.0, None, None), vec![Op::set("a", moved_by(s.node("a").unwrap(), 30.0, 0.0))]);
		// Carried with both: it moves with them.
		assert_eq!(move_ops(&s, &["j", "a", "b"], 30.0, 0.0, None, None)[0], Op::set("j", moved_by(s.node("j").unwrap(), 30.0, 0.0)));
		// One end joined: it stays too; carried with what it joins, it moves.
		assert!(move_ops(&s, &["ar"], 5.0, 5.0, None, None).is_empty());
		assert_eq!(move_ops(&s, &["ar", "a"], 5.0, 5.0, None, None)[0], Op::set("ar", moved_by(s.node("ar").unwrap(), 5.0, 5.0)));
	}

	#[test]
	fn an_arrow_whose_joined_items_were_deleted_moves_as_a_free_one_from_where_it_is_drawn() {
		let s = scene_and(drawn_arrow("o", json!({ "type": pen::ARROW, "from": "gone1", "to": { "item": "gone2", "side": "left" } })));
		assert_eq!(v(move_ops(&s, &["o"], 30.0, 60.0, None, None)), json!([{ "op": "update", "id": "o", "set": { "x": 140, "y": 100, "metadata": { "type": pen::ARROW, "from": [142, 105], "to": [228, 105] } } }]));
	}

	#[test]
	fn an_arrows_ends_are_drawn_where_its_geometry_puts_them_through_its_view_box() {
		let node = json!({ "x": 10, "y": 20, "width": 200, "height": 20, "viewBox": [0, 0, 100, 10], "geometry": "M0 5 C10 0 90 0 100 5 M90 9 L100 5" });
		assert_eq!(arrow_ends_drawn(node.as_object().unwrap()), Some(DrawnEnds { from: [10.0, 30.0], to: [210.0, 30.0] }));
		assert_eq!(arrow_ends_drawn(json!({ "geometry": "M1 2" }).as_object().unwrap()), None);
	}

	fn card(id: &str, child: &str) -> Props {
		json!({ "type": "frame", "id": id, "name": "Card", "children": [{ "type": "text", "id": child }] }).as_object().unwrap().clone()
	}

	/// Make with the insert panel's picks, its inner ids counted from `in1`.
	fn with<T>(shape: &str, centred: bool, parent: Option<&str>, make: impl FnOnce(&mut MakeOptions) -> T) -> T {
		let mut next = counter("in");
		let mut options = MakeOptions { shape, icon: Icon { library: "lucide", name: "star" }, next_id: &mut next, card: &card, centred, parent };
		make(&mut options)
	}
	fn click(tool: MakingTool, id: &str, at: Pt) -> Made {
		with("Rectangle", false, None, |o| make_at_op(tool, id, at, o))
	}

	#[test]
	fn a_click_makes_each_tools_item_at_its_own_size_its_corner_at_the_point() {
		let point = Pt::new(10.4, 20.6);
		let rect = click(MakingTool::Rectangle, "r", point);
		let node = json!({ "type": "rectangle", "fill": "$decks-fill-slate", "cornerRadius": 8, "id": "r" });
		assert_eq!(v(&rect.op), json!({ "op": "insert", "node": node, "box": { "x1": 10, "y1": 21, "x2": 170, "y2": 121 } }));
		assert_eq!(Value::Object(rect.node), node);
		assert_eq!(rect.area, Rect { x: 10.0, y: 21.0, w: 160.0, h: 100.0 });
		assert_eq!(v(click(MakingTool::Ellipse, "e", point).op), json!({ "op": "insert", "node": { "type": "ellipse", "fill": "$decks-fill-sky", "id": "e" }, "box": { "x1": 10, "y1": 21, "x2": 130, "y2": 141 } }));
		assert_eq!(FRAME_RADIUS, 30.0);
		assert_eq!(
			v(click(MakingTool::Frame, "f", point).op),
			json!({ "op": "insert", "node": { "type": "frame", "name": "Frame", "layout": "vertical", "gap": 12, "padding": 18, "fill": "$decks-surface", "stroke": "$decks-line-subtle", "strokeWidth": 1, "cornerRadius": 30, "clip": true, "id": "f" }, "box": { "x1": 10, "y1": 21, "x2": 410, "y2": 141 } })
		);
		assert_eq!(
			v(click(MakingTool::Icon, "i", point).op),
			json!({ "op": "insert", "node": { "type": "icon", "id": "i", "name": "star", "library": "lucide", "icon": "star", "fill": "$decks-text", "weight": 400 }, "box": { "x1": 10, "y1": 21, "x2": 58, "y2": 69 } })
		);
	}

	#[test]
	fn a_texts_box_has_no_bottom_and_a_notes_no_size_at_all() {
		let point = Pt::new(10.4, 20.6);
		let text = click(MakingTool::Text, "t", point);
		assert_eq!(v(&text.op), json!({ "op": "insert", "node": { "type": "text", "content": "", "fontSize": 24, "textGrowth": "fixed-width", "metadata": { "type": pen::MARKDOWN }, "id": "t" }, "box": { "x1": 10, "y1": 21, "x2": 330 } }));
		assert_eq!(text.area, Rect { x: 10.0, y: 21.0, w: 320.0, h: 32.0 });
		let note = click(MakingTool::Note, "no", point);
		assert_eq!(v(&note.op), json!({ "op": "insert", "node": { "type": "note", "content": "", "id": "no" }, "box": { "x1": 10, "y1": 21 } }));
		assert_eq!(note.area, Rect { x: 10.0, y: 21.0, w: 240.0, h: 80.0 });
	}

	#[test]
	fn a_card_is_the_pages_card_with_a_fresh_block_id_and_opens_eighty_tall_for_typing() {
		let made = click(MakingTool::Card, "k", Pt::new(10.4, 20.6));
		let node = json!({ "type": "frame", "id": "k", "name": "Card", "children": [{ "type": "text", "id": "in1" }] });
		assert_eq!(v(&made.op), json!({ "op": "insert", "node": node, "box": { "x1": 10, "y1": 21, "x2": 330, "y2": 69 } }));
		assert_eq!(made.area, Rect { x: 10.0, y: 21.0, w: 320.0, h: 80.0 });
	}

	#[test]
	fn a_shape_is_square_for_a_star_wider_for_a_decision_and_its_outline_gets_the_next_id() {
		assert_eq!(made_size(MakingTool::Shape, "Star"), Size { w: 120.0, h: 120.0 });
		assert_eq!(made_size(MakingTool::Shape, "Ellipse"), Size { w: 120.0, h: 120.0 });
		assert_eq!(made_size(MakingTool::Shape, "Decision"), Size { w: 160.0, h: 120.0 });
		assert_eq!(made_size(MakingTool::Shape, "Rectangle"), Size { w: 160.0, h: 100.0 });
		assert_eq!(made_size(MakingTool::Icon, "Star"), Size { w: 48.0, h: 48.0 });
		assert_eq!(made_size(MakingTool::Note, "Star"), Size { w: 240.0, h: 80.0 });
		for (shape, x2, y2) in [("Star", 130.0, 141.0), ("Decision", 170.0, 141.0), ("Rectangle", 170.0, 121.0)] {
			let made = with(shape, false, None, |o| make_at_op(MakingTool::Shape, "s", Pt::new(10.0, 21.0), o));
			let Op::Insert { area, .. } = &made.op else { panic!("an insert") };
			assert_eq!(*area, Some(BoxPart { x1: Some(10.0), y1: Some(21.0), x2: Some(x2), y2: Some(y2) }));
			assert_eq!(made.node["name"], json!(shape));
			assert_eq!(made.node["metadata"]["kind"], json!(shape));
			assert_eq!(made.node["children"][0]["id"], json!("in1"));
		}
	}

	#[test]
	fn a_kind_the_library_does_not_know_is_its_first() {
		let node = with("Nope", false, None, |o| made_node(MakingTool::Shape, "s", Size { w: 10.0, h: 10.0 }, o));
		assert_eq!(node["name"], json!("Rectangle"));
	}

	#[test]
	fn a_shape_that_can_be_built_is_built_at_its_size_and_the_rest_are_stretched() {
		let rect = with("rectangle", false, None, |o| made_node(MakingTool::Shape, "s", Size { w: 160.0, h: 100.0 }, o));
		assert_eq!(rect["metadata"], json!({ "type": "decks.shape", "kind": "Rectangle", "radius": 0 }));
		assert_eq!(rect["children"][0]["viewBox"], json!([0, 0, 160, 100]));
		assert_eq!(rect["children"][0]["geometry"], json!("M0 0H160V100H0Z"));
		let rounded = with("Rounded", false, None, |o| made_node(MakingTool::Shape, "s", Size { w: 100.0, h: 50.0 }, o));
		assert_eq!(rounded["metadata"]["radius"], json!(7));
		assert_eq!(rounded["children"][0]["geometry"], json!("M7 0H93A7 7 0 0 1 100 7V43A7 7 0 0 1 93 50H7A7 7 0 0 1 0 43V7A7 7 0 0 1 7 0Z"));
		let star = with("Star", false, None, |o| made_node(MakingTool::Shape, "s", Size { w: 50.0, h: 70.0 }, o));
		assert_eq!((star["width"].clone(), star["height"].clone()), (json!(50), json!(70)));
		assert_eq!(star["children"][0]["viewBox"], json!([0, 0, 100, 100]));
		assert_eq!(star["children"][0]["geometry"], json!("M50 0L61 35H98L68 57L79 91L50 70L21 91L32 57L2 35H39Z"));
		assert!(star["metadata"].get("radius").is_none(), "a star has no corners to round");
		let chevron = with("Chevron", false, None, |o| made_node(MakingTool::Shape, "s", Size { w: 200.0, h: 100.0 }, o));
		assert_eq!(chevron["children"][0]["geometry"], json!("M0 0L174 0L200 50L174 100L0 100L26 50Z"));
		let brace = with("Brace", false, None, |o| made_node(MakingTool::Shape, "s", Size { w: 3.0, h: 100.0 }, o));
		assert!(brace["children"][0].get("fill").is_none(), "a line has no fill");
		assert_eq!(brace["width"], json!(8), "never under 8");
		let ring = with("Ring", false, None, |o| made_node(MakingTool::Shape, "s", Size { w: 120.0, h: 120.0 }, o));
		assert_eq!(ring["children"][0]["fillRule"], json!("evenodd"));
	}

	#[test]
	fn from_the_insert_panel_the_item_is_put_with_its_middle_at_the_point_and_into_the_frame_given() {
		let centred = with("Rectangle", true, None, |o| make_at_op(MakingTool::Rectangle, "r", Pt::new(100.0, 100.0), o));
		assert_eq!(v(centred.op), json!({ "op": "insert", "node": { "type": "rectangle", "fill": "$decks-fill-slate", "cornerRadius": 8, "id": "r" }, "box": { "x1": 20, "y1": 50, "x2": 180, "y2": 150 } }));
		let inside = with("Rectangle", false, Some("col"), |o| make_at_op(MakingTool::Ellipse, "e", Pt::new(5.0, 5.0), o));
		assert_eq!(v(inside.op), json!({ "op": "insert", "parent": "col", "node": { "type": "ellipse", "fill": "$decks-fill-sky", "id": "e" }, "box": { "x1": 5, "y1": 5, "x2": 125, "y2": 125 } }));
	}

	#[test]
	fn a_drag_makes_the_box_between_press_and_release_at_least_eight_each_way() {
		let drawn = with("Rectangle", false, None, |o| drawn_op(MakingTool::Rectangle, "r", Pt::new(100.0, 100.0), Pt::new(40.4, 300.6), o));
		assert_eq!(v(&drawn.op), json!({ "op": "insert", "node": { "type": "rectangle", "fill": "$decks-fill-slate", "cornerRadius": 8, "id": "r" }, "box": { "x1": 40, "y1": 100, "x2": 100, "y2": 301 } }));
		assert_eq!(drawn.area, Rect { x: 40.0, y: 100.0, w: 60.0, h: 201.0 });
		let tiny = with("Rectangle", false, Some("col"), |o| drawn_op(MakingTool::Frame, "f", Pt::new(0.0, 0.0), Pt::new(3.0, 2.0), o));
		assert_eq!(v(&tiny.op)["box"], json!({ "x1": 0, "y1": 0, "x2": 8, "y2": 8 }));
		let box_of = |tool: MakingTool| with("Rectangle", false, None, |o| drawn_op(tool, "x", Pt::new(0.0, 0.0), Pt::new(200.0, 60.0), o));
		// A text drawn keeps its width, not its height; a note drawn has both; a card opens 80 tall.
		assert_eq!(v(box_of(MakingTool::Text).op)["box"], json!({ "x1": 0, "y1": 0, "x2": 200 }));
		assert_eq!(v(box_of(MakingTool::Note).op)["box"], json!({ "x1": 0, "y1": 0, "x2": 200, "y2": 60 }));
		assert_eq!(box_of(MakingTool::Card).area, Rect { x: 0.0, y: 0.0, w: 200.0, h: 80.0 });
		// A shape drawn is made at the size dragged.
		let star = with("Star", false, None, |o| drawn_op(MakingTool::Shape, "s", Pt::new(0.0, 0.0), Pt::new(50.0, 70.0), o));
		assert_eq!((star.node["width"].clone(), star.node["height"].clone(), star.node["children"][0]["id"].clone()), (json!(50), json!(70), json!("in1")));
	}

	#[test]
	fn an_arrow_is_a_curved_grey_path_between_its_ends() {
		assert_eq!(
			v(arrow_insert_op("ar2", json!("a"), json!([300, 40]), ArrowLook::default())),
			json!({ "op": "insert", "node": { "type": "path", "id": "ar2", "stroke": "$decks-line", "strokeWidth": 2, "strokeLinecap": "round", "strokeLinejoin": "round", "metadata": { "type": pen::ARROW, "from": "a", "to": [300, 40], "route": "curved" } } })
		);
		let plain = v(arrow_insert_op("ar3", json!("a"), json!("b"), ArrowLook { route: Some(ArrowRoute::Elbow), heads: ArrowHeads::None }));
		assert_eq!(plain["node"]["metadata"], json!({ "type": pen::ARROW, "from": "a", "to": "b", "route": "elbow", "heads": "none" }));
	}

	#[test]
	fn nothing_a_tool_makes_stores_a_fixed_colour() {
		let fixed = |text: &str| text.split('"').any(|part| part.starts_with('#') && part.len() >= 4 && part[1..].bytes().all(|c| c.is_ascii_hexdigit()));
		for tool in [MakingTool::Rectangle, MakingTool::Ellipse, MakingTool::Frame, MakingTool::Text, MakingTool::Note, MakingTool::Card, MakingTool::Icon] {
			let node = click(tool, "x", Pt::new(0.0, 0.0)).node;
			assert!(!fixed(&serde_json::to_string(&node).unwrap()), "{tool:?}");
		}
		for shape in SHAPES.iter().map(|k| k.name) {
			let node = with(shape, false, None, |o| make_at_op(MakingTool::Shape, "x", Pt::new(0.0, 0.0), o)).node;
			assert!(!fixed(&serde_json::to_string(&node).unwrap()), "{shape}");
		}
		assert_eq!(v(arrow_insert_op("a", json!("x"), json!("y"), ArrowLook::default()))["node"]["stroke"], json!("$decks-line"));
	}
}
