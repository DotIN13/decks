//! The editor's gestures as one machine (`edit/core/gesture.ts`): `Editor::step` takes one input — a
//! press on something, a move, a lift, the engine having drawn, a time come due — and changes the
//! editor's state, answering with the pen ops to send, what the engine should preview, and the
//! effects for the page to run. A gesture is a press followed to its lift: carrying the selection
//! (boards go with it), a marquee, an item's or a board's handles, the corner radius, an arrow's
//! end or middle. What is drawn after the lift waits for the engine's redraw, and that wait is state
//! too. Every number that differs by device is the rules table's (`rules.rs`).

use crate::arrows::{self, ArrowHandles, ArrowRoute, BendStart, JoinedEnd, SlidJoin, Which};
use crate::drop::{self, Current, NearDrops, Slot};
use crate::model::{Corners, Guide, Mods, Offset, Op, PageBox, Pt, Rect, Side, Tool, ZERO};
use crate::ops::{self, PageMove};
use crate::pen::{self, Media};
use crate::pick::{marquee_pick, pick_at, PickOptions};
use crate::resize::{self, Handle, Least, RadiusStart, ResizeMods, SnapOptions};
use crate::rules::{Pointer, Rules};
use crate::scene::{Props, Scene};
use crate::snap::snap_move;
use crate::snapping::{reading_targets, selection_box, snap_targets, snap_threshold};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashSet;

/// How long a let-go gesture waits for the drawing that answers it before its preview goes anyway.
pub const SETTLE_MS: f64 = 2000.0;
/// How long a let-go radius waits for the drawing to have it.
pub const RADIUS_HOLD_MS: f64 = 3000.0;
/// How long boards let go of wait to be where their move asked.
pub const PAGE_HOLD_MS: f64 = 4000.0;
/// A second press on the same handle, without a drag, within this long: a handle's double-click.
pub const HANDLE_TAP_MS: f64 = 400.0;
/// How far below and right of a pointer a ghost rides over a card, on the screen: a finger hides more of what is under it.
const GHOST_GAP_POINTER: f64 = 12.0;
const GHOST_GAP_FINGER: f64 = 28.0;

/// A pointer at a stage point (`at`) and on the screen (`client`), with its keys, its kind and its time (ms).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointerInput {
	pub at: Pt,
	pub client: Pt,
	pub mods: Mods,
	pub pointer: Pointer,
	pub time: f64,
}

/// What a click that does not move does besides selecting: follow a card's link, or play a film or a sound.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "do", rename_all = "kebab-case")]
pub enum Tap {
	OpenLink { href: String },
	Media { id: String, media: Media },
}

/// Carrying the selection: items and boards together.
#[derive(Clone, Debug, PartialEq)]
pub struct Carry {
	pub ids: Vec<String>,
	pub boards: Vec<String>,
	/// The selection's box as the press found it, what it snaps to, and the boards it keeps the reading gap from.
	pub start: Option<Rect>,
	pub targets: Vec<Rect>,
	pub reading: Vec<Rect>,
	pub from: Pt,
	pub from_client: Pt,
	/// A finger's carry: no axis, no copy, no composer; the ghost further off.
	pub touch: bool,
	pub tap: Option<Tap>,
	pub offset: Offset,
	/// `false` until it has moved.
	pub moved: bool,
}

/// The press in hand.
#[derive(Clone, Debug, PartialEq)]
pub enum Gesture {
	Carry(Carry),
	Marquee { from: Pt, kept_items: Vec<String>, kept_boards: Vec<String> },
	Resize { id: String, handle: Handle, start: Rect, given: Rect, words: bool, least: Least, targets: Vec<Rect>, from: Pt, next: Rect, moved: bool },
	Radius { id: String, start: RadiusStart, radius: f64, moved: bool },
	ArrowEnd { id: String, which: Which, metadata: Map<String, Value>, node: Props, stays: Pt, own: Option<JoinedEnd>, slid: Option<SlidJoin>, moved: bool },
	ArrowBend { id: String, node: Props, route: ArrowRoute, start: BendStart, next: Option<Map<String, Value>>, moved: bool },
	PageResize { path: String, handle: Handle, least: Option<f64>, start: Rect, targets: Vec<Rect>, from: Pt, next: Rect, moved: bool },
}

/// One input to the editor.
#[derive(Clone, Debug, PartialEq)]
pub enum Input {
	/// A press on the drawing or bare canvas with the select tool: an item picked up, or a marquee.
	PressCanvas(PointerInput),
	/// A press on a board (its node or its picture): it moves with whatever else is picked up.
	PressBoard { path: String, p: PointerInput },
	/// A press on a card block's grip: the block alone, carried.
	PressBlock { id: String, p: PointerInput },
	/// A press on one of the selected item's handles (`area` is the handles' box as drawn).
	PressHandle { handle: Handle, id: String, area: Rect, p: PointerInput },
	PressBoardHandle { handle: Handle, path: String, area: Rect, p: PointerInput },
	PressRadius { id: String, start: RadiusStart, p: PointerInput },
	PressArrowEnd { which: Which, ends: ArrowHandles, p: PointerInput },
	PressArrowBend { ends: ArrowHandles, p: PointerInput },
	/// A finger that landed on the selection has moved far enough to carry it.
	Carry { from_at: Pt, from_client: Pt, p: PointerInput },
	Move(PointerInput),
	Release(PointerInput),
	/// The press was taken back (a finger that became a pinch): what it carried goes back.
	Cancel,
	/// The engine laid the drawing out: `fresh` a new drawing, `current` the page's, `present` every id in it.
	Drawn { fresh: bool, current: bool, present: HashSet<String> },
	/// A time asked for by a `Wake` effect has come.
	Tick(f64),
	CarryPending(bool),
}

/// A board's new size, written by the page.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Size {
	pub w: f64,
	pub h: f64,
}

/// Where one item is as a drop lets it go, for the glide into where it lands.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Landing {
	pub id: String,
	pub x: f64,
	pub y: f64,
	pub w: f64,
	pub h: f64,
}

/// What the page does for the editor, in order.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "do", rename_all = "kebab-case")]
pub enum Effect {
	/// The app's selected board: picked, or let go.
	SelectBoard { path: Option<String> },
	/// A picture of what a drag carries, cut as it starts, for the ghost over a card.
	GhostTake { ids: Vec<String> },
	GhostShow { over: bool, client: Pt, gap: f64 },
	GhostDrop,
	/// Mark the composer under `client` as a drop target for these, or no composer.
	Composer { client: Option<Pt>, ids: Vec<String>, boards: Vec<String> },
	/// What was let go on the composer is mentioned there instead of moved.
	Refer { ids: Vec<String>, boards: Vec<String> },
	OpenLink { href: String },
	Media { id: String, media: Media },
	MoveBoards { moves: Vec<PageMove> },
	BoardSize { path: String, size: Size },
	/// A gesture was let go: a drop says where what it can move was let go, to glide from.
	Settle { landing: Vec<Landing> },
	/// Step again with a `Tick` at this time.
	Wake { at: f64 },
	/// The camera was dragged or something carried: a double-click soon after is not one.
	Panned,
}

