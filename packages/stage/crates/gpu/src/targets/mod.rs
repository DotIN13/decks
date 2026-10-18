//! Where a [`Gpu`] gets its device and what it draws to the screen through. Each target opens a wgpu
//! device its own way and hands it to [`Gpu::new`]; drawing is the same on all of them.
//!
//! - [`webgpu`]: a browser canvas or `OffscreenCanvas`, through WebGPU.
//! - [`native`]: this machine's graphics card (Metal), with no window: for tests.
//!
//! Screen surfaces, which a browser target configures, are set up here for all of them.

#[cfg(not(target_arch = "wasm32"))]
pub mod native;
#[cfg(target_arch = "wasm32")]
pub mod webgpu;

use crate::Gpu;

impl Gpu {
	/// Draw to the screen through this surface from now on, as the first screen surface.
	pub fn set_surface(&mut self, surface: wgpu::Surface<'static>, adapter: &wgpu::Adapter, width: u32, height: u32) {
		self.surfaces.clear();
		self.add_surface(surface, adapter, width, height);
	}

	/// One more screen surface on the same device; returns its number for `Target::Surface`.
	pub fn add_surface(&mut self, surface: wgpu::Surface<'static>, adapter: &wgpu::Adapter, width: u32, height: u32) -> u32 {
		let caps = surface.get_capabilities(adapter);
		let format = caps.formats.iter().copied().find(|f| matches!(f, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm)).unwrap_or(caps.formats[0]);
		// The stage canvas lies over the boards' pages, so what it leaves clear must show through.
		// wgpu's browser backend lists only "opaque" among its modes but configures "premultiplied".
		let alpha = if cfg!(target_arch = "wasm32") || caps.alpha_modes.contains(&wgpu::CompositeAlphaMode::PreMultiplied) { wgpu::CompositeAlphaMode::PreMultiplied } else { caps.alpha_modes[0] };
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
