//! The two engines, without the browser: the page's (here, with its frame and gestures in `engine/`)
//! and the worker's (`engine/worker.rs`). The wasm bindings (`bind.rs`) only carry calls across;
//! everything here also runs, and is tested, natively.

use serde_json::{Value, json};
use stage_doc::{Change, Document, History, Ids};
use stage_paint::list::{Color, DrawList, Op};
use stage_paint::painter::{Context, IconShape, LiveInk, Writer, paint_area, paint_ink};
use stage_scene::geometry::Mat;
use stage_paint::tiles::{Grid, Key, TILE, overview_scale, scale_for};
use stage_scene::{Rect, Scene, Updated, arrows};
use stage_text::{Laid, Text};
use stage_text::atlas::Atlas;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

mod frame;
mod gesture;
mod worker;
use gesture::Bent;
pub use worker::{Worker, TILE_SIZE, copy_extent};
pub use frame::{CardPlace, APP_BAR};
pub use gesture::Preview;

/// Where the stage is looking: the stage point at the window's corner, and CSS pixels per stage unit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
	pub x: f64,
	pub y: f64,
	pub zoom: f64,
}

/// The page's engine: owns the document, answers the pointer, and lays the worker's tiles on the
/// screen in the same frame as the board pages.
/// The fewest tiles the page keeps, whatever the screen.
const MIN_TILES: usize = 160;

/// How long a card's new picture takes to fade in over the one it replaced (`Page::fade_pictures`).
const PICTURE_FADE_MS: f32 = 180.0;

pub struct Page {
	/// Draw the lifted items and nothing else over the pages, for one frame: a drag's ghost.
	pub only_lifted: bool,
	/// Leave the lifted items out: a ghost of them is shown in their place.
	pub hide_lifted: bool,
	pub icons: HashMap<String, IconShape>,
	pub text: Text,
	pub atlas: RefCell<Atlas>,
	/// Sleeping items' titles as laid, by title: one line each, laid once and painted every frame (`frame`).
	pub titles: RefCell<HashMap<String, Laid>>,
	pub pictures: Pictures,
	/// What the editor draws over the canvas (`set_overlay`), painted last in every frame (`stage_paint::overlay`).
	pub overlay: Option<stage_paint::overlay::Overlay>,
	/// Pictures put whose sizes the layout has not yet taken in (`lay_out_pictures`).
	pictures_unlaid: bool,
	/// Items being moved: drawn here each frame, left out of the worker's tiles.
	pub lifted: HashSet<String>,
	/// How far each item in a drag has moved, drawn that far away until the drag lets go.
	pub offsets: HashMap<String, (f64, f64)>,
	/// What undoes the fields a gesture is showing (a size, a corner, a colour) before it is saved.
	preview_undo: Vec<Change>,
	/// The arrows a gesture bends, found once per gesture and routed again at each step.
	bent: Option<Bent>,
	/// Items hidden (the eraser), muted (an editor over their words), drawn as holes (live files).
	pub view: ViewState,
	/// The stroke still under the pen.
	pub ink: Vec<LiveInk>,
	/// The stage's boards, as the app places them; and the ones a drag carries, and how far.
	pub cards: Vec<CardPlace>,
	pub carry: (HashSet<String>, f64, f64),
	/// The boards drawn as their picture in the last frame, and the live ones carried as one.
	pub pictured: Vec<String>,
	pub carrying: Vec<String>,
	/// Goes up when `pictured` or `carrying` changes, so the page asks for them only then.
	pub marks: u32,
	pub doc: Document,
	pub scene: Scene,
	pub history: History,
	pub ids: Ids,
	/// Tile pictures the page holds: key → (texture, when last drawn).
	pub tiles: HashMap<Key, (u32, u64)>,
	pub budget: usize,
	/// The scales tiles are held at besides the one shown and the one wanted, nearest the scale
	/// wanted first, and those two: made again only when a tile of a new scale comes or one goes, or
	/// another scale is wanted or shown (`frame`).
	scales: Option<((u32, u32), Vec<u32>)>,
	/// The level shown (its scale's bits): tiles of the level wanted wait unseen until they cover the window.
	shown: Option<u32>,
	/// Show the level wanted at the next frame, whole or not (`show_wanted`).
	show_wanted: bool,
	frame: u64,
	next_texture: u32,
	/// What `layout_changes` last told the page, by root: its id, version and first paint order.
	sent_layout: HashMap<stage_doc::Handle, SentRoot>,
	/// Counts `layout_changes` calls, to find the roots that went (`SentRoot::seen` behind it).
	layout_calls: u64,
	/// The version of each root whose words `font_needs_changed` last told, by root.
	fonts_sent: HashMap<stage_doc::Handle, u64>,
}
/// A root as `layout_changes` last reported it.
struct SentRoot {
	id: String,
	version: u64,
	base: u32,
	seen: u64,
}

/// What the stage asks the drawing to leave out or change, besides the document.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ViewState {
	/// Hidden: being erased, deleted until the server says so.
	pub hidden: HashSet<String>,
	/// Their words are not drawn: an editor is open over them.
	pub mute: HashSet<String>,
	/// Drawn as holes: a live file shows under the drawing there.
	pub holes: HashSet<String>,
	/// Wide tables' scroll, by `id:index`.
	pub scrolls: HashMap<String, f64>,
	/// Who last wrote the drawing, as its placeholder frames are marked; none: the accent, no name.
	pub writer: Option<Writer>,
}