/// How the engine should show an item before the edit lands: moved, sized, rounded, or with fields changed.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct PreviewChange {
	pub dx: f64,
	pub dy: f64,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub w: Option<f64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub h: Option<f64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub radius: Option<f64>,
}

/// What to do with the engine's preview after a step.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Preview {
	/// Leave it as it is.
	#[default]
	Keep,
	/// Take it away: everything back where the drawing has it.
	Clear,
	Show(Vec<(String, PreviewChange)>),
}

/// One step's answer.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Step {
	pub ops: Vec<Op>,
	pub preview: Preview,
	pub effects: Vec<Effect>,
}

/// What the step reads besides the state and the scene.
pub struct Context<'a> {
	pub zoom: f64,
	/// The window, in stage pixels: what a drag snaps against.
	pub view: Rect,
	/// Counted up by the page each time a new drawing is drawn.
	pub generation: u64,
	/// Ids for what a copy makes.
	pub next_id: &'a mut dyn FnMut() -> String,
	/// A board's revision now, which a write of its size moves on.
	pub page_rev: &'a dyn Fn(&str) -> u64,
	/// A card's link under a stage point.
	pub link_at: &'a dyn Fn(Pt) -> Option<String>,
	/// Whether the composer is under a screen point, for a drag of these to mention them.
	pub over_composer: &'a dyn Fn(Pt, &[String], &[String]) -> bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Selection {
	pub items: Vec<String>,
	pub boards: Vec<String>,
	/// Items just made or copied, selected before the drawing has them.
	pub awaited: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Hover {
	pub item: Option<String>,
	pub board: Option<String>,
	pub link: bool,
}

/// Where a drag would drop: into a frame (`Some(None)` the stage itself), the slot among its children, and the other places near the pointer.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Drop {
	pub into: Option<Option<String>>,
	pub slot: Option<Slot>,
	pub near: Option<NearDrops>,
}

/// Boards a drag carries; once let go, held where they were dropped until they are where the move asked.
#[derive(Clone, Debug, PartialEq)]
pub struct PageDrag {
	pub paths: Vec<String>,
	pub offset: Offset,
	pub released: Option<(Vec<PageMove>, f64)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
	Browse,
	Edit,
}

/// Everything the editor holds.
#[derive(Clone, Debug, PartialEq)]
pub struct State {
	pub mode: Mode,
	pub tool: Tool,
	pub selection: Selection,
	pub hover: Hover,
	pub gesture: Option<Gesture>,
	/// The selection's move, held after the lift until the drawing that answers it is drawn.
	pub drag: Offset,
	pub page_drag: Option<PageDrag>,
	/// An item being resized as the pointer has it.
	pub resize: Option<(String, Rect)>,
	pub page_resize: Option<(String, Rect, Option<(u64, f64)>)>,
	/// A corner radius dragged; once let go, held until the drawing has it or the time.
	pub radius: Option<(String, f64, Option<f64>)>,
	pub marquee: Option<Corners>,
	pub guides: Vec<Guide>,
	pub drop: Drop,
	pub joins: Vec<Rect>,
	pub sides: Vec<(Rect, Option<Side>)>,
	pub end_draft: Option<Corners>,
	pub route: Option<arrows::RouteDraft>,
	pub carry_pending: bool,
	/// Gestures let go and waiting for the engine's redraw: the generation each was let go at, and when it gives up.
	pub settling: Vec<(u64, f64)>,
	pub handle_tap: Option<(String, f64)>,
}

impl State {
	pub fn new(mode: Mode, tool: Tool) -> State {
		State { mode, tool, selection: Selection::default(), hover: Hover::default(), gesture: None, drag: ZERO, page_drag: None, resize: None, page_resize: None, radius: None, marquee: None, guides: Vec::new(), drop: Drop::default(), joins: Vec::new(), sides: Vec::new(), end_draft: None, route: None, carry_pending: false, settling: Vec::new(), handle_tap: None }
	}
	/// Select what was just asked for, which the drawing does not have until the server answers.
	pub fn select_made(&mut self, made: &[String]) {
		self.selection.items = made.to_vec();
		for id in made {
			if !self.selection.awaited.contains(id) {
				self.selection.awaited.push(id.clone());
			}
		}
	}
	/// Boards let go of after a drag are put down once each is where its move asked, or gone.
	pub fn land_page_drag(&mut self, boards: &[PageBox]) {
		let Some(PageDrag { released: Some((to, _)), .. }) = &self.page_drag else { return };
		let landed = to.iter().all(|m| boards.iter().find(|b| b.path == m.path).is_none_or(|b| (b.x - m.x).abs() <= 1.0 && (b.y - m.y).abs() <= 1.0));
		if landed {
			self.page_drag = None;
		}
	}
	fn landed(&mut self) {
		self.drag = ZERO;
		self.resize = None;
	}
}

/// The editor: its state and the rules it follows.
#[derive(Clone, Debug)]
pub struct Editor {
	pub state: State,
	pub rules: Rules,
}

/// Where everything a drop can move is as it is let go: each carried item where the drag has it, and every other
/// child of each frame it leaves or joins, and of each frame those sit in, where they are now (`camera/glide.ts`).
pub fn landing_boxes(scene: &dyn Scene, ids: &[String], offset: Offset, into: Option<&str>) -> Vec<(String, Rect)> {
	let mut out: Vec<(String, Rect)> = Vec::new();
	let mut holders = Vec::new();
	for start in ids.iter().map(|id| scene.parent(id)).chain(std::iter::once(into.map(str::to_string))) {
		let mut up = start;
		while let Some(holder) = up {
			up = scene.parent(&holder);
			if !holders.contains(&holder) {
				holders.push(holder);
			}
		}
	}
	for holder in &holders {
		for child in scene.children(holder) {
			if ids.contains(&child) {
				continue;
			}
			if let Some(b) = scene.bounds(&child) {
				out.push((child, b));
			}
		}
	}
	for id in ids {
		if let Some(b) = scene.bounds(id) {
			out.push((id.clone(), Rect { x: b.x + offset.dx, y: b.y + offset.dy, ..b }));
		}
	}
	out
}

fn with_selection(state: &mut State, items: Option<Vec<String>>, boards: Option<Vec<String>>) {
	if let Some(items) = items {
		state.selection.items = items;
	}
	if let Some(boards) = boards {
		state.selection.boards = boards;
	}
}

fn snaps(rules: &Rules, pointer: Pointer) -> bool {
	rules.snap_by.get(pointer)
}

fn is_card_id(scene: &dyn Scene, id: &str) -> bool {
	scene.node(id).is_some_and(pen::is_card)
}

/// The radius a node is drawn with now, for a let-go radius to be let go of when the drawing has it.
fn radius_now(scene: &dyn Scene, id: &str) -> Option<f64> {
	let node = scene.node(id)?;
	let area = scene.bounds(id)?;
	resize::radius_start(node, &area).map(|start| start.radius).or_else(|| node.get("cornerRadius").and_then(Value::as_f64)).or(Some(0.0))
}

