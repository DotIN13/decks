//! The worker's engine: the same document as the page, kept by the same numbered batches,
//! painted as tiles. In the browser it runs on its own thread; natively, beside the page.

use super::*;

/// The worker's engine: the same document, kept by the same numbered batches, painted as tiles.
pub struct Worker {
	pub icons: HashMap<String, IconShape>,
	pub text: Text,
	pub pictures: Pictures,
	/// Items the page is moving: left out of the tiles until they land.
	pub lifted: HashSet<String>,
	pub view: ViewState,
	/// Items put down whose tiles are being painted with them: the page hears when they all are.
	pub(crate) landing: Vec<(Vec<String>, Rect)>,
	/// The scale tiles were last asked for at.
	pub(crate) scale: f32,
	/// Stale tiles at other scales, let go of: the page drops them too.
	pub discarded: Vec<Key>,
	pub atlas: RefCell<Atlas>,
	pub doc: Document,
	pub scene: Scene,
	pub grid: Grid,
	pub dark: bool,
	/// The tile pictures the page holds, by the version they were painted at.
	pub(crate) version: u64,
	/// The tiles painted without a picture, by its address, while it was not yet here.
	pub(crate) missing: HashMap<String, Vec<Key>>,
	/// A font or a picture arrived since the last paint: everything is laid out again and every tile
	/// painted again, once for however many came (`settle`).
	pub(crate) relayout: bool,
	/// An icon arrived since the last paint: every tile is painted again, once (`settle`).
	pub(crate) repaint: bool,
}

impl Worker {
	pub fn new(text: &str, dark: bool) -> Result<Worker, String> {
		let doc = Document::parse(text).map_err(|e| e.0)?;
		let mut words = Text::new();
		words.dark = dark;
		let scene = Scene::new(&doc, dark, &words);
		Ok(Worker { view: ViewState::default(), icons: HashMap::new(), text: words, pictures: Pictures::default(), lifted: HashSet::new(), landing: Vec::new(), scale: 1.0, discarded: Vec::new(), atlas: RefCell::new(Atlas::new()), doc, scene, grid: Grid::new(4096, 1), dark, version: 0, missing: HashMap::new(), relayout: false, repaint: false })
	}

	/// Start again from the whole document: after a lost batch, or a theme change.
	pub fn reload(&mut self, text: &str, dark: bool) -> Result<(), String> {
		self.doc = Document::parse(text).map_err(|e| e.0)?;
		self.dark = dark;
		self.text.dark = dark;
		self.scene = Scene::new(&self.doc, dark, &self.text);
		self.grid.invalidate_all();
		self.missing.clear();
		self.relayout = false;
		self.repaint = false;
		Ok(())
	}

	/// What fonts, pictures and icons that arrived since the last paint call for, done once: a
	/// batch of five fonts lays the stage out once and paints each tile once, not five times.
	pub fn settle(&mut self) {
		if self.relayout {
			self.scene.update(&self.doc, None, &self.text);
		}
		if self.relayout || self.repaint {
			self.version += 1;
			self.grid.invalidate_all();
		}
		self.relayout = false;
		self.repaint = false;
	}

	/// Apply the page's batch number `generation`. `Err` when one was missed: ask for the whole
	/// document then.
	pub fn apply(&mut self, changes: &[Change], generation: u64) -> Result<(), String> {
		if generation != self.doc.generation + 1 {
			return Err(format!("batch {generation} after {}: send the whole document", self.doc.generation));
		}
		self.settle();
		let applied = self.doc.apply(changes).map_err(|e| e.0)?;
		let updated = self.scene.update(&self.doc, Some(&applied), &self.text);
		self.invalidate(&updated);
		Ok(())
	}

	/// The server's edits, applied; the tiles they reach are painted again.
	pub fn apply_edits(&mut self, edits: &[stage_doc::edits::Edit]) -> Result<(), String> {
		self.settle();
		let applied = self.doc.apply_edits(edits).map_err(|e| e.0)?;
		let updated = self.scene.update(&self.doc, Some(&applied), &self.text);
		self.invalidate(&updated);
		Ok(())
	}

