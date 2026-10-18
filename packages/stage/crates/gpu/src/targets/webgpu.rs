//! A browser canvas, the page's own or the worker's `OffscreenCanvas`, drawn on through WebGPU.

use crate::Gpu;

/// Open WebGPU on this canvas: an adapter that can draw to it, a device with WebGPU's default
/// limits, and the canvas as the first screen surface, `width` × `height` pixels.
pub async fn open(target: wgpu::SurfaceTarget<'static>, width: u32, height: u32) -> Result<Gpu, String> {
	let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
	let surface = instance.create_surface(target).map_err(|e| e.to_string())?;
	let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions { compatible_surface: Some(&surface), ..Default::default() }).await.map_err(|e| e.to_string())?;
	let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(|e| e.to_string())?;
	let mut gpu = Gpu::new(device, queue);
	gpu.set_surface(surface, &adapter, width, height);
	Ok(gpu)
}
