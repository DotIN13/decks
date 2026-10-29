//! Where a [`Gpu`] gets its device and what it draws to the screen through. Each target opens a wgpu
//! device its own way and hands it to [`Gpu::new`]; drawing is the same on all of them.
//!
//! - [`webgpu`]: a browser canvas or `OffscreenCanvas`, through WebGPU.
//! - [`webgl`]: the same, through WebGL 2, where there is no WebGPU (with the `webgl` feature).
//! - [`native`]: this machine's graphics card (Metal), with no window: for tests.
//!
//! Screen surfaces, which a browser target configures, are set up here for all of them.

#[cfg(not(target_arch = "wasm32"))]
pub mod native;
#[cfg(all(target_arch = "wasm32", feature = "webgl"))]
pub mod webgl;
#[cfg(target_arch = "wasm32")]
pub mod webgpu;

use crate::{Api, Gpu};

/// The canvas a browser target draws on: the page's own, or the worker's.
#[cfg(target_arch = "wasm32")]
#[derive(Clone)]
pub enum Canvas {
	Element(web_sys::HtmlCanvasElement),
	Offscreen(web_sys::OffscreenCanvas),
}

#[cfg(target_arch = "wasm32")]
impl Canvas {
	pub fn target(&self) -> wgpu::SurfaceTarget<'static> {
		match self {
			Canvas::Element(c) => wgpu::SurfaceTarget::Canvas(c.clone()),
			Canvas::Offscreen(c) => wgpu::SurfaceTarget::OffscreenCanvas(c.clone()),
		}
	}
}

#[cfg(target_arch = "wasm32")]
impl Gpu {
	/// Copy a picture, premultiplied, into the top left `width` × `height` of `texture`, kept
	/// premultiplied as every colour texture is. `from_canvas`: it is a canvas's
	/// `transferToImageBitmap` (a tile from the worker), else a `createImageBitmap` with
	/// `premultiplyAlpha: "premultiply"`. The picture may be let go once this returns.
	pub fn copy_bitmap(&mut self, bitmap: &web_sys::ImageBitmap, texture: &wgpu::Texture, width: u32, height: u32, from_canvas: bool) {
		#[cfg(feature = "webgl")]
		if self.api == Api::WebGl2 {
			return webgl::copy_bitmap(self, bitmap, texture, width, height, from_canvas);
		}
		let _ = from_canvas;
		self.queue.copy_external_image_to_texture(
			&wgpu::CopyExternalImageSourceInfo { source: wgpu::ExternalImageSource::ImageBitmap(bitmap.clone()), origin: wgpu::Origin2d::ZERO, flip_y: false },
			wgpu::CopyExternalImageDestInfo { texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All, color_space: wgpu::PredefinedColorSpace::Srgb, premultiplied_alpha: true },
			wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
		);
	}

	/// Copy raw pixels, RGBA8 premultiplied with rows `stride` bytes apart (a tile the worker read
	/// back, `copy_out`), into the top left `width` × `height` of `texture`. On WebGPU the bytes go
	/// from their JavaScript array straight to `writeTexture`, not through this module's memory;
	/// elsewhere they are copied in first. Under WebKit this costs the main thread about a tenth of
	/// what `copy_bitmap` does for a tile (0.17 ms against 2 on an iPad mini 6).
	pub fn write_pixels(&mut self, pixels: &js_sys::Uint8Array, stride: u32, texture: &wgpu::Texture, width: u32, height: u32) {
		if let (Some(queue), Some(target)) = (self.queue.as_webgpu(), texture.as_webgpu()) {
			use wasm_bindgen::JsValue;
			let set = |o: &js_sys::Object, k: &str, v: &JsValue| {
				let _ = js_sys::Reflect::set(o, &JsValue::from_str(k), v);
			};
			let dest = js_sys::Object::new();
			set(&dest, "texture", target.as_ref());
			let layout = js_sys::Object::new();
			set(&layout, "bytesPerRow", &JsValue::from(stride));
			set(&layout, "rowsPerImage", &JsValue::from(height));
			let size = js_sys::Array::of2(&JsValue::from(width), &JsValue::from(height));
			let queue: &JsValue = queue.as_ref();
			if let Ok(write) = js_sys::Reflect::get(queue, &JsValue::from_str("writeTexture")) {
				let write: js_sys::Function = write.into();
				let _ = write.apply(queue, &js_sys::Array::of4(&dest, pixels, &layout, &size));
			}
			return;
		}
		self.queue.write_texture(
			texture.as_image_copy(),
			&pixels.to_vec(),
			wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(stride), rows_per_image: Some(height) },
			wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
		);
	}

	/// One size of a compressed picture (`compressed_picture`), its blocks straight from their
	/// JavaScript array to WebGPU's `writeTexture`, never through this module's memory: the whole
	/// cost to the page's thread of a picture that arrives compressed. Elsewhere, `write_level`.
	pub fn write_level_js(&mut self, id: u32, level: u32, blocks: &js_sys::Uint8Array) {
		let Some(tex) = self.textures.get(&id) else { return };
		let size = tex.texture.size().mip_level_size(level, wgpu::TextureDimension::D2).physical_size(tex.texture.format());
		let (across, down) = (size.width / 4, size.height / 4);
		if blocks.length() < across * down * 16 {
			return;
		}
		if let (Some(queue), Some(target)) = (self.queue.as_webgpu(), tex.texture.as_webgpu()) {
			use wasm_bindgen::JsValue;
			let set = |o: &js_sys::Object, k: &str, v: &JsValue| {
				let _ = js_sys::Reflect::set(o, &JsValue::from_str(k), v);
			};
			let dest = js_sys::Object::new();
			set(&dest, "texture", target.as_ref());
			set(&dest, "mipLevel", &JsValue::from(level));
			let layout = js_sys::Object::new();
			set(&layout, "bytesPerRow", &JsValue::from(across * 16));
			set(&layout, "rowsPerImage", &JsValue::from(down));
			let extent = js_sys::Array::of2(&JsValue::from(size.width), &JsValue::from(size.height));
			let queue: &JsValue = queue.as_ref();
			if let Ok(write) = js_sys::Reflect::get(queue, &JsValue::from_str("writeTexture")) {
				let write: js_sys::Function = write.into();
				let _ = write.apply(queue, &js_sys::Array::of4(&dest, blocks, &layout, &extent));
			}
			return;
		}
		self.write_level(id, level, &blocks.to_vec());
	}
}

