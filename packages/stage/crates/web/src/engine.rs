//! The two engines, without the browser: what the page and the worker each keep and do. The wasm
//! bindings (`lib.rs`) only carry calls across; everything here also runs, and is tested, natively.

use serde_json::{Value, json};
use stage_doc::{Change, Document, History, Ids};
use stage_paint::list::{Color, DrawList, Op};
use stage_paint::painter::{Context, IconShape, LiveInk, paint_area, paint_ink};
use stage_scene::geometry::Mat;
use stage_paint::tiles::{Grid, Key, TILE, overview_scale, scale_for};
use stage_scene::{Rect, Scene, Updated, arrows};
use stage_text::Text;
use stage_text::atlas::Atlas;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

/// Where the stage is looking: the stage point at the window's corner, and CSS pixels per stage unit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
	pub x: f64,
	pub y: f64,
	pub zoom: f64,
}

/// Pictures by address (an image fill's `url`, or `board:<id>` for a board's picture): texture,
/// width and height, and the addresses asked for that have not arrived.
#[derive(Default)]
pub struct Pictures {
	pub held: HashMap<String, (u32, u32, u32)>,
	pub wanted: RefCell<Vec<String>>,
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

/// The page's engine: owns the document, answers the pointer, and lays the worker's tiles on the
/// screen in the same frame as the board pages.
/// The fewest tiles the page keeps, whatever the screen.
const MIN_TILES: usize = 160;

pub struct Page {
	/// Draw the lifted items and nothing else over the pages, for one frame: a drag's ghost.
	pub only_lifted: bool,
	/// Leave the lifted items out: a ghost of them is shown in their place.
	pub hide_lifted: bool,
	pub icons: HashMap<String, IconShape>,
	pub text: Text,
	pub atlas: RefCell<Atlas>,
	pub pictures: Pictures,
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
	pub boards: Vec<BoardPlace>,
	pub carry: (HashSet<String>, f64, f64),
	/// The boards drawn as their picture in the last frame, and the live ones carried as one.
	pub pictured: Vec<String>,
	pub carrying: Vec<String>,
	pub doc: Document,
	pub scene: Scene,
	pub history: History,
	pub ids: Ids,
	/// Tile pictures the page holds: key → (texture, when last drawn).
	pub tiles: HashMap<Key, (u32, u64)>,
	pub budget: usize,
	frame: u64,
	next_texture: u32,
}

impl Page {
	pub fn new(text: &str, dark: bool, session: &str) -> Result<Page, String> {
		let doc = Document::parse(text).map_err(|e| e.0)?;
		let mut words = Text::new();
		words.dark = dark;
		let scene = Scene::new(&doc, dark, &words);
		Ok(Page { only_lifted: false, hide_lifted: false, boards: Vec::new(), carry: (HashSet::new(), 0.0, 0.0), pictured: Vec::new(), carrying: Vec::new(), offsets: HashMap::new(), preview_undo: Vec::new(), bent: None, view: ViewState::default(), icons: HashMap::new(), text: words, atlas: RefCell::new(Atlas::new()), pictures: Pictures::default(), lifted: HashSet::new(), ink: Vec::new(), doc, scene, history: History::default(), ids: Ids::new(session), tiles: HashMap::new(), budget: 160, frame: 0, next_texture: 1 })
	}

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
		let applied = self.doc.apply_edits(edits).map_err(|e| e.0)?;
		self.scene.update(&self.doc, Some(&applied), &self.text);
		Ok(())
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

	/// A font file arrived: words are measured again, so everything is laid out again.
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.text.add_font(name, bytes, fallback);
		self.scene.update(&self.doc, None, &self.text);
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

	/// The ids of every item under a stage point, topmost first.
	pub fn pick_all(&self, x: f64, y: f64, slop: f64) -> Value {
		let ids: Vec<&str> = self.scene.pick_all(x, y, slop).into_iter().map(|(r, i)| self.scene.roots[r as usize].tree.items[i as usize].id.as_str()).collect();
		json!(ids)
	}

	/// Each markdown card's links and wide tables, for a press to be answered with: `{ id, order,
	/// box, pad, links, scrollers }`, the links and tables from the card's words' top-left.
	pub fn cards_json(&self) -> Value {
		let vars = &self.scene.vars;
		let mut out = Vec::new();
		let mut order = 0u32;
		for root in &self.scene.roots {
			for (item, place) in root.tree.items.iter().zip(&root.placed) {
				order += 1;
				if !place.visible || !stage_text::is_markdown(item) {
					continue;
				}
				let Some(Value::String(content)) = vars.resolve(item.get("content"), &place.theme) else { continue };
				let pad = if item.kind() == "text" { 0.0 } else { stage_scene::layout::NOTE_PAD };
				let style = stage_scene::layout::text_style(item, vars, &place.theme);
				let card = self.text.card(content, &style, (place.rect.w - pad * 2.0).max(1.0) as f32, stage_text::Align::Left);
				let r = place.rect;
				let links: Vec<Value> = card.links.iter().map(|(x, y, w, h, href, s)| json!({ "x": x, "y": y, "w": w, "h": h, "href": href, "scroller": s })).collect();
				let scrollers: Vec<Value> = card.scrollers.iter().map(|(x, y, w, h, c)| json!({ "x": x, "y": y, "w": w, "h": h, "content": c })).collect();
				out.push(json!({ "id": item.id, "order": order, "box": { "x": r.x, "y": r.y, "w": r.w, "h": r.h }, "pad": pad, "links": links, "scrollers": scrollers }));
			}
		}
		Value::Array(out)
	}

