//! The two engines, without the browser: what the page and the worker each keep and do. The wasm
//! bindings (`lib.rs`) only carry calls across; everything here also runs, and is tested, natively.

use serde_json::{Value, json};
use stage_doc::{Change, Document, History, Ids};
use stage_paint::list::{Color, DrawList, Op};
use stage_paint::painter::{Context, paint_area};
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

/// The page's engine: owns the document, answers the pointer, and lays the worker's tiles on the
/// screen in the same frame as the board pages.
pub struct Page {
	pub text: Text,
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
		Ok(Page { text: words, doc, scene, history: History::default(), ids: Ids::new(session), tiles: HashMap::new(), budget: 160, frame: 0, next_texture: 1 })
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
		let t = self.next_texture;
		self.next_texture += 1;
		self.tiles.insert(key, (t, self.frame));
		t
	}

	/// What the screen shows for a camera: every held tile meeting the view, coarse ones first so
	/// the sharpest picture of each place lies on top. Positions are rounded to whole device pixels.
	pub fn frame(&mut self, camera: Camera, dpr: f64, width: f64, height: f64) -> DrawList {
		self.frame += 1;
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		let s = camera.zoom * dpr;
		let mut visible: Vec<(Key, u32)> = self.tiles.iter().filter(|(k, _)| k.area().meets(&view)).map(|(k, (t, _))| (*k, *t)).collect();
		visible.sort_by(|a, b| a.0.scale().total_cmp(&b.0.scale()));
		let mut list = DrawList::new(Color::TRANSPARENT);
		for (key, texture) in visible {
			let a = key.area();
			let x0 = ((a.x - camera.x) * s).round();
			let y0 = ((a.y - camera.y) * s).round();
			let x1 = ((a.right() - camera.x) * s).round();
			let y1 = ((a.bottom() - camera.y) * s).round();
			list.push(Op::Picture { texture, x: x0 as f32, y: y0 as f32, w: (x1 - x0) as f32, h: (y1 - y0) as f32, uv: [0.0, 0.0, 1.0, 1.0], opacity: 1.0 });
			if let Some(t) = self.tiles.get_mut(&key) {
				t.1 = self.frame;
			}
		}
		list
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
		Ok(Worker { text: words, atlas: RefCell::new(Atlas::new()), doc, scene, grid: Grid::new(4096, 1), dark, version: 0 })
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
	}

	/// The next tiles to paint for a view, with their draw lists: missing ones first, the middle first.
	pub fn next(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, moving: bool, limit: usize) -> Vec<(Key, DrawList)> {
		let scale = scale_for(camera.zoom * dpr, moving);
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		let wanted = Grid::covering(&view, scale, if moving { 0 } else { 1 });
		let keys = self.grid.to_paint(&wanted, limit);
		let skip = HashSet::new();
		let none = |_: &str| None;
		let ctx = Context::new(&self.scene, &skip, &none).with_text(&self.text, &self.atlas);
		let clear = Color::TRANSPARENT;
		let out = keys.into_iter().map(|k| (k, paint_area(&ctx, k.area(), k.scale(), clear))).collect();
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
		let frame = page.frame(cam, 1.0, 1200.0, 800.0);
		assert!(frame.ops.iter().all(|op| matches!(op, Op::Picture { .. })));
		assert_eq!(page.boards()[0]["id"], "board");
	}
}