impl ViewState {
	fn apply<'a>(&'a self, ctx: &mut Context<'a>) {
		ctx.mute = Some(&self.mute);
		ctx.holes = Some(&self.holes);
		ctx.scrolls = Some(&self.scrolls);
		ctx.writer = self.writer.as_ref();
	}

	/// The ids whose look changes between two states (for a scroll, `id:index`).
	fn differs(&self, other: &ViewState) -> Vec<String> {
		let mut out: Vec<String> = Vec::new();
		for (a, b) in [(&self.hidden, &other.hidden), (&self.mute, &other.mute), (&self.holes, &other.holes)] {
			out.extend(a.symmetric_difference(b).cloned());
		}
		for key in self.scrolls.keys().chain(other.scrolls.keys()) {
			if self.scrolls.get(key) != other.scrolls.get(key) {
				out.push(key.clone());
			}
		}
		out
	}
}

/// Pictures by address (an image fill's `url`, or `card:<path>` for a card's picture): texture,
/// width and height, and the addresses asked for that have not arrived.
#[derive(Default)]
pub struct Pictures {
	pub held: HashMap<String, (u32, u32, u32)>,
	pub wanted: RefCell<Vec<String>>,
	/// A card's picture a sharper or newer one has replaced, kept drawn under it while the new one
	/// fades in (`Page::fade_pictures`): texture, width, height, and how far the new one has come, 0 to 1.
	pub fading: HashMap<String, (u32, u32, u32, f32)>,
	/// Textures let go of here (an old picture whose fade is done, or one replaced mid-fade), for the caller to free on the GPU.
	pub dropped: Vec<u32>,
}

impl Pictures {
	pub fn get(&self, url: &str) -> Option<(u32, u32, u32)> {
		self.held.get(url).copied()
	}

	/// Take the addresses asked for since the last time, each once, leaving out those held.
	pub fn take_wanted(&self) -> Vec<String> {
		let mut seen = HashSet::new();
		self.wanted.borrow_mut().drain(..).filter(|u| !self.held.contains_key(u) && seen.insert(u.clone())).collect()
	}
}

impl Page {
	pub fn new(text: &str, dark: bool, session: &str) -> Result<Page, String> {
		let doc = Document::parse(text).map_err(|e| e.0)?;
		let mut words = Text::new();
		words.dark = dark;
		let scene = Scene::new(&doc, dark, &words);
		Ok(Page { overlay: None, pictures_unlaid: false, only_lifted: false, hide_lifted: false, cards: Vec::new(), carry: (HashSet::new(), 0.0, 0.0), pictured: Vec::new(), carrying: Vec::new(), marks: 0, offsets: HashMap::new(), preview_undo: Vec::new(), bent: None, view: ViewState::default(), icons: HashMap::new(), text: words, atlas: RefCell::new(Atlas::new()), titles: RefCell::new(HashMap::new()), pictures: Pictures::default(), lifted: HashSet::new(), ink: Vec::new(), doc, scene, history: History::default(), ids: Ids::new(session), tiles: HashMap::new(), budget: 160, scales: None, shown: None, show_wanted: false, frame: 0, next_texture: 1, sent_layout: HashMap::new(), layout_calls: 0, fonts_sent: HashMap::new() })
	}

	// The document: batches, undo, the server's edits, the arrows they move.
	/// Apply a batch. `mine` records it for undo: a batch from someone else's session is not.
	/// Returns the batch's generation, to hand the worker with the same changes.
	pub fn apply(&mut self, changes: &[Change], mine: bool) -> Result<u64, String> {
		let applied = self.doc.apply(changes).map_err(|e| e.0)?;
		if mine {
			self.history.record(&applied);
		}
		self.scene.update(&self.doc, Some(&applied), &self.text);
		Ok(applied.generation)
	}

	/// Undo this session's last batch: the changes that did it, to send on, and their generation.
	pub fn undo(&mut self) -> Option<(Vec<Change>, u64)> {
		let (changes, applied) = self.history.undo(&mut self.doc)?;
		self.scene.update(&self.doc, Some(&applied), &self.text);
		Some((changes, applied.generation))
	}

	pub fn redo(&mut self) -> Option<(Vec<Change>, u64)> {
		let (changes, applied) = self.history.redo(&mut self.doc)?;
		self.scene.update(&self.doc, Some(&applied), &self.text);
		Some((changes, applied.generation))
	}

	/// The server's edits (`stage.pen.delta`), applied and laid out where they reached. A gesture's
	/// shown fields are taken back first: the saved drawing is what is drawn from now on.
	pub fn apply_edits(&mut self, edits: &[stage_doc::edits::Edit]) -> Result<(), String> {
		self.unpreview_fields();
		let before = self.boxes();
		let applied = self.doc.apply_edits(edits).map_err(|e| e.0)?;
		self.scene.update(&self.doc, Some(&applied), &self.text);
		// Arrows follow what the edit moved, routed here as the server will route them.
		let routed = self.reroute_after(&before, applied.reshaped, edits);
		if !routed.is_empty() {
			let applied = self.doc.apply(&routed).map_err(|e| e.0)?;
			self.scene.update(&self.doc, Some(&applied), &self.text);
		}
		Ok(())
	}