impl Editor {
	pub fn new(rules: Rules) -> Editor {
		Editor { state: State::new(Mode::Browse, Tool::Select), rules }
	}

	/// Start carrying `ids` and `boards` from a press. A finger's carry is under way already (it carries once past its slop).
	fn carry(&mut self, scene: &dyn Scene, ctx: &Context, p: &PointerInput, ids: Vec<String>, boards: Vec<String>, tap: Option<Tap>, finger: Option<(Pt, Pt)>) -> Effect {
		let snapping = snaps(&self.rules, if finger.is_some() { Pointer::Touch } else { p.pointer });
		let carry = Carry {
			start: selection_box(scene, &ids, &boards),
			targets: if snapping { snap_targets(scene, &ids, &boards, &ctx.view) } else { Vec::new() },
			reading: if snapping { reading_targets(scene, &ids, &boards, &ctx.view) } else { Vec::new() },
			from: finger.map(|(at, _)| at).unwrap_or(p.at),
			from_client: finger.map(|(_, client)| client).unwrap_or(p.client),
			touch: finger.is_some(),
			tap,
			offset: ZERO,
			moved: finger.is_some(),
			boards,
			ids: ids.clone(),
		};
		self.state.gesture = Some(Gesture::Carry(carry));
		Effect::GhostTake { ids }
	}

	/// A press on the drawing or bare canvas with the select tool: what is under it picked up, or a marquee.
	fn press_canvas(&mut self, p: &PointerInput, scene: &dyn Scene, ctx: &Context) -> Step {
		let selected = self.state.selection.items.clone();
		let inner = pick_at(scene, p.at, PickOptions { deep: true, ..Default::default() });
		let hit = match &inner {
			Some(inner) if selected.contains(&inner.id) => Some(inner.clone()),
			_ => pick_at(scene, p.at, Default::default()),
		};
		let mut effects = vec![Effect::SelectBoard { path: None }];
		if let Some(hit) = hit {
			if p.mods.shift {
				let items = if selected.contains(&hit.id) { selected.into_iter().filter(|id| *id != hit.id).collect() } else { [selected, vec![hit.id]].concat() };
				with_selection(&mut self.state, Some(items), None);
				return Step { effects, ..Default::default() };
			}
			let group = selected.contains(&hit.id);
			let moving = if group { selected } else { vec![hit.id.clone()] };
			let boards = if group { self.state.selection.boards.clone() } else { Vec::new() };
			if !group {
				with_selection(&mut self.state, Some(moving.clone()), Some(Vec::new()));
			}
			self.state.hover.item = None;
			// A link in a card: a click that does not move follows it, in browse mode, or with ⌘ or Ctrl while editing.
			let href = (ctx.link_at)(p.at);
			let follows = href.is_some() && (self.state.mode == Mode::Browse || p.mods.free());
			let playable = inner.as_ref().filter(|one| scene.node(&one.id).and_then(pen::media_of).is_some()).map(|one| one.id.clone()).or_else(|| scene.node(&hit.id).and_then(pen::media_of).map(|_| hit.id.clone()));
			let tap = if follows {
				href.map(|href| Tap::OpenLink { href })
			} else {
				playable.and_then(|id| scene.node(&id).and_then(pen::media_of).map(|media| Tap::Media { id, media }))
			};
			effects.push(self.carry(scene, ctx, p, moving, boards, tap, None));
			return Step { effects, ..Default::default() };
		}
		// Bare canvas: a marquee, picking what is wholly inside it as it goes. Shift adds to what is selected.
		let adding = p.mods.shift;
		let (kept_items, kept_boards) = if adding { (self.state.selection.items.clone(), self.state.selection.boards.clone()) } else { (Vec::new(), Vec::new()) };
		if !adding {
			with_selection(&mut self.state, Some(Vec::new()), Some(Vec::new()));
		}
		self.state.marquee = Some(Corners { x1: p.at.x, y1: p.at.y, x2: p.at.x, y2: p.at.y });
		self.state.gesture = Some(Gesture::Marquee { from: p.at, kept_items, kept_boards });
		Step { effects, ..Default::default() }
	}

	/// A press on a board: Shift adds it to the picks or takes it out; otherwise it is carried with the selection it is part of, or alone.
	fn press_page(&mut self, path: &str, p: &PointerInput, scene: &dyn Scene, ctx: &Context) -> Step {
		let picks = self.state.selection.boards.clone();
		if p.mods.shift {
			let boards = if picks.iter().any(|one| one == path) { picks.into_iter().filter(|one| one != path).collect() } else { [picks, vec![path.to_string()]].concat() };
			with_selection(&mut self.state, None, Some(boards));
			return Step::default();
		}
		let group = picks.iter().any(|one| one == path);
		let (items, boards) = if group { (self.state.selection.items.clone(), picks) } else { (Vec::new(), vec![path.to_string()]) };
		if !group {
			with_selection(&mut self.state, Some(Vec::new()), Some(Vec::new()));
		}
		let effect = self.carry(scene, ctx, p, items, boards, None, None);
		Step { effects: vec![Effect::SelectBoard { path: Some(path.to_string()) }, effect], ..Default::default() }
	}

