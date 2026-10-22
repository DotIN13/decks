//! The calls JavaScript makes: `PageEngine` on the page, `WorkerEngine` in the render worker, and
//! opening WebGPU or WebGL 2 on a canvas for either (`select.rs` picks which). Changes cross as JSON text; tiles as `ImageBitmap`s.

use crate::engine::{Camera, Page, TILE_SIZE, Worker};
use crate::select::{self, Api};
use crate::wire;
use stage_gpu::Gpu;
use stage_gpu::targets::Canvas;
use stage_paint::tiles::Key;
use stage_paint::{Backend, Target, TextureKind};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
fn start() {
	console_error_panic_hook::set_once();
}

fn err(e: impl std::fmt::Display) -> JsError {
	JsError::new(&e.to_string())
}

/// WebGPU or WebGL 2, opened on a canvas: the page's own, or the worker's offscreen one.
#[wasm_bindgen]
pub struct GpuHandle {
	gpu: Gpu,
}

#[wasm_bindgen]
impl GpuHandle {
	/// The graphics API it draws with: `"webgpu"` or `"webgl2"`. The worker opens with the page's.
	pub fn backend(&self) -> String {
		self.gpu.api().name().into()
	}

	/// The widest and tallest texture the device allows, in pixels. Pictures are kept no bigger
	/// than this or 4096, whichever is less (`maxPictureSize`).
	#[wasm_bindgen(js_name = maxTextureSize)]
	pub fn max_texture_size(&self) -> u32 {
		self.gpu.limits().max_texture
	}

	/// The widest and tallest a picture is kept: resize bigger ones before `putPicture`.
	#[wasm_bindgen(js_name = maxPictureSize)]
	pub fn max_picture_size(&self) -> u32 {
		self.gpu.limits().max_picture()
	}

	/// Samples a pixel it draws with: 4, or 1 on a device short of them or of memory.
	pub fn samples(&self) -> u32 {
		self.gpu.limits().samples
	}
}

/// Open the stage on a canvas. `backend` (`"webgpu"`, `"webgl2"`, or nothing for WebGPU first) is
/// tried first, then the other; `low_memory` says whether the device is short of memory (drawn
/// with one sample a pixel), guessed from `navigator.deviceMemory` when not given.
async fn open(canvas: Canvas, width: u32, height: u32, backend: Option<String>, low_memory: Option<bool>) -> Result<GpuHandle, JsError> {
	let prefer = backend.as_deref().map(Api::parse).transpose().map_err(err)?;
	Ok(GpuHandle { gpu: select::open(canvas, width, height, prefer, low_memory).await.map_err(err)? })
}

/// The page's canvas, over the boards' pages: the drawing, and the boards' pictures.
#[wasm_bindgen(js_name = openStage)]
pub async fn open_stage(canvas: web_sys::HtmlCanvasElement, width: u32, height: u32, backend: Option<String>, low_memory: Option<bool>) -> Result<GpuHandle, JsError> {
	open(Canvas::Element(canvas), width, height, backend, low_memory).await
}

/// Copy a picture into texture `id`, made the picture's size (or `size`), and let the picture go.
/// `from_canvas`: it is a canvas's `transferToImageBitmap` (a tile), not a `createImageBitmap`.
/// No texture is made bigger than the device's picture limit: a bigger picture (the page resizes
/// them first, so it should not come) keeps what fits, and says so. A picture with nothing in it
/// (closed, or transferred away) is not copied (`copy_extent`), and the answer is false.
/// Copy a bitmap into texture `id`, and close it, unless `keep` (it is handed on to the page after).
fn copy_in(gpu: &mut Gpu, id: u32, bitmap: &web_sys::ImageBitmap, size: Option<(u32, u32)>, from_canvas: bool) -> bool {
	copy_in_keep(gpu, id, bitmap, size, from_canvas, false)
}

fn copy_in_keep(gpu: &mut Gpu, id: u32, bitmap: &web_sys::ImageBitmap, size: Option<(u32, u32)>, from_canvas: bool, keep: bool) -> bool {
	let Some(_) = crate::engine::copy_extent((bitmap.width(), bitmap.height()), (u32::MAX, u32::MAX)) else {
		web_sys::console::warn_1(&"stage: a picture with nothing in it (closed, or sent elsewhere) was not copied".into());
		return false;
	};
	let cap = gpu.limits().max_picture();
	let (w, h) = size.unwrap_or((bitmap.width().max(1), bitmap.height().max(1)));
	let (w, h) = (w.min(cap), h.min(cap));
	if bitmap.width() > w || bitmap.height() > h {
		web_sys::console::warn_1(&format!("stage: a {}×{} picture is over the {cap}-pixel limit: only {w}×{h} of it is kept", bitmap.width(), bitmap.height()).into());
	}
	if gpu.texture_handle(id).is_none_or(|t| t.width() != w || t.height() != h) {
		gpu.texture(id, TextureKind::Color, w, h, None);
	}
	let texture = gpu.texture_handle(id).expect("just made").clone();
	let (cw, ch) = crate::engine::copy_extent((bitmap.width(), bitmap.height()), (w, h)).expect("not empty, checked above");
	gpu.copy_bitmap(bitmap, &texture, cw, ch, from_canvas);
	if !keep {
		bitmap.close();
	}
	true
}


/// The app's markdown reader, a JavaScript function from a card's source to its blocks as JSON.
fn reader(read: js_sys::Function) -> Box<dyn Fn(&str) -> Option<Vec<stage_text::markdown::Block>>> {
	Box::new(move |source: &str| {
		let out = read.call1(&JsValue::NULL, &JsValue::from_str(source)).ok()?;
		stage_text::markdown::from_json(&out.as_string()?).ok()
	})
}

