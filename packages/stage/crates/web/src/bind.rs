//! The calls JavaScript makes: `PageEngine` on the page, `WorkerEngine` in the render worker, and
//! opening WebGPU on a canvas for either. Changes cross as JSON text; tiles as `ImageBitmap`s.

use crate::engine::{Camera, Page, TILE_SIZE, Worker};
use crate::wire;
use stage_gpu::Gpu;
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

/// WebGPU, opened on a canvas: the page's own, or the worker's offscreen one.
#[wasm_bindgen]
pub struct GpuHandle {
	gpu: Gpu,
}

async fn open(target: wgpu::SurfaceTarget<'static>, width: u32, height: u32) -> Result<GpuHandle, JsError> {
	let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
	let surface = instance.create_surface(target).map_err(err)?;
	let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions { compatible_surface: Some(&surface), ..Default::default() }).await.map_err(err)?;
	let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(err)?;
	let mut gpu = Gpu::new(device, queue);
	gpu.set_surface(surface, &adapter, width, height);
	Ok(GpuHandle { gpu })
}

/// The page's two canvases on one device: `over` the boards' pages (the drawing, the screen's first
/// surface) and `under` them (board pictures).
#[wasm_bindgen(js_name = openStage)]
pub async fn open_stage(canvas: web_sys::HtmlCanvasElement, width: u32, height: u32) -> Result<GpuHandle, JsError> {
	let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
	let top = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas)).map_err(err)?;
	let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions { compatible_surface: Some(&top), ..Default::default() }).await.map_err(err)?;
	let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(err)?;
	let mut gpu = Gpu::new(device, queue);
	gpu.set_surface(top, &adapter, width, height);
	Ok(GpuHandle { gpu })
}

/// Copy a picture into texture `id`, made the picture's size, and let the picture go.
fn copy_in(gpu: &mut Gpu, id: u32, bitmap: &web_sys::ImageBitmap, size: Option<(u32, u32)>) {
	let (w, h) = size.unwrap_or((bitmap.width().max(1), bitmap.height().max(1)));
	if gpu.texture_handle(id).is_none_or(|t| t.width() != w || t.height() != h) {
		gpu.texture(id, TextureKind::Color, w, h, None);
	}
	let texture = gpu.texture_handle(id).expect("just made").clone();
	gpu.queue.copy_external_image_to_texture(
		&wgpu::CopyExternalImageSourceInfo { source: wgpu::ExternalImageSource::ImageBitmap(bitmap.clone()), origin: wgpu::Origin2d::ZERO, flip_y: false },
		wgpu::CopyExternalImageDestInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All, color_space: wgpu::PredefinedColorSpace::Srgb, premultiplied_alpha: true },
		wgpu::Extent3d { width: bitmap.width().min(w), height: bitmap.height().min(h), depth_or_array_layers: 1 },
	);
	bitmap.close();
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

#[wasm_bindgen(js_name = openCanvas)]
pub async fn open_canvas(canvas: web_sys::HtmlCanvasElement, width: u32, height: u32) -> Result<GpuHandle, JsError> {
	open(wgpu::SurfaceTarget::Canvas(canvas), width, height).await
}

#[wasm_bindgen(js_name = openOffscreen)]
pub async fn open_offscreen(canvas: web_sys::OffscreenCanvas, width: u32, height: u32) -> Result<GpuHandle, JsError> {
	open(wgpu::SurfaceTarget::OffscreenCanvas(canvas), width, height).await
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

	/// A font file, under the name the app's chains use; `fallback` for the files tried last.
	#[wasm_bindgen(js_name = addFont)]
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.page.add_font(name, bytes, fallback);
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
		copy_in(gpu, id, &bitmap, Some((TILE_SIZE, TILE_SIZE)));
	}

	/// A picture by its address (an image fill's `url`, or `board:<id>`).
	#[wasm_bindgen(js_name = putPicture)]
	pub fn put_picture(&mut self, url: &str, bitmap: web_sys::ImageBitmap) {
		let Some(gpu) = &mut self.gpu else { return };
		let (w, h) = (bitmap.width(), bitmap.height());
		let id = self.page.pictures.get(url).map(|p| p.0).unwrap_or_else(|| self.page.new_texture());
		copy_in(gpu, id, &bitmap, None);
		self.page.picture(url, id, w, h);
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
	/// Returns the arrows it bends that were not lifted before, as a JSON list, for the worker to lift.
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
				Some(crate::engine::BoardPlace {
					path: b.get("path")?.as_str()?.to_owned(),
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
	pub fn frame(&mut self, x: f64, y: f64, zoom: f64, dpr: f64, width: f64, height: f64, moving: bool) -> u32 {
		let Some(gpu) = &mut self.gpu else { return 0 };
		let size = ((width * dpr).round() as u32, (height * dpr).round() as u32);
		if size != self.size {
			gpu.resize(size.0, size.1);
			self.size = size;
		}
		let over = self.page.frame(Camera { x, y, zoom }, dpr, width, height, moving);
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

#[wasm_bindgen]
pub struct WorkerEngine {
	worker: Worker,
	gpu: Option<Gpu>,
	canvas: Option<web_sys::OffscreenCanvas>,
}

#[wasm_bindgen]
impl WorkerEngine {
	#[wasm_bindgen(constructor)]
	pub fn new(text: &str, dark: bool) -> Result<WorkerEngine, JsError> {
		Ok(WorkerEngine { worker: Worker::new(text, dark).map_err(err)?, gpu: None, canvas: None })
	}

	/// The tile canvas, `TILE` pixels square, and WebGPU opened on it.
	#[wasm_bindgen(js_name = setGpu)]
	pub fn set_gpu(&mut self, handle: GpuHandle, canvas: web_sys::OffscreenCanvas) {
		self.gpu = Some(handle.gpu);
		self.canvas = Some(canvas);
	}

	#[wasm_bindgen(js_name = tileSize)]
	pub fn tile_size() -> u32 {
		TILE_SIZE
	}

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
	pub fn paint(&mut self, x: f64, y: f64, zoom: f64, dpr: f64, width: f64, height: f64, moving: bool, limit: u32) -> js_sys::Array {
		let out = js_sys::Array::new();
		let (Some(gpu), Some(canvas)) = (&mut self.gpu, &self.canvas) else { return out };
		for (key, list) in self.worker.next(Camera { x, y, zoom }, dpr, width, height, moving, limit as usize) {
			stage_paint::flush_glyphs(&mut self.worker.atlas.borrow_mut(), gpu);
			gpu.draw(Target::Screen, &list);
			let Ok(bitmap) = canvas.transfer_to_image_bitmap() else { break };
			let tile = js_sys::Object::new();
			let set = |k: &str, v: JsValue| js_sys::Reflect::set(&tile, &JsValue::from_str(k), &v).ok();
			set("scale", JsValue::from(key.scale));
			set("x", JsValue::from(key.x));
			set("y", JsValue::from(key.y));
			set("bitmap", bitmap.into());
			out.push(&tile);
			self.worker.sent(key);
		}
		out
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

	#[wasm_bindgen(js_name = putPicture)]
	pub fn put_picture(&mut self, url: &str, bitmap: web_sys::ImageBitmap) {
		let Some(gpu) = &mut self.gpu else { return };
		let (w, h) = (bitmap.width(), bitmap.height());
		let id = self.worker.pictures.get(url).map(|p| p.0).unwrap_or(0x8000_0000 + self.worker.pictures.held.len() as u32);
		copy_in(gpu, id, &bitmap, None);
		self.worker.picture(url, id, w, h);
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