	/// A move of the selection being carried.
	fn move_carry(&mut self, mut g: Carry, p: &PointerInput, scene: &dyn Scene, ctx: &Context) -> Step {
		let now = p.at;
		let threshold = snap_threshold(&self.rules, ctx.zoom);
		let mut guides = Vec::new();
		let mut effects = Vec::new();
		let onto: Option<String>;
		let mut offset;
		if g.touch {
			// A finger moves by as far as it has gone on the screen, and drops into what is under it.
			offset = Offset { dx: (p.client.x - g.from_client.x) / ctx.zoom, dy: (p.client.y - g.from_client.y) / ctx.zoom };
			onto = drop::frame_under(scene, now, &g.ids);
			let card = onto.as_deref().filter(|into| is_card_id(scene, into)).and_then(|_| selection_box(scene, &g.ids, &[]));
			if let Some(card) = card {
				let gap = GHOST_GAP_FINGER / ctx.zoom;
				offset = Offset { dx: now.x + gap - card.x, dy: now.y + gap - card.y };
			} else if let Some(start) = g.start.filter(|_| !g.targets.is_empty() || !g.reading.is_empty()) {
				// A finger snaps as a mouse does (`snap.by-pointer`); a finger has no ⌘ to turn it off.
				let snapped = snap_move(&Rect { x: start.x + offset.dx, y: start.y + offset.dy, ..start }, &g.targets, threshold, &g.reading, &self.rules);
				offset = Offset { dx: offset.dx + snapped.dx, dy: offset.dy + snapped.dy };
				guides = snapped.guides;
			}
			effects.push(Effect::GhostShow { over: card.is_some(), client: p.client, gap: GHOST_GAP_FINGER });
		} else {
			let (mut dx, mut dy) = (now.x - g.from.x, now.y - g.from.y);
			// Shift keeps it to one axis.
			if p.mods.shift {
				if dx.abs() > dy.abs() {
					dy = 0.0;
				} else {
					dx = 0.0;
				}
			}
			// ⌘ or Ctrl turns snapping off.
			if let Some(start) = g.start.filter(|_| !p.mods.free()) {
				let snapped = snap_move(&Rect { x: start.x + dx, y: start.y + dy, ..start }, &g.targets, threshold, &g.reading, &self.rules);
				if !p.mods.shift || dx != 0.0 {
					dx += snapped.dx;
				}
				if !p.mods.shift || dy != 0.0 {
					dy += snapped.dy;
				}
				guides = snapped.guides;
			}
			offset = Offset { dx, dy };
			onto = if g.ids.is_empty() || p.mods.free() { None } else { drop::frame_under(scene, now, &g.ids) };
			let over = onto.as_deref().is_some_and(|into| is_card_id(scene, into)) && g.start.is_some();
			if over {
				let gap = GHOST_GAP_POINTER / ctx.zoom;
				let start = g.start.unwrap();
				offset = Offset { dx: now.x + gap - start.x, dy: now.y + gap - start.y };
				guides.clear();
			}
			effects.push(Effect::GhostShow { over, client: p.client, gap: GHOST_GAP_POINTER });
			effects.push(Effect::Composer { client: Some(p.client), ids: g.ids.clone(), boards: g.boards.clone() });
			effects.push(Effect::Panned);
		}
		let into = if g.touch || !(g.ids.is_empty() || p.mods.free()) { Some(onto.clone()) } else { None };
		let slot = onto.as_deref().and_then(|frame| drop::drop_slot(scene, frame, now, &g.ids));
		let near = if !g.ids.is_empty() && (g.touch || !p.mods.free()) {
			let near = drop::near_drops(scene, now, &g.ids, drop::near_reach(&self.rules, ctx.zoom), Current { into: onto.as_deref(), line: slot.as_ref().map(|s| s.line) });
			(!near.slots.is_empty() || !near.frames.is_empty()).then_some(near)
		} else {
			None
		};
		self.state.drop = Drop { into, slot, near };
		g.offset = offset;
		g.moved = true;
		let carried = if g.touch { self.state.selection.boards.clone() } else { g.boards.clone() };
		self.state.guides = guides;
		if !g.ids.is_empty() || g.touch {
			self.state.drag = offset;
		}
		if !carried.is_empty() {
			self.state.page_drag = Some(PageDrag { paths: carried, offset, released: None });
		}
		let preview = if !g.ids.is_empty() || g.touch { Preview::Show(g.ids.iter().map(|id| (id.clone(), PreviewChange { dx: offset.dx, dy: offset.dy, ..Default::default() })).collect()) } else { Preview::Keep };
		self.state.gesture = Some(Gesture::Carry(g));
		Step { preview, effects, ..Default::default() }
	}

	/// The boards a drag let go of stay where they were dropped until they are where the move asked, or `PAGE_HOLD_MS` passes.
	fn hold_pages(&mut self, carried: Option<PageDrag>, moves: &[PageMove], time: f64, effects: &mut Vec<Effect>) {
		let Some(carried) = carried else {
			self.state.page_drag = None;
			return;
		};
		let moving: Vec<PageMove> = moves.iter().filter(|m| carried.paths.contains(&m.path)).cloned().collect();
		if moving.is_empty() {
			self.state.page_drag = None;
			return;
		}
		let until = time + PAGE_HOLD_MS;
		effects.push(Effect::Wake { at: until });
		self.state.page_drag = Some(PageDrag { paths: carried.paths, offset: carried.offset, released: Some((moving, until)) });
	}

	/// A gesture let go with its edit sent: the engine is told, and it waits for the drawing that answers it.
	fn settle(&mut self, time: f64, ctx: &Context, effects: &mut Vec<Effect>, landing: Vec<(String, Rect)>) {
		let until = time + SETTLE_MS;
		effects.push(Effect::Settle { landing: landing.into_iter().map(|(id, r)| Landing { id, x: r.x, y: r.y, w: r.w, h: r.h }).collect() });
		effects.push(Effect::Wake { at: until });
		self.state.settling.push((ctx.generation, until));
	}

	/// The lift of a carry.
	fn release_carry(&mut self, g: Carry, p: &PointerInput, scene: &dyn Scene, ctx: &mut Context) -> Step {
		let Carry { ids, boards, offset, .. } = g.clone();
		let mut effects = vec![Effect::GhostDrop];
		let into = self.state.drop.into.clone();
		let slot = self.state.drop.slot.as_ref().map(|s| s.index);
		let page_drag = self.state.page_drag.take();
		self.state.gesture = None;
		self.state.guides.clear();
		self.state.drop = Drop::default();
		if g.touch {
			let ops = ops::move_ops(scene, &ids, offset.dx, offset.dy, into.as_ref().map(|i| i.as_deref()), slot);
			if !ids.is_empty() {
				let landing = landing_boxes(scene, &ids, offset, into.as_ref().and_then(|i| i.as_deref()));
				self.settle(p.time, ctx, &mut effects, landing);
			}
			let moves = ops::page_moves(&scene.boards(), &self.state.selection.boards, offset.dx, offset.dy);
			effects.push(Effect::MoveBoards { moves: moves.clone() });
			self.hold_pages(page_drag, &moves, p.time, &mut effects);
			return Step { ops, effects, ..Default::default() };
		}
		effects.push(Effect::Composer { client: None, ids: ids.clone(), boards: boards.clone() });
		if !g.moved {
			if let Some(tap) = g.tap {
				effects.push(match tap {
					Tap::OpenLink { href } => Effect::OpenLink { href },
					Tap::Media { id, media } => Effect::Media { id, media },
				});
			}
			return Step { effects, ..Default::default() };
		}
		// Dropped on the composer: the move is undone and the items are mentioned instead.
		if (ctx.over_composer)(p.client, &ids, &boards) {
			effects.push(Effect::Refer { ids, boards });
			self.state.drag = ZERO;
			return Step { preview: Preview::Clear, effects, ..Default::default() };
		}
		let mut preview = Preview::Keep;
		let copying = p.mods.alt && self.rules.copy_with_alt.get(p.pointer) && !ids.is_empty();
		let ops = if copying {
			// Alt lets go of copies, and leaves the originals where they were.
			preview = Preview::Clear;
			let copies = ops::copy_ops(scene, &ids, offset.dx, offset.dy, &mut *ctx.next_id);
			let (ops, made) = (copies.ops, copies.made);
			self.state.drag = ZERO;
			if !made.is_empty() {
				self.state.select_made(&made);
			}
			ops
		} else {
			ops::move_ops(scene, &ids, offset.dx, offset.dy, into.as_ref().map(|i| i.as_deref()), slot)
		};
		if !ids.is_empty() && ops.is_empty() {
			// Nothing it carried can move (an arrow joined at both ends): it goes back now.
			preview = Preview::Clear;
			self.state.drag = ZERO;
		} else if !ids.is_empty() {
			let landing = if copying { Vec::new() } else { landing_boxes(scene, &ids, offset, into.as_ref().and_then(|i| i.as_deref())) };
			self.settle(p.time, ctx, &mut effects, landing);
		}
		let moves = ops::page_moves(&scene.boards(), &boards, offset.dx, offset.dy);
		effects.push(Effect::MoveBoards { moves: moves.clone() });
		self.hold_pages(page_drag, &moves, p.time, &mut effects);
		Step { ops, preview, effects }
	}

