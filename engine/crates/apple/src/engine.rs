//! One engine: the browser's `Page` and `Worker`, kept in step, on one Metal device.
//!
//! The browser runs the worker on its own thread and posts tiles to the page. Here both live in
//! one thread on two backends of the same device, and a tile goes from one to the other as the
//! texture it was drawn into (`frame.rs`). Every document change reaches both, in order.

use crate::device::Device;
use serde_json::Value;
use stage_doc::edits::Edit;
use stage_gpu::Gpu;
use stage_paint::painter::IconShape;
use stage_paint::{Backend, TextureKind};
use stage_scene::Rect;
use stage_web::engine::{CardPlace, Page, Worker};

/// Texture numbers the worker's backend gives its tiles and pictures: far from the page's, which
/// count up from 2, and from the glyph and layer textures, which sit near the top.
const WORKER_TEXTURES: u32 = 0x1000_0000;

pub struct Engine {
	pub device: Device,
	pub page: Page,
	pub worker: Worker,
	pub page_gpu: Gpu,
	pub worker_gpu: Gpu,
	next_worker_texture: u32,
	/// What a gesture has lifted and not yet put down (`gesture.rs`).
	pub lifted: crate::gesture::Lifted,
	/// The size the attached layer is configured at, in pixels; none until a layer is attached.
	pub layer_size: Option<(u32, u32)>,
}

impl Engine {
	/// An engine for a drawing (`.pen` text), in a scheme, for an editing session (its ids' prefix).
	pub fn new(pen: &str, dark: bool, session: &str) -> Result<Engine, String> {
		let device = Device::open()?;
		let page_gpu = device.backend();
		let worker_gpu = device.backend();
		let page = Page::new(pen, dark, session)?;
		let worker = Worker::new(pen, dark)?;
		Ok(Engine { device, page, worker, page_gpu, worker_gpu, next_worker_texture: WORKER_TEXTURES, lifted: Default::default(), layer_size: None })
	}

	pub(crate) fn worker_texture(&mut self) -> u32 {
		self.next_worker_texture += 1;
		self.next_worker_texture
	}

	/// The whole drawing again, as the server sent it: the worker starts from it and paints every
	/// tile again, and the page shows the tiles it has until each new one replaces it.
	pub fn set_document(&mut self, pen: &str) -> Result<(), String> {
		self.page.set_document(pen)?;
		self.worker.reload(pen, self.page.scene.dark)?;
		self.lifted.clear();
		Ok(())
	}

	/// The colour scheme: everything laid out and painted again in it.
	pub fn set_dark(&mut self, dark: bool) -> Result<(), String> {
		self.page.set_dark(dark);
		let text = self.page.doc.to_text();
		self.worker.reload(&text, dark)?;
		Ok(())
	}

	/// The server's edits (`stage.pen.delta` edits, as JSON), applied to both.
	pub fn apply_edits(&mut self, json: &str) -> Result<(), String> {
		let edits: Vec<Edit> = parse_edits(json)?;
		self.page.apply_edits(&edits)?;
		self.worker.apply_edits(&edits)?;
		Ok(())
	}

	/// A batch of this session's own changes (`wire.rs` JSON, `mine`) or another session's, applied
	/// to the page and handed to the worker under the page's generation. Returns that generation.
	pub fn apply(&mut self, json: &str, mine: bool) -> Result<u64, String> {
		let changes = stage_web::wire::parse(json)?;
		let generation = self.page.apply(&changes, mine)?;
		if self.worker.apply(&changes, generation).is_err() {
			let text = self.page.doc.to_text();
			self.worker.reload(&text, self.page.scene.dark)?;
		}
		Ok(generation)
	}

	/// A font file, under the family name the drawing uses; `fallback` for the files tried last.
	pub fn add_font(&mut self, family: &str, bytes: Vec<u8>, fallback: bool) {
		self.page.add_font(family, bytes.clone(), fallback);
		self.worker.add_font(family, bytes, fallback);
	}

	/// The canvas's cards, `[{ path, id, x, y, w, h, live, title, kind, corners }]`, as the web
	/// page's `setCards` takes them: each is drawn as its picture, or its paper until one comes.
	pub fn set_cards(&mut self, json: &str) -> Result<(), String> {
		let list: Vec<Value> = serde_json::from_str(json).map_err(|e| format!("cards are not JSON: {e}"))?;
		self.page.titles.borrow_mut().clear();
		self.page.cards = list.iter().filter_map(card_place).collect();
		Ok(())
	}

	/// A picture by address (an image fill's `url`, or `card:<path>`): RGBA8, premultiplied, rows
	/// `stride` bytes apart. Drawn by both the page and the worker from one texture.
	pub fn put_picture_pixels(&mut self, url: &str, rgba: &[u8], width: u32, height: u32, stride: u32) -> Result<(), String> {
		let row = (width * 4) as usize;
		if width == 0 || height == 0 || (stride as usize) < row || rgba.len() < stride as usize * (height as usize - 1) + row {
			return Err(format!("a picture {width}×{height} with rows {stride} bytes apart needs more than {} bytes", rgba.len()));
		}
		let tight: Vec<u8> = (0..height as usize).flat_map(|y| rgba[y * stride as usize..][..row].iter().copied()).collect();
		let id = self.page.new_texture();
		self.page_gpu.texture(id, TextureKind::Color, width, height, Some(&tight));
		let texture = self.page_gpu.texture_handle(id).cloned().ok_or("the picture's texture was not made")?;
		self.hold_picture(url, id, texture, width, height);
		Ok(())
	}

