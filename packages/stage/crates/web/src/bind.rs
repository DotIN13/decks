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
pub async fn open_stage(over: web_sys::HtmlCanvasElement, under: web_sys::HtmlCanvasElement, width: u32, height: u32) -> Result<GpuHandle, JsError> {
	let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
	let top = instance.create_surface(wgpu::SurfaceTarget::Canvas(over)).map_err(err)?;
	let bottom = instance.create_surface(wgpu::SurfaceTarget::Canvas(under)).map_err(err)?;
	let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions { compatible_surface: Some(&top), ..Default::default() }).await.map_err(err)?;
	let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(err)?;
	let mut gpu = Gpu::new(device, queue);
	gpu.set_surface(top, &adapter, width, height);
	gpu.add_surface(bottom, &adapter, width, height);
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

fn icon_shape(json: &str) -> Option<stage_paint::painter::IconShape> {
	serde_json::from_str(json).ok()
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

	/// An icon's shapes, as `parseIcon` gives them, by the key the engine asked for (after `icon:`).
	#[wasm_bindgen(js_name = putIcon)]
	pub fn put_icon(&mut self, key: &str, json: &str) {
		if let Some(shape) = icon_shape(json) {
			self.page.icons.insert(key.to_owned(), shape);
		}
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
	/// animation frame that moves the pages. `live` names the boards whose pages are showing.
	/// Returns how many draw operations it made.
	#[allow(clippy::too_many_arguments)]
	pub fn frame(&mut self, x: f64, y: f64, zoom: f64, dpr: f64, width: f64, height: f64, moving: bool, live: &str) -> u32 {
		let Some(gpu) = &mut self.gpu else { return 0 };
		let size = ((width * dpr).round() as u32, (height * dpr).round() as u32);
		if size != self.size {
			gpu.resize(size.0, size.1);
			self.size = size;
		}
		let live: std::collections::HashSet<String> = ids(live).into_iter().collect();
		let (under, over) = self.page.frame(Camera { x, y, zoom }, dpr, width, height, moving, &live);
		stage_paint::flush_glyphs(&mut self.page.atlas.borrow_mut(), gpu);
		let n = (under.ops.len() + over.ops.len()) as u32;
		gpu.draw(Target::Surface(1), &under);
		gpu.draw(Target::Screen, &over);
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
