//! This machine's own graphics card through Metal, with no window: for tests and offline pictures.

use crate::Gpu;

/// A device on this machine's own graphics card, with no window.
pub async fn headless() -> Option<Gpu> {
	headless_with(wgpu::Limits::default()).await
}

/// The same, with the device held to these limits: `wgpu::Limits::downlevel_webgl2_defaults()`
/// draws on Metal as WebGL 2 would let it (no storage buffers, 2048-texel textures).
pub async fn headless_with(limits: wgpu::Limits) -> Option<Gpu> {
	headless_sampled(limits, crate::SAMPLES).await
}

/// The same, drawing with `samples` samples a pixel: 1 is how a device short of memory draws.
pub async fn headless_sampled(limits: wgpu::Limits, samples: u32) -> Option<Gpu> {
	let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::METAL, ..wgpu::InstanceDescriptor::new_without_display_handle() });
	let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions::default()).await.ok()?;
	let required_features = adapter.features() & wgpu::Features::TEXTURE_COMPRESSION_ASTC;
	let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor { required_limits: limits, required_features, ..Default::default() }).await.ok()?;
	Some(Gpu::on(device, queue, crate::Api::Native, samples))
}