	/// A picture as a Metal texture the host made on this engine's device (`decks_engine_metal_device`).
	///
	/// # Safety
	/// `texture` is a live `MTLTexture` made on this engine's device.
	pub unsafe fn put_picture_texture(&mut self, url: &str, texture: *mut std::ffi::c_void) -> Result<(), String> {
		let texture = unsafe { self.device.wrap(texture) }?;
		let (width, height) = (texture.width(), texture.height());
		let id = self.page.new_texture();
		self.page_gpu.adopt(id, texture.clone());
		self.hold_picture(url, id, texture, width, height);
		Ok(())
	}

	fn hold_picture(&mut self, url: &str, page_id: u32, texture: wgpu::Texture, width: u32, height: u32) {
		let worker_id = self.worker_texture();
		self.worker_gpu.adopt(worker_id, texture);
		self.page.picture(url, page_id, width, height);
		self.worker.picture(url, worker_id, width, height);
		for gone in std::mem::take(&mut self.page.pictures.dropped) {
			self.page_gpu.forget(gone);
		}
	}

	/// An icon's shapes (`parseIcon`'s JSON) under its key, `library|name|weight`.
	pub fn put_icon(&mut self, key: &str, json: &str) -> Result<(), String> {
		let shape: IconShape = serde_json::from_str(json).map_err(|e| format!("icon {key}: {e}"))?;
		self.page.icons.insert(key.to_owned(), shape.clone());
		self.worker.icon(key, shape);
		Ok(())
	}

	/// What the engine met and was not handed: `{ pictures: [url], icons: [key] }`.
	pub fn wanted(&self) -> Value {
		let mut urls = self.page.pictures.take_wanted();
		urls.extend(self.worker.pictures.take_wanted());
		urls.sort();
		urls.dedup();
		let (icons, pictures): (Vec<String>, Vec<String>) = urls.into_iter().partition(|u| u.starts_with("icon:"));
		let icons: Vec<String> = icons.into_iter().map(|u| u["icon:".len()..].to_owned()).filter(|k| !self.page.icons.contains_key(k)).collect();
		serde_json::json!({ "pictures": pictures, "icons": icons })
	}

	/// The topmost item under a stage point, `{ id, path }`, or null.
	pub fn pick(&self, x: f64, y: f64, slop: f64) -> Value {
		self.page.pick(x, y, slop)
	}

	/// Every item under a stage point, topmost first.
	pub fn pick_all(&self, x: f64, y: f64, slop: f64) -> Value {
		self.page.pick_all(x, y, slop)
	}

	/// The ids of the items whose whole box is inside a stage rectangle.
	pub fn within(&self, x: f64, y: f64, w: f64, h: f64) -> Value {
		self.page.within(Rect { x, y, w, h })
	}

	/// Every item as laid out, in paint order: `[id, x, y, w, h, parent, order, theme]`.
	pub fn layout(&self) -> Value {
		self.page.layout_json()
	}

	/// The words on the drawing and the faces they are set in, for the host's font list.
	pub fn font_needs(&self) -> Value {
		self.page.font_needs()
	}

	/// The drawing's extent, `[x, y, w, h]` in stage units, or null when it is empty.
	pub fn extent(&self) -> Value {
		self.page.scene.extent().map_or(Value::Null, |r| serde_json::json!([r.x, r.y, r.w, r.h]))
	}
}

fn parse_edits(json: &str) -> Result<Vec<Edit>, String> {
	let list: Vec<Value> = serde_json::from_str(json).map_err(|e| format!("edits are not JSON: {e}"))?;
	list.iter().map(Edit::from_json).collect()
}

/// A card's place as the web page's `setCards` reads it (`stage-web`'s `bind.rs`).
fn card_place(b: &Value) -> Option<CardPlace> {
	let n = |k: &str| b.get(k).and_then(Value::as_f64).unwrap_or(0.0);
	let s = |k: &str| b.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
	let path = b.get("path")?.as_str()?.to_owned();
	let corners = b.get("corners").and_then(Value::as_array).filter(|l| l.len() == 4).map(|l| {
		let at = |i: usize| l[i].as_f64().unwrap_or(12.0).max(0.0) as f32;
		[at(0), at(1), at(2), at(3)]
	});
	Some(CardPlace {
		picture: format!("card:{path}"),
		id: s("id"),
		path,
		x: n("x"),
		y: n("y"),
		w: n("w"),
		h: n("h"),
		live: b.get("live").and_then(Value::as_bool).unwrap_or(false),
		news: b.get("news").and_then(Value::as_str).and_then(stage_scene::values::parse_color),
		glow: b.get("glow").and_then(Value::as_bool).unwrap_or(false),
		title: s("title"),
		kind: s("kind"),
		status: s("status"),
		corners,
	})
}
