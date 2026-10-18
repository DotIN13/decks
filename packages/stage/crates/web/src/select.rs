//! Which graphics API the stage draws with in this browser: WebGPU where it has an adapter, else
//! WebGL 2, else an error the page shows.
//!
//! The order matters for more than taste: a canvas that has once had a `webgpu` context can never
//! have a `webgl2` one, so WebGPU's adapter is asked for before the canvas is touched, and the
//! canvas gets a WebGPU context only when there is an adapter to go with it. WebGPU present but
//! with no adapter (a blocklisted card, WebGPU turned off) falls back to WebGL 2 as if it were not
//! there.

use stage_gpu::Gpu;
use stage_gpu::targets::webgl::Canvas;
use stage_gpu::targets::{webgl, webgpu};

/// A graphics API the page asks for by name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Api {
	WebGpu,
	WebGl2,
}

impl Api {
	/// `"webgpu"` or `"webgl2"`, as `GpuHandle.backend()` gives them; anything else is an error.
	pub fn parse(name: &str) -> Result<Api, String> {
		match name {
			"webgpu" => Ok(Api::WebGpu),
			"webgl2" => Ok(Api::WebGl2),
			other => Err(format!("no graphics API called {other:?}: \"webgpu\" or \"webgl2\"")),
		}
	}
}

/// `navigator.deviceMemory`, in GiB, where the browser gives it (Chromium does; Safari and Firefox
/// do not), on the page or in a worker.
fn device_memory() -> Option<f64> {
	let navigator = js_sys::Reflect::get(&js_sys::global(), &"navigator".into()).ok()?;
	js_sys::Reflect::get(&navigator, &"deviceMemory".into()).ok()?.as_f64()
}

/// Open the stage on `canvas`, `width` × `height` pixels. `prefer` is tried first (the worker
/// passes the page's, so both draw alike), then the other: WebGPU first when nothing is preferred.
/// `short_of_memory` overrides the guess from `navigator.deviceMemory` (2 GiB or less); a device
/// short of memory draws with one sample a pixel instead of four.
pub async fn open(canvas: Canvas, width: u32, height: u32, prefer: Option<Api>, short_of_memory: Option<bool>) -> Result<Gpu, String> {
	let short = short_of_memory.unwrap_or_else(|| stage_render::limits::short_of_memory(device_memory()));
	let order = match prefer {
		Some(Api::WebGl2) => [Api::WebGl2, Api::WebGpu],
		_ => [Api::WebGpu, Api::WebGl2],
	};
	let mut why = Vec::new();
	for api in order {
		let opened = match api {
			// No canvas context is made unless there is an adapter for it.
			Api::WebGpu => match webgpu::adapter().await {
				Ok(found) => webgpu::open(found, canvas.target(), width, height, stage_render::limits::samples(None, short)).await,
				Err(e) => Err(e),
			},
			Api::WebGl2 => webgl::open(canvas.clone(), width, height, short).await,
		};
		match opened {
			Ok(gpu) => return Ok(gpu),
			Err(e) => why.push(e),
		}
	}
	Err(format!("This browser can't draw the stage: it needs WebGPU or WebGL 2 ({})", why.join("; ")))
}
