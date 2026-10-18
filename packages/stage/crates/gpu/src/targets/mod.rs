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
}

impl Gpu {
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