	/// A second press on the same handle, without a drag, soon after.
	fn handle_tap(&mut self, key: String, time: f64) -> bool {
		let again = self.state.handle_tap.as_ref().is_some_and(|(was, at)| *was == key && time - at < HANDLE_TAP_MS);
		self.state.handle_tap = if again { None } else { Some((key, time)) };
		again
	}

	fn press_handle(&mut self, input: &Input, scene: &dyn Scene, ctx: &Context) -> Option<Step> {
		match input {
			Input::PressHandle { handle, id, area, p } => {
				let node = scene.node(id);
				let given = scene.placed(id).unwrap_or(*area);
				self.state.gesture = Some(Gesture::Resize {
					id: id.clone(),
					handle: *handle,
					start: *area,
					given,
					// A card as tall as its words stays that while only its sides are dragged.
					words: resize::keeps_words(node, *handle),
					least: Least { floor: resize::size_floor(node), narrowest: resize::size_narrowest(node) },
					targets: snap_targets(scene, std::slice::from_ref(id), &[], &ctx.view),
					from: p.at,
					next: *area,
					moved: false,
				});
				Some(Step::default())
			}
			Input::PressBoardHandle { handle, path, area, p } => {
				let least = scene.boards().into_iter().find(|b| &b.path == path).and_then(|b| b.least);
				self.state.gesture = Some(Gesture::PageResize { path: path.clone(), handle: *handle, least, start: *area, targets: snap_targets(scene, &[], std::slice::from_ref(path), &ctx.view), from: p.at, next: *area, moved: false });
				Some(Step::default())
			}
			Input::PressRadius { id, start, .. } => {
				self.state.gesture = Some(Gesture::Radius { id: id.clone(), start: start.clone(), radius: start.radius, moved: false });
				Some(Step::default())
			}
			Input::PressArrowEnd { which, ends, .. } => {
				let node = scene.node(&ends.id)?.clone();
				let metadata = pen::metadata(&node)?.clone();
				let (stays, own) = match which {
					Which::From => (ends.to, ends.from_join.clone()),
					Which::To => (ends.from, ends.to_join.clone()),
				};
				self.state.gesture = Some(Gesture::ArrowEnd { id: ends.id.clone(), which: *which, metadata, node, stays, own, slid: None, moved: false });
				Some(Step::default())
			}
			Input::PressArrowBend { ends, .. } => {
				ends.middle?;
				let node = scene.node(&ends.id)?.clone();
				let metadata = pen::metadata(&node)?.clone();
				let start = arrows::bend_start(scene, &metadata)?;
				self.state.gesture = Some(Gesture::ArrowBend { id: ends.id.clone(), node, route: ends.route, start, next: None, moved: false });
				Some(Step::default())
			}
			_ => None,
		}
	}

	fn moved(&mut self, p: &PointerInput, scene: &dyn Scene, ctx: &Context) -> Step {
		let Some(g) = self.state.gesture.clone() else { return Step::default() };
		let threshold = snap_threshold(&self.rules, ctx.zoom);
		match g {
			Gesture::Carry(carry) => self.move_carry(carry, p, scene, ctx),
			Gesture::Marquee { from, kept_items, kept_boards } => {
				let m = Corners { x1: from.x, y1: from.y, x2: p.at.x, y2: p.at.y };
				let (items, boards) = marquee_pick(scene, &m.rect());
				let union = |kept: Vec<String>, picked: Vec<String>| {
					let mut all = kept;
					for one in picked {
						if !all.contains(&one) {
							all.push(one);
						}
					}
					all
				};
				with_selection(&mut self.state, Some(union(kept_items.clone(), items)), Some(union(kept_boards.clone(), boards)));
				self.state.marquee = Some(m);
				Step { effects: vec![Effect::Panned], ..Default::default() }
			}
			Gesture::Resize { id, handle, start, given, words, least, targets, from, .. } => {
				let step = resize::resize_step(&start, handle, Pt::new(p.at.x - from.x, p.at.y - from.y), ResizeMods::from(p.mods), &SnapOptions { targets: &targets, threshold }, least);
				let area = resize::given_for(&start, &given, &step.area);
				self.state.guides = step.guides;
				self.state.resize = Some((id.clone(), step.area));
				let change = resize::resize_preview(&given, &area, words);
				if let Some(Gesture::Resize { next, moved, .. }) = &mut self.state.gesture {
					*next = step.area;
					*moved = true;
				}
				Step { preview: Preview::Show(vec![(id, PreviewChange { dx: change.dx, dy: change.dy, w: Some(change.w), h: change.h, radius: None })]), ..Default::default() }
			}
			Gesture::PageResize { path, handle, least, start, targets, from, .. } => {
				let step = resize::page_resize_step(&start, handle, Pt::new(p.at.x - from.x, p.at.y - from.y), ResizeMods::from(p.mods), &SnapOptions { targets: &targets, threshold });
				self.state.guides = step.guides;
				self.state.page_resize = Some((path, resize::shown_page_resize(&step.area, least), None));
				if let Some(Gesture::PageResize { next, moved, .. }) = &mut self.state.gesture {
					*next = step.area;
					*moved = true;
				}
				Step::default()
			}
			Gesture::Radius { id, start, .. } => {
				let radius = resize::radius_at(&start.area, start.most, p.at);
				self.state.radius = Some((id.clone(), radius, None));
				if let Some(Gesture::Radius { radius: r, moved, .. }) = &mut self.state.gesture {
					*r = radius;
					*moved = true;
				}
				Step { preview: Preview::Show(vec![(id, PreviewChange { radius: Some(radius), ..Default::default() })]), ..Default::default() }
			}
			Gesture::ArrowEnd { id, which, metadata, node, stays, own, .. } => {
				// Along the side the end joins, the drag slides the join; away from it, it picks the end up.
				let slid = arrows::slide_join(own.as_ref(), p.at, ctx.zoom, p.mods.alt, &self.rules);
				if let Some(slid) = &slid {
					let draft = arrows::route_draft(scene, &Value::Object(arrows::with_end(&metadata, which, slid.end().to_value())), &node);
					self.state.end_draft = None;
					self.state.joins = own.iter().map(|o| o.area).collect();
					self.state.sides.clear();
					self.state.route = draft;
				} else {
					let join = arrows::join_at(scene, p.at, ctx.zoom, Some(&id), &self.rules);
					let now = p.at;
					self.state.route = None;
					self.state.end_draft = Some(match which {
						Which::From => Corners { x1: now.x, y1: now.y, x2: stays.x, y2: stays.y },
						Which::To => Corners { x1: stays.x, y1: stays.y, x2: now.x, y2: now.y },
					});
					self.state.joins = join.iter().map(|j| j.area).collect();
					self.state.sides = join.iter().map(|j| (j.area, j.side)).collect();
				}
				if let Some(Gesture::ArrowEnd { slid: s, moved, .. }) = &mut self.state.gesture {
					*s = slid;
					*moved = true;
				}
				Step::default()
			}
			Gesture::ArrowBend { node, route, start, .. } => {
				let next = arrows::bend_at(&start, route, p.at);
				self.state.route = arrows::route_draft(scene, &Value::Object(next.clone()), &node);
				if let Some(Gesture::ArrowBend { next: n, moved, .. }) = &mut self.state.gesture {
					*n = Some(next);
					*moved = true;
				}
				Step::default()
			}
		}
	}