	/// Each root's items' boxes as laid out, with the root's handle and version: what an edit's
	/// layout is compared with to find what it moved. A list, not a map: 2,000 items are copied in
	/// microseconds, where hashing every id cost more than the routing.
	fn boxes(&self) -> Vec<(stage_doc::Handle, u64, Vec<Rect>)> {
		self.scene.roots.iter().map(|root| (root.handle, root.version, root.placed.iter().map(|p| p.rect).collect())).collect()
	}

	/// The arrows an edit touched, routed again from where their ends are now, as the Decks server
	/// routes them (`@decks/pen` `reroute`): an arrow the edit made or whose place, geometry, stroke
	/// width or metadata it set, and any with an end (or a parent) whose box the edit moved or resized.
	/// The others keep the server's route: routed again here, one that differed from the server's by
	/// a pixel would move for the round trip and back. An arrow a gesture still holds lifted is routed
	/// too: the gesture's own edit (its drop) arrives with the lift still on, and the drop lands it
	/// where the edit put its ends. `before` is `boxes` from before the edit; `reshaped` says the edit
	/// added, removed or moved items, so a re-laid root's items are compared whole rather than one by
	/// one. The answer is the field changes to apply, none when every touched arrow already lies where
	/// its ends are.
	fn reroute_after(&self, before: &[(stage_doc::Handle, u64, Vec<Rect>)], reshaped: bool, edits: &[stage_doc::edits::Edit]) -> Vec<Change> {
		use stage_doc::edits::Edit;
		let mut written: HashSet<&str> = HashSet::new();
		for edit in edits {
			match edit {
				Edit::Insert { id, .. } => {
					written.insert(id);
				}
				Edit::Set { id, key, .. } if matches!(key.as_str(), "x" | "y" | "geometry" | "strokeWidth" | "metadata") => {
					written.insert(id);
				}
				_ => {}
			}
		}
		// What moved: the items of each root laid out again whose box differs, or all of a root's when its items changed.
		let was: HashMap<stage_doc::Handle, usize> = before.iter().enumerate().map(|(i, (h, _, _))| (*h, i)).collect();
		let mut moved: HashSet<&str> = HashSet::new();
		for root in &self.scene.roots {
			let Some(&(_, version, ref rects)) = was.get(&root.handle).map(|&i| &before[i]) else {
				moved.extend(root.tree.items.iter().map(|it| it.id.as_str()));
				continue;
			};
			if version == root.version {
				continue;
			}
			let same_shape = !reshaped && rects.len() == root.placed.len();
			for (i, item) in root.tree.items.iter().enumerate() {
				if !same_shape || rects[i] != root.placed[i].rect {
					moved.insert(item.id.as_str());
				}
			}
		}
		if moved.is_empty() && written.is_empty() {
			return Vec::new();
		}
		// Where a name is: an item by id, or a page (a card, a board, an app, a document) by its path.
		let find = |name: &str| -> Option<Rect> {
			if let Some((r, i)) = self.scene.find(name) {
				return Some(self.scene.roots[r].placed[i as usize].rect);
			}
			for root in &self.scene.roots {
				for (item, place) in root.tree.items.iter().zip(&root.placed) {
					if item.get("metadata").and_then(|m| m.get("path")).and_then(Value::as_str) == Some(name) {
						return Some(place.rect);
					}
				}
			}
			None
		};
		let line = if self.doc.meta.get("variables").and_then(|v| v.get("decks-line")).is_some() { "$decks-line" } else { "#8a8f98" };
		let mut changes = Vec::new();
		for root in &self.scene.roots {
			let items = &root.tree.items;
			for item in items {
				// Arrows in the document itself: an instance's copies are routed where they are defined.
				if item.handle.is_none() || !arrows::is_arrow(&item.props) {
					continue;
				}
				let Some(meta) = item.get("metadata") else { continue };
				let parent = item.parent.map(|p| &items[p as usize]);
				let parent_id = parent.map(|p| p.id.as_str());
				let touched = written.contains(item.id.as_str()) || arrows::end_items(meta).iter().flatten().copied().chain(parent_id).any(|name| moved.contains(name));
				if !touched {
					continue;
				}
				let Some(points) = arrows::points(meta, &find) else { continue };
				let (route, heads) = arrows::style(meta);
				let stroke = item.get("strokeWidth").and_then(Value::as_f64).unwrap_or(2.0);
				let shape = arrows::shape(&points, stroke, route, heads);
				let origin = parent_id.and_then(find).map_or((0.0, 0.0), |r| (r.x, r.y));
				let (x, y) = (arrows::round(shape.x - origin.0), arrows::round(shape.y - origin.1));
				let num = |key: &str| item.get(key).and_then(Value::as_f64);
				if num("x") == Some(x) && num("y") == Some(y) && item.get("geometry").and_then(Value::as_str) == Some(shape.geometry.as_str()) {
					continue;
				}
				let set = |key: &str, value: Value| Change::Set { id: item.id.clone(), key: key.into(), value: Some(value) };
				changes.extend([
					set("x", json!(x)),
					set("y", json!(y)),
					set("width", json!(shape.width)),
					set("height", json!(shape.height)),
					set("viewBox", json!([0, 0, shape.width, shape.height])),
					set("geometry", json!(shape.geometry)),
				]);
				// The fields the server fills in for an arrow its writer left bare: the tools' arrow grey, 2 px, round ends.
				for (key, value) in [("stroke", json!(line)), ("strokeWidth", json!(2)), ("strokeLinecap", json!("round")), ("strokeLinejoin", json!("round"))] {
					if item.get(key).is_none() {
						changes.push(set(key, value));
					}
				}
				// An arrow sits where its ends are, never where a row layout would put it.
				if let Some(frame) = parent {
					if frame.kind() == "frame" && frame.get("layout").and_then(Value::as_str).unwrap_or("horizontal") != "none" && item.get("layoutPosition").is_none() {
						changes.push(set("layoutPosition", json!("absolute")));
					}
				}
			}
		}
		changes
	}

