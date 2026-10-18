//! A browser canvas, the page's own or the worker's `OffscreenCanvas`, drawn on through WebGL 2:
//! wgpu's GL backend, running the same shader (converted to GLSL ES 3.00) and the same passes.
//!
//! A WebGL 2 device is its canvas's context: it draws on that canvas and no other, so a `Gpu` here
//! has one screen surface. Its limits are WebGL 2's guaranteed ones but for the biggest texture,
//! which is the device's own. A lost context marks the `Gpu` lost. A canvas's picture that WebGL
//! hands over with straight colour is premultiplied on the way in ([`Uploads`]).

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

/// How pictures go into textures under WebGL 2, beyond wgpu's own copy.
///
/// Every colour texture is premultiplied, and the pictures are: a tile is a premultiplied WebGL
/// canvas's `transferToImageBitmap` (the render worker's), a board's picture a
/// `createImageBitmap(…, { premultiplyAlpha: "premultiply" })`. Chromium uploads both as they are.
/// WebKit (Safari, and every browser on an iPhone) hands a canvas's bitmap over with straight
/// colour, whatever `UNPACK_PREMULTIPLY_ALPHA_WEBGL` says, so drawn premultiplied every partly clear
/// pixel of a tile came out too bright: a pale rim round every note. What this browser does is asked
/// once, with a canvas of its own ([`canvas_bitmaps_straight`]), before the first canvas's picture
/// is copied; where they come straight, each is copied into a scratch texture and drawn into its
/// own premultiplied ([`Premultiply`]).
#[derive(Default)]
pub struct Uploads {
	/// Whether a canvas's bitmap arrives with straight colour: not asked yet, or the answer.
	canvas_straight: Option<bool>,
	premultiply: Option<Premultiply>,
}

/// A scratch texture a straight picture is copied into, and the pass that draws it premultiplied.
struct Premultiply {
	pipeline: wgpu::RenderPipeline,
	layout: wgpu::BindGroupLayout,
	scratch: Option<(wgpu::Texture, wgpu::BindGroup)>,
}

const PREMULTIPLY: &str = "
@group(0) @binding(0) var straight: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
	// One triangle over the whole target.
	let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
	return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
	let c = textureLoad(straight, vec2<i32>(at.xy), 0);
	return vec4<f32>(c.rgb * c.a, c.a);
}
";

impl Premultiply {
	fn new(device: &wgpu::Device) -> Premultiply {
		let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("premultiply"), source: wgpu::ShaderSource::Wgsl(PREMULTIPLY.into()) });
		let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
			label: Some("premultiply"),
			entries: &[wgpu::BindGroupLayoutEntry {
				binding: 0,
				visibility: wgpu::ShaderStages::FRAGMENT,
				ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
				count: None,
			}],
		});
		let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("premultiply"), bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
		let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
			label: Some("premultiply"),
			layout: Some(&pipeline_layout),
			vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
			fragment: Some(wgpu::FragmentState {
				module: &module,
				entry_point: Some("fs"),
				compilation_options: Default::default(),
				targets: &[Some(wgpu::ColorTargetState { format: wgpu::TextureFormat::Rgba8Unorm, blend: None, write_mask: wgpu::ColorWrites::ALL })],
			}),
			primitive: Default::default(),
			depth_stencil: None,
			multisample: Default::default(),
			multiview_mask: None,
			cache: None,
		});
		Premultiply { pipeline, layout, scratch: None }
	}

	/// The scratch texture, at least `width` × `height`, and its bind group.
	fn scratch(&mut self, device: &wgpu::Device, width: u32, height: u32) -> (wgpu::Texture, wgpu::BindGroup) {
		if let Some((t, g)) = &self.scratch
			&& t.width() >= width
			&& t.height() >= height
		{
			return (t.clone(), g.clone());
		}
		let (w, h) = self.scratch.as_ref().map_or((width, height), |(t, _)| (t.width().max(width), t.height().max(height)));
		let texture = device.create_texture(&wgpu::TextureDescriptor {
			label: Some("straight picture"),
			size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
			mip_level_count: 1,
			sample_count: 1,
			dimension: wgpu::TextureDimension::D2,
			format: wgpu::TextureFormat::Rgba8Unorm,
			// A copy from a picture needs it to be a render target too.
			usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::RENDER_ATTACHMENT,
			view_formats: &[],
		});
		let view = texture.create_view(&Default::default());
		let group = device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("premultiply"), layout: &self.layout, entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) }] });
		self.scratch = Some((texture.clone(), group.clone()));
		(texture, group)
	}
}