impl Gpu {
	/// Copy texture `id` whole into `buffer` (made `MAP_READ | COPY_DST`, at least `stride` × its
	/// height bytes), its rows `stride` bytes apart (a multiple of 256), and submit it, for the
	/// caller to map and read. False when there is no such texture.
	pub fn copy_out(&self, id: u32, buffer: &wgpu::Buffer, stride: u32) -> bool {
		let Some(tex) = self.textures.get(&id) else { return false };
		let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("read back") });
		encoder.copy_texture_to_buffer(
			tex.texture.as_image_copy(),
			wgpu::TexelCopyBufferInfo { buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(stride), rows_per_image: Some(tex.height) } },
			wgpu::Extent3d { width: tex.width, height: tex.height, depth_or_array_layers: 1 },
		);
		self.queue.submit([encoder.finish()]);
		true
	}

	/// Draw to the screen through this surface from now on, as the first screen surface.
	pub fn set_surface(&mut self, surface: wgpu::Surface<'static>, adapter: &wgpu::Adapter, width: u32, height: u32) {
		self.surfaces.clear();
		self.configure(surface, adapter, width, height);
	}

	/// One more screen surface on the same device; returns its number for `Target::Surface`. A
	/// WebGL 2 device is its canvas's context and draws on no other canvas, so it refuses.
	pub fn add_surface(&mut self, surface: wgpu::Surface<'static>, adapter: &wgpu::Adapter, width: u32, height: u32) -> Result<u32, String> {
		if self.api == Api::WebGl2 && !self.surfaces.is_empty() {
			return Err("a WebGL 2 device draws on its own canvas only: open another for this one".into());
		}
		Ok(self.configure(surface, adapter, width, height))
	}

	fn configure(&mut self, surface: wgpu::Surface<'static>, adapter: &wgpu::Adapter, width: u32, height: u32) -> u32 {
		let caps = surface.get_capabilities(adapter);
		let format = caps.formats.iter().copied().find(|f| matches!(f, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm)).unwrap_or(caps.formats[0]);
		// The stage canvas lies over the boards' pages, so what it leaves clear must show through.
		// wgpu's browser backend lists only "opaque" among its modes but configures "premultiplied".
		// Its WebGL 2 backend lists only "opaque" too, refuses any other, and makes the context with
		// WebGL's defaults (alpha, premultiplied) whatever is asked: "opaque" there is transparent.
		let alpha = if (cfg!(target_arch = "wasm32") && self.api == Api::WebGpu) || caps.alpha_modes.contains(&wgpu::CompositeAlphaMode::PreMultiplied) { wgpu::CompositeAlphaMode::PreMultiplied } else { caps.alpha_modes[0] };
		let config = wgpu::SurfaceConfiguration {
			usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
			format,
			width: width.max(1),
			height: height.max(1),
			present_mode: wgpu::PresentMode::Fifo,
			desired_maximum_frame_latency: 1,
			alpha_mode: alpha,
			view_formats: vec![],
			color_space: wgpu::SurfaceColorSpace::Auto,
		};
		surface.configure(&self.device, &config);
		self.surfaces.push((surface, config));
		(self.surfaces.len() - 1) as u32
	}
}