	/// The whole drawing, as the server sent it: worked out as edits from the one held, so only what
	/// changed is laid out again.
	pub fn set_document(&mut self, text: &str) -> Result<(), String> {
		let next = Document::parse(text).map_err(|e| e.0)?;
		self.history = History::default();
		self.doc = next;
		self.scene = Scene::new(&self.doc, self.scene.dark, &self.text);
		Ok(())
	}

	/// The colour scheme: cards and papers are drawn in it, so the stage is laid out again.
	pub fn set_dark(&mut self, dark: bool) {
		if dark == self.scene.dark && dark == self.text.dark {
			return;
		}
		self.text.dark = dark;
		self.scene = Scene::new(&self.doc, dark, &self.text);
	}

	// Layout: fonts, and the layout as the page is told it.
	/// A font file arrived: words are measured again, so everything is laid out again.
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.hold_font(name, bytes, fallback);
		self.lay_out();
	}

	/// A font file of a batch: kept, and nothing laid out until `lay_out`, once for the batch.
	pub fn hold_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.text.add_font(name, bytes, fallback);
	}

	/// Everything laid out again, after a batch of fonts (`hold_font`).
	pub fn lay_out(&mut self) {
		self.scene.update(&self.doc, None, &self.text);
		// The cards' titles and placeholders' words too: laid before their font came, they were kept empty until the card list next changed.
		self.titles.borrow_mut().clear();
	}

	/// Every item as laid out, in paint order: `[id, x, y, w, h, parent, order, theme]`.
	pub fn layout_json(&self) -> Value {
		let mut out = Vec::new();
		let mut order = 0u32;
		for root in &self.scene.roots {
			for (item, place) in root.tree.items.iter().zip(&root.placed) {
				order += 1;
				if !place.visible {
					continue;
				}
				let r = place.rect;
				let parent = item.parent.map(|p| root.tree.items[p as usize].id.as_str());
				let theme: serde_json::Map<String, Value> = place.theme.0.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
				out.push(json!([item.id, r.x, r.y, r.w, r.h, parent, order, theme]));
			}
		}
		Value::Array(out)
	}

	/// The layout as it changed since the last call: the roots laid out again (new ones included) with
	/// their items and cards, the ones gone, and the roots kept whose first paint order moved. `all`
	/// when every root is in `roots` (the first call, a new document, the scheme, a font), so the page
	/// starts again from them. A drag's step re-lays only the arrows it bends; an edit, what it reached.
	///
	/// `{ all, roots: [{ id, base, items: [[id, x, y, w, h, parent, i, theme]], cards: [{ id, i, box, pad, links, scrollers }] }], removed: [id], bases: [[id, base]] }`:
	/// an item's paint order is its root's `base` plus `i` plus one, as in `layout_json`. With `all`
	/// only `tops` is said, `[[id, base, items]]` for every root: the page reads `layout_json` and
	/// `cards_json` whole, which is quicker to make and to read than the same thing root by root.
	pub fn layout_changes(&mut self) -> Value {
		self.layout_calls += 1;
		let call = self.layout_calls;
		let mut changed = Vec::new();
		let mut bases = Vec::new();
		let mut removed = Vec::new();
		let mut order = 0u32;
		for (at, root) in self.scene.roots.iter().enumerate() {
			let base = order;
			order += root.tree.items.len() as u32;
			match self.sent_layout.get_mut(&root.handle) {
				Some(sent) if sent.id == root.id && sent.version == root.version => {
					if sent.base != base {
						sent.base = base;
						bases.push(json!([root.id, base]));
					}
					sent.seen = call;
				}
				sent => {
					if let Some(old) = sent {
						if old.id != root.id {
							removed.push(Value::String(std::mem::take(&mut old.id)));
						}
					}
					changed.push((at, base));
					self.sent_layout.insert(root.handle, SentRoot { id: root.id.clone(), version: root.version, base, seen: call });
				}
			}
		}
		if self.sent_layout.len() > self.scene.roots.len() || removed.len() + changed.len() + bases.len() > 0 {
			self.sent_layout.retain(|_, sent| {
				if sent.seen == call {
					return true;
				}
				if !sent.id.is_empty() {
					removed.push(Value::String(std::mem::take(&mut sent.id)));
				}
				false
			});
		}
		if changed.len() == self.scene.roots.len() {
			let mut base = 0u32;
			let tops: Vec<Value> = self
				.scene
				.roots
				.iter()
				.map(|root| {
					let top = json!([root.id, base, root.tree.items.len()]);
					base += root.tree.items.len() as u32;
					top
				})
				.collect();
			return json!({ "all": true, "tops": tops, "roots": [], "removed": [], "bases": [] });
		}
		let roots: Vec<Value> = changed.into_iter().map(|(at, base)| self.root_json(&self.scene.roots[at], base)).collect();
		json!({ "all": false, "roots": roots, "removed": removed, "bases": bases })
	}

	/// One root's items as `layout_json` has them (with their index in the root for the order) and its cards.
	fn root_json(&self, root: &stage_scene::Root, base: u32) -> Value {
		let mut items = Vec::new();
		let mut cards = Vec::new();
		for (i, (item, place)) in root.tree.items.iter().zip(&root.placed).enumerate() {
			if !place.visible {
				continue;
			}
			let r = place.rect;
			let parent = item.parent.map(|p| root.tree.items[p as usize].id.as_str());
			let theme: serde_json::Map<String, Value> = place.theme.0.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
			// An arrow's route is this engine's (`reroute_after`): the page's copy of the drawing may still hold the one before the edit.
			if arrows::is_arrow(&item.props) {
				items.push(json!([item.id, r.x, r.y, r.w, r.h, parent, i, theme, { "geometry": item.get("geometry"), "viewBox": item.get("viewBox") }]));
			} else {
				items.push(json!([item.id, r.x, r.y, r.w, r.h, parent, i, theme]));
			}
			if let Some(mut card) = self.card_json(item, place) {
				card["i"] = json!(i);
				cards.push(card);
			}
		}
		json!({ "id": root.id, "base": base, "items": items, "cards": cards })
	}

	/// A markdown card's links and wide tables, without its order; `None` for anything else.
	fn card_json(&self, item: &stage_scene::tree::Item, place: &stage_scene::layout::Placed) -> Option<Value> {
		if !place.visible || !stage_text::is_markdown(item) {
			return None;
		}
		let Some(Value::String(content)) = self.scene.vars.resolve(item.get("content"), &place.theme) else { return None };
		let pad = if item.kind() == "text" { 0.0 } else { stage_scene::layout::NOTE_PAD };
		let style = stage_scene::layout::text_style(item, &self.scene.vars, &place.theme);
		let card = self.text.card(content, &style, (place.rect.w - pad * 2.0).max(1.0) as f32, stage_text::Align::Left);
		let r = place.rect;
		let links: Vec<Value> = card.links.iter().map(|(x, y, w, h, href, s)| json!({ "x": x, "y": y, "w": w, "h": h, "href": href, "scroller": s })).collect();
		let scrollers: Vec<Value> = card.scrollers.iter().map(|(x, y, w, h, c)| json!({ "x": x, "y": y, "w": w, "h": h, "content": c })).collect();
		Some(json!({ "id": item.id, "box": { "x": r.x, "y": r.y, "w": r.w, "h": r.h }, "pad": pad, "links": links, "scrollers": scrollers }))
	}

	/// Each markdown card's links and wide tables, for a press to be answered with: `{ id, order,
	/// box, pad, links, scrollers }`, the links and tables from the card's words' top-left.
	pub fn cards_json(&self) -> Value {
		let mut out = Vec::new();
		let mut order = 0u32;
		for root in &self.scene.roots {
			for (item, place) in root.tree.items.iter().zip(&root.placed) {
				order += 1;
				if let Some(mut card) = self.card_json(item, place) {
					card["order"] = json!(order);
					out.push(card);
				}
			}
		}
		Value::Array(out)
	}

	/// The words on the stage and the faces they are set in, for the app to fetch fonts for:
	/// `[{ family, weight, italic, text }]`. A card's words may be bold, italic or code too.
	pub fn font_needs(&self) -> Value {
		let mut out = Vec::new();
		for root in &self.scene.roots {
			self.root_font_needs(root, &mut out);
		}
		Value::Array(out)
	}

	/// `font_needs` of the roots laid out again since the last call (all of them the first time): the
	/// words a change brought, without the whole stage's words read again for every edit.
	pub fn font_needs_changed(&mut self) -> Value {
		let mut out = Vec::new();
		let mut seen = 0;
		for root in &self.scene.roots {
			if self.fonts_sent.get(&root.handle) != Some(&root.version) {
				self.root_font_needs(root, &mut out);
				self.fonts_sent.insert(root.handle, root.version);
			}
			seen += 1;
		}
		if self.fonts_sent.len() > seen {
			let live: HashSet<stage_doc::Handle> = self.scene.roots.iter().map(|r| r.handle).collect();
			self.fonts_sent.retain(|h, _| live.contains(h));
		}
		Value::Array(out)
	}

	fn root_font_needs(&self, root: &stage_scene::Root, out: &mut Vec<Value>) {
		let vars = &self.scene.vars;
		{
			for (item, place) in root.tree.items.iter().zip(&root.placed) {
				// An arrow's words, in the face the painter sets them in (`stage_paint`, `arrow_label`).
				if item.kind() == "path" {
					let meta = item.get("metadata");
					if meta.and_then(|m| m.get("type")).and_then(Value::as_str) == Some("decks.arrow") {
						if let Some(label) = meta.and_then(|m| m.get("label")).and_then(Value::as_str).filter(|l| !l.trim().is_empty()) {
							out.push(json!({ "family": "Inter", "weight": 500, "italic": false, "text": label }));
						}
					}
					continue;
				}
				if !matches!(item.kind(), "text" | "note" | "prompt" | "context") {
					continue;
				}
				let text = match vars.resolve(item.get("content"), &place.theme) {
					Some(Value::String(s)) => s.clone(),
					_ => continue,
				};
				let style = stage_scene::layout::text_style(item, vars, &place.theme);
				out.push(json!({ "family": style.family, "weight": style.weight, "italic": style.italic, "text": text }));
				if stage_text::is_markdown(item) {
					for (weight, italic) in [(600.0, false), (700.0, false), (400.0, true)] {
						out.push(json!({ "family": style.family, "weight": weight, "italic": italic, "text": text }));
					}
					out.push(json!({ "family": stage_text::card::MONO, "weight": 400, "italic": false, "text": text }));
				}
			}
		}
	}

	// Questions: what is under a point or in an area, and the cards.
	/// The topmost item under a stage point, as its id path.
	pub fn pick(&self, x: f64, y: f64, slop: f64) -> Value {
		match self.scene.pick(x, y, slop) {
			Some(hit) => json!({ "id": hit.id, "path": hit.path }),
			None => Value::Null,
		}
	}

	/// The ids of every item under a stage point, topmost first.
	pub fn pick_all(&self, x: f64, y: f64, slop: f64) -> Value {
		let ids: Vec<&str> = self.scene.pick_all(x, y, slop).into_iter().map(|(r, i)| self.scene.roots[r as usize].tree.items[i as usize].id.as_str()).collect();
		json!(ids)
	}

	/// Ids of the items whose whole box is inside an area.
	pub fn within(&self, area: Rect) -> Value {
		let ids: Vec<&str> = self.scene.within(&area).into_iter().map(|(r, i)| self.scene.roots[r as usize].tree.items[i as usize].id.as_str()).collect();
		json!(ids)
	}

	/// A card's corners in stage units, top-left clockwise: its item's `cornerRadius`, no rounder than
	/// half its shorter side, as the drawing's hole for it is (`paint`'s `rrect`); 12 when it has none.
	fn card_radii(&self, id: &str, w: f64, h: f64) -> [f32; 4] {
		let Some((r, i)) = self.scene.find(id) else { return [12.0; 4] };
		let root = &self.scene.roots[r];
		let item = &root.tree.items[i as usize];
		if item.get("cornerRadius").is_none() {
			return [12.0; 4];
		}
		let limit = (w.min(h) / 2.0).max(0.0);
		self.scene.vars.radii(&item.props, &root.placed[i as usize].theme).map(|v| v.clamp(0.0, limit) as f32)
	}

	/// A carried card's own frame (`paint`'s `frame_parts`), on the screen at `x`, `y` and scale `s`:
	/// what goes under its picture and what goes over it. None for a card whose item frames nothing.
	fn carried_frame(&self, id: &str, x: f32, y: f32, s: f64) -> Option<(Vec<Op>, Vec<Op>)> {
		let (r, i) = self.scene.find(id)?;
		let root = &self.scene.roots[r];
		let item = &root.tree.items[i as usize];
		if !stage_paint::painter::has_frame(item) {
			return None;
		}
		let placed = &root.placed[i as usize];
		let skip = HashSet::new();
		let image = |_: &str| None;
		let ctx = Context::new(&self.scene, &skip, &image);
		let transform = stage_paint::list::Affine::translate(x, y).then(&stage_paint::list::Affine::scale(s as f32));
		Some(stage_paint::painter::frame_parts(&ctx, item, &placed.theme, placed.rect.w, placed.rect.h, transform, true))
	}

	/// The boards on the stage: where each goes, for the page to place its picture or its page.
	pub fn cards(&self) -> Value {
		let mut out = Vec::new();
		for root in &self.scene.roots {
			for (item, place) in root.tree.items.iter().zip(&root.placed) {
				if item.kind() == "browser" && place.visible {
					let r = place.rect;
					out.push(json!({ "id": item.id, "url": item.get("url"), "x": r.x, "y": r.y, "w": r.w, "h": r.h }));
				}
			}
		}
		Value::Array(out)
	}


	// Pictures and the tiles the page holds.
	/// A picture arrived: its texture is made by the caller; this names it. Cards with it are laid
	/// out again, since their height may change.
	pub fn picture(&mut self, url: &str, texture: u32, width: u32, height: u32) {
		self.picture_unlaid(url, texture, width, height);
		self.lay_out_pictures();
	}

	/// As `picture`, but the drawing is laid out for it by `lay_out_pictures`: a batch of pictures
	/// lays it out once. A card's picture replacing one held in another texture (a higher rung at rest,
	/// a new revision) keeps the old one drawn under it while the new fades in over `PICTURE_FADE_MS`
	/// (`fade_pictures`), so a zoom's rung swap never pops.
	pub fn picture_unlaid(&mut self, url: &str, texture: u32, width: u32, height: u32) {
		if let Some((was, w, h)) = self.pictures.held.insert(url.to_owned(), (texture, width, height)) {
			if was != texture && url.starts_with("card:") {
				if let Some((older, _, _, _)) = self.pictures.fading.insert(url.to_owned(), (was, w, h, 0.0)) {
					self.pictures.dropped.push(older);
				}
			}
		}
		// Only a card that shows it is laid out differently for it (`Text::picture`).
		if !url.starts_with("card:") && self.text.picture(url, width as f32, height as f32) {
			self.pictures_unlaid = true;
		}
	}

	/// Carry every picture fade on by `dt` milliseconds (`picture_unlaid`): the old pictures whose new
	/// one has fully come are let go of (`Pictures::dropped`). True while any fade is still going.
	pub fn fade_pictures(&mut self, dt: f32) -> bool {
		let step = (dt / PICTURE_FADE_MS).clamp(0.0, 1.0);
		let mut done = Vec::new();
		for (url, one) in self.pictures.fading.iter_mut() {
			one.3 = (one.3 + step).min(1.0);
			if one.3 >= 1.0 {
				done.push(url.clone());
			}
		}
		for url in done {
			if let Some((old, _, _, _)) = self.pictures.fading.remove(&url) {
				self.pictures.dropped.push(old);
			}
		}
		!self.pictures.fading.is_empty()
	}

	/// A picture forgotten by its address: its texture, and any old one still fading under it, to free.
	pub fn forget_picture(&mut self, url: &str) -> Vec<u32> {
		let mut out = Vec::new();
		if let Some((texture, _, _)) = self.pictures.held.remove(url) {
			out.push(texture);
		}
		if let Some((old, _, _, _)) = self.pictures.fading.remove(url) {
			out.push(old);
		}
		out
	}

	/// Lay the drawing out for the pictures put since it last was that cards show; false if none.
	pub fn lay_out_pictures(&mut self) -> bool {
		if !std::mem::take(&mut self.pictures_unlaid) {
			return false;
		}
		self.scene.update(&self.doc, None, &self.text);
		true
	}

	/// A texture id for a picture or a tile, unique on the page.
	pub fn new_texture(&mut self) -> u32 {
		self.next_texture += 1;
		self.next_texture
	}

	/// The worker discarded these tiles (stale, at a scale not in use): let them go.
	pub fn forget_tiles(&mut self, keys: &[Key]) -> Vec<u32> {
		let gone: Vec<u32> = keys.iter().filter_map(|k| self.tiles.remove(k).map(|(t, _)| t)).collect();
		if !gone.is_empty() {
			self.scales = None;
		}
		gone
	}

	/// Tiles past the budget, drawn longest ago: forget their textures and tell the worker. Never
	/// one drawn in the last frame, nor the overview's (`overview_scale`): the budget is passed
	/// rather than leave a hole on screen.
	pub fn evict(&mut self) -> Vec<(Key, u32)> {
		if self.tiles.len() <= self.budget {
			return Vec::new();
		}
		let overview: HashSet<Key> = self.scene.extent().map(|e| Grid::covering(&e, overview_scale(&e), 0).into_iter().collect()).unwrap_or_default();
		let shown = self.frame;
		let mut old: Vec<(u64, Key)> = self.tiles.iter().filter(|(k, (_, used))| !overview.contains(k) && *used < shown).map(|(k, (_, used))| (*used, *k)).collect();
		old.sort();
		let excess = (self.tiles.len() - self.budget).min(old.len());
		let gone: Vec<(Key, u32)> = old.into_iter().take(excess).filter_map(|(_, k)| self.tiles.remove(&k).map(|(t, _)| (k, t))).collect();
		if !gone.is_empty() {
			self.scales = None;
		}
		gone
	}
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod bend_bench {
	use super::*;

	/// `STAGE_BENCH=path/to/stage.pen cargo test --release -p stage-web bend_cost -- --ignored --nocapture`:
	/// a box with ten arrows joined to it, added to a real stage, dragged 200 steps.
	#[test]
	#[ignore]
	fn bend_cost() {
		let path = std::env::var("STAGE_BENCH").expect("STAGE_BENCH");
		let mut doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
		let children = doc["children"].as_array_mut().unwrap();
		let items = children.len();
		children.push(json!({"type":"rectangle","id":"bench-hub","x":-5000,"y":-5000,"width":140,"height":80}));
		for k in 0..10 {
			let (x, y) = (-5600.0 + 130.0 * k as f64, -4600.0 - 40.0 * (k % 3) as f64);
			children.push(json!({"type":"rectangle","id":format!("bench-{k}"),"x":x,"y":y,"width":100,"height":60}));
			let route = ["straight", "curved", "elbow"][k % 3];
			children.push(json!({"type":"path","id":format!("bench-a{k}"),"geometry":"M0 0 L1 1","strokeWidth":2,"metadata":{"type":"decks.arrow","from":"bench-hub","to":format!("bench-{k}"),"route":route}}));
		}
		let mut page = Page::new(&doc.to_string(), false, "s").unwrap();
		let t = std::time::Instant::now();
		let first = page.preview(Some(vec![("bench-hub".into(), Preview { dx: 1.0, dy: 1.0, set: vec![] })])).unwrap();
		let first_ms = t.elapsed().as_secs_f64() * 1e3;
		let t = std::time::Instant::now();
		for s in 0..200 {
			page.preview(Some(vec![("bench-hub".into(), Preview { dx: s as f64 * 3.0, dy: (s as f64 * 0.1).sin() * 200.0, set: vec![] })])).unwrap();
		}
		let step_us = t.elapsed().as_secs_f64() * 1e6 / 200.0;
		println!("{items} top-level items; first step {first_ms:.2} ms ({} arrows found); each later step {step_us:.0} µs", first.len());
	}
}

