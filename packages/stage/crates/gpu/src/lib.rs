//! The first backend: wgpu, on WebGPU or WebGL 2 in the browser (and on Metal when the tests run on
//! a Mac).
//!
//! It implements [`Backend`]: it turns a draw list into render passes and knows nothing of the
//! document. Shapes are instanced quads whose edges the shader works out exactly; meshes are the
//! painter's triangles, smoothed by four samples a pixel (one on a device short of them). Layers are drawn into a texture of their
//! own and laid down at their opacity. Paints and clips go up as one small table texture.
//! Batching, the table and the shader are stage-render's; this crate runs them on wgpu.
//!
//! - [`exec`]: the pipelines, what is kept on the device between frames, and running one draw: the
//!   same on every wgpu target.
//! - [`targets`]: opening a device on each target (WebGPU or WebGL 2 in a browser, Metal for the
//!   tests).
//! - this file: [`Gpu`], the stage's textures and screen surfaces, as a [`Backend`].

pub mod exec;
pub mod targets;

use exec::draw::{self, Out};
use exec::pipelines::Pipelines;
use exec::resources::{Resources, Tex};
use stage_paint::list::{DrawList, Op};
use stage_paint::{Backend, DeviceLimits, Target, TextureKind};
use stage_render::batch::{Built, LAYER_IDS};
use stage_render::Limits;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(not(target_arch = "wasm32"))]
pub use targets::native::{headless, headless_sampled, headless_with};

/// Samples a pixel in every pass, where the device allows them.
pub const SAMPLES: u32 = 4;

/// The graphics API a [`Gpu`]'s device is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Api {
	WebGpu,
	WebGl2,
	/// This machine's own (Metal), for tests.
	Native,
}

impl Api {
	/// The name the page reads: `"webgpu"`, `"webgl2"` or `"native"`.
	pub fn name(self) -> &'static str {
		match self {
			Api::WebGpu => "webgpu",
			Api::WebGl2 => "webgl2",
			Api::Native => "native",
		}
	}
}

pub struct Gpu {
	pub device: wgpu::Device,
	pub queue: wgpu::Queue,
	surfaces: Vec<(wgpu::Surface<'static>, wgpu::SurfaceConfiguration)>,
	textures: HashMap<u32, Tex>,
	/// Textures let go of and kept to be used again (`forget_to_spare`), by size and kind, at most `spare_cap` of each.
	spare_textures: HashMap<(u32, u32, u8), Vec<Tex>>,
	spare_cap: usize,
	pipelines: Pipelines,
	resources: Resources,
	lost: Arc<AtomicBool>,
	next_layer: u32,
	limits: Limits,
	api: Api,
	/// How pictures go into textures under WebGL 2.
	#[cfg(all(target_arch = "wasm32", feature = "webgl"))]
	webgl: targets::webgl::Uploads,
}

impl Gpu {
	/// A backend on a device this machine opened, drawing with four samples a pixel: the tests'.
	pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Gpu {
		Gpu::on(device, queue, Api::Native, SAMPLES)
	}

	/// A backend on a device a target opened (the page's, the worker's, the tests'), on `api`,
	/// drawing with `samples` samples a pixel (4 or 1).
	pub fn on(device: wgpu::Device, queue: wgpu::Queue, api: Api, samples: u32) -> Gpu {
		let lost = Arc::new(AtomicBool::new(false));
		let flag = lost.clone();
		device.set_device_lost_callback(move |_, _| flag.store(true, Ordering::SeqCst));
		let limits = Limits { max_texture: device.limits().max_texture_dimension_2d, max_samples: samples, table_width: stage_render::limits::TABLE_WIDTH };
		let pipelines = Pipelines::new(&device, limits.max_samples);
		let resources = Resources::new(&device, &queue, &pipelines);
		Gpu {
			device,
			queue,
			surfaces: Vec::new(),
			textures: HashMap::new(),
			spare_textures: HashMap::new(),
			spare_cap: 0,
			pipelines,
			resources,
			lost,
			next_layer: LAYER_IDS,
			limits,
			api,
			#[cfg(all(target_arch = "wasm32", feature = "webgl"))]
			webgl: Default::default(),
		}
	}

	/// The graphics API this backend's device is on.
	pub fn api(&self) -> Api {
		self.api
	}