	fn released(&mut self, p: &PointerInput, scene: &dyn Scene, ctx: &mut Context) -> Step {
		let Some(g) = self.state.gesture.clone() else { return Step::default() };
		let mut effects = Vec::new();
		if !matches!(g, Gesture::Carry(_)) {
			self.state.gesture = None;
		}
		match g {
			Gesture::Carry(carry) => self.release_carry(carry, p, scene, ctx),
			Gesture::Marquee { .. } => {
				self.state.marquee = None;
				Step::default()
			}
			Gesture::Resize { id, handle, start, given, words, next, moved, .. } => {
				self.state.guides.clear();
				if !moved {
					// Two presses on a frame's top or bottom handle: it hugs what it holds again.
					let again = self.handle_tap(format!("size:{id}:{}", handle.name()), p.time);
					let op = if again { resize::hug_again_op(&id, scene.node(&id), handle) } else { None };
					return Step { ops: op.into_iter().collect(), ..Default::default() };
				}
				self.settle(p.time, ctx, &mut effects, Vec::new());
				Step { ops: vec![resize::resize_op(&id, &resize::given_for(&start, &given, &next), words)], effects, ..Default::default() }
			}
			Gesture::PageResize { path, start, next, least, moved, .. } => {
				self.state.guides.clear();
				if !moved {
					self.state.page_resize = None;
					return Step::default();
				}
				let end = resize::page_resize_end(&start, &next);
				if let Some(to) = end.to {
					effects.push(Effect::MoveBoards { moves: vec![PageMove { path: path.clone(), x: to.x, y: to.y }] });
				}
				if let Some(size) = end.size {
					effects.push(Effect::BoardSize { path: path.clone(), size: Size { w: size.w, h: size.h } });
				}
				// The box is let go of when the board is at it, or after a moment if the file settles elsewhere.
				let until = p.time + PAGE_HOLD_MS;
				effects.push(Effect::Wake { at: until });
				self.state.page_resize = Some((path.clone(), resize::shown_page_resize(&next, least), Some(((ctx.page_rev)(&path), until))));
				Step { effects, ..Default::default() }
			}
			Gesture::Radius { id, start, radius, moved } => {
				if !moved || radius == start.radius {
					self.state.radius = None;
					return Step { preview: Preview::Clear, ..Default::default() };
				}
				let until = p.time + RADIUS_HOLD_MS;
				effects.push(Effect::Wake { at: until });
				self.state.radius = Some((id.clone(), radius, Some(until)));
				Step { ops: vec![resize::radius_op(&id, radius, start.shape, scene.node(&id))], effects, ..Default::default() }
			}
			Gesture::ArrowEnd { id, which, metadata, slid, moved, .. } => {
				self.state.end_draft = None;
				self.state.joins.clear();
				self.state.sides.clear();
				self.state.route = None;
				if !moved {
					// A double-click on a joined end: the join goes back to the middle of its side.
					let again = self.handle_tap(format!("end:{id}:{}", which.key()), p.time);
					let op = if again { arrows::reset_end_op(&id, scene.node(&id).and_then(pen::metadata), which) } else { None };
					return Step { ops: op.into_iter().collect(), ..Default::default() };
				}
				let end = slid.map(|s| s.end()).unwrap_or_else(|| arrows::dropped_end(scene, &id, &metadata, which, p.at, ctx.zoom, &self.rules));
				Step { ops: vec![arrows::arrow_op(&id, arrows::with_end(&metadata, which, end.to_value()))], ..Default::default() }
			}
			Gesture::ArrowBend { id, next, moved, .. } => {
				self.state.route = None;
				if !moved {
					// A double-click on the middle handle: back on the automatic route.
					let again = self.handle_tap(format!("bend:{id}"), p.time);
					let op = if again { arrows::reset_bend_op(&id, scene.node(&id).and_then(pen::metadata)) } else { None };
					return Step { ops: op.into_iter().collect(), ..Default::default() };
				}
				Step { ops: next.map(|next| arrows::arrow_op(&id, next)).into_iter().collect(), ..Default::default() }
			}
		}
	}