#[cfg(test)]
mod glyph_overflow {
	use super::*;

	/// Chinese text zoomed in and out at 2× pixels, as in the report of broken text at 400%: tiles are
	/// painted as the app paints them, and as each is drawn every glyph it uses is checked against a
	/// copy of the glyph texture: it must still be the last thing written where it points.
	/// Returns (tiles drawn, glyphs checked, glyphs pointing at something else).
	pub fn zoom_cycle(worker: &mut Worker, limit: usize) -> (usize, usize, usize) {
		// Each texture's writes, in order: x, y, w, h.
		let mut writes: HashMap<u32, Vec<[u32; 4]>> = HashMap::new();
		let (mut tiles, mut checked, mut wrong) = (0, 0, 0);
		for zoom in [1.0, 2.0, 0.5, 3.0, 4.0, 1.0, 2.5, 4.0, 0.7, 4.0, 3.3, 4.0] {
			for moving in [true, false] {
				// The view's middle stays on the text, as a pinch about it does.
				let (w, h) = (1600.0, 1000.0);
				let cam = Camera { x: 450.0 - w / 2.0 / zoom, y: 300.0 - h / 2.0 / zoom, zoom };
				loop {
					let mut sent = Vec::new();
					worker.paint(cam, 2.0, w, h, moving, limit, &mut |key, list, atlas| {
						for (texture, x, y, w, h, _) in atlas.uploads.drain(..) {
							writes.entry(texture).or_default().push([x, y, w, h]);
						}
						for op in &list.ops {
							let Op::Glyphs { texture, quads, .. } = op else { continue };
							let log = writes.get(texture).map(Vec::as_slice).unwrap_or(&[]);
							for q in quads {
								checked += 1;
								let want = [q.u as u32, q.v as u32, q.w as u32, q.h as u32];
								let meets = |r: &[u32; 4]| r[0] < want[0] + want[2] && want[0] < r[0] + r[2] && r[1] < want[1] + want[3] && want[1] < r[1] + r[3];
								if log.iter().rev().find(|r| meets(r)) != Some(&want) {
									wrong += 1;
								}
							}
						}
						sent.push(key);
					});
					if sent.is_empty() {
						break;
					}
					tiles += sent.len();
					for key in sent {
						worker.sent(key);
					}
				}
			}
		}
		(tiles, checked, wrong)
	}