/// The app's typesetter (`math.ts`): TeX and whether it is a display formula in, the formula's
/// outlines as JSON out, or null.
fn typesetter(typeset: js_sys::Function) -> Box<dyn Fn(&str, bool) -> Option<stage_text::math::Formula>> {
	Box::new(move |tex: &str, display: bool| {
		let out = typeset.call2(&JsValue::NULL, &JsValue::from_str(tex), &JsValue::from_bool(display)).ok()?;
		serde_json::from_str(&out.as_string()?).ok()
	})
}

fn icon_shape(json: &str) -> Option<stage_paint::painter::IconShape> {
	serde_json::from_str(json).ok()
}

fn parse_edits(json: &str) -> Result<Vec<stage_doc::edits::Edit>, String> {
	let list: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| e.to_string())?;
	list.iter().map(stage_doc::edits::Edit::from_json).collect()
}

/// A gesture's previews from the app's `PenPreview`s: a size, a corner and fields become fields.
fn previews(json: &str) -> Option<Vec<(String, crate::engine::Preview)>> {
	let list: Vec<(String, serde_json::Value)> = serde_json::from_str(json).ok()?;
	Some(
		list.into_iter()
			.map(|(id, p)| {
				let n = |k: &str| p.get(k).and_then(serde_json::Value::as_f64);
				let mut set: Vec<(String, Option<serde_json::Value>)> = Vec::new();
				if let Some(w) = n("w") {
					set.push(("width".into(), Some(w.into())));
				}
				if let Some(h) = n("h") {
					set.push(("height".into(), Some(h.into())));
				}
				match p.get("radius") {
					Some(serde_json::Value::Null) => set.push(("cornerRadius".into(), None)),
					Some(r) if r.is_number() => set.push(("cornerRadius".into(), Some(r.clone()))),
					_ => {}
				}
				if let Some(serde_json::Value::Object(fields)) = p.get("set") {
					for (k, v) in fields {
						set.push((k.clone(), if v.is_null() { None } else { Some(v.clone()) }));
					}
				}
				(id, crate::engine::Preview { dx: n("dx").unwrap_or(0.0), dy: n("dy").unwrap_or(0.0), set })
			})
			.collect(),
	)
}

fn view_state(json: &str) -> crate::engine::ViewState {
	let v: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
	let set = |k: &str| v.get(k).and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_owned)).collect()).unwrap_or_default();
	let scrolls = v.get("scrolls").and_then(|s| s.as_object()).map(|m| m.iter().filter_map(|(k, x)| Some((k.clone(), x.as_f64()?))).collect()).unwrap_or_default();
	crate::engine::ViewState { hidden: set("hidden"), mute: set("mute"), holes: set("holes"), scrolls }
}

fn ids(json: &str) -> Vec<String> {
	serde_json::from_str(json).unwrap_or_default()
}

/// Any page canvas, as `openStage`.
#[wasm_bindgen(js_name = openCanvas)]
pub async fn open_canvas(canvas: web_sys::HtmlCanvasElement, width: u32, height: u32, backend: Option<String>, low_memory: Option<bool>) -> Result<GpuHandle, JsError> {
	open(Canvas::Element(canvas), width, height, backend, low_memory).await
}

/// The worker's tile canvas. Pass the page's `backend()` so both draw with the same API.
#[wasm_bindgen(js_name = openOffscreen)]
pub async fn open_offscreen(canvas: web_sys::OffscreenCanvas, width: u32, height: u32, backend: Option<String>, low_memory: Option<bool>) -> Result<GpuHandle, JsError> {
	open(Canvas::Offscreen(canvas), width, height, backend, low_memory).await
}

fn key(scale: u32, x: i32, y: i32) -> Key {
	Key { scale, x, y }
}

#[wasm_bindgen]
pub struct PageEngine {
	page: Page,
	gpu: Option<Gpu>,
	size: (u32, u32),
}

#[wasm_bindgen]
impl PageEngine {
	#[wasm_bindgen(constructor)]
	pub fn new(text: &str, dark: bool, session: &str) -> Result<PageEngine, JsError> {
		Ok(PageEngine { page: Page::new(text, dark, session).map_err(err)?, gpu: None, size: (0, 0) })
	}

	#[wasm_bindgen(js_name = setGpu)]
	pub fn set_gpu(&mut self, handle: GpuHandle) {
		self.gpu = Some(handle.gpu);
	}