	/// A font file arrived: laid out again and every tile repainted, at the next paint (`settle`).
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.text.add_font(name, bytes, fallback);
		self.relayout = true;
	}

	/// The tiles a change reaches are painted again: in a root laid out again, what each changed item
	/// painted before and paints now (`Root::changed_ink`), so a word changed in a big frame repaints
	/// that word's tiles, not the frame's; the whole extent, before and after, when its items changed.
	fn invalidate(&mut self, updated: &Updated) {
		self.version += 1;
		for (handle, before) in &updated.roots {
			let root = self.scene.root(*handle);
			let was = updated.old.iter().find(|r| r.handle == *handle);
			if let (Some(root), Some(was)) = (root, was) {
				if let Some(areas) = root.changed_ink(was) {
					for area in &areas {
						self.grid.invalidate(area);
					}
					continue;
				}
			}
			if let Some(b) = before {
				self.grid.invalidate(b);
			}
			if let Some(root) = root {
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
		self.settle();
		let mut changed: Vec<String> = next.differs(&self.view);
		// A new writer redraws the frames its name and colour are drawn on.
		if next.writer != self.view.writer {
			changed.extend(self.scene.placeholders());
		}
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
		self.settle();
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
		self.settle();
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
		// Laid out again, and every tile painted again, for a card that shows it (`Text::picture`);
		// otherwise only the tiles painted without it are painted again.
		if self.text.picture(url, width as f32, height as f32) {
			self.relayout = true;
		}
		if let Some(keys) = self.missing.remove(url) {
			self.version += 1;
			for key in keys {
				if let Some(tile) = self.grid.tiles.get_mut(&key) {
					tile.dirty = true;
				}
			}
		}
	}

	/// An icon arrived: tiles are painted again (an icon is small, but it may be anywhere), at the
	/// next paint, once for however many came (`settle`).
	pub fn icon(&mut self, key: &str, shape: IconShape) {
		self.icons.insert(key.to_owned(), shape);
		self.repaint = true;
	}

	/// The next tiles to paint for a view, with their draw lists: missing ones first, the middle first.
	///
	/// For tests and measures: the lists are built one after another without being drawn, so text in
	/// an earlier one may point at glyphs a later one has replaced. Painting goes through `paint`.
	pub fn next(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, zooming: bool, limit: usize) -> Vec<(Key, DrawList)> {
		let mut out = Vec::new();
		self.paint(camera, dpr, width, height, zooming, limit, &mut |key, list, _| out.push((key, list)));
		out
	}

	/// Paint the next tiles for a view, missing ones first and the middle first, each handed to `draw`
	/// with the glyph texture as soon as its list is built, so it is drawn before the next one can
	/// replace a glyph it uses. A list whose own glyphs were pushed out while it was built (the texture
	/// full of them alone) is built again. Returns how many tiles were painted.
	#[allow(clippy::too_many_arguments)]
	pub fn paint(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, zooming: bool, limit: usize, draw: &mut dyn FnMut(Key, DrawList, &mut Atlas)) -> usize {
		self.settle();
		let scale = scale_for(camera.zoom * dpr, zooming);
		/*
		 * A new scale: the stale tiles of the others are let go of now, as an edit lets them go
		 * (`discard_stale`). Kept, they were never painted again, since no view wants them, and an
		 * item put down just before a zoom never landed (`landed` waits for every stale tile it is
		 * on): the page went on drawing it over the tiles that have it, twice over where it is clear.
		 */
		if scale.to_bits() != self.scale.to_bits() {
			self.scale = scale;
			self.discard_stale();
		}
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		/*
		 * While the page holds items lifted (a drag), only what is on screen is painted: the border and
		 * the overview are not seen until a pan or a zoom out, and wait, still marked, for the drop.
		 */
		let holding = !self.lifted.is_empty();
		let wanted = if holding { Grid::covering(&view, scale, 0) } else { Grid::wanted(&view, scale) };
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
			let asked = ctx.wanted.borrow().len();
			for _ in 0..3 {
				self.atlas.borrow_mut().begin();
				list = paint_area(&ctx, k.area(), k.scale(), clear);
				if !self.atlas.borrow_mut().take_overflow() {
					break;
				}
			}
			// The pictures this tile was painted without: it is painted again when they come.
			for url in &ctx.wanted.borrow()[asked..] {
				let keys = self.missing.entry(url.clone()).or_default();
				if !keys.contains(&k) {
					keys.push(k);
				}
			}
			draw(k, list, &mut self.atlas.borrow_mut());
		}
		self.pictures.wanted.borrow_mut().extend(ctx.wanted.borrow_mut().drain(..));
		n
	}

	/// How many tiles the window itself (no margin) still needs at the scale it wants: missing, or
	/// stale. 0 means what the page shows of the window is painted from the drawing as it is now.
	/// A count for measures (`e2e/checks/render-perf.mjs`): a few lookups, made once per batch.
	pub fn view_left(&self, camera: Camera, dpr: f64, width: f64, height: f64, zooming: bool) -> usize {
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		let wanted = Grid::covering(&view, scale_for(camera.zoom * dpr, zooming), 0);
		wanted.iter().filter(|k| self.grid.tiles.get(k).is_none_or(|t| t.dirty || t.texture.is_none())).count()
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