	pub fn chinese_worker() -> Option<Worker> {
		let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fonts");
		let sc = std::fs::read(format!("{dir}/noto-sans-sc_latest_chinese-simplified-400-normal.ttf")).ok()?;
		let inter = std::fs::read(format!("{dir}/inter_latest_latin-400-normal.ttf")).ok()?;
		// Ten paragraphs of different characters, 17 px, in a 900 px column.
		let para = |p: u32| (0..90u32).map(|i| char::from_u32(0x4E00 + p * 211 + i * 7).unwrap()).collect::<String>();
		let children: Vec<Value> = (0..10u32).map(|p| json!({"type":"text","id":format!("t{p}"),"x":0,"y":p * 80,"width":900,"textGrowth":"fixed-width","fontSize":17,"fontFamily":"Inter","content":para(p)})).collect();
		let stage = json!({"version":"2.6","children":children}).to_string();
		let mut worker = Worker::new(&stage, false).ok()?;
		worker.add_font("Inter", inter, false);
		worker.add_font("Noto Sans SC", sc, true);
		Some(worker)
	}

	#[test]
	fn zooming_chinese_text_in_and_out_never_draws_a_tile_with_another_glyph() {
		let Some(mut worker) = chinese_worker() else { return };
		let (tiles, checked, wrong) = zoom_cycle(&mut worker, 12);
		println!("{tiles} tiles drawn, {checked} glyphs checked, {wrong} pointing at another glyph");
		// A tile asks only for the glyphs that reach it (`Context::glyph_area`), about 8,700 of them
		// here; the texture still fills and empties its bands some twenty times on the way.
		assert!(checked > 5_000, "{checked}");
		assert_eq!(wrong, 0);
	}
}