	/// A font file, under the name the app's chains use; `fallback` for the files tried last. The
	/// stage is laid out again, unless `later` (a batch of fonts): then once, by `layOut`.
	#[wasm_bindgen(js_name = addFont)]
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool, later: Option<bool>) {
		if later == Some(true) {
			self.page.hold_font(name, bytes, fallback);
		} else {
			self.page.add_font(name, bytes, fallback);
		}
	}

	/// Everything laid out again: after a batch of fonts added `later`.
	#[wasm_bindgen(js_name = layOut)]
	pub fn lay_out(&mut self) {
		self.page.lay_out();
	}

	/// The server's edits (`stage.pen.delta` `edits`, as JSON).
	#[wasm_bindgen(js_name = applyEdits)]
	pub fn apply_edits(&mut self, edits: &str) -> Result<(), JsError> {
		self.page.apply_edits(&parse_edits(edits).map_err(err)?).map_err(err)
	}

	/// The colour scheme, dark or not.
	#[wasm_bindgen(js_name = setDark)]
	pub fn set_dark(&mut self, dark: bool) {
		self.page.set_dark(dark);
	}

	/// The whole drawing (`stage.pen` `doc`, as JSON text).
	#[wasm_bindgen(js_name = setDocument)]
	pub fn set_document(&mut self, text: &str) -> Result<(), JsError> {
		self.page.set_document(text).map_err(err)
	}

	/// Apply a batch of changes (JSON); `mine` when this session made it. Returns its generation.
	pub fn apply(&mut self, changes: &str, mine: bool) -> Result<f64, JsError> {
		let changes = wire::parse(changes).map_err(err)?;
		Ok(self.page.apply(&changes, mine).map_err(err)? as f64)
	}

	/// `{ changes, generation }` for the batch undone, or `null`.
	pub fn undo(&mut self) -> String {
		match self.page.undo() {
			Some((c, g)) => format!("{{\"changes\":{},\"generation\":{g}}}", wire::write(&c)),
			None => "null".into(),
		}
	}

	pub fn redo(&mut self) -> String {
		match self.page.redo() {
			Some((c, g)) => format!("{{\"changes\":{},\"generation\":{g}}}", wire::write(&c)),
			None => "null".into(),
		}
	}

	pub fn generation(&self) -> f64 {
		self.page.doc.generation as f64
	}

	/// The document as `.pen` text.
	pub fn text(&self) -> String {
		self.page.doc.to_text()
	}

	/// A new id for an item this session makes.
	#[wasm_bindgen(js_name = newId)]
	pub fn new_id(&mut self) -> String {
		self.page.ids.next(&self.page.doc)
	}

	pub fn pick(&self, x: f64, y: f64, slop: f64) -> String {
		self.page.pick(x, y, slop).to_string()
	}

	pub fn within(&self, x: f64, y: f64, w: f64, h: f64) -> String {
		self.page.within(stage_scene::Rect { x, y, w, h }).to_string()
	}

	pub fn boards(&self) -> String {
		self.page.boards().to_string()
	}

	/// Every top-level item: `[{ id, type, x, y, w, h }]`, its box as laid out.
	pub fn roots(&self) -> String {
		let list: Vec<serde_json::Value> = self
			.page
			.scene
			.roots
			.iter()
			.map(|r| {
				let b = r.placed[0].rect;
				serde_json::json!({ "id": r.id, "type": r.tree.items[0].kind(), "x": b.x, "y": b.y, "w": b.w, "h": b.h })
			})
			.collect();
		serde_json::Value::Array(list).to_string()
	}

	/// The box round everything on the stage, `[x, y, w, h]`.
	pub fn extent(&self) -> String {
		let all = self.page.scene.roots.iter().map(|r| r.extent).reduce(|a, b| a.union(&b)).unwrap_or_default();
		format!("[{},{},{},{}]", all.x, all.y, all.w, all.h)
	}

	/// An item's box on the stage, `[x, y, w, h]`, or `null`.
	#[wasm_bindgen(js_name = boxOf)]
	pub fn box_of(&self, id: &str) -> String {
		for root in &self.page.scene.roots {
			if let Some(i) = root.tree.items.iter().position(|it| it.id == id) {
				let r = root.placed[i].rect;
				return format!("[{},{},{},{}]", r.x, r.y, r.w, r.h);
			}
		}
		"null".into()
	}

	/// A tile's picture from the worker, copied into the page's own texture for it.
	#[wasm_bindgen(js_name = putTile)]
	pub fn put_tile(&mut self, scale: u32, x: i32, y: i32, bitmap: web_sys::ImageBitmap) {
		let Some(gpu) = &mut self.gpu else { return };
		let id = self.page.tile_texture(key(scale, x, y));
		let _ = copy_in(gpu, id, &bitmap, Some((TILE_SIZE, TILE_SIZE)), true);
	}

	/// A tile's pixels from the worker (`WorkerEngine::paintPixels`), RGBA8 premultiplied, rows
	/// `stride` bytes apart, written into the page's own texture for it: what `putTile` does for a
	/// picture, at a tenth of its cost to the page's thread under WebKit.
	#[wasm_bindgen(js_name = putTilePixels)]
	pub fn put_tile_pixels(&mut self, scale: u32, x: i32, y: i32, pixels: &js_sys::Uint8Array, stride: u32) {
		let Some(gpu) = &mut self.gpu else { return };
		if pixels.length() < stride * TILE_SIZE {
			return;
		}
		let id = self.page.tile_texture(key(scale, x, y));
		if gpu.texture_handle(id).is_none_or(|t| t.width() != TILE_SIZE || t.height() != TILE_SIZE) {
			gpu.texture(id, TextureKind::Color, TILE_SIZE, TILE_SIZE, None);
		}
		let texture = gpu.texture_handle(id).expect("just made").clone();
		gpu.write_pixels(pixels, stride, &texture, TILE_SIZE, TILE_SIZE);
	}

	/// A picture by its address (an image fill's `url`, or `board:<id>`). `width` × `height` is its
	/// own size, when the bitmap was made smaller to fit `maxPictureSize`; else the bitmap's.
	/// `later`: the drawing is laid out for it by `layOutPictures`, once for a batch, not now.
	#[wasm_bindgen(js_name = putPicture)]
	pub fn put_picture(&mut self, url: &str, bitmap: web_sys::ImageBitmap, width: Option<u32>, height: Option<u32>, later: Option<bool>) {
		let Some(gpu) = &mut self.gpu else { return };
		let (w, h) = (width.unwrap_or(bitmap.width()), height.unwrap_or(bitmap.height()));
		let id = self.page.pictures.get(url).map(|p| p.0).unwrap_or_else(|| self.page.new_texture());
		if copy_in(gpu, id, &bitmap, None, false) {
			if later.unwrap_or(false) {
				self.page.picture_unlaid(url, id, w, h);
			} else {
				self.page.picture(url, id, w, h);
			}
		}
	}

	/// Lay the drawing out for the pictures put `later` since the last time; false if there were none.
	#[wasm_bindgen(js_name = layOutPictures)]
	pub fn lay_out_pictures(&mut self) -> bool {
		self.page.lay_out_pictures()
	}

	/// Pictures asked for since the last call, to load: `["url", …]`.
	#[wasm_bindgen(js_name = wantedPictures)]
	pub fn wanted_pictures(&self) -> String {
		serde_json::to_string(&self.page.pictures.take_wanted()).unwrap_or_else(|_| "[]".into())
	}

	/// Read cards with the app's own reader: `(source) => JSON of blocks`.
	#[wasm_bindgen(js_name = setMarkdownReader)]
	pub fn set_markdown_reader(&mut self, read: js_sys::Function) {
		self.page.text.set_reader(reader(read));
		self.page.scene.update(&self.page.doc, None, &self.page.text);
	}

	/// The app's typesetter for `$…$` formulas in words and cards.
	#[wasm_bindgen(js_name = setMath)]
	pub fn set_math(&mut self, typeset: js_sys::Function) {
		self.page.text.set_math(typesetter(typeset));
		self.page.scene.update(&self.page.doc, None, &self.page.text);
	}

	/// An icon's shapes, as `parseIcon` gives them, by the key the engine asked for (after `icon:`).
	#[wasm_bindgen(js_name = putIcon)]
	pub fn put_icon(&mut self, key: &str, json: &str) {
		if let Some(shape) = icon_shape(json) {
			self.page.icons.insert(key.to_owned(), shape);
		}
	}

	/// A gesture in progress: `[[id, { dx, dy, w?, h?, radius?, set? }], …]`, or `null` when it ends.
	#[wasm_bindgen(js_name = setPreview)]
	/// Returns what it newly lifted (the arrows it bends, a resized shape's outline), as a JSON list, for the worker to lift.
	pub fn set_preview(&mut self, moving: &str) -> Result<String, JsError> {
		let bent = self.page.preview(previews(moving)).map_err(err)?;
		Ok(serde_json::to_string(&bent).unwrap_or_else(|_| "[]".into()))
	}

	/// What the stage hides, mutes or shows live: `{ hidden, mute, holes, scrolls }`.
	#[wasm_bindgen(js_name = setView)]
	pub fn set_view(&mut self, view: &str) {
		self.page.view = view_state(view);
	}

	/// The stage's boards: `[{ path, x, y, w, h, live, news?, glow? }]`.
	#[wasm_bindgen(js_name = setBoards)]
	pub fn set_boards(&mut self, boards: &str) {
		let list: Vec<serde_json::Value> = serde_json::from_str(boards).unwrap_or_default();
		self.page.boards = list
			.iter()
			.filter_map(|b| {
				let n = |k: &str| b.get(k).and_then(serde_json::Value::as_f64).unwrap_or(0.0);
				let path = b.get("path")?.as_str()?.to_owned();
				Some(crate::engine::BoardPlace {
					picture: format!("board:{path}"),
					path,
					x: n("x"),
					y: n("y"),
					w: n("w"),
					h: n("h"),
					live: b.get("live").and_then(serde_json::Value::as_bool).unwrap_or(false),
					news: b.get("news").and_then(serde_json::Value::as_str).and_then(stage_scene::values::parse_color),
					glow: b.get("glow").and_then(serde_json::Value::as_bool).unwrap_or(false),
				})
			})
			.collect();
	}

	/// Boards a drag carries (`["path", …]`), and how far.
	pub fn carry(&mut self, paths: &str, dx: f64, dy: f64) {
		self.page.carry = (ids(paths).into_iter().collect(), dx, dy);
	}

	/// A number that goes up whenever `pictured` or `carrying` would answer differently.
	#[wasm_bindgen(js_name = boardMarks)]
	pub fn board_marks(&self) -> u32 {
		self.page.marks
	}

	/// Whether `wantedPictures` has anything to say: asked before it, so most frames make no JSON.
	#[wasm_bindgen(js_name = hasWanted)]
	pub fn has_wanted(&self) -> bool {
		!self.page.pictures.wanted.borrow().is_empty()
	}

	/// The boards drawn as their picture in the last frame.
	pub fn pictured(&self) -> String {
		serde_json::to_string(&self.page.pictured).unwrap_or_else(|_| "[]".into())
	}

	/// The live boards a drag carries as their picture, whose pages wait unseen.
	pub fn carrying(&self) -> String {
		serde_json::to_string(&self.page.carrying).unwrap_or_else(|_| "[]".into())
	}

	/// Forget a board's picture (it changed): asked for again when next drawn.
	#[wasm_bindgen(js_name = forgetPicture)]
	pub fn forget_picture(&mut self, url: &str) {
		if let Some((texture, _, _)) = self.page.pictures.held.remove(url) {
			if let Some(gpu) = &mut self.gpu {
				gpu.forget(texture);
			}
		}
	}

	/// Every item as laid out: `[[id, x, y, w, h, parent, order, theme], …]`.
	pub fn layout(&self) -> String {
		self.page.layout_json().to_string()
	}

	/// The layout as it changed since the last call (`Page::layout_changes`): what the page reads after
	/// each change instead of `layout` and `cards` whole.
	#[wasm_bindgen(js_name = layoutChanges)]
	pub fn layout_changes(&mut self) -> String {
		self.page.layout_changes().to_string()
	}

	/// Every item under a stage point, topmost first.
	#[wasm_bindgen(js_name = pickAll)]
	pub fn pick_all(&self, x: f64, y: f64, slop: f64) -> String {
		self.page.pick_all(x, y, slop).to_string()
	}

	/// Each markdown card's links and wide tables.
	pub fn cards(&self) -> String {
		self.page.cards_json().to_string()
	}

	/// The words and faces on the stage, for fonts.
	#[wasm_bindgen(js_name = fontNeeds)]
	pub fn font_needs(&self) -> String {
		self.page.font_needs().to_string()
	}

	/// The words and faces of what was laid out again since the last call (all of it the first time), for fonts.
	#[wasm_bindgen(js_name = fontNeedsChanged)]
	pub fn font_needs_changed(&mut self) -> String {
		self.page.font_needs_changed().to_string()
	}

	/// Lift top-level items for a drag (`["id", …]`): drawn here from now on.
	pub fn lift(&mut self, items: &str) {
		self.page.lift(&ids(items));
	}

	/// The worker's tiles have them again (`["id", …]`): stop drawing them here.
	pub fn landed(&mut self, items: &str) {
		self.page.landed(&ids(items));
	}

	/// The stroke under the pen, `[{ d, filled, color, size, opacity }]`, in stage units; `[]` ends it.
	#[wasm_bindgen(js_name = setInk)]
	pub fn set_ink(&mut self, strokes: &str) {
		let list: Vec<serde_json::Value> = serde_json::from_str(strokes).unwrap_or_default();
		self.page.ink = list
			.iter()
			.filter_map(|v| {
				Some(stage_paint::painter::LiveInk {
					d: v.get("d")?.as_str()?.to_owned(),
					filled: v.get("filled").and_then(|f| f.as_bool()).unwrap_or(false),
					color: stage_scene::values::parse_color(v.get("color").and_then(|c| c.as_str()).unwrap_or("#000"))?,
					size: v.get("size").and_then(|s| s.as_f64()).unwrap_or(2.0) as f32,
					opacity: v.get("opacity").and_then(|s| s.as_f64()).unwrap_or(1.0) as f32,
				})
			})
			.collect();
	}

	/// Draw the screen for a camera, under and over the boards' pages. Call it in the same
	/// animation frame that moves the pages. Returns how many draw operations it made.
	#[allow(clippy::too_many_arguments)]
	/// `zooming`: the zoom is changing, so tiles are wanted at the power of two under it.
	pub fn frame(&mut self, x: f64, y: f64, zoom: f64, dpr: f64, width: f64, height: f64, zooming: bool) -> u32 {
		let Some(gpu) = &mut self.gpu else { return 0 };
		let size = ((width * dpr).round() as u32, (height * dpr).round() as u32);
		if size != self.size {
			gpu.resize(size.0, size.1);
			self.size = size;
		}
		let over = self.page.frame(Camera { x, y, zoom }, dpr, width, height, zooming);
		stage_paint::flush_glyphs(&mut self.page.atlas.borrow_mut(), gpu);
		let n = over.ops.len() as u32;
		gpu.draw(Target::Screen, &over);
		n
	}

	/// Show the lifted items or not, while a ghost of them stands in.
	#[wasm_bindgen(js_name = showLifted)]
	pub fn show_lifted(&mut self, on: bool) {
		self.page.hide_lifted = !on;
	}

	/// Draw only the lifted items over the pages, for a ghost to be copied from the canvas in the
	/// same task; the next `frame` draws everything again.
	#[allow(clippy::too_many_arguments)]
	#[wasm_bindgen(js_name = frameLifted)]
	pub fn frame_lifted(&mut self, x: f64, y: f64, zoom: f64, dpr: f64, width: f64, height: f64) -> u32 {
		self.page.only_lifted = true;
		let n = self.frame(x, y, zoom, dpr, width, height, false);
		self.page.only_lifted = false;
		n
	}

	/// The worker discarded these tiles, `[[scale, x, y], …]`.
	#[wasm_bindgen(js_name = forgetTiles)]
	pub fn forget_tiles(&mut self, keys: &str) {
		let list: Vec<(u32, i32, i32)> = serde_json::from_str(keys).unwrap_or_default();
		let keys: Vec<Key> = list.into_iter().map(|(s, x, y)| key(s, x, y)).collect();
		let gone = self.page.forget_tiles(&keys);
		if let Some(gpu) = &mut self.gpu {
			for t in gone {
				gpu.forget(t);
			}
		}
	}

	/// Tiles let go of past the budget, `[[scale, x, y], …]`, to tell the worker.
	pub fn evict(&mut self) -> String {
		let gone = self.page.evict();
		if let Some(gpu) = &mut self.gpu {
			for (_, t) in &gone {
				gpu.forget(*t);
			}
		}
		let list: Vec<String> = gone.iter().map(|(k, _)| format!("[{},{},{}]", k.scale, k.x, k.y)).collect();
		format!("[{}]", list.join(","))
	}

	#[wasm_bindgen(js_name = tileCount)]
	pub fn tile_count(&self) -> u32 {
		self.page.tiles.len() as u32
	}

	pub fn lost(&self) -> bool {
		self.gpu.as_ref().is_some_and(|g| g.lost())
	}
}