	/// Mark the device gone from outside wgpu (a WebGL context lost): `lost()` says so from now on.
	pub fn lost_flag(&self) -> Arc<AtomicBool> {
		self.lost.clone()
	}

	fn make_texture(&self, kind: TextureKind, width: u32, height: u32) -> Tex {
		Tex::new(&self.device, &self.pipelines.picture_layout, kind, width, height)
	}

	/// A texture the caller made elsewhere (a picture copied from an `ImageBitmap`), under our id.
	pub fn adopt(&mut self, id: u32, texture: wgpu::Texture) {
		let tex = Tex::wrap(&self.device, &self.pipelines.picture_layout, texture, TextureKind::Color);
		self.textures.insert(id, tex);
	}

	/// Make now what a draw would otherwise make the first time it needs it, so that time is not
	/// taken in the middle of a gesture: the pipelines for every colour format drawn into here (the
	/// screen's, layers' and read-back tiles' RGBA8) at one sample a pixel and at the most (a draw
	/// with triangles: paper, ink, lifted items), and for `msaa`, a screen-sized multisampled texture
	/// and one layer texture of that size (the worker's tile, 512 pixels square; the page's window
	/// is too big to hold one for a draw that may never come). Compiling a pipeline holds the GPU
	/// process's one thread, frames included.
	pub fn warm(&mut self, msaa: bool) {
		let mut formats = vec![wgpu::TextureFormat::Rgba8Unorm];
		for (_, config) in &self.surfaces {
			if !formats.contains(&config.format) {
				formats.push(config.format);
			}
		}
		let most = self.pipelines.samples;
		for format in &formats {
			for samples in [1, most] {
				self.pipelines.prepare(&self.device, *format, samples);
			}
		}
		if let (true, Some((_, config))) = (msaa, self.surfaces.first()) {
			let (width, height, format) = (config.width, config.height, config.format);
			if most > 1 {
				for f in [format, wgpu::TextureFormat::Rgba8Unorm] {
					self.resources.msaa(&self.device, most, width, height, f, 0);
				}
			}
			self.resources.lend_layers(&self.device, &self.pipelines, &[(u32::MAX, width, height)], width, height);
			self.resources.return_layers();
		}
	}

	/// Let a texture go, but keep it among the spares of its size and kind (`texture_from_spare`):
	/// the page's tiles, made and let go of by the dozen in a zoom.
	pub fn forget_to_spare(&mut self, id: u32) {
		if let Some(tex) = self.textures.remove(&id) {
			let spare = self.spare_textures.entry((tex.width, tex.height, tex.kind as u8)).or_default();
			if spare.len() < self.spare_cap {
				spare.push(tex);
			}
		}
	}

	/// A `width` × `height` texture under `id` from the spares (`forget_to_spare`), or a new one;
	/// what a spare held is still in it, for a caller that writes it whole.
	pub fn texture_from_spare(&mut self, id: u32, kind: TextureKind, width: u32, height: u32) {
		let spare = self.spare_textures.get_mut(&(width, height, kind as u8)).and_then(Vec::pop);
		let tex = match spare {
			Some(tex) => tex,
			None => self.make_texture(kind, width, height),
		};
		self.textures.insert(id, tex);
	}

	/// Hold up to `count` spare textures of a size and kind, made now (`warm`), and keep no more
	/// than that many from then on.
	pub fn make_spares(&mut self, kind: TextureKind, width: u32, height: u32, count: usize) {
		self.spare_cap = count;
		let have = self.spare_textures.get(&(width, height, kind as u8)).map_or(0, Vec::len);
		for _ in have..count {
			let tex = self.make_texture(kind, width, height);
			self.spare_textures.entry((width, height, kind as u8)).or_default().push(tex);
		}
	}

	pub fn texture_handle(&self, id: u32) -> Option<&wgpu::Texture> {
		self.textures.get(&id).map(|t| &t.texture)
	}

