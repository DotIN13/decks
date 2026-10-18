//! A browser canvas, the page's own or the worker's `OffscreenCanvas`, drawn on through WebGL 2:
//! wgpu's GL backend, running the same shader (converted to GLSL ES 3.00) and the same passes.
//!
//! A WebGL 2 device is its canvas's context: it draws on that canvas and no other, so a `Gpu` here
//! has one screen surface. Its limits are WebGL 2's guaranteed ones but for the biggest texture,
//! which is the device's own. A lost context marks the `Gpu` lost.

use super::Canvas;
use crate::{Api, Gpu};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::Closure;
use web_sys::WebGl2RenderingContext as Gl;

impl Canvas {
	/// The canvas's WebGL 2 context, the one wgpu made: asking again gives the same one.
	fn context(&self) -> Option<Gl> {
		let context = match self {
			Canvas::Element(c) => c.get_context("webgl2"),
			Canvas::Offscreen(c) => c.get_context("webgl2"),
		};
		context.ok()??.dyn_into::<Gl>().ok()
	}

	fn events(&self) -> &web_sys::EventTarget {
		match self {
			Canvas::Element(c) => c.as_ref(),
			Canvas::Offscreen(c) => c.as_ref(),
		}
	}

	/// Set `flag` when the context is lost, and ask the browser to restore it (by preventing the
	/// event's default), so the page may open the stage on it again.
	fn watch_lost(&self, flag: Arc<AtomicBool>) {
		let on_lost = Closure::<dyn FnMut(web_sys::Event)>::new(move |event: web_sys::Event| {
			event.prevent_default();
			flag.store(true, Ordering::SeqCst);
		});
		let _ = self.events().add_event_listener_with_callback("webglcontextlost", on_lost.as_ref().unchecked_ref());
		// It listens as long as the canvas lives.
		on_lost.forget();
	}
}

/// Open WebGL 2 on this canvas: the adapter of its context, a device with WebGL 2's limits and the
/// context's own biggest texture, and the canvas as the only screen surface, `width` × `height`.
/// It draws with four samples a pixel unless the context allows fewer (`MAX_SAMPLES`) or the
/// device is `short_of_memory` ([`stage_render::limits::samples`]).
pub async fn open(canvas: Canvas, width: u32, height: u32, short_of_memory: bool) -> Result<Gpu, String> {
	let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::GL, ..wgpu::InstanceDescriptor::new_without_display_handle() });
	let surface = instance.create_surface(canvas.target()).map_err(|e| format!("no WebGL 2 on this canvas: {e}"))?;
	let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions { compatible_surface: Some(&surface), ..Default::default() }).await.map_err(|e| format!("WebGL 2 has no adapter: {e}"))?;
	let required_limits = wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits());
	let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor { required_limits, ..Default::default() }).await.map_err(|e| e.to_string())?;
	let max_samples = canvas.context().and_then(|gl| gl.get_parameter(Gl::MAX_SAMPLES).ok()?.as_f64()).map(|n| n as u32);
	let samples = stage_render::limits::samples(max_samples, short_of_memory);
	let mut gpu = Gpu::on(device, queue, Api::WebGl2, samples);
	canvas.watch_lost(gpu.lost_flag());
	gpu.set_surface(surface, &adapter, width, height);
	Ok(gpu)
}