/// This engine's compiled `WebAssembly.Module`, which the page posts to its render worker so the
/// worker instantiates it rather than fetch and compile its own copy.
#[wasm_bindgen(js_name = engineModule)]
pub fn wasm_module() -> JsValue {
	wasm_bindgen::module()
}

#[wasm_bindgen]
pub struct WorkerEngine {
	worker: Worker,
	gpu: Option<Gpu>,
	canvas: Option<web_sys::OffscreenCanvas>,
	/// Buffers tiles are read back into (`paintPixels`), one a tile of a batch, kept between batches.
	read_back: Vec<wgpu::Buffer>,
}

/// The worker's texture it paints a tile into to read it back (`paintPixels`), not the canvas.
const READ_TILE: u32 = 0xE100_0000;
/// The bytes between rows of a tile read back: a multiple of 256, as WebGPU's copies want.
const READ_STRIDE: u32 = (TILE_SIZE * 4).div_ceil(256) * 256;

#[wasm_bindgen]
impl WorkerEngine {
	#[wasm_bindgen(constructor)]
	pub fn new(text: &str, dark: bool) -> Result<WorkerEngine, JsError> {
		Ok(WorkerEngine { worker: Worker::new(text, dark).map_err(err)?, gpu: None, canvas: None, read_back: Vec::new() })
	}

