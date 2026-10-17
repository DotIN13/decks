//! The two engines, without the browser: what the page and the worker each keep and do. The wasm
//! bindings (`lib.rs`) only carry calls across; everything here also runs, and is tested, natively.

use serde_json::{Value, json};
use stage_doc::{Change, Document, History, Ids};
use stage_paint::list::{Color, DrawList, Op};
use stage_paint::painter::{Context, IconShape, LiveInk, paint_area, paint_ink};
use stage_scene::geometry::Mat;
use stage_paint::tiles::{Grid, Key, TILE, overview_scale, scale_for};
use stage_scene::{Rect, Scene, Updated};
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
		Ok(Page { only_lifted: false, hide_lifted: false, boards: Vec::new(), carry: (HashSet::new(), 0.0, 0.0), pictured: Vec::new(), carrying: Vec::new(), offsets: HashMap::new(), preview_undo: Vec::new(), view: ViewState::default(), icons: HashMap::new(), text: words, atlas: RefCell::new(Atlas::new()), pictures: Pictures::default(), lifted: HashSet::new(), ink: Vec::new(), doc, scene, history: History::default(), ids: Ids::new(session), tiles: HashMap::new(), budget: 160, frame: 0, next_texture: 1 })
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

	/// The two layers the screen shows for a camera, in one frame with the board pages:
	///
	/// - under the pages, each board that has no live page: its picture, or its paper until the
	///   picture comes;
	/// - over them, the worker's tiles, coarse ones first so the sharpest of each place lies on top,
	///   then the lifted items and the stroke under the pen, drawn fresh.
	///
	/// Tiles and pictures lie on whole device pixels.
	pub fn frame(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, moving: bool) -> (DrawList, DrawList) {
		self.frame += 1;
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		let s = camera.zoom * dpr;
		let snap = |r: &Rect| {
			let x0 = ((r.x - camera.x) * s).round();
			let y0 = ((r.y - camera.y) * s).round();
			let x1 = ((r.right() - camera.x) * s).round();
			let y1 = ((r.bottom() - camera.y) * s).round();
			(x0 as f32, y0 as f32, (x1 - x0) as f32, (y1 - y0) as f32)
		};
		// Under: the boards with no live page (and those a drag carries): picture, or paper until it comes.
		let mut under = DrawList::new(Color::TRANSPARENT);
		let paper = if self.scene.dark { [0.118, 0.118, 0.125, 1.0] } else { [1.0, 1.0, 1.0, 1.0] };
		let mut pictured = Vec::new();
		let mut carrying = Vec::new();
		for board in &self.boards {
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
			under.push(Op::Shape { shape: shape(w, h), transform: stage_paint::list::Affine::translate(x, y), paint: stage_paint::list::Paint::Solid(Color(paper)), stroke: None });
			if let Some((texture, pw, ph)) = picture {
				// The whole board was pictured: one taller than the box is cut at its foot.
				let tall = ph as f32 / pw.max(1) as f32 * w;
				let shown = h.min(tall);
				under.push(Op::Shape { shape: shape(w, shown), transform: stage_paint::list::Affine::translate(x, y), paint: stage_paint::list::Paint::Image { texture, opacity: 1.0, uv: [0.0, 0.0, 1.0, shown / tall] }, stroke: None });
				if board.live {
					carrying.push(board.path.clone());
				} else {
					pictured.push(board.path.clone());
				}
			}
			if let Some(colour) = board.news.filter(|_| board.glow) {
				under.push(Op::Shape { shape: shape(w, h), transform: stage_paint::list::Affine::translate(x, y), paint: stage_paint::list::Paint::Solid(Color::straight([colour[0], colour[1], colour[2], 0.6], 1.0)), stroke: Some((1.5, stage_paint::list::Align::Center)) });
			}
		}
		self.pictured = pictured;
		self.carrying = carrying;
		// Over: the tiles, one per place. Each place shows the sharpest tile held for it; where the
		// tile at the scale asked for has not come yet, the part of a coarser one that covers it, and
		// failing that the sharper tiles of one scale that lie in it, drawn smaller (a zoom out holds
		// only sharper ones). Never two scales layered in a place: tiles are clear where nothing is
		// drawn, so a stale one under a fresh one would show through.
		let mut over = DrawList::new(Color::TRANSPARENT);
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
			let lifted = paint_area(&ctx, view, s, Color::TRANSPARENT);
			self.pictures.wanted.borrow_mut().extend(ctx.wanted.borrow_mut().drain(..));
			over.ops.extend(lifted.ops);
		}
		if !self.ink.is_empty() {
			let target = Mat([s, 0.0, 0.0, s, -camera.x * s, -camera.y * s]);
			paint_ink(&self.ink, &target, &mut over.ops);
		}
		(under, over)
	}

	/// Lift items for a drag: the worker leaves them out of its tiles from now on.
	pub fn lift(&mut self, ids: &[String]) {
		self.lifted.extend(ids.iter().cloned());
	}

	/// A gesture in progress: each item moved by `dx dy` and, while resizing or restyling, with these
	/// fields, shown here only, until the gesture ends (`None`) or the saved drawing arrives. Lifts
	/// what it names. Returns the items whose layout changed, for the stage's outlines.
	pub fn preview(&mut self, moving: Option<Vec<(String, Preview)>>) -> Result<(), String> {
		self.unpreview();
		let Some(moving) = moving else { return Ok(()) };
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
		Ok(())
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

	/// Tiles past the budget, drawn longest ago: forget their textures and tell the worker. The
	/// overview's are kept (`overview_scale`).
	pub fn evict(&mut self) -> Vec<(Key, u32)> {
		if self.tiles.len() <= self.budget {
			return Vec::new();
		}
		let overview = self.scene.extent().map(|e| overview_scale(&e).to_bits());
		let mut old: Vec<(u64, Key)> = self.tiles.iter().filter(|(k, _)| Some(k.scale) != overview).map(|(k, (_, used))| (*used, *k)).collect();
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

	/// The page lifted these items: paint their tiles without them.
	pub fn lift(&mut self, ids: &[String]) {
		self.version += 1;
		for id in ids {
			if let Some(area) = self.scene.extent_of(id) {
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
			if let Some(extent) = self.scene.extent_of(id) {
				self.grid.invalidate(&extent);
				area = Some(area.map_or(extent, |a| a.union(&extent)));
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
	pub fn next(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, moving: bool, limit: usize) -> Vec<(Key, DrawList)> {
		let scale = scale_for(camera.zoom * dpr, moving);
		self.scale = scale;
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		let wanted = Grid::covering(&view, scale, if moving { 0 } else { 1 });
		let mut keys = self.grid.to_paint(&wanted, limit);
		// Once the view has all it needs, the overview: the whole stage at one small scale.
		if keys.len() < limit {
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
		let out = keys.into_iter().map(|k| (k, paint_area(&ctx, k.area(), k.scale(), clear))).collect();
		self.pictures.wanted.borrow_mut().extend(ctx.wanted.borrow_mut().drain(..));
		out
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

#[cfg(test)]
mod tests {
	use super::*;
	use stage_paint::{Backend, Recording, Target, TextureKind};

	const STAGE: &str = r##"{"version":"2.14","children":[
		{"type":"rectangle","id":"a","x":10,"y":10,"width":100,"height":100,"fill":"#f00"},
		{"type":"browser","id":"board","x":600,"y":0,"width":400,"height":300,"url":"boards/x.html"}
	]}"##;

	/// The whole loop: the page edits, the worker repaints what the edit touched, the page shows it.
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
		let (under, over) = page.frame(cam, 1.0, 1200.0, 800.0, false);
		assert!(over.ops.iter().all(|op| matches!(op, Op::Picture { .. })));
		// No boards placed yet: nothing under the pages.
		assert!(under.ops.is_empty());
		// A drag: the worker repaints without the square (its tile and the overview's), the page draws it.
		page.lift(&["a".into()]);
		worker.lift(&["a".into()]);
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 2);
		// The drag's moves are the page's alone: the worker paints nothing.
		page.preview(Some(vec![("a".into(), Preview { dx: 50.0, dy: 0.0, set: vec![] })])).unwrap();
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 0, "moving a lifted item paints no tiles");
		let (_, over) = page.frame(cam, 1.0, 1200.0, 800.0, false);
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
		let (_, over) = page.frame(far, 1.0, 1200.0, 800.0, true);
		let pictures = over.ops.iter().filter(|op| matches!(op, Op::Picture { .. })).count();
		assert!(pictures >= 6, "the sharper tiles stand in: {pictures}");
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
