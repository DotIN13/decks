//! A frame: the loop the browser's script runs between its page and its worker, in one thread.
//!
//! The worker paints the tiles a camera needs, each into a texture of its own; the page takes that
//! texture as its tile (no copy: both backends are on one device); tiles the worker let go of and
//! tiles past the page's budget are let go of on both sides; then the page draws the frame.

use crate::engine::Engine;
use stage_paint::list::DrawList;
use stage_paint::tiles::{Key, TILE};
use stage_paint::{Backend, Target, TextureKind, flush_glyphs};
use stage_web::engine::Camera;

/// Where the stage is looking: the browser's camera, the screen's size in points and its pixels a point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
	pub x: f64,
	pub y: f64,
	pub zoom: f64,
	pub scale: f64,
	pub width: f64,
	pub height: f64,
}

impl View {
	fn camera(&self) -> Camera {
		Camera { x: self.x, y: self.y, zoom: self.zoom }
	}

	/// The size of the picture of this view, in pixels.
	pub fn pixels(&self) -> (u32, u32) {
		((self.width * self.scale).round().max(1.0) as u32, (self.height * self.scale).round().max(1.0) as u32)
	}

	/// The scale its tiles are painted at, as the page's `want` takes it (an `f32`'s bits).
	fn want(&self) -> u32 {
		stage_paint::tiles::scale_for(self.zoom * self.scale, false).to_bits()
	}
}

/// The texture number a host's texture is drawn into under, on the page's backend.
const HOST_TARGET: u32 = 0xD000_0001;
/// The texture number the worker paints each tile into before the page takes it.
const TILE_SCRATCH: u32 = 0x0FFF_FFFF;
/// The texture number of a picture read back (`pixels`).
const READ_TARGET: u32 = 0xD000_0002;
/// The most tiles painted in one frame on a layer: the rest come in the next frames.
pub const TILES_A_FRAME: usize = 8;
/// The most rounds `draw_settled` paints for before drawing whatever it has.
const MOST_ROUNDS: usize = 64;

impl Engine {
	/// Paint up to `limit` tiles this view needs and hand them to the page. Returns how many tiles
	/// the window itself still needs: 0 when what it shows is painted from the drawing as it is.
	pub fn paint(&mut self, view: &View, limit: usize) -> usize {
		let mut painted: Vec<(Key, wgpu::Texture)> = Vec::new();
		let gpu = &mut self.worker_gpu;
		// Each tile into a new texture under one number, handed on, and the number let go of.
		self.worker.paint(view.camera(), view.scale, view.width, view.height, false, limit, &mut |key, list, atlas| {
			gpu.texture(TILE_SCRATCH, TextureKind::Color, TILE, TILE, None);
			flush_glyphs(atlas, gpu);
			gpu.draw(Target::Texture(TILE_SCRATCH), &list);
			if let Some(texture) = gpu.texture_handle(TILE_SCRATCH).cloned() {
				painted.push((key, texture));
			}
			gpu.forget(TILE_SCRATCH);
		});
		for (key, texture) in painted {
			let id = self.page.tile_texture(key);
			self.page_gpu.adopt(id, texture);
			self.worker.sent(key);
		}
		self.let_go();
		self.worker.view_left(view.camera(), view.scale, view.width, view.height, false)
	}

	/// Tiles the worker discarded, and tiles past the page's budget, let go of on both sides.
	fn let_go(&mut self) {
		let discarded = std::mem::take(&mut self.worker.discarded);
		for texture in self.page.forget_tiles(&discarded) {
			self.page_gpu.forget(texture);
		}
		for (key, texture) in self.page.evict() {
			self.page_gpu.forget(texture);
			self.worker.dropped(key);
		}
		for gone in std::mem::take(&mut self.page.pictures.dropped) {
			self.page_gpu.forget(gone);
		}
	}

	/// What the page draws for this view, its glyphs on its backend first.
	fn compose(&mut self, view: &View) -> DrawList {
		let list = self.page.frame(view.camera(), view.scale, view.width, view.height, view.want());
		flush_glyphs(&mut self.page.atlas.borrow_mut(), &mut self.page_gpu);
		list
	}

	/// Attach the host's `CAMetalLayer`, `width` × `height` pixels: frames are drawn into it.
	///
	/// # Safety
	/// `layer` is a live `CAMetalLayer` that outlives this engine or the next attach.
	pub unsafe fn attach_layer(&mut self, layer: *mut std::ffi::c_void, width: u32, height: u32) -> Result<(), String> {
		let surface = unsafe { self.device.surface(layer) }?;
		self.page_gpu.set_surface(surface, &self.device.adapter, width, height);
		self.layer_size = Some((width.max(1), height.max(1)));
		Ok(())
	}

	/// One frame on the attached layer: a few tiles painted, then the screen drawn. Returns how
	/// many tiles the window still needs; above 0, the host draws another frame soon.
	pub fn frame(&mut self, view: &View) -> Result<usize, String> {
		let Some(size) = self.layer_size else { return Err("no layer is attached".into()) };
		let pixels = view.pixels();
		if pixels != size {
			self.page_gpu.resize(pixels.0, pixels.1);
			self.layer_size = Some(pixels);
		}
		let left = self.paint(view, TILES_A_FRAME);
		let list = self.compose(view);
		self.page_gpu.draw(Target::Screen, &list);
		Ok(left)
	}

	/// Paint until the window needs no more tiles, then draw it into texture `id` of the page's backend.
	fn draw_settled(&mut self, view: &View, id: u32) {
		for _ in 0..MOST_ROUNDS {
			if self.paint(view, 64) == 0 {
				break;
			}
		}
		let list = self.compose(view);
		self.page_gpu.draw(Target::Texture(id), &list);
	}

	/// The view drawn whole into the host's `MTLTexture`, and finished on the device, so the host
	/// can read it at once. Its size is the texture's; `view.width` and `height` should match it.
	///
	/// # Safety
	/// `texture` is a live `MTLTexture` made on this engine's device.
	pub unsafe fn draw_into(&mut self, texture: *mut std::ffi::c_void, view: &View) -> Result<(), String> {
		let texture = unsafe { self.device.wrap(texture) }?;
		self.page_gpu.adopt(HOST_TARGET, texture);
		self.draw_settled(view, HOST_TARGET);
		self.page_gpu.forget(HOST_TARGET);
		self.device.finish();
		Ok(())
	}

	/// The view drawn whole into a texture of the engine's own and finished on the device, with no
	/// read-back: what a frame on a layer costs, for measures.
	pub fn draw_and_wait(&mut self, view: &View) {
		let (w, h) = view.pixels();
		self.page_gpu.texture(READ_TARGET, TextureKind::Color, w, h, None);
		self.draw_settled(view, READ_TARGET);
		self.device.finish();
		self.page_gpu.forget(READ_TARGET);
	}

	/// The view drawn whole and read back: RGBA8 premultiplied, rows tight, on transparent.
	pub fn pixels(&mut self, view: &View) -> Result<(Vec<u8>, u32, u32), String> {
		let (w, h) = view.pixels();
		let most = self.page_gpu.limits().max_texture;
		if w > most || h > most {
			return Err(format!("a picture {w}×{h} is bigger than this device draws ({most})"));
		}
		self.page_gpu.texture(READ_TARGET, TextureKind::Color, w, h, None);
		self.draw_settled(view, READ_TARGET);
		let rgba = self.page_gpu.read(READ_TARGET).ok_or("the picture could not be read back")?;
		self.page_gpu.forget(READ_TARGET);
		Ok((rgba, w, h))
	}
}