/// Copy `bitmap` into the top left `width` × `height` of `texture` with wgpu's copy (which on GL
/// copies with the queue's next submission, so submit at once, before the picture is let go).
fn copy(gpu: &Gpu, bitmap: &web_sys::ImageBitmap, texture: &wgpu::Texture, width: u32, height: u32) {
	gpu.queue.copy_external_image_to_texture(
		&wgpu::CopyExternalImageSourceInfo { source: wgpu::ExternalImageSource::ImageBitmap(bitmap.clone()), origin: wgpu::Origin2d::ZERO, flip_y: false },
		// wgpu's GL backend refuses to be asked to premultiply an `ImageBitmap`.
		wgpu::CopyExternalImageDestInfo { texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All, color_space: wgpu::PredefinedColorSpace::Srgb, premultiplied_alpha: false },
		wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
	);
	gpu.queue.submit([]);
}

/// [`Gpu::copy_bitmap`] under WebGL 2: `from_canvas` says the bitmap is a canvas's.
pub(crate) fn copy_bitmap(gpu: &mut Gpu, bitmap: &web_sys::ImageBitmap, texture: &wgpu::Texture, width: u32, height: u32, from_canvas: bool) {
	let straight = from_canvas && *gpu.webgl.canvas_straight.get_or_insert_with(canvas_bitmaps_straight);
	if !straight {
		return copy(gpu, bitmap, texture, width, height);
	}
	let device = gpu.device.clone();
	let premultiply = gpu.webgl.premultiply.get_or_insert_with(|| Premultiply::new(&device));
	let (scratch, group) = premultiply.scratch(&device, width, height);
	let pipeline = premultiply.pipeline.clone();
	copy(gpu, bitmap, &scratch, width, height);
	let view = texture.create_view(&Default::default());
	let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("premultiply") });
	{
		let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
			label: Some("premultiply"),
			color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store } })],
			depth_stencil_attachment: None,
			timestamp_writes: None,
			occlusion_query_set: None,
			multiview_mask: None,
		});
		pass.set_viewport(0.0, 0.0, width as f32, height as f32, 0.0, 1.0);
		pass.set_scissor_rect(0, 0, width, height);
		pass.set_pipeline(&pipeline);
		pass.set_bind_group(0, &group, &[]);
		pass.draw(0..3, 0..1);
	}
	gpu.queue.submit([encoder.finish()]);
}

/// Whether this browser's WebGL 2 hands a premultiplied canvas's `ImageBitmap` over with straight
/// colour: a 2 × 2 WebGL 2 canvas of its own cleared to a half-clear colour, its bitmap copied into
/// a texture and read back. Premultiplied, red reads 128; straight, 255. No canvas, no answer: as
/// it was (premultiplied).
fn canvas_bitmaps_straight() -> bool {
	let ask = || -> Option<bool> {
		let canvas = web_sys::OffscreenCanvas::new(2, 2).ok()?;
		let gl = canvas.get_context("webgl2").ok()??.dyn_into::<Gl>().ok()?;
		// As wgpu makes a canvas's context: alpha, premultiplied (WebGL's defaults).
		gl.clear_color(0.5, 0.4, 0.2, 0.5);
		gl.clear(Gl::COLOR_BUFFER_BIT);
		let bitmap = canvas.transfer_to_image_bitmap().ok()?;
		let texture = gl.create_texture()?;
		gl.bind_texture(Gl::TEXTURE_2D, Some(&texture));
		gl.tex_storage_2d(Gl::TEXTURE_2D, 1, Gl::RGBA8, 2, 2);
		gl.tex_sub_image_2d_with_u32_and_u32_and_image_bitmap(Gl::TEXTURE_2D, 0, 0, 0, Gl::RGBA, Gl::UNSIGNED_BYTE, &bitmap).ok()?;
		bitmap.close();
		let framebuffer = gl.create_framebuffer()?;
		gl.bind_framebuffer(Gl::FRAMEBUFFER, Some(&framebuffer));
		gl.framebuffer_texture_2d(Gl::FRAMEBUFFER, Gl::COLOR_ATTACHMENT0, Gl::TEXTURE_2D, Some(&texture), 0);
		let mut pixel = [0u8; 4];
		gl.read_pixels_with_opt_u8_array(0, 0, 1, 1, Gl::RGBA, Gl::UNSIGNED_BYTE, Some(&mut pixel)).ok()?;
		// Let the context go now rather than when it is collected: a page may hold only so many.
		if let Ok(Some(lose)) = gl.get_extension("WEBGL_lose_context")
			&& let Ok(f) = js_sys::Reflect::get(&lose, &"loseContext".into())
			&& let Ok(f) = f.dyn_into::<js_sys::Function>()
		{
			let _ = f.call0(&lose);
		}
		Some(pixel[3] > 0 && pixel[0] > 192)
	};
	let straight = ask().unwrap_or(false);
	if straight {
		web_sys::console::info_1(&"stage: this browser's WebGL 2 hands canvas pictures over straight; they are premultiplied on the way in".into());
	}
	straight
}