	/// The editor's next state for one input, with the ops, preview and effects it brings.
	pub fn step(&mut self, input: Input, scene: &dyn Scene, ctx: &mut Context) -> Step {
		let pressing = matches!(input, Input::PressCanvas(_) | Input::PressBoard { .. } | Input::PressBlock { .. } | Input::PressHandle { .. } | Input::PressBoardHandle { .. } | Input::PressRadius { .. } | Input::PressArrowEnd { .. } | Input::PressArrowBend { .. });
		// A press starts afresh: no gesture is still in hand when another press lands.
		if pressing {
			self.state.gesture = None;
		}
		match &input {
			Input::PressCanvas(p) => self.press_canvas(p, scene, ctx),
			Input::PressBoard { path, p } => self.press_page(path, p, scene, ctx),
			Input::PressBlock { id, p } => {
				with_selection(&mut self.state, Some(vec![id.clone()]), Some(Vec::new()));
				let effect = self.carry(scene, ctx, p, vec![id.clone()], Vec::new(), None, None);
				Step { effects: vec![Effect::SelectBoard { path: None }, effect], ..Default::default() }
			}
			Input::PressHandle { .. } | Input::PressBoardHandle { .. } | Input::PressRadius { .. } | Input::PressArrowEnd { .. } | Input::PressArrowBend { .. } => self.press_handle(&input, scene, ctx).unwrap_or_default(),
			Input::Carry { from_at, from_client, p } => {
				let (items, boards) = (self.state.selection.items.clone(), self.state.selection.boards.clone());
				let effect = self.carry(scene, ctx, p, items, boards, None, Some((*from_at, *from_client)));
				Step { effects: vec![effect], ..Default::default() }
			}
			Input::Move(p) => self.moved(p, scene, ctx),
			Input::Release(p) => self.released(p, scene, ctx),
			Input::Cancel => {
				// A second finger: the start of a pinch, and whatever was carried goes back.
				let carried = matches!(&self.state.gesture, Some(Gesture::Carry(c)) if c.touch && c.moved);
				self.state.gesture = None;
				self.state.drop = Drop::default();
				self.state.guides.clear();
				if !carried {
					return Step { effects: vec![Effect::GhostDrop], ..Default::default() };
				}
				self.state.drag = ZERO;
				self.state.page_drag = None;
				Step { preview: Preview::Clear, effects: vec![Effect::GhostDrop], ..Default::default() }
			}
			Input::Drawn { fresh, current, present } => {
				// The answer to a drag has been drawn: the offset goes. Only a newly drawn document is the answer, and only the page's.
				if *fresh && *current {
					self.state.landed();
				}
				// A selection of items the drawing no longer has is let go; what was just made waits for the drawing to have it.
				let awaited: Vec<String> = self.state.selection.awaited.iter().filter(|id| !present.contains(*id)).cloned().collect();
				let items: Vec<String> = self.state.selection.items.iter().filter(|id| present.contains(*id) || awaited.contains(id)).cloned().collect();
				self.state.selection.awaited = awaited;
				self.state.selection.items = items;
				// A let-go radius is let go of when the drawing has it.
				if let Some((id, radius, Some(_))) = self.state.radius.clone() {
					if radius_now(scene, &id).is_some_and(|now| now.round() == radius.round()) {
						self.state.radius = None;
					}
				}
				Step::default()
			}
			Input::Tick(time) => {
				let mut preview = Preview::Keep;
				let (due, left): (Vec<_>, Vec<_>) = self.state.settling.iter().partition(|(_, until)| *until <= *time);
				if !due.is_empty() {
					self.state.settling = left;
					// No new drawing since it was let go: the server refused it, or it changed nothing.
					if due.iter().any(|(generation, _)| *generation == ctx.generation) {
						self.state.landed();
						preview = Preview::Clear;
					}
				}
				if matches!(self.state.radius, Some((_, _, Some(until))) if until <= *time) {
					self.state.radius = None;
				}
				if matches!(self.state.page_resize, Some((_, _, Some((_, until)))) if until <= *time) {
					self.state.page_resize = None;
				}
				if matches!(&self.state.page_drag, Some(PageDrag { released: Some((_, until)), .. }) if *until <= *time) {
					self.state.page_drag = None;
				}
				Step { preview, ..Default::default() }
			}
			Input::CarryPending(pending) => {
				self.state.carry_pending = *pending;
				Step::default()
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::rules::{Form, Rules};
	use crate::scene::{Fake, FakeItem};
	use serde_json::json;

	/// `a` and `b` side by side, `b`'s left edge 290 right of `a`'s; a board far to the right.
	fn scene() -> Fake {
		Fake::new(vec![FakeItem::rect("a", 10.0, 20.0, 100.0, 50.0), FakeItem::rect("b", 400.0, 20.0, 100.0, 50.0)]).with_boards(vec![PageBox { path: "boards/one.html".into(), x: 1000.0, y: 0.0, w: 400.0, h: 300.0, least: None }])
	}
	fn at(x: f64, y: f64, pointer: Pointer, time: f64) -> PointerInput {
		PointerInput { at: Pt::new(x, y), client: Pt::new(x, y), mods: Mods::default(), pointer, time }
	}
	fn mouse(x: f64, y: f64) -> PointerInput {
		at(x, y, Pointer::Mouse, 1000.0)
	}
	fn with(mut p: PointerInput, mods: Mods) -> PointerInput {
		p.mods = mods;
		p
	}
	/// Run inputs through an editor on a form's rules, with the whole stage in view to snap to.
	fn run(form: Form, start: impl FnOnce(&mut State), inputs: Vec<Input>) -> (Editor, Vec<Step>) {
		let s = scene();
		let mut editor = Editor::new(Rules::for_form(form));
		editor.state.mode = Mode::Edit;
		start(&mut editor.state);
		let mut n = 0;
		let mut next = || {
			n += 1;
			format!("new{n}")
		};
		let rev = |_: &str| 7u64;
		let link = |_: Pt| None;
		let composer = |_: Pt, _: &[String], _: &[String]| false;
		let mut ctx = Context { zoom: 1.0, view: Rect { x: -2000.0, y: -2000.0, w: 6000.0, h: 6000.0 }, generation: 1, next_id: &mut next, page_rev: &rev, link_at: &link, over_composer: &composer };
		let steps = inputs.into_iter().map(|input| editor.step(input, &s, &mut ctx)).collect();
		(editor, steps)
	}
	fn kinds(step: &Step) -> Vec<String> {
		step.effects.iter().map(|e| serde_json::to_value(e).unwrap()["do"].as_str().unwrap().to_string()).collect()
	}

	#[test]
	fn a_press_selects_an_item_a_drag_carries_it_and_the_lift_moves_it_and_waits_for_the_drawing() {
		let free = Mods { meta: true, ..Default::default() };
		let (editor, steps) = run(Form::Desk, |_| {}, vec![Input::PressCanvas(mouse(50.0, 40.0)), Input::Move(with(mouse(80.0, 140.0), free)), Input::Release(with(mouse(80.0, 140.0), free))]);
		assert_eq!(editor.state.selection.items, vec!["a".to_string()]);
		assert_eq!(kinds(&steps[0]), vec!["select-board", "ghost-take"]);
		assert_eq!(steps[1].preview, Preview::Show(vec![("a".into(), PreviewChange { dx: 30.0, dy: 100.0, ..Default::default() })]));
		assert_eq!(serde_json::to_value(&steps[2].ops).unwrap(), json!([{ "op": "update", "id": "a", "set": { "x": 40, "y": 120 } }]));
		assert!(kinds(&steps[2]).contains(&"settle".to_string()) && kinds(&steps[2]).contains(&"wake".to_string()));
		assert_eq!(editor.state.drag, Offset { dx: 30.0, dy: 100.0 }, "held until the drawing answers");
	}

	#[test]
	fn the_drawing_that_answers_a_move_puts_its_offset_down_and_with_no_answer_it_goes_when_the_wait_is_due() {
		let (mut editor, _) = run(Form::Desk, |_| {}, vec![Input::PressCanvas(mouse(50.0, 40.0)), Input::Move(mouse(80.0, 140.0)), Input::Release(mouse(80.0, 140.0))]);
		let s = scene();
		let present: HashSet<String> = ["a", "b"].iter().map(|s| s.to_string()).collect();
		let mut next = || "x".to_string();
		let (rev, link, composer) = (|_: &str| 0u64, |_: Pt| None, |_: Pt, _: &[String], _: &[String]| false);
		let mut ctx = Context { zoom: 1.0, view: Rect::default(), generation: 1, next_id: &mut next, page_rev: &rev, link_at: &link, over_composer: &composer };
		let mut waiting = editor.clone();
		editor.step(Input::Drawn { fresh: true, current: true, present }, &s, &mut ctx);
		assert_eq!(editor.state.drag, ZERO);
		let late = waiting.step(Input::Tick(1000.0 + SETTLE_MS), &s, &mut ctx);
		assert_eq!(late.preview, Preview::Clear);
		assert_eq!(waiting.state.drag, ZERO);
	}

	#[test]
	fn rules_snap_by_pointer_a_mouses_drag_three_px_short_of_a_neighbour_snaps_onto_it_and_cmd_turns_it_off() {
		for form in Form::ALL {
			let (_, steps) = run(form, |_| {}, vec![Input::PressCanvas(mouse(50.0, 40.0)), Input::Move(mouse(337.0, 40.0))]);
			assert_eq!(steps[1].preview, Preview::Show(vec![("a".into(), PreviewChange { dx: 290.0, dy: 0.0, ..Default::default() })]), "{form:?}");
		}
		let free = Mods { meta: true, ..Default::default() };
		let (editor, _) = run(Form::Desk, |_| {}, vec![Input::PressCanvas(mouse(50.0, 40.0)), Input::Move(with(mouse(337.0, 40.0), free))]);
		assert_eq!(editor.state.drag, Offset { dx: 287.0, dy: 0.0 });
		assert!(editor.state.guides.is_empty());
	}

	#[test]
	fn rules_snap_by_pointer_a_fingers_carry_snaps_too_and_its_lift_clears_the_guide() {
		for form in [Form::Tablet, Form::Phone] {
			let finger = |x: f64| at(x, 40.0, Pointer::Touch, 1000.0);
			let (editor, steps) = run(
				form,
				|s| s.selection.items = vec!["a".into()],
				vec![Input::Carry { from_at: Pt::new(50.0, 40.0), from_client: Pt::new(50.0, 40.0), p: finger(337.0) }, Input::Move(finger(337.0)), Input::Release(finger(337.0))],
			);
			assert_eq!(steps[1].preview, Preview::Show(vec![("a".into(), PreviewChange { dx: 290.0, dy: 0.0, ..Default::default() })]), "{form:?}");
			assert_eq!(serde_json::to_value(&steps[2].ops).unwrap(), json!([{ "op": "update", "id": "a", "set": { "x": 300, "y": 20 } }]));
			assert!(editor.state.guides.is_empty());
		}
	}

	#[test]
	fn rules_drag_copy_with_alt_alt_lets_go_of_copies_under_a_mouse_and_selects_them() {
		let alt = Mods { alt: true, ..Default::default() };
		let (editor, steps) = run(Form::Desk, |_| {}, vec![Input::PressCanvas(mouse(50.0, 40.0)), Input::Move(mouse(50.0, 240.0)), Input::Release(with(mouse(50.0, 240.0), alt))]);
		assert_eq!(serde_json::to_value(&steps[2].ops).unwrap()[0]["op"], "copy");
		assert_eq!(steps[2].preview, Preview::Clear, "the originals stay where they were");
		assert_eq!(editor.state.selection.items, vec!["new1".to_string()]);
		assert_eq!(editor.state.selection.awaited, vec!["new1".to_string()]);
		// A finger has no Alt to copy with: its carry moves, whatever the keys say.
		assert!(!Rules::tablet().copy_with_alt.touch);
	}

	#[test]
	fn a_pinch_takes_a_fingers_carry_back_and_sends_nothing() {
		let finger = |x: f64, y: f64| at(x, y, Pointer::Touch, 1000.0);
		let (editor, steps) = run(Form::Tablet, |s| s.selection.items = vec!["a".into()], vec![Input::Carry { from_at: Pt::new(50.0, 40.0), from_client: Pt::new(50.0, 40.0), p: finger(70.0, 90.0) }, Input::Move(finger(70.0, 90.0)), Input::Cancel]);
		assert_eq!(steps[2].preview, Preview::Clear);
		assert!(steps[2].ops.is_empty());
		assert_eq!(editor.state.drag, ZERO);
	}

	#[test]
	fn a_marquee_on_bare_canvas_selects_what_is_wholly_inside_and_shift_adds_it_to_what_was() {
		let (editor, _) = run(Form::Desk, |_| {}, vec![Input::PressCanvas(mouse(0.0, 0.0)), Input::Move(mouse(200.0, 200.0)), Input::Release(mouse(200.0, 200.0))]);
		assert_eq!(editor.state.selection.items, vec!["a".to_string()]);
		assert!(editor.state.marquee.is_none());
		let shift = Mods { shift: true, ..Default::default() };
		let (editor, _) = run(Form::Desk, |s| s.selection.items = vec!["b".into()], vec![Input::PressCanvas(with(mouse(0.0, 0.0), shift)), Input::Move(mouse(200.0, 200.0))]);
		assert_eq!(editor.state.selection.items, vec!["b".to_string(), "a".to_string()]);
	}

	#[test]
	fn a_corner_handle_previews_the_size_and_the_lift_writes_it() {
		let area = Rect { x: 10.0, y: 20.0, w: 100.0, h: 50.0 };
		let (_, steps) = run(Form::Desk, |s| s.selection.items = vec!["a".into()], vec![Input::PressHandle { handle: Handle::Se, id: "a".into(), area, p: mouse(110.0, 70.0) }, Input::Move(mouse(160.0, 90.0)), Input::Release(mouse(160.0, 90.0))]);
		match &steps[1].preview {
			Preview::Show(changes) => assert_eq!((changes[0].1.w, changes[0].1.h), (Some(150.0), Some(70.0))),
			other => panic!("no preview: {other:?}"),
		}
		let op = serde_json::to_value(&steps[2].ops).unwrap();
		assert_eq!(op[0]["op"], "update");
		assert_eq!(op[0]["box"], json!({ "x1": 10, "y1": 20, "x2": 160, "y2": 90 }));
	}

	#[test]
	fn a_board_pressed_is_carried_and_held_where_it_was_dropped_until_it_lands() {
		let free = Mods { meta: true, ..Default::default() };
		let (mut editor, steps) = run(Form::Desk, |_| {}, vec![Input::PressBoard { path: "boards/one.html".into(), p: mouse(1100.0, 10.0) }, Input::Move(with(mouse(1150.0, 60.0), free)), Input::Release(with(mouse(1150.0, 60.0), free))]);
		assert_eq!(kinds(&steps[0]), vec!["select-board", "ghost-take"]);
		let moves = serde_json::to_value(&steps[2].effects).unwrap();
		assert!(moves.as_array().unwrap().iter().any(|e| e["do"] == "move-boards" && e["moves"][0]["path"] == "boards/one.html"));
		assert!(editor.state.page_drag.as_ref().is_some_and(|d| d.released.is_some()));
		editor.state.land_page_drag(&[PageBox { path: "boards/one.html".into(), x: 1050.0, y: 50.0, w: 400.0, h: 300.0, least: None }]);
		assert!(editor.state.page_drag.is_none());
	}

	#[test]
	fn effects_and_previews_cross_to_the_page_in_the_typescript_editors_own_words() {
		let effect = Effect::GhostShow { over: false, client: Pt::new(1.0, 2.0), gap: 12.0 };
		assert_eq!(serde_json::to_value(&effect).unwrap(), json!({ "do": "ghost-show", "over": false, "client": { "x": 1.0, "y": 2.0 }, "gap": 12.0 }));
		assert_eq!(serde_json::to_value(Effect::SelectBoard { path: None }).unwrap(), json!({ "do": "select-board", "path": null }));
		assert_eq!(serde_json::to_value(PreviewChange { dx: 1.0, dy: 2.0, ..Default::default() }).unwrap(), json!({ "dx": 1.0, "dy": 2.0 }));
	}
}