	/// The words on the stage and the faces they are set in, for the app to fetch fonts for:
	/// `[{ family, weight, italic, text }]`. A card's words may be bold, italic or code too.
	pub fn font_needs(&self) -> Value {
		let vars = &self.scene.vars;
		let mut out = Vec::new();
		for root in &self.scene.roots {
			for (item, place) in root.tree.items.iter().zip(&root.placed) {
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
		Value::Array(out)
	}

	/// The topmost item under a stage point, as its id path.
	pub fn pick(&self, x: f64, y: f64, slop: f64) -> Value {
		match self.scene.pick(x, y, slop) {
			Some(hit) => json!({ "id": hit.id, "path": hit.path }),
			None => Value::Null,
		}
	}

	/// Ids of the items whose whole box is inside an area.
	pub fn within(&self, area: Rect) -> Value {
		let ids: Vec<&str> = self.scene.within(&area).into_iter().map(|(r, i)| self.scene.roots[r as usize].tree.items[i as usize].id.as_str()).collect();
		json!(ids)
	}

	/// The boards on the stage: where each goes, for the page to place its picture or its page.
	pub fn boards(&self) -> Value {
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

	/// A tile's picture arrived: the texture to put it in (the caller copies the picture there).
	pub fn tile_texture(&mut self, key: Key) -> u32 {
		if let Some((t, _)) = self.tiles.get(&key) {
			return *t;
		}
		self.next_texture += 1;
		let t = self.next_texture;
		self.tiles.insert(key, (t, self.frame));
		t
	}

	/// What the screen shows over the board pages for a camera, in one frame with them:
	///
	/// - each board that has no live page: its picture, or its paper until the picture comes. Over
	///   the pages, so a page still loading or asleep under it never shows through;
	/// - the worker's tiles, which leave a hole for every board, so the pictures show through them
	///   and what is drawn over a board stays over it;
	/// - the lifted items and the stroke under the pen, drawn fresh.
	///
	/// A board going live loses its picture in the frame that shows its page; no tile is painted
	/// again for it. Tiles and pictures lie on whole device pixels.
	pub fn frame(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, moving: bool) -> DrawList {
		self.frame += 1;
		// Room for three windows of tiles at this screen's size, with the ring round them, and never
		// under the floor: a 2x screen needs far more than a 1x one.
		let across = (width * dpr / TILE as f64).ceil() as usize + 2;
		let down = (height * dpr / TILE as f64).ceil() as usize + 2;
		self.budget = (3 * across * down).max(MIN_TILES);
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		let s = camera.zoom * dpr;
		let snap = |r: &Rect| {
			let x0 = ((r.x - camera.x) * s).round();
			let y0 = ((r.y - camera.y) * s).round();
			let x1 = ((r.right() - camera.x) * s).round();
			let y1 = ((r.bottom() - camera.y) * s).round();
			(x0 as f32, y0 as f32, (x1 - x0) as f32, (y1 - y0) as f32)
		};
		// The boards with no live page (and those a drag carries): picture, or paper until it comes.
		let mut over = DrawList::new(Color::TRANSPARENT);
		let paper = if self.scene.dark { [0.118, 0.118, 0.125, 1.0] } else { [1.0, 1.0, 1.0, 1.0] };
		let mut pictured = Vec::new();
		let mut carrying = Vec::new();
		// A drag's ghost is the lifted items alone: no boards.
		let boards: &[BoardPlace] = if self.only_lifted { &[] } else { &self.boards };
		for board in boards {
			let carried = self.carry.0.contains(&board.path);
			let picture = self.pictures.get(&format!("board:{}", board.path));
			if board.live && !(carried && picture.is_some()) {
				continue;
			}
			let (dx, dy) = if carried { (self.carry.1, self.carry.2) } else { (0.0, 0.0) };
			let place = Rect { x: board.x + dx, y: board.y + dy, w: board.w, h: board.h };
			if !place.meets(&view) {
				continue;
			}
			let (x, y, w, h) = snap(&place);
			let shape = |w: f32, h: f32| stage_paint::list::Shape { w, h, radii: [12.0 * s as f32; 4], ellipse: false };
			over.push(Op::Shape { shape: shape(w, h), transform: stage_paint::list::Affine::translate(x, y), paint: stage_paint::list::Paint::Solid(Color(paper)), stroke: None });
			if let Some((texture, pw, ph)) = picture {
				// The whole board was pictured: one taller than the box is cut at its foot.
				let tall = ph as f32 / pw.max(1) as f32 * w;
				let shown = h.min(tall);
				over.push(Op::Shape { shape: shape(w, shown), transform: stage_paint::list::Affine::translate(x, y), paint: stage_paint::list::Paint::Image { texture, opacity: 1.0, uv: [0.0, 0.0, 1.0, shown / tall] }, stroke: None });
				if board.live {
					carrying.push(board.path.clone());
				} else {
					pictured.push(board.path.clone());
				}
			}
			if let Some(colour) = board.news.filter(|_| board.glow) {
				over.push(Op::Shape { shape: shape(w, h), transform: stage_paint::list::Affine::translate(x, y), paint: stage_paint::list::Paint::Solid(Color::straight([colour[0], colour[1], colour[2], 0.6], 1.0)), stroke: Some((1.5, stage_paint::list::Align::Center)) });
			}
		}
		if !self.only_lifted {
			self.pictured = pictured;
			self.carrying = carrying;
		}
		// Over: the tiles, one per place. Each place shows the sharpest tile held for it; where the
		// tile at the scale asked for has not come yet, the part of a coarser one that covers it, and
		// failing that the sharper tiles of one scale that lie in it, drawn smaller (a zoom out holds
		// only sharper ones). Never two scales layered in a place: tiles are clear where nothing is
		// drawn, so a stale one under a fresh one would show through.
		let want = scale_for(camera.zoom * dpr, moving);
		let mut scales: Vec<u32> = self.tiles.keys().map(|k| k.scale).collect::<HashSet<_>>().into_iter().collect();
		// Nearest the scale wanted first, sharper before blurrier at the same distance.
		scales.sort_by(|a, b| {
			let d = |s: u32| ((f32::from_bits(s) as f64).ln() - (want as f64).ln()).abs();
			d(*a).total_cmp(&d(*b)).then(f32::from_bits(*b).total_cmp(&f32::from_bits(*a)))
		});
		// A ghost of what a drag carries is the lifted items alone, with no tiles under them.
		let places = if self.only_lifted { Vec::new() } else { Grid::covering(&view, want, 0) };
		for key in places {
			let place = key.area();
			let found = scales.iter().find_map(|&sc| {
				let side = TILE as f64 / f32::from_bits(sc) as f64;
				let k = Key { scale: sc, x: (place.cx() / side).floor() as i32, y: (place.cy() / side).floor() as i32 };
				// A coarser tile covers the whole place; a sharper one only part of it.
				let a = k.area();
				(a.x <= place.x + 1e-6 && a.y <= place.y + 1e-6 && a.right() >= place.right() - 1e-6 && a.bottom() >= place.bottom() - 1e-6).then_some(())?;
				self.tiles.get(&k).map(|(t, _)| (k, *t))
			});
			let Some((k, texture)) = found else {
				self.sharper_in(&place, &scales, want, &snap, &mut over);
				continue;
			};
			let a = k.area();
			let uv = [((place.x - a.x) / a.w) as f32, ((place.y - a.y) / a.h) as f32, ((place.right() - a.x) / a.w) as f32, ((place.bottom() - a.y) / a.h) as f32];
			let (x, y, w, h) = snap(&place);
			over.push(Op::Picture { texture, x, y, w, h, uv, opacity: 1.0 });
			if let Some(t) = self.tiles.get_mut(&k) {
				t.1 = self.frame;
			}
		}
		// The lifted items, drawn fresh, and the stroke under the pen.
		if !self.lifted.is_empty() && !self.hide_lifted {
			let skip = HashSet::new();
			let pictures = &self.pictures;
			let image = |url: &str| pictures.get(url);
			let mut ctx = Context::new(&self.scene, &skip, &image).with_text(&self.text, &self.atlas);
			ctx.only = Some(&self.lifted);
			ctx.icons = Some(&self.icons);
			ctx.offsets = Some(&self.offsets);
			self.view.apply(&mut ctx);
			// Built again if the glyph texture had to push out glyphs this frame uses (`Atlas::begin`).
			let mut lifted = DrawList::new(Color::TRANSPARENT);
			for _ in 0..3 {
				self.atlas.borrow_mut().begin();
				lifted = paint_area(&ctx, view, s, Color::TRANSPARENT);
				if !self.atlas.borrow_mut().take_overflow() {
					break;
				}
			}
			self.pictures.wanted.borrow_mut().extend(ctx.wanted.borrow_mut().drain(..));
			over.ops.extend(lifted.ops);
		}
		if !self.ink.is_empty() {
			let target = Mat([s, 0.0, 0.0, s, -camera.x * s, -camera.y * s]);
			paint_ink(&self.ink, &target, &mut over.ops);
		}
		over
	}

	/// Lift items for a drag: the worker leaves them out of its tiles from now on.
	pub fn lift(&mut self, ids: &[String]) {
		self.lifted.extend(ids.iter().cloned());
	}

	/// A gesture in progress: each item moved by `dx dy` and, while resizing or restyling, with these
	/// fields, shown here only, until the gesture ends (`None`) or the saved drawing arrives. Lifts
	/// what it names. Returns the items whose layout changed, for the stage's outlines.
	///
	/// An arrow with an end on what the gesture moves or reshapes bends with it: it is routed again
	/// here at each step (`arrows.rs`, pen's router ported) and lifted too. Returns the arrows lifted
	/// by this step, which the worker must leave out of its tiles as well.
	pub fn preview(&mut self, moving: Option<Vec<(String, Preview)>>) -> Result<Vec<String>, String> {
		self.unpreview();
		let Some(moving) = moving else {
			self.bent = None;
			return Ok(Vec::new());
		};
		let mut changes = Vec::new();
		for (id, p) in &moving {
			if p.dx != 0.0 || p.dy != 0.0 {
				self.offsets.insert(id.clone(), (p.dx, p.dy));
			}
			for (key, value) in &p.set {
				changes.push(Change::Set { id: id.clone(), key: key.clone(), value: value.clone() });
			}
			self.lifted.insert(id.clone());
		}
		// Fields that no longer apply (an item that went) are left out rather than failing the gesture.
		changes.retain(|c| matches!(c, Change::Set { id, .. } if self.doc.handle(id).is_some()));
		if !changes.is_empty() {
			let applied = self.doc.apply(&changes).map_err(|e| e.0)?;
			self.preview_undo = applied.undo.clone();
			self.scene.update(&self.doc, Some(&applied), &self.text);
		}
		Ok(self.bend(&moving))
	}

	/// Route the arrows a gesture bends from where their ends are at this step, as preview fields
	/// undone with the rest; returns the ones newly lifted.
	fn bend(&mut self, moving: &[(String, Preview)]) -> Vec<String> {
		let mut key: Vec<&str> = moving.iter().map(|(id, _)| id.as_str()).collect();
		key.sort_unstable();
		let mut boards: Vec<&str> = self.carry.0.iter().map(String::as_str).collect();
		boards.sort_unstable();
		let key = format!("{}|{}", key.join(","), boards.join(","));
		if self.bent.as_ref().is_none_or(|b| b.key != key) {
			self.bent = Some(Bent::find(&self.scene, moving, &self.carry.0, key));
		}
		let bent = self.bent.as_ref().expect("found above");
		if bent.arrows.is_empty() {
			return Vec::new();
		}
		let scene = &self.scene;
		let place = |id: &str| -> Option<Rect> {
			let (r, i) = match bent.at.get(id) {
				Some(&(r, i)) if scene.roots.get(r).and_then(|root| root.tree.items.get(i as usize)).is_some_and(|it| it.id == id) => (r, i),
				_ => scene.find(id)?,
			};
			Some(scene.roots[r].placed[i as usize].rect)
		};
		let find = |id: &str| -> Option<Rect> {
			if let Some(mut rect) = place(id) {
				if let Some((dx, dy)) = bent.carried.get(id).and_then(|by| self.offsets.get(by)) {
					rect.x += dx;
					rect.y += dy;
				}
				return Some(rect);
			}
			let board = self.boards.iter().find(|b| b.path == id)?;
			let (dx, dy) = if self.carry.0.contains(id) { (self.carry.1, self.carry.2) } else { (0.0, 0.0) };
			Some(Rect { x: board.x + dx, y: board.y + dy, w: board.w, h: board.h })
		};
		let mut changes = Vec::new();
		for arrow in &bent.arrows {
			let Some(points) = arrows::points(&arrow.meta, &find) else { continue };
			let (route, heads) = arrows::style(&arrow.meta);
			let shape = arrows::shape(&points, arrow.stroke, route, heads);
			let origin = arrow.parent.as_deref().and_then(place).map_or((0.0, 0.0), |r| (r.x, r.y));
			let set = |key: &str, value: Value| Change::Set { id: arrow.id.clone(), key: key.into(), value: Some(value) };
			changes.extend([
				set("x", json!(arrows::round(shape.x - origin.0))),
				set("y", json!(arrows::round(shape.y - origin.1))),
				set("width", json!(shape.width)),
				set("height", json!(shape.height)),
				set("viewBox", json!([0, 0, shape.width, shape.height])),
				set("geometry", json!(shape.geometry)),
			]);
		}
		let ids: Vec<String> = bent.arrows.iter().map(|a| a.id.clone()).collect();
		if !changes.is_empty() {
			if let Ok(applied) = self.doc.apply(&changes) {
				// Undone first, then the gesture's own fields: the two touch different items.
				let mut undo = applied.undo.clone();
				undo.append(&mut self.preview_undo);
				self.preview_undo = undo;
				self.scene.update(&self.doc, Some(&applied), &self.text);
			}
		}
		ids.into_iter().filter(|id| self.lifted.insert(id.clone())).collect()
	}

	fn unpreview_fields(&mut self) {
		if !self.preview_undo.is_empty() {
			let undo = std::mem::take(&mut self.preview_undo);
			if let Ok(applied) = self.doc.apply(&undo) {
				self.scene.update(&self.doc, Some(&applied), &self.text);
			}
		}
	}

	/// Take a gesture's shown fields and offsets back.
	fn unpreview(&mut self) {
		self.offsets.clear();
		if !self.preview_undo.is_empty() {
			let undo = std::mem::take(&mut self.preview_undo);
			if let Ok(applied) = self.doc.apply(&undo) {
				self.scene.update(&self.doc, Some(&applied), &self.text);
			}
		}
	}

	/// Put them down: drawn here until the worker's tiles with them arrive (`landed`).
	pub fn landed(&mut self, ids: &[String]) {
		for id in ids {
			self.lifted.remove(id);
		}
	}

	/// A picture arrived: its texture is made by the caller; this names it. Cards with it are laid
	/// out again, since their height may change.
	pub fn picture(&mut self, url: &str, texture: u32, width: u32, height: u32) {
		self.pictures.held.insert(url.to_owned(), (texture, width, height));
		if !url.starts_with("board:") {
			self.text.images.borrow_mut().insert(url.to_owned(), (width as f32, height as f32));
			self.text.forget();
			self.scene.update(&self.doc, None, &self.text);
		}
	}

	/// A texture id for a picture or a tile, unique on the page.
	pub fn new_texture(&mut self) -> u32 {
		self.next_texture += 1;
		self.next_texture
	}

	/// The worker discarded these tiles (stale, at a scale not in use): let them go.
	pub fn forget_tiles(&mut self, keys: &[Key]) -> Vec<u32> {
		keys.iter().filter_map(|k| self.tiles.remove(k).map(|(t, _)| t)).collect()
	}

	/// A place no tile of its scale or coarser covers: the sharper tiles of the one scale nearest
	/// its own that has any there, each cut to the place. A scale whose tiles would be too many to
	/// look up for one place is passed over.
	fn sharper_in(&mut self, place: &Rect, scales: &[u32], want: f32, snap: &dyn Fn(&Rect) -> (f32, f32, f32, f32), over: &mut DrawList) {
		for &sc in scales {
			let s = f32::from_bits(sc);
			if s <= want {
				continue;
			}
			let side = TILE as f64 / s as f64;
			let (x0, y0) = ((place.x / side).floor() as i32, (place.y / side).floor() as i32);
			let (x1, y1) = ((place.right() / side).ceil() as i32, (place.bottom() / side).ceil() as i32);
			if ((x1 - x0) as i64) * ((y1 - y0) as i64) > 256 {
				continue;
			}
			let mut drew = false;
			for y in y0..y1 {
				for x in x0..x1 {
					let k = Key { scale: sc, x, y };
					let Some((texture, used)) = self.tiles.get_mut(&k) else { continue };
					*used = self.frame;
					let a = k.area();
					let cx = a.x.max(place.x);
					let cy = a.y.max(place.y);
					let cut = Rect { x: cx, y: cy, w: a.right().min(place.right()) - cx, h: a.bottom().min(place.bottom()) - cy };
					if cut.w <= 0.0 || cut.h <= 0.0 {
						continue;
					}
					let uv = [((cut.x - a.x) / a.w) as f32, ((cut.y - a.y) / a.h) as f32, ((cut.right() - a.x) / a.w) as f32, ((cut.bottom() - a.y) / a.h) as f32];
					let (px, py, pw, ph) = snap(&cut);
					over.push(Op::Picture { texture: *texture, x: px, y: py, w: pw, h: ph, uv, opacity: 1.0 });
					drew = true;
				}
			}
			if drew {
				return;
			}
		}
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
		old.into_iter().take(excess).filter_map(|(_, k)| self.tiles.remove(&k).map(|(t, _)| (k, t))).collect()
	}
}

/// The worker's engine: the same document, kept by the same numbered batches, painted as tiles.
pub struct Worker {
	pub icons: HashMap<String, IconShape>,
	pub text: Text,
	pub pictures: Pictures,
	/// Items the page is moving: left out of the tiles until they land.
	pub lifted: HashSet<String>,
	pub view: ViewState,
	/// Items put down whose tiles are being painted with them: the page hears when they all are.
	landing: Vec<(Vec<String>, Rect)>,
	/// The scale tiles were last asked for at.
	scale: f32,
	/// Stale tiles at other scales, let go of: the page drops them too.
	pub discarded: Vec<Key>,
	pub atlas: RefCell<Atlas>,
	pub doc: Document,
	pub scene: Scene,
	pub grid: Grid,
	pub dark: bool,
	/// The tile pictures the page holds, by the version they were painted at.
	version: u64,
}

impl Worker {
	pub fn new(text: &str, dark: bool) -> Result<Worker, String> {
		let doc = Document::parse(text).map_err(|e| e.0)?;
		let mut words = Text::new();
		words.dark = dark;
		let scene = Scene::new(&doc, dark, &words);
		Ok(Worker { view: ViewState::default(), icons: HashMap::new(), text: words, pictures: Pictures::default(), lifted: HashSet::new(), landing: Vec::new(), scale: 1.0, discarded: Vec::new(), atlas: RefCell::new(Atlas::new()), doc, scene, grid: Grid::new(4096, 1), dark, version: 0 })
	}

	/// Start again from the whole document: after a lost batch, or a theme change.
	pub fn reload(&mut self, text: &str, dark: bool) -> Result<(), String> {
		self.doc = Document::parse(text).map_err(|e| e.0)?;
		self.dark = dark;
		self.text.dark = dark;
		self.scene = Scene::new(&self.doc, dark, &self.text);
		self.grid.invalidate_all();
		Ok(())
	}

	/// Apply the page's batch number `generation`. `Err` when one was missed: ask for the whole
	/// document then.
	pub fn apply(&mut self, changes: &[Change], generation: u64) -> Result<(), String> {
		if generation != self.doc.generation + 1 {
			return Err(format!("batch {generation} after {}: send the whole document", self.doc.generation));
		}
		let applied = self.doc.apply(changes).map_err(|e| e.0)?;
		let updated = self.scene.update(&self.doc, Some(&applied), &self.text);
		self.invalidate(&updated);
		Ok(())
	}

	/// The server's edits, applied; the tiles they reach are painted again.
	pub fn apply_edits(&mut self, edits: &[stage_doc::edits::Edit]) -> Result<(), String> {
		let applied = self.doc.apply_edits(edits).map_err(|e| e.0)?;
		let updated = self.scene.update(&self.doc, Some(&applied), &self.text);
		self.invalidate(&updated);
		Ok(())
	}

	/// A font file arrived: lay out again and repaint every tile.
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.text.add_font(name, bytes, fallback);
		self.scene.update(&self.doc, None, &self.text);
		self.version += 1;
		self.grid.invalidate_all();
	}

	fn invalidate(&mut self, updated: &Updated) {
		self.version += 1;
		for (handle, before) in &updated.roots {
			if let Some(b) = before {
				self.grid.invalidate(b);
			}
			if let Some(root) = self.scene.root(*handle) {
				self.grid.invalidate(&root.extent);
			}
		}
		for (_, extent) in &updated.removed {
			self.grid.invalidate(extent);
		}
		self.discard_stale();
	}

	/// Stale tiles at scales other than the one in use are let go of rather than kept: shown as a
	/// stand-in they would show what was there before.
	fn discard_stale(&mut self) {
		let current = self.scale.to_bits();
		let overview = self.scene.extent().map(|e| overview_scale(&e).to_bits());
		let stale: Vec<Key> = self.grid.tiles.iter().filter(|(k, t)| t.dirty && k.scale != current && Some(k.scale) != overview).map(|(k, _)| *k).collect();
		for k in stale {
			self.grid.forget(&k);
			self.discarded.push(k);
		}
	}

	/// What the stage hides, mutes or shows live changed: the tiles those items are on are painted again.
	pub fn set_view(&mut self, next: ViewState) {
		let changed: Vec<String> = next.differs(&self.view);
		self.view = next;
		self.version += 1;
		for id in changed {
			if let Some(area) = self.scene.extent_of(&id) {
				self.grid.invalidate(&area);
			} else if id.contains(':') {
				// A table's scroll: the card's id is before the colon.
				if let Some(area) = id.split(':').next().and_then(|c| self.scene.extent_of(c)) {
					self.grid.invalidate(&area);
				}
			}
		}
		self.discard_stale();
	}

	/// Where an item paints, to mark the tiles it is on. A stroked path with no fill and nothing in
	/// it (an arrow, a line) is each of its segments grown by its stroke, so a long elbow arrow marks
	/// the tiles its three lines cross rather than every tile in its box; anything else, its extent.
	fn ink_areas(&self, id: &str) -> Vec<Rect> {
		let extent = || self.scene.extent_of(id).into_iter().collect::<Vec<_>>();
		let Some((r, i)) = self.scene.find(id) else { return extent() };
		let root = &self.scene.roots[r];
		let item = &root.tree.items[i as usize];
		let filled = item.get("fill").is_some_and(|f| !f.is_null());
		if item.kind() != "path" || filled || !item.children.is_empty() {
			return extent();
		}
		let rect = root.placed[i as usize].rect;
		let Some(path) = stage_paint::mesh::geometry_path(item, rect.w, rect.h) else { return extent() };
		let Some(segments) = stage_paint::mesh::segment_bounds(&path, 256) else { return extent() };
		let m = &root.world[i as usize];
		let (ox, oy) = m.apply(0.0, 0.0);
		let reach = |(x, y): (f64, f64)| (x - ox).hypot(y - oy);
		let k = reach(m.apply(1.0, 0.0)).max(reach(m.apply(0.0, 1.0)));
		// Half the stroke reaches either side of the line; a mitred corner up to twice its width.
		let pad = item.get("strokeWidth").and_then(Value::as_f64).unwrap_or(2.0) * 2.0 * k + 1.0;
		let out: Vec<Rect> = segments
			.into_iter()
			.map(|[x0, y0, x1, y1]| {
				let corners = [m.apply(x0, y0), m.apply(x1, y0), m.apply(x0, y1), m.apply(x1, y1)];
				let (mut a, mut b) = ((f64::INFINITY, f64::INFINITY), (f64::NEG_INFINITY, f64::NEG_INFINITY));
				for (x, y) in corners {
					a = (a.0.min(x), a.1.min(y));
					b = (b.0.max(x), b.1.max(y));
				}
				Rect { x: a.0 - pad, y: a.1 - pad, w: b.0 - a.0 + pad * 2.0, h: b.1 - a.1 + pad * 2.0 }
			})
			.collect();
		if out.is_empty() { extent() } else { out }
	}

	/// The page lifted these items: paint their tiles without them.
	pub fn lift(&mut self, ids: &[String]) {
		self.version += 1;
		for id in ids {
			for area in self.ink_areas(id) {
				self.grid.invalidate(&area);
			}
			self.lifted.insert(id.clone());
		}
		self.discard_stale();
	}

	/// The page put them down: paint them back in, and say when every tile they are on is done.
	pub fn drop_items(&mut self, ids: &[String]) {
		self.version += 1;
		let mut area: Option<Rect> = None;
		for id in ids {
			self.lifted.remove(id);
			for ink in self.ink_areas(id) {
				self.grid.invalidate(&ink);
				area = Some(area.map_or(ink, |a| a.union(&ink)));
			}
		}
		self.discard_stale();
		self.landing.push((ids.to_vec(), area.unwrap_or_default()));
	}

	/// Items whose tiles are all painted again since they were put down, for the page to stop
	/// drawing them itself.
	pub fn landed(&mut self) -> Vec<String> {
		let grid = &self.grid;
		let mut out = Vec::new();
		self.landing.retain(|(ids, area)| {
			let stale = grid.tiles.iter().any(|(k, t)| t.dirty && k.area().meets(area));
			if stale {
				return true;
			}
			out.extend(ids.iter().cloned());
			false
		});
		out
	}

	/// A picture arrived (its texture made by the caller).
	pub fn picture(&mut self, url: &str, texture: u32, width: u32, height: u32) {
		self.pictures.held.insert(url.to_owned(), (texture, width, height));
		self.text.images.borrow_mut().insert(url.to_owned(), (width as f32, height as f32));
		self.text.forget();
		self.scene.update(&self.doc, None, &self.text);
		self.version += 1;
		self.grid.invalidate_all();
	}

	/// An icon arrived: tiles are painted again (an icon is small, but it may be anywhere).
	pub fn icon(&mut self, key: &str, shape: IconShape) {
		self.icons.insert(key.to_owned(), shape);
		self.version += 1;
		self.grid.invalidate_all();
	}

	/// The next tiles to paint for a view, with their draw lists: missing ones first, the middle first.
	///
	/// For tests and measures: the lists are built one after another without being drawn, so text in
	/// an earlier one may point at glyphs a later one has replaced. Painting goes through `paint`.
	pub fn next(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, moving: bool, limit: usize) -> Vec<(Key, DrawList)> {
		let mut out = Vec::new();
		self.paint(camera, dpr, width, height, moving, limit, &mut |key, list, _| out.push((key, list)));
		out
	}

	/// Paint the next tiles for a view, missing ones first and the middle first, each handed to `draw`
	/// with the glyph texture as soon as its list is built, so it is drawn before the next one can
	/// replace a glyph it uses. A list whose own glyphs were pushed out while it was built (the texture
	/// full of them alone) is built again. Returns how many tiles were painted.
	#[allow(clippy::too_many_arguments)]
	pub fn paint(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, moving: bool, limit: usize, draw: &mut dyn FnMut(Key, DrawList, &mut Atlas)) -> usize {
		let scale = scale_for(camera.zoom * dpr, moving);
		self.scale = scale;
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		/*
		 * While the page holds items lifted (a drag), only what is on screen is painted: the margin and
		 * the overview are not seen until a pan or a zoom out, and wait, still marked, for the drop.
		 */
		let holding = !self.lifted.is_empty();
		let wanted = Grid::covering(&view, scale, if moving || holding { 0 } else { 1 });
		let mut keys = self.grid.to_paint(&wanted, limit);
		// Once the view has all it needs, the overview: the whole stage at one small scale.
		if keys.len() < limit && !holding {
			if let Some(extent) = self.scene.extent() {
				let overview = Grid::covering(&extent, overview_scale(&extent), 0);
				keys.extend(self.grid.to_paint(&overview, limit - keys.len()));
			}
		}
		let pictures = &self.pictures;
		let image = |url: &str| pictures.get(url);
		let skip: HashSet<String> = self.lifted.union(&self.view.hidden).cloned().collect();
		let mut ctx = Context::new(&self.scene, &skip, &image).with_text(&self.text, &self.atlas);
		ctx.icons = Some(&self.icons);
		self.view.apply(&mut ctx);
		let clear = Color::TRANSPARENT;
		let n = keys.len();
		for k in keys {
			let mut list = DrawList::new(clear);
			for _ in 0..3 {
				self.atlas.borrow_mut().begin();
				list = paint_area(&ctx, k.area(), k.scale(), clear);
				if !self.atlas.borrow_mut().take_overflow() {
					break;
				}
			}
			draw(k, list, &mut self.atlas.borrow_mut());
		}
		self.pictures.wanted.borrow_mut().extend(ctx.wanted.borrow_mut().drain(..));
		n
	}

	/// The tile was painted and sent.
	pub fn sent(&mut self, key: Key) {
		self.grid.painted(key, self.version);
	}

	/// The page let go of a tile.
	pub fn dropped(&mut self, key: Key) {
		self.grid.forget(&key);
	}
}

pub const TILE_SIZE: u32 = TILE;

/// How much of a picture `bitmap` (its width, height) is copied into a texture `texture` big, or
/// nothing when there is none to copy. A closed or transferred `ImageBitmap` reads as 0 × 0, and
/// the browser refuses to copy it; wgpu unwraps that refusal (`copyExternalImageToTexture`), which
/// is a panic, and a panic leaves the engine unusable. So such a picture is never handed over.
pub fn copy_extent(bitmap: (u32, u32), texture: (u32, u32)) -> Option<(u32, u32)> {
	let (w, h) = (bitmap.0.min(texture.0), bitmap.1.min(texture.1));
	(w > 0 && h > 0).then_some((w, h))
}

#[cfg(test)]
mod tests {
	use super::*;
	use stage_paint::{Backend, Recording, Target, TextureKind};

	#[test]
	fn a_closed_picture_is_not_copied_and_a_big_one_keeps_what_fits() {
		assert_eq!(copy_extent((0, 0), (1920, 1080)), None, "a closed ImageBitmap reads as 0 × 0");
		assert_eq!(copy_extent((1920, 0), (1920, 1080)), None);
		assert_eq!(copy_extent((1920, 1080), (1920, 1080)), Some((1920, 1080)));
		assert_eq!(copy_extent((8000, 1080), (4096, 4096)), Some((4096, 1080)));
	}

	const STAGE: &str = r##"{"version":"2.14","children":[
		{"type":"rectangle","id":"a","x":10,"y":10,"width":100,"height":100,"fill":"#f00"},
		{"type":"browser","id":"board","x":600,"y":0,"width":400,"height":300,"url":"boards/x.html"}
	]}"##;