	/// The tile canvas, `TILE` pixels square, and the GPU opened on it.
	#[wasm_bindgen(js_name = setGpu)]
	pub fn set_gpu(&mut self, handle: GpuHandle, canvas: web_sys::OffscreenCanvas) {
		self.gpu = Some(handle.gpu);
		self.canvas = Some(canvas);
	}

	/// The device went away (WebGPU's device lost, WebGL's context lost): the page starts again.
	pub fn lost(&self) -> bool {
		self.gpu.as_ref().is_some_and(|g| g.lost())
	}

	#[wasm_bindgen(js_name = tileSize)]
	pub fn tile_size() -> u32 {
		TILE_SIZE
	}

	/// A font file: the stage is laid out again and its tiles painted again at the next paint, once
	/// for every font, picture and icon that came before it.
	#[wasm_bindgen(js_name = addFont)]
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.worker.add_font(name, bytes, fallback);
	}

	/// The server's edits (`stage.pen.delta` `edits`, as JSON).
	#[wasm_bindgen(js_name = applyEdits)]
	pub fn apply_edits(&mut self, edits: &str) -> Result<(), JsError> {
		self.worker.apply_edits(&parse_edits(edits).map_err(err)?).map_err(err)
	}

	/// The page's batch number `generation`; an error asks for the whole document.
	pub fn apply(&mut self, changes: &str, generation: f64) -> Result<(), JsError> {
		let changes = wire::parse(changes).map_err(err)?;
		self.worker.apply(&changes, generation as u64).map_err(err)
	}

	pub fn reload(&mut self, text: &str, dark: bool) -> Result<(), JsError> {
		self.worker.reload(text, dark).map_err(err)
	}

	/// Paint up to `limit` tiles the view needs: `[{ scale, x, y, bitmap }]`, bitmaps to transfer.
	#[allow(clippy::too_many_arguments)]
	pub fn paint(&mut self, x: f64, y: f64, zoom: f64, dpr: f64, width: f64, height: f64, zooming: bool, limit: u32) -> js_sys::Array {
		let out = js_sys::Array::new();
		let (Some(gpu), Some(canvas)) = (&mut self.gpu, &self.canvas) else { return out };
		// Each tile drawn as soon as its list is built, before the next can replace one of its glyphs.
		let mut sent = Vec::new();
		self.worker.paint(Camera { x, y, zoom }, dpr, width, height, zooming, limit as usize, &mut |key, list, atlas| {
			stage_paint::flush_glyphs(atlas, gpu);
			gpu.draw(Target::Screen, &list);
			let Ok(bitmap) = canvas.transfer_to_image_bitmap() else { return };
			let tile = js_sys::Object::new();
			let set = |k: &str, v: JsValue| js_sys::Reflect::set(&tile, &JsValue::from_str(k), &v).ok();
			set("scale", JsValue::from(key.scale));
			set("x", JsValue::from(key.x));
			set("y", JsValue::from(key.y));
			set("bitmap", bitmap.into());
			out.push(&tile);
			sent.push(key);
		});
		for key in sent {
			self.worker.sent(key);
		}
		out
	}

	/// As `paint`, but each tile is painted into a texture and copied into a buffer to be read:
	/// `[{ scale, x, y, buffer, stride }]`, `buffer` a `GPUBuffer` the caller maps for reading
	/// (`mapAsync`), copies its bytes out of (RGBA8 premultiplied, rows `stride` bytes apart) and
	/// unmaps before the next call, which uses the same buffers again. The page writes the bytes
	/// into its texture (`PageEngine::putTilePixels`) rather than copy a picture, which under
	/// WebKit costs its thread about 2 ms a tile. Empty on WebGL 2, which has no such buffers here.
	#[allow(clippy::too_many_arguments)]
	#[wasm_bindgen(js_name = paintPixels)]
	pub fn paint_pixels(&mut self, x: f64, y: f64, zoom: f64, dpr: f64, width: f64, height: f64, zooming: bool, limit: u32) -> js_sys::Array {
		let out = js_sys::Array::new();
		let Some(gpu) = &mut self.gpu else { return out };
		if gpu.api() != stage_gpu::Api::WebGpu {
			return out;
		}
		if gpu.texture_handle(READ_TILE).is_none() {
			gpu.texture(READ_TILE, TextureKind::Color, TILE_SIZE, TILE_SIZE, None);
		}
		let pool = &mut self.read_back;
		let mut sent = Vec::new();
		self.worker.paint(Camera { x, y, zoom }, dpr, width, height, zooming, limit as usize, &mut |key, list, atlas| {
			stage_paint::flush_glyphs(atlas, gpu);
			gpu.draw(Target::Texture(READ_TILE), &list);
			let n = sent.len();
			if pool.len() <= n {
				pool.push(gpu.device.create_buffer(&wgpu::BufferDescriptor {
					label: Some("tile read back"),
					size: (READ_STRIDE * TILE_SIZE) as u64,
					usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
					mapped_at_creation: false,
				}));
			}
			let Some(buffer) = pool[n].as_webgpu() else { return };
			if !gpu.copy_out(READ_TILE, &pool[n], READ_STRIDE) {
				return;
			}
			let tile = js_sys::Object::new();
			let set = |k: &str, v: &JsValue| js_sys::Reflect::set(&tile, &JsValue::from_str(k), v).ok();
			set("scale", &JsValue::from(key.scale));
			set("x", &JsValue::from(key.x));
			set("y", &JsValue::from(key.y));
			set("buffer", buffer.as_ref());
			set("stride", &JsValue::from(READ_STRIDE));
			out.push(&tile);
			sent.push(key);
		});
		for key in sent {
			self.worker.sent(key);
		}
		out
	}

	/// Tiles the window still needs after the last `paint` (`Worker::view_left`), for measures.
	#[wasm_bindgen(js_name = viewLeft)]
	pub fn view_left(&self, x: f64, y: f64, zoom: f64, dpr: f64, width: f64, height: f64, zooming: bool) -> u32 {
		self.worker.view_left(Camera { x, y, zoom }, dpr, width, height, zooming) as u32
	}

	pub fn lift(&mut self, items: &str) {
		self.worker.lift(&ids(items));
	}

	#[wasm_bindgen(js_name = setView)]
	pub fn set_view(&mut self, view: &str) {
		self.worker.set_view(view_state(view));
	}

	#[wasm_bindgen(js_name = dropItems)]
	pub fn drop_items(&mut self, items: &str) {
		self.worker.drop_items(&ids(items));
	}

	/// Stale tiles at other scales the worker let go of since the last call: `[[scale, x, y], …]`.
	pub fn discarded(&mut self) -> String {
		let list: Vec<String> = self.worker.discarded.drain(..).map(|k| format!("[{},{},{}]", k.scale, k.x, k.y)).collect();
		format!("[{}]", list.join(","))
	}

	/// Items put down whose tiles are all painted again: `["id", …]`.
	pub fn landed(&mut self) -> String {
		serde_json::to_string(&self.worker.landed()).unwrap_or_else(|_| "[]".into())
	}

	/// As the page's: `width` × `height` is the picture's own size when the bitmap was made smaller.
	/// `keep`: the bitmap is left open, to be handed to the page, which copies it too.
	#[wasm_bindgen(js_name = putPicture)]
	pub fn put_picture(&mut self, url: &str, bitmap: web_sys::ImageBitmap, width: Option<u32>, height: Option<u32>, keep: Option<bool>) {
		let Some(gpu) = &mut self.gpu else { return };
		let (w, h) = (width.unwrap_or(bitmap.width()), height.unwrap_or(bitmap.height()));
		let id = self.worker.pictures.get(url).map(|p| p.0).unwrap_or(0x8000_0000 + self.worker.pictures.held.len() as u32);
		if copy_in_keep(gpu, id, &bitmap, None, false, keep.unwrap_or(false)) {
			self.worker.picture(url, id, w, h);
		}
	}

	#[wasm_bindgen(js_name = wantedPictures)]
	pub fn wanted_pictures(&self) -> String {
		serde_json::to_string(&self.worker.pictures.take_wanted()).unwrap_or_else(|_| "[]".into())
	}

	#[wasm_bindgen(js_name = setMarkdownReader)]
	pub fn set_markdown_reader(&mut self, read: js_sys::Function) {
		self.worker.text.set_reader(reader(read));
		let text = self.worker.doc.to_text();
		let dark = self.worker.dark;
		let _ = self.worker.reload(&text, dark);
	}

	#[wasm_bindgen(js_name = setMath)]
	pub fn set_math(&mut self, typeset: js_sys::Function) {
		self.worker.text.set_math(typesetter(typeset));
		let text = self.worker.doc.to_text();
		let dark = self.worker.dark;
		let _ = self.worker.reload(&text, dark);
	}

	#[wasm_bindgen(js_name = putIcon)]
	pub fn put_icon(&mut self, key: &str, json: &str) {
		if let Some(shape) = icon_shape(json) {
			self.worker.icon(key, shape);
		}
	}

	/// The page let go of a tile.
	pub fn dropped(&mut self, scale: u32, x: i32, y: i32) {
		self.worker.dropped(key(scale, x, y));
	}

	/// The scale of the overview's tiles (`overview_scale`), as an `f32`'s bits; 0 for an empty stage.
	#[wasm_bindgen(js_name = overviewScale)]
	pub fn overview_scale(&self) -> u32 {
		self.worker.scene.extent().map_or(0, |e| stage_paint::tiles::overview_scale(&e).to_bits())
	}
}