#[cfg(test)]
mod glyph_cost {
	use super::*;

	/// What a zoom back costs when its glyphs are still in the texture, and when they were emptied:
	/// `cargo test --release -p stage-web glyph_cost -- --ignored --nocapture`.
	#[test]
	#[ignore]
	fn glyph_cost() {
		let Some(mut worker) = super::glyph_overflow::chinese_worker() else { return };
		let (w, h) = (1600.0, 1000.0);
		let cam = |zoom: f64| Camera { x: 450.0 - w / 2.0 / zoom, y: 300.0 - h / 2.0 / zoom, zoom };
		let mut screen = |worker: &mut Worker, zoom: f64| -> (f64, usize) {
			worker.grid.invalidate_all();
			let t = std::time::Instant::now();
			let mut n = 0;
			loop {
				let batch = worker.next(cam(zoom), 2.0, w, h, false, 64);
				if batch.is_empty() {
					break;
				}
				for (key, _) in &batch {
					worker.sent(*key);
				}
				n += batch.len();
				worker.atlas.borrow_mut().uploads.clear();
			}
			(t.elapsed().as_secs_f64() * 1e3, n)
		};
		for zoom in [4.0, 2.0, 1.0] {
			worker.atlas.replace(stage_text::atlas::Atlas::new());
			let (cold, n) = screen(&mut worker, zoom);
			let (warm, _) = screen(&mut worker, zoom);
			println!("zoom {zoom}: {n} tiles; glyphs drawn anew {cold:.1} ms, glyphs kept {warm:.1} ms");
		}
		// The case the bands are for: 400%, out to 200% and 100%, and back to 400%.
		worker.atlas.replace(stage_text::atlas::Atlas::new());
		screen(&mut worker, 4.0);
		screen(&mut worker, 2.0);
		screen(&mut worker, 1.0);
		let (back, _) = screen(&mut worker, 4.0);
		println!("back to 400% after 200% and 100%: {back:.1} ms");
	}
}