	/// The whole loop: the page edits, the worker repaints what the edit touched, the page shows it.
	#[test]
	fn a_drag_bends_the_arrows_on_what_it_carries() {
		let stage = r#"{"version":"2.6","children":[
			{"type":"rectangle","id":"a","x":0,"y":0,"width":100,"height":60},
			{"type":"rectangle","id":"b","x":300,"y":0,"width":100,"height":60},
			{"type":"rectangle","id":"c","x":0,"y":300,"width":100,"height":60},
			{"type":"path","id":"ab","x":98,"y":24,"width":204,"height":12,"geometry":"M2 6 L202 6","strokeWidth":2,"metadata":{"type":"decks.arrow","from":"a","to":"b"}},
			{"type":"path","id":"bc","x":0,"y":0,"width":10,"height":10,"geometry":"M0 0 L10 10","strokeWidth":2,"metadata":{"type":"decks.arrow","from":"b","to":"c","route":"elbow"}}
		]}"#;
		let mut page = Page::new(stage, false, "s").unwrap();
		let geometry = |page: &Page, id: &str| page.doc.get(id).unwrap().props.get("geometry").cloned();
		let before = geometry(&page, "ab");
		let lifted = page.preview(Some(vec![("a".into(), Preview { dx: 0.0, dy: 200.0, set: vec![] })])).unwrap();
		assert_eq!(lifted, vec!["ab".to_owned()], "only the arrow joined to what moves is lifted");
		// Routed as pen routes it, from where the moved box is now.
		let find = |id: &str| match id { "a" => Some(Rect { x: 0.0, y: 200.0, w: 100.0, h: 60.0 }), "b" => Some(Rect { x: 300.0, y: 0.0, w: 100.0, h: 60.0 }), _ => None };
		let meta = json!({"type":"decks.arrow","from":"a","to":"b"});
		let want = arrows::shape(&arrows::points(&meta, &find).unwrap(), 2.0, arrows::Route::Straight, arrows::Heads::End);
		assert_eq!(geometry(&page, "ab"), Some(json!(want.geometry)));
		// A second step lifts nothing new and keeps routing.
		assert!(page.preview(Some(vec![("a".into(), Preview { dx: 0.0, dy: 210.0, set: vec![] })])).unwrap().is_empty());
		assert_ne!(geometry(&page, "ab"), Some(json!(want.geometry)));
		// Let go: the arrow is the document's again, still drawn here until its tiles come.
		page.preview(None).unwrap();
		assert_eq!(geometry(&page, "ab"), before);
		assert!(page.lifted.contains("ab"));
	}

	#[test]
	fn a_lifted_arrow_repaints_only_the_tiles_its_line_crosses_on_screen() {
		// The arrow measured on the tile-repaint board: 7,804 by 6,045 px of box, three thin lines.
		let stage = r##"{"version":"2.6","children":[
			{"type":"rectangle","id":"b","x":9400,"y":9000,"width":120,"height":70,"fill":"#f5a34c"},
			{"type":"path","id":"long","x":1598,"y":2992,"width":7804,"height":6045,"viewBox":[0,0,7804,6045],"stroke":"#4a5568","strokeWidth":2,
				"geometry":"M7802 6043 L3902 6043 L3902 8 L2 8 M12 2 L2 8 L12 14","metadata":{"type":"decks.arrow","from":"b","to":[1600,3000],"route":"elbow"}}
		]}"##;
		let mut page = Page::new(stage, false, "s").unwrap();
		let mut worker = Worker::new(stage, false).unwrap();
		let cam = Camera { x: 8200.0, y: 8350.0, zoom: 1.0 };
		let mut gpu = Recording::default();
		let mut paint_all = |worker: &mut Worker| {
			let mut keys = Vec::new();
			loop {
				let batch = worker.next(cam, 1.0, 1400.0, 900.0, false, 64);
				if batch.is_empty() {
					return keys;
				}
				for (key, list) in batch {
					let t = page.tile_texture(key);
					gpu.texture(t, TextureKind::Color, TILE, TILE, None);
					gpu.draw(Target::Texture(t), &list);
					worker.sent(key);
					keys.push(key);
				}
			}
		};
		paint_all(&mut worker);
		worker.lift(&["long".into()]);
		let lifted = paint_all(&mut worker);
		// The bottom line runs along tile row 17 (y 8704 to 9216): three of its tiles are on screen.
		assert_eq!(lifted.iter().map(|k| (k.x, k.y)).collect::<Vec<_>>().len(), 3, "{lifted:?}");
		assert!(lifted.iter().all(|k| k.y == 17 && (16..=18).contains(&k.x)), "{lifted:?}");
		// Put down: those three with it again, the one margin tile it crosses, and the overview's tiles
		// (2,048 px here) along its three lines: 8, where its box covers 20. Then nothing more.
		worker.drop_items(&["long".into()]);
		let dropped = paint_all(&mut worker);
		let screen: Vec<(i32, i32)> = dropped.iter().filter(|k| k.scale() == 1.0).map(|k| (k.x, k.y)).collect();
		let overview: std::collections::BTreeSet<(i32, i32)> = dropped.iter().filter(|k| k.scale() != 1.0).map(|k| (k.x, k.y)).collect();
		assert!(screen.len() == 4 && screen.iter().all(|&(x, y)| y == 17 && (15..=18).contains(&x)), "{screen:?}");
		assert_eq!(overview, [(0, 1), (1, 1), (2, 1), (2, 2), (2, 3), (2, 4), (3, 4), (4, 4)].into_iter().collect(), "{dropped:?}");
		assert!(paint_all(&mut worker).is_empty());
	}

	#[test]
	fn page_and_worker_stay_in_step() {
		let mut page = Page::new(STAGE, false, "s").unwrap();
		let mut worker = Worker::new(STAGE, false).unwrap();
		let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
		let mut gpu = Recording::default();
		let paint_all = |worker: &mut Worker, page: &mut Page, gpu: &mut Recording| {
			let mut n = 0;
			for (key, list) in worker.next(cam, 1.0, 1200.0, 800.0, false, 64) {
				let t = page.tile_texture(key);
				gpu.texture(t, TextureKind::Color, TILE, TILE, None);
				gpu.draw(Target::Texture(t), &list);
				worker.sent(key);
				n += 1;
			}
			n
		};
		let first = paint_all(&mut worker, &mut page, &mut gpu);
		assert!(first >= 6, "{first}");
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 0, "nothing changed, nothing to paint");
		let changes = crate::wire::parse(r#"[{"op":"set","id":"a","key":"x","value":1100}]"#).unwrap();
		let generation = page.apply(&changes, true).unwrap();
		worker.apply(&changes, generation).unwrap();
		// The tile the square left, the tile it went to, and the overview's tile under both.
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 3);
		assert_eq!(page.pick(1150.0, 50.0, 0.0)["id"], "a");
		// A missed batch is noticed.
		assert!(worker.apply(&changes, generation + 5).is_err());
		// No boards placed yet: only tiles.
		let over = page.frame(cam, 1.0, 1200.0, 800.0, false);
		assert!(over.ops.iter().all(|op| matches!(op, Op::Picture { .. })));
		// A drag: the worker repaints its tile on screen without the square, and the page draws it. The
		// overview's tile waits for the drop: nothing shows it during a drag.
		page.lift(&["a".into()]);
		worker.lift(&["a".into()]);
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 1);
		// The drag's moves are the page's alone: the worker paints nothing.
		page.preview(Some(vec![("a".into(), Preview { dx: 50.0, dy: 0.0, set: vec![] })])).unwrap();
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 0, "moving a lifted item paints no tiles");
		let over = page.frame(cam, 1.0, 1200.0, 800.0, false);
		assert!(over.ops.iter().any(|op| matches!(op, Op::Shape { .. })), "the page draws it");
		// Let go: saved, and the saved drawing is what both draw.
		let saved = crate::wire::parse(r#"[{"op":"set","id":"a","key":"x","value":1150}]"#).unwrap();
		page.preview(None).unwrap();
		let generation = page.apply(&saved, true).unwrap();
		worker.apply(&saved, generation).unwrap();
		worker.drop_items(&["a".into()]);
		assert!(worker.landed().is_empty());
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 2);
		assert_eq!(worker.landed(), vec!["a".to_owned()]);
		assert_eq!(page.boards()[0]["id"], "board");
	}

	#[test]
	fn a_sleeping_boards_picture_lies_over_its_page_and_under_the_tiles() {
		let mut page = Page::new(STAGE, false, "s").unwrap();
		let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
		page.tile_texture(Key { scale: 1f32.to_bits(), x: 1, y: 0 });
		page.pictures.held.insert("board:boards/x.html".into(), (900, 400, 300));
		let board = |live| BoardPlace { path: "boards/x.html".into(), x: 600.0, y: 0.0, w: 400.0, h: 300.0, live, news: None, glow: false };
		page.boards = vec![board(false)];
		let over = page.frame(cam, 1.0, 1200.0, 800.0, false);
		let picture = over.ops.iter().position(|op| matches!(op, Op::Shape { paint: stage_paint::list::Paint::Image { texture: 900, .. }, .. }));
		let tile = over.ops.iter().position(|op| matches!(op, Op::Picture { .. }));
		assert!(matches!((picture, tile), (Some(p), Some(t)) if p < t), "the picture first, then the tiles: {picture:?} {tile:?}");
		assert_eq!(page.pictured, vec!["boards/x.html".to_owned()]);
		// Live: its page shows through the tiles' hole, with nothing of the board drawn.
		page.boards = vec![board(true)];
		let over = page.frame(cam, 1.0, 1200.0, 800.0, false);
		assert!(over.ops.iter().all(|op| matches!(op, Op::Picture { .. })));
		assert!(page.pictured.is_empty());
	}

	#[test]
	fn a_tile_on_screen_is_never_evicted() {
		let mut page = Page::new(STAGE, false, "s").unwrap();
		let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
		// The window's own tiles, drawn in a frame.
		for key in Grid::covering(&Rect { x: 0.0, y: 0.0, w: 1200.0, h: 800.0 }, 1.0, 0) {
			page.tile_texture(key);
		}
		let on_screen = page.tiles.len();
		page.frame(cam, 1.0, 1200.0, 800.0, false);
		// Far more tiles than the budget arrive elsewhere.
		for x in 0..400 {
			page.tile_texture(Key { scale: 1f32.to_bits(), x: 100 + x, y: 50 });
		}
		page.frame(Camera { x: 0.0, y: 0.0, zoom: 1.0 }, 1.0, 1200.0, 800.0, false);
		let gone = page.evict();
		assert!(!gone.is_empty());
		for key in Grid::covering(&Rect { x: 0.0, y: 0.0, w: 1200.0, h: 800.0 }, 1.0, 0) {
			assert!(page.tiles.contains_key(&key), "a tile on screen was evicted");
		}
		assert!(on_screen > 0);
	}

	#[test]
	fn a_zoom_out_shows_the_sharper_tiles_until_its_own_come() {
		let mut page = Page::new(STAGE, false, "s").unwrap();
		let mut worker = Worker::new(STAGE, false).unwrap();
		let near = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
		for (key, _) in worker.next(near, 1.0, 1200.0, 800.0, false, 64) {
			if key.scale() == 1.0 {
				page.tile_texture(key);
			}
		}
		// Zoomed out to a fifth: no tile at that scale or coarser is held, only the ones at 1.
		let far = Camera { x: -2000.0, y: -2000.0, zoom: 0.2 };
		let over = page.frame(far, 1.0, 1200.0, 800.0, true);
		let pictures = over.ops.iter().filter(|op| matches!(op, Op::Picture { .. })).count();
		assert!(pictures >= 6, "the sharper tiles stand in: {pictures}");
	}
}