/// The scale tiles are painted at for a zoom times the screen's density (`tiles::scale_for`), as an
/// `f32`'s bits, so the page knows which tiles the worker's latest camera wants.
#[wasm_bindgen(js_name = scaleFor)]
pub fn scale_for(zoom_times_dpr: f64, zooming: bool) -> u32 {
	stage_paint::tiles::scale_for(zoom_times_dpr, zooming).to_bits()
}

/// Words measured as the page lays them out, for the server: the same text crate, fonts and
/// markdown reader, so a box an agent reads back from an edit is the box the page draws.
#[wasm_bindgen]
pub struct TextMeasure {
	text: stage_text::Text,
}

#[wasm_bindgen]
impl TextMeasure {
	#[wasm_bindgen(constructor)]
	pub fn new() -> TextMeasure {
		TextMeasure { text: stage_text::Text::new() }
	}

	#[wasm_bindgen(js_name = addFont)]
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.text.add_font(name, bytes, fallback);
	}

	#[wasm_bindgen(js_name = setMarkdownReader)]
	pub fn set_markdown_reader(&mut self, read: js_sys::Function) {
		self.text.set_reader(reader(read));
	}

	#[wasm_bindgen(js_name = setMath)]
	pub fn set_math(&mut self, typeset: js_sys::Function) {
		self.text.set_math(typesetter(typeset));
	}

	/// `[w, h]` of words in a style (`{ fontFamily, fontSize, fontWeight, fontStyle, letterSpacing,
	/// lineHeight }`), wrapped at `max_width` when it is not negative. A card's markdown (`markdown`)
	/// is laid out at that width, aligned by `align`, and its height is the card's.
	pub fn measure(&self, text: &str, style: &str, max_width: f64, markdown: bool, align: &str) -> Vec<f64> {
		let v: serde_json::Value = serde_json::from_str(style).unwrap_or_default();
		let num = |k: &str| v.get(k).and_then(serde_json::Value::as_f64);
		let style = stage_scene::layout::TextStyle {
			family: v.get("fontFamily").and_then(serde_json::Value::as_str).unwrap_or("Inter").to_owned(),
			size: num("fontSize").unwrap_or(16.0),
			weight: num("fontWeight").unwrap_or(400.0),
			italic: v.get("fontStyle").and_then(serde_json::Value::as_str) == Some("italic"),
			letter_spacing: num("letterSpacing").unwrap_or(0.0),
			line_height: num("lineHeight"),
		};
		let max = (max_width >= 0.0).then_some(max_width);
		if markdown {
			let width = max.unwrap_or(240.0).max(1.0) as f32;
			let align = match align {
				"center" => stage_text::Align::Center,
				"right" => stage_text::Align::Right,
				"justify" => stage_text::Align::Justify,
				_ => stage_text::Align::Left,
			};
			return vec![width as f64, self.text.card(text, &style, width, align).height as f64];
		}
		let item = stage_scene::tree::Item { id: String::new(), props: Default::default(), parent: None, children: Vec::new(), handle: None };
		let (w, h) = stage_scene::layout::Measure::measure(&self.text, text, &style, max, &item);
		vec![w, h]
	}
}

