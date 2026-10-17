//! The two engines, without the browser: what the page and the worker each keep and do. The wasm
//! bindings (`lib.rs`) only carry calls across; everything here also runs, and is tested, natively.

use serde_json::{Value, json};
use stage_doc::{Change, Document, History, Ids};
use stage_paint::list::{Color, DrawList, Op};
use stage_paint::painter::{Context, LiveInk, paint_area, paint_ink};
use stage_scene::geometry::Mat;
use stage_paint::tiles::{Grid, Key, TILE, scale_for};
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
	pub text: Text,
	pub atlas: RefCell<Atlas>,
	pub pictures: Pictures,
	/// Top-level items being moved: drawn here each frame, left out of the worker's tiles.
	pub lifted: HashSet<String>,
	/// The stroke still under the pen.
	pub ink: Vec<LiveInk>,
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
		let words = Text::new();
		let scene = Scene::new(&doc, dark, &words);
		Ok(Page { text: words, atlas: RefCell::new(Atlas::new()), pictures: Pictures::default(), lifted: HashSet::new(), ink: Vec::new(), doc, scene, history: History::default(), ids: Ids::new(session), tiles: HashMap::new(), budget: 160, frame: 0, next_texture: 1 })
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

	/// A font file arrived: words are measured again, so everything is laid out again.
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.text.add_font(name, bytes, fallback);
		self.scene.update(&self.doc, None, &self.text);
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
	///   picture comes (`live` names the boards whose pages are showing);
	/// - over them, the worker's tiles, coarse ones first so the sharpest of each place lies on top,
	///   then the lifted items and the stroke under the pen, drawn fresh.
	///
	/// Tiles and pictures lie on whole device pixels.
	pub fn frame(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, moving: bool, live: &HashSet<String>) -> (DrawList, DrawList) {
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
		// Under: the boards.
		let mut under = DrawList::new(Color::TRANSPARENT);
		for root in &self.scene.roots {
			if !root.extent.meets(&view) {
				continue;
			}
			for (item, place) in root.tree.items.iter().zip(&root.placed) {
				if item.kind() != "browser" || !place.visible || live.contains(&item.id) || self.lifted.contains(&root.id) {
					continue;
				}
				let (x, y, w, h) = snap(&place.rect);
				match self.pictures.get(&format!("board:{}", item.id)) {
					Some((texture, _, _)) => under.push(Op::Picture { texture, x, y, w, h, uv: [0.0, 0.0, 1.0, 1.0], opacity: 1.0 }),
					None => {
						let paper = if self.scene.dark { [0.141, 0.141, 0.141, 1.0] } else { [1.0, 1.0, 1.0, 1.0] };
						under.push(Op::Shape {
							shape: stage_paint::list::Shape { w, h, radii: [0.0; 4], ellipse: false },
							transform: stage_paint::list::Affine::translate(x, y),
							paint: stage_paint::list::Paint::Solid(Color(paper)),
							stroke: None,
						});
					}
				}
			}
		}
		// Over: the tiles, one per place. Each place shows the sharpest tile held for it; where the
		// tile at the scale asked for has not come yet, the part of a coarser one that covers it.
		// Never two layered: tiles are clear where nothing is drawn, so a stale one under a fresh
		// one would show through.
		let mut over = DrawList::new(Color::TRANSPARENT);
		let want = scale_for(camera.zoom * dpr, moving);
		let mut scales: Vec<u32> = self.tiles.keys().map(|k| k.scale).collect::<HashSet<_>>().into_iter().collect();
		// Nearest the scale wanted first, sharper before blurrier at the same distance.
		scales.sort_by(|a, b| {
			let d = |s: u32| ((f32::from_bits(s) as f64).ln() - (want as f64).ln()).abs();
			d(*a).total_cmp(&d(*b)).then(f32::from_bits(*b).total_cmp(&f32::from_bits(*a)))
		});
		for key in Grid::covering(&view, want, 0) {
			let place = key.area();
			let found = scales.iter().find_map(|&sc| {
				let side = TILE as f64 / f32::from_bits(sc) as f64;
				let k = Key { scale: sc, x: (place.cx() / side).floor() as i32, y: (place.cy() / side).floor() as i32 };
				// A coarser tile covers the whole place; a sharper one only part of it.
				let a = k.area();
				(a.x <= place.x + 1e-6 && a.y <= place.y + 1e-6 && a.right() >= place.right() - 1e-6 && a.bottom() >= place.bottom() - 1e-6).then_some(())?;
				self.tiles.get(&k).map(|(t, _)| (k, *t))
			});
			let Some((k, texture)) = found else { continue };
			let a = k.area();
			let uv = [((place.x - a.x) / a.w) as f32, ((place.y - a.y) / a.h) as f32, ((place.right() - a.x) / a.w) as f32, ((place.bottom() - a.y) / a.h) as f32];
			let (x, y, w, h) = snap(&place);
			over.push(Op::Picture { texture, x, y, w, h, uv, opacity: 1.0 });
			if let Some(t) = self.tiles.get_mut(&k) {
				t.1 = self.frame;
			}
		}
		// The lifted items, drawn fresh, and the stroke under the pen.
		if !self.lifted.is_empty() {
			let skip = HashSet::new();
			let pictures = &self.pictures;
			let image = |url: &str| pictures.get(url);
			let mut ctx = Context::new(&self.scene, &skip, &image).with_text(&self.text, &self.atlas);
			ctx.only = Some(&self.lifted);
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

	/// Lift top-level items for a drag: the worker leaves them out of its tiles from now on.
	pub fn lift(&mut self, ids: &[String]) {
		self.lifted.extend(ids.iter().cloned());
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

	/// Tiles past the budget, drawn longest ago: forget their textures and tell the worker.
	pub fn evict(&mut self) -> Vec<(Key, u32)> {
		if self.tiles.len() <= self.budget {
			return Vec::new();
		}
		let mut old: Vec<(u64, Key)> = self.tiles.iter().map(|(k, (_, used))| (*used, *k)).collect();
		old.sort();
		let excess = self.tiles.len() - self.budget;
		old.into_iter().take(excess).filter_map(|(_, k)| self.tiles.remove(&k).map(|(t, _)| (k, t))).collect()
	}
}

/// The worker's engine: the same document, kept by the same numbered batches, painted as tiles.
pub struct Worker {
	pub text: Text,
	pub pictures: Pictures,
	/// Items the page is moving: left out of the tiles until they land.
	pub lifted: HashSet<String>,
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
		let words = Text::new();
		let scene = Scene::new(&doc, dark, &words);
		Ok(Worker { text: words, pictures: Pictures::default(), lifted: HashSet::new(), landing: Vec::new(), scale: 1.0, discarded: Vec::new(), atlas: RefCell::new(Atlas::new()), doc, scene, grid: Grid::new(4096, 1), dark, version: 0 })
	}

	/// Start again from the whole document: after a lost batch, or a theme change.
	pub fn reload(&mut self, text: &str, dark: bool) -> Result<(), String> {
		self.doc = Document::parse(text).map_err(|e| e.0)?;
		self.dark = dark;
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
			// A lifted item is drawn by the page while it moves: its tiles do not change.
			if self.scene.root(*handle).is_some_and(|r| self.lifted.contains(&r.id)) {
				continue;
			}
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
		let stale: Vec<Key> = self.grid.tiles.iter().filter(|(k, t)| t.dirty && k.scale != current).map(|(k, _)| *k).collect();
		for k in stale {
			self.grid.forget(&k);
			self.discarded.push(k);
		}
	}

	/// The page lifted these items: paint their tiles without them.
	pub fn lift(&mut self, ids: &[String]) {
		self.version += 1;
		for id in ids {
			if let Some(root) = self.scene.roots.iter().find(|r| &r.id == id) {
				self.grid.invalidate(&root.extent);
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
			if let Some(root) = self.scene.roots.iter().find(|r| &r.id == id) {
				self.grid.invalidate(&root.extent);
				area = Some(area.map_or(root.extent, |a| a.union(&root.extent)));
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

	/// The next tiles to paint for a view, with their draw lists: missing ones first, the middle first.
	pub fn next(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, moving: bool, limit: usize) -> Vec<(Key, DrawList)> {
		let scale = scale_for(camera.zoom * dpr, moving);
		self.scale = scale;
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		let wanted = Grid::covering(&view, scale, if moving { 0 } else { 1 });
		let keys = self.grid.to_paint(&wanted, limit);
		let pictures = &self.pictures;
		let image = |url: &str| pictures.get(url);
		let ctx = Context::new(&self.scene, &self.lifted, &image).with_text(&self.text, &self.atlas);
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
		// The tile the square left and the tile it went to.
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 2);
		assert_eq!(page.pick(1150.0, 50.0, 0.0)["id"], "a");
		// A missed batch is noticed.
		assert!(worker.apply(&changes, generation + 5).is_err());
		let (under, over) = page.frame(cam, 1.0, 1200.0, 800.0, false, &HashSet::new());
		assert!(over.ops.iter().all(|op| matches!(op, Op::Picture { .. })));
		// The board has no live page and no picture yet: its paper, under the pages.
		assert_eq!(under.ops.len(), 1);
		// A drag: the worker repaints without the square, the page draws it.
		page.lift(&["a".into()]);
		worker.lift(&["a".into()]);
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 1);
		let moved = crate::wire::parse(r#"[{"op":"set","id":"a","key":"x","value":1150}]"#).unwrap();
		let generation = page.apply(&moved, true).unwrap();
		worker.apply(&moved, generation).unwrap();
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 0, "moving a lifted item paints no tiles");
		let (_, over) = page.frame(cam, 1.0, 1200.0, 800.0, false, &HashSet::new());
		assert!(over.ops.iter().any(|op| matches!(op, Op::Shape { .. })), "the page draws it");
		worker.drop_items(&["a".into()]);
		assert!(worker.landed().is_empty());
		assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 1);
		assert_eq!(worker.landed(), vec!["a".to_owned()]);
		assert_eq!(page.boards()[0]["id"], "board");
	}
}
