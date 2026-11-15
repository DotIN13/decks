//! The Metal device, and the host's Metal objects as wgpu ones: its layer as a surface, its
//! textures as textures. Everything here is wgpu's own Metal backend; nothing draws.

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_metal::{MTLPixelFormat, MTLTexture, MTLTextureType};
use stage_gpu::{Api, Gpu, SAMPLES};
use std::ffi::c_void;
use wgpu::hal;

/// One Metal device, opened once, that the page's and the worker's backends both draw on.
pub struct Device {
	pub instance: wgpu::Instance,
	pub adapter: wgpu::Adapter,
	pub device: wgpu::Device,
	pub queue: wgpu::Queue,
}

impl Device {
	/// The system's Metal device, with the limits and features the browser's engine asks for.
	pub fn open() -> Result<Device, String> {
		let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::METAL, ..wgpu::InstanceDescriptor::new_without_display_handle() });
		let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).map_err(|e| format!("no Metal device: {e}"))?;
		let required_features = adapter.features() & wgpu::Features::TEXTURE_COMPRESSION_ASTC;
		let descriptor = wgpu::DeviceDescriptor { required_limits: wgpu::Limits::default(), required_features, ..Default::default() };
		let (device, queue) = pollster::block_on(adapter.request_device(&descriptor)).map_err(|e| format!("the Metal device would not open: {e}"))?;
		Ok(Device { instance, adapter, device, queue })
	}

	/// A backend on this device. The page and the worker each get one, so each keeps its own glyph
	/// textures and texture numbers, as they do in the browser, where they run on two threads.
	pub fn backend(&self) -> Gpu {
		Gpu::on(self.device.clone(), self.queue.clone(), Api::Native, SAMPLES)
	}

	/// The host's `CAMetalLayer` as a surface on this device.
	///
	/// # Safety
	/// `layer` is a live `CAMetalLayer` that outlives the surface.
	pub unsafe fn surface(&self, layer: *mut c_void) -> Result<wgpu::Surface<'static>, String> {
		let target = wgpu::SurfaceTargetUnsafe::CoreAnimationLayer(layer);
		unsafe { self.instance.create_surface_unsafe(target) }.map_err(|e| format!("the layer is not a surface: {e}"))
	}

	/// The `MTLDevice` under this device, for the host to make textures on. Not retained: it lives
	/// as long as the engine does.
	pub fn raw(&self) -> *mut c_void {
		// SAFETY: the device is on the Metal backend (`open`); the pointer is only handed out.
		let hal = unsafe { self.device.as_hal::<hal::api::Metal>() };
		hal.map_or(std::ptr::null_mut(), |d| Retained::as_ptr(d.raw_device()) as *mut c_void)
	}

	/// The host's `MTLTexture` as a texture on this device. It must be 2D, RGBA8 unorm (what the
	/// backend draws into), one level, made on this device, and usable as a render target and to be read.
	///
	/// # Safety
	/// `texture` is a live `MTLTexture` made on `raw()`.
	pub unsafe fn wrap(&self, texture: *mut c_void) -> Result<wgpu::Texture, String> {
		let raw: Retained<ProtocolObject<dyn MTLTexture>> = unsafe { Retained::retain(texture.cast()) }.ok_or("no texture")?;
		let format = match raw.pixelFormat() {
			MTLPixelFormat::RGBA8Unorm => wgpu::TextureFormat::Rgba8Unorm,
			other => return Err(format!("a texture in pixel format {} is not drawn into: use RGBA8Unorm", other.0)),
		};
		if raw.textureType() != MTLTextureType::Type2D || raw.mipmapLevelCount() != 1 {
			return Err("the texture must be 2D with one level".into());
		}
		let (width, height) = (raw.width() as u32, raw.height() as u32);
		let extent = hal::CopyExtent { width, height, depth: 1 };
		let hal_texture = unsafe { hal::metal::Device::texture_from_raw(raw, format, MTLTextureType::Type2D, 1, 1, extent, None) };
		let usage = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST;
		let desc = wgpu::TextureDescriptor {
			label: Some("host texture"),
			size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
			mip_level_count: 1,
			sample_count: 1,
			dimension: wgpu::TextureDimension::D2,
			format,
			usage,
			view_formats: &[],
		};
		Ok(unsafe { self.device.create_texture_from_hal::<hal::api::Metal>(hal_texture, &desc, wgpu::TextureUses::UNINITIALIZED) })
	}

	/// Wait until the device has done everything sent to it: before the host reads a texture.
	pub fn finish(&self) {
		let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
	}
}