impl Default for TextMeasure {
	fn default() -> Self {
		Self::new()
	}
}

/// One joined arrow routed by the engine's router (`stage_scene::arrows`), for the server's reroute:
/// its `metadata`, the boxes of what its ends name (`{ name: [x, y, w, h] }`) and its stroke width.
/// Returns the path's fields as JSON, `{ x, y, width, height, geometry }`, or `""` when an end is
/// not among the boxes.
#[wasm_bindgen(js_name = routeArrow)]
pub fn route_arrow(metadata: &str, ends: &str, stroke: f64) -> String {
	let Ok(meta) = serde_json::from_str::<serde_json::Value>(metadata) else { return String::new() };
	let boxes: std::collections::HashMap<String, [f64; 4]> = serde_json::from_str(ends).unwrap_or_default();
	let find = |name: &str| boxes.get(name).map(|b| stage_scene::Rect { x: b[0], y: b[1], w: b[2], h: b[3] });
	let Some(points) = stage_scene::arrows::points(&meta, &find) else { return String::new() };
	let (route, heads) = stage_scene::arrows::style(&meta);
	let s = stage_scene::arrows::shape(&points, stroke, route, heads);
	serde_json::json!({ "x": s.x, "y": s.y, "width": s.width, "height": s.height, "geometry": s.geometry }).to_string()
}

