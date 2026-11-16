//! The worker's engine for JavaScript: the render worker paints tiles with it and posts them to
//! the page, as pictures or as their pixels.

use super::*;

#[wasm_bindgen]
pub struct WorkerEngine {
	worker: Worker,
	gpu: Option<Gpu>,
	canvas: Option<web_sys::OffscreenCanvas>,
	/// Buffers tiles are read back into (`paintPixels`), one a tile of a batch, kept between batches.
	read_back: Vec<wgpu::Buffer>,
}

/// The worker's texture it paints a tile into to read it back (`paintPixels`), not the canvas.
pub(crate) const READ_TILE: u32 = 0xE100_0000;

/// The bytes between rows of a tile read back: a multiple of 256, as WebGPU's copies want.
pub(crate) const READ_STRIDE: u32 = (TILE_SIZE * 4).div_ceil(256) * 256;

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

	/// Make now, in idle time, what painting would otherwise make the first time it needs it
	/// (`Gpu::warm`): every pipeline, a multisampled tile and a layer tile, the glyph textures, and
	/// the tile it paints into to read back (`paintPixels`) where it can.
	pub fn warm(&mut self) {
		let Some(gpu) = &mut self.gpu else { return };
		gpu.warm(true);
		stage_paint::flush_glyphs(&mut self.worker.atlas.borrow_mut(), gpu);
		if gpu.api() == stage_gpu::Api::WebGpu && gpu.texture_handle(READ_TILE).is_none() {
			gpu.texture(READ_TILE, TextureKind::Color, TILE_SIZE, TILE_SIZE, None);
		}
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

	// The document, by the page's numbered batches.
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

	// Painting tiles, and the ones let go of.
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

	/// Stale tiles at other scales the worker let go of since the last call: `[[scale, x, y], …]`.
	pub fn discarded(&mut self) -> String {
		let list: Vec<String> = self.worker.discarded.drain(..).map(|k| format!("[{},{},{}]", k.scale, k.x, k.y)).collect();
		format!("[{}]", list.join(","))
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

	// What the page lifts, hides and puts down.
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

	/// Items put down whose tiles are all painted again: `["id", …]`.
	pub fn landed(&mut self) -> String {
		serde_json::to_string(&self.worker.landed()).unwrap_or_else(|_| "[]".into())
	}
}

/// The scale tiles are painted at for a zoom times the screen's density (`tiles::scale_for`), as an
/// `f32`'s bits, so the page knows which tiles the worker's latest camera wants.
#[wasm_bindgen(js_name = scaleFor)]
pub fn scale_for(zoom_times_dpr: f64, zooming: bool) -> u32 {
	stage_paint::tiles::scale_for(zoom_times_dpr, zooming).to_bits()
}