	/// A texture's pixels, RGBA8 premultiplied, rows tight: for tests and pictures of tiles.
	#[cfg(not(target_arch = "wasm32"))]
	pub fn read(&self, id: u32) -> Option<Vec<u8>> {
		let tex = self.textures.get(&id)?;
		let bytes = if tex.kind == TextureKind::Mask { 1 } else { 4 };
		let row = (tex.width * bytes).div_ceil(256) * 256;
		let buffer = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("read"), size: (row * tex.height) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
		let mut encoder = self.device.create_command_encoder(&Default::default());
		encoder.copy_texture_to_buffer(
			tex.texture.as_image_copy(),
			wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(tex.height) } },
			wgpu::Extent3d { width: tex.width, height: tex.height, depth_or_array_layers: 1 },
		);
		self.queue.submit([encoder.finish()]);
		let slice = buffer.slice(..);
		slice.map_async(wgpu::MapMode::Read, |_| {});
		self.device.poll(wgpu::PollType::wait_indefinitely()).ok()?;
		let data = slice.get_mapped_range().ok()?;
		let mut out = Vec::with_capacity((tex.width * tex.height * bytes) as usize);
		for y in 0..tex.height {
			let start = (y * row) as usize;
			out.extend_from_slice(&data[start..start + (tex.width * bytes) as usize]);
		}
		Some(out)
	}
}

impl Backend for Gpu {
	fn limits(&self) -> DeviceLimits {
		DeviceLimits { max_texture: self.limits.max_texture, samples: self.limits.max_samples }
	}

	fn texture(&mut self, id: u32, kind: TextureKind, width: u32, height: u32, pixels: Option<&[u8]>) {
		let tex = self.make_texture(kind, width, height);
		if let Some(pixels) = pixels {
			let bytes = if kind == TextureKind::Mask { 1 } else { 4 };
			self.queue.write_texture(
				tex.texture.as_image_copy(),
				pixels,
				wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(tex.width * bytes), rows_per_image: Some(tex.height) },
				wgpu::Extent3d { width: tex.width, height: tex.height, depth_or_array_layers: 1 },
			);
		}
		self.textures.insert(id, tex);
	}

	fn write(&mut self, id: u32, x: u32, y: u32, width: u32, height: u32, pixels: &[u8]) {
		let Some(tex) = self.textures.get(&id) else { return };
		let bytes = if tex.kind == TextureKind::Mask { 1 } else { 4 };
		self.queue.write_texture(
			wgpu::TexelCopyTextureInfo { texture: &tex.texture, mip_level: 0, origin: wgpu::Origin3d { x, y, z: 0 }, aspect: wgpu::TextureAspect::All },
			pixels,
			wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * bytes), rows_per_image: Some(height) },
			wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
		);
	}

	fn forget(&mut self, id: u32) {
		self.textures.remove(&id);
	}

	fn resize(&mut self, width: u32, height: u32) {
		// What was kept for drawing at the old screen size is not needed at the new one.
		if let Some((_, old)) = self.surfaces.first()
			&& (old.width, old.height) != (width.max(1), height.max(1))
		{
			self.resources.forget_size(old.width, old.height);
		}
		for (surface, config) in self.surfaces.iter_mut() {
			config.width = width.max(1);
			config.height = height.max(1);
			surface.configure(&self.device, config);
		}
	}

	fn draw(&mut self, target: Target, list: &DrawList) {
		// The target: a texture of ours, or the surface's next frame.
		let (frame, view, width, height, format) = match target {
			Target::Texture(id) => {
				let Some(tex) = self.textures.get(&id) else { return };
				(None, tex.view.clone(), tex.width, tex.height, wgpu::TextureFormat::Rgba8Unorm)
			}
			Target::Screen | Target::Surface(_) => {
				let index = if let Target::Surface(i) = target { i as usize } else { 0 };
				let Some((surface, config)) = self.surfaces.get(index) else { return };
				let frame = match surface.get_current_texture() {
					wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
					_ => return,
				};
				let view = frame.texture.create_view(&Default::default());
				(Some(frame), view, config.width, config.height, config.format)
			}
		};
		let sizes: HashMap<u32, (u32, u32)> = list
			.ops
			.iter()
			.filter_map(|op| if let Op::Glyphs { texture, .. } = op { self.textures.get(texture).map(|t| (*texture, (t.width, t.height))) } else { None })
			.collect();
		let built = Built::build(list, &mut self.next_layer, &sizes, width, height, self.limits.max_texture);
		draw::run(&self.device, &self.queue, &mut self.pipelines, &mut self.resources, &self.limits, &self.textures, &built, Out { view: &view, width, height, format });
		if let Some(frame) = frame {
			self.queue.present(frame);
		}
	}

	fn lost(&self) -> bool {
		self.lost.load(Ordering::SeqCst)
	}
}

#[cfg(test)]
mod tests;