/// The pictures every backend must draw alike (`stage_paint::fixtures`), for
/// `apps/web/scripts/stage-backends.ts` to hold to the native goldens (`crates/gpu/goldens/`) under
/// WebGPU and WebGL 2. Not used by the app.
#[wasm_bindgen]
pub struct Fixtures {
	words: stage_text::Text,
}

#[wasm_bindgen]
impl Fixtures {
	#[wasm_bindgen(constructor)]
	#[allow(clippy::new_without_default)]
	pub fn new() -> Fixtures {
		Fixtures { words: stage_text::Text::new() }
	}

	/// What there is to draw, as JSON: `{"fonts": [[family, file, fallback]], "names": [..],
	/// "stages": [..]}` (fonts from `packages/stage/fonts/`, stages from `crates/gpu/fixtures/`).
	pub fn list() -> String {
		use stage_paint::fixtures::{FONTS, NAMES, STAGES};
		serde_json::json!({ "fonts": FONTS, "names": NAMES, "stages": STAGES }).to_string()
	}

	/// One of the fonts `list` names, under its family.
	#[wasm_bindgen(js_name = addFont)]
	pub fn add_font(&mut self, family: &str, bytes: Vec<u8>, fallback: bool) {
		self.words.add_font(family, bytes, fallback);
	}

	/// Draw fixture `name` (with `pen`, a `.pen` file's text: that stage, the way the worker tiles
	/// it) and lay it on the handle's canvas pixel for pixel, over white. Size the canvas to the
	/// picture first: its golden's size. Its `[width, height]`.
	pub fn show(&self, handle: &mut GpuHandle, name: &str, pen: Option<String>) -> Result<Vec<u32>, JsError> {
		use stage_paint::fixtures;
		let gpu = &mut handle.gpu;
		let size = match pen {
			Some(pen) => fixtures::draw_stage(gpu, &pen, &self.words),
			None => fixtures::draw(gpu, name, &self.words),
		};
		let (w, h) = size.ok_or_else(|| err(format!("no fixture {name:?} (or no fonts for it)")))?;
		gpu.resize(w, h);
		let mut list = stage_paint::DrawList::new(stage_paint::Color([1.0, 1.0, 1.0, 1.0]));
		list.push(stage_paint::Op::Picture { texture: fixtures::OUT, x: 0.0, y: 0.0, w: w as f32, h: h as f32, uv: [0.0, 0.0, 1.0, 1.0], opacity: 1.0 });
		gpu.draw(Target::Screen, &list);
		Ok(vec![w, h])
	}
}
