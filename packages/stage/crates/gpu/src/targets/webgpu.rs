//! A browser canvas, the page's own or the worker's `OffscreenCanvas`, drawn on through WebGPU.
//!
//! Opening is two steps, because a canvas that has once had a WebGPU context can never have a
//! WebGL 2 one: [`adapter`] asks the browser for an adapter without touching any canvas, and only
//! with one in hand does [`open`] make the canvas's context.

use crate::{Api, Gpu};

/// WebGPU's adapter, found before any canvas has a context.
pub struct Found {
	instance: wgpu::Instance,
	adapter: wgpu::Adapter,
}

/// The browser's WebGPU adapter, or why there is none: no `navigator.gpu`, or no adapter behind it
/// (a blocklisted card, WebGPU turned off).
pub async fn adapter() -> Result<Found, String> {
	if !wgpu::util::is_browser_webgpu_supported().await {
		return Err("this browser has no WebGPU".into());
	}
	let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
	let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions::default()).await.map_err(|e| format!("WebGPU has no adapter: {e}"))?;
	Ok(Found { instance, adapter })
}

/// Open WebGPU on this canvas with the adapter found: a device with WebGPU's default limits,
/// drawing with `samples` samples a pixel, and the canvas as the first screen surface, `width` ×
/// `height` pixels.
pub async fn open(found: Found, target: wgpu::SurfaceTarget<'static>, width: u32, height: u32, samples: u32) -> Result<Gpu, String> {
	let Found { instance, adapter } = found;
	let surface = instance.create_surface(target).map_err(|e| e.to_string())?;
	let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(|e| e.to_string())?;
	let mut gpu = Gpu::on(device, queue, Api::WebGpu, samples);
	gpu.set_surface(surface, &adapter, width, height);
	Ok(gpu)
}