/// The arrows one gesture bends: each with an end on what it moves (or in it), or on a board it
/// carries, and not itself moved. Found once per gesture; only the routing runs at each step.
struct Bent {
	key: String,
	arrows: Vec<BentArrow>,
	/// Each item the gesture moves, and everything in one, to the moved item whose offset it takes.
	carried: HashMap<String, String>,
	/// Where each arrow end and parent is in the scene, so a step does not search for it.
	at: HashMap<String, (usize, u32)>,
}

struct BentArrow {
	id: String,
	meta: Value,
	stroke: f64,
	parent: Option<String>,
}

impl Bent {
	fn find(scene: &Scene, moving: &[(String, Preview)], boards: &HashSet<String>, key: String) -> Bent {
		let moved: HashSet<&str> = moving.iter().map(|(id, _)| id.as_str()).collect();
		let mut carried = HashMap::new();
		for root in &scene.roots {
			let items = &root.tree.items;
			for (i, item) in items.iter().enumerate() {
				let mut at = Some(i as u32);
				while let Some(a) = at {
					let up = &items[a as usize];
					if moved.contains(up.id.as_str()) {
						carried.insert(item.id.clone(), up.id.clone());
						break;
					}
					at = up.parent;
				}
			}
		}
		let mut arrows = Vec::new();
		let mut at = HashMap::new();
		for root in &scene.roots {
			let items = &root.tree.items;
			for item in items {
				// Arrows in the document itself: an instance's copies are routed where they are defined.
				if item.handle.is_none() || carried.contains_key(&item.id) || !arrows::is_arrow(&item.props) {
					continue;
				}
				let Some(meta) = item.get("metadata") else { continue };
				let ends = arrows::end_items(meta);
				if !ends.iter().flatten().any(|e| carried.contains_key(*e) || boards.contains(*e)) {
					continue;
				}
				let parent = item.parent.map(|p| items[p as usize].id.clone());
				for name in ends.iter().flatten().map(|e| e.to_string()).chain(parent.clone()) {
					if let Some(found) = scene.find(&name) {
						at.insert(name, found);
					}
				}
				arrows.push(BentArrow { id: item.id.clone(), meta: meta.clone(), stroke: item.get("strokeWidth").and_then(Value::as_f64).unwrap_or(2.0), parent });
			}
		}
		Bent { key, arrows, carried, at }
	}
}

/// A gesture's preview of one item (`PenPreview` in the app): moved by `dx dy`, and fields shown.
#[derive(Clone, Debug, Default)]
pub struct Preview {
	pub dx: f64,
	pub dy: f64,
	pub set: Vec<(String, Option<Value>)>,
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
}

impl ViewState {
	fn apply<'a>(&'a self, ctx: &mut Context<'a>) {
		ctx.mute = Some(&self.mute);
		ctx.holes = Some(&self.holes);
		ctx.scrolls = Some(&self.scrolls);
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

/// A board as the app places it (`SceneBoard`).
#[derive(Clone, Debug, Default)]
pub struct BoardPlace {
	pub path: String,
	pub x: f64,
	pub y: f64,
	pub w: f64,
	pub h: f64,
	/// Its page is showing: nothing is drawn for it here.
	pub live: bool,
	/// The writer's colour when the board is news, and whether to draw its outline here.
	pub news: Option<[f32; 4]>,
	pub glow: bool,
}

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
		assert!(checked > 10_000, "{checked}");
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
