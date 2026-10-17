//! The first backend: wgpu, on WebGPU in the browser (and on Metal when the tests run on a Mac).
//!
//! It implements [`Backend`]: it turns a draw list into render passes and knows nothing of the
//! document. Shapes are instanced quads whose edges the shader works out exactly; meshes are the
//! painter's triangles, smoothed by four samples a pixel. Layers are drawn into a texture of their
//! own and laid down at their opacity. Paints and clips go up once a draw as two small tables.

use stage_paint::list::{Align, Clip, Color, DrawList, Op, Paint, Shape};
use stage_paint::{Backend, Target, TextureKind};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use wgpu::util::DeviceExt;

const SAMPLES: u32 = 4;
/// Gradients are cut into rows of this many colours in one texture, a row per gradient a draw.
const RAMP_W: u32 = 256;
const RAMP_H: u32 = 256;
/// Texture ids at and above this are the backend's own: layers.
const LAYER_IDS: u32 = 0xF000_0000;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Instance {
	xf0: [f32; 4],
	xf1: [f32; 4],
	radii: [f32; 4],
	params: [f32; 4],
	extra: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Vertex {
	target: [f32; 2],
	local: [f32; 2],
	refs: [f32; 2],
	size: [f32; 2],
}

struct Tex {
	texture: wgpu::Texture,
	view: wgpu::TextureView,
	kind: TextureKind,
	width: u32,
	height: u32,
	picture: wgpu::BindGroup,
}

struct Pipelines {
	shape: wgpu::RenderPipeline,
	mesh: wgpu::RenderPipeline,
}

/// What a pass draws, in order.
enum Cmd {
	Shapes { range: std::ops::Range<u32>, texture: Option<u32> },
	Mesh { range: std::ops::Range<u32>, texture: Option<u32> },
}

struct Pass {
	/// `None`: the list's own target; `Some(id)`: a layer's texture.
	layer: Option<u32>,
	depth: usize,
	clear: Option<Color>,
	cmds: Vec<Cmd>,
}

pub struct Gpu {
	pub device: wgpu::Device,
	pub queue: wgpu::Queue,
	surface: Option<(wgpu::Surface<'static>, wgpu::SurfaceConfiguration)>,
	textures: HashMap<u32, Tex>,
	pipelines: HashMap<wgpu::TextureFormat, Pipelines>,
	frame_layout: wgpu::BindGroupLayout,
	picture_layout: wgpu::BindGroupLayout,
	pipeline_layout: wgpu::PipelineLayout,
	module: wgpu::ShaderModule,
	sampler: wgpu::Sampler,
	ramp: wgpu::Texture,
	ramp_view: wgpu::TextureView,
	white: wgpu::BindGroup,
	msaa: HashMap<(u32, u32, wgpu::TextureFormat, usize), wgpu::TextureView>,
	lost: Arc<AtomicBool>,
	next_layer: u32,
}

impl Gpu {
	/// A backend on a device the caller opened: the page's or the worker's.
	pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Gpu {
		let lost = Arc::new(AtomicBool::new(false));
		let flag = lost.clone();
		device.set_device_lost_callback(move |_, _| flag.store(true, Ordering::SeqCst));
		let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("stage"), source: wgpu::ShaderSource::Wgsl(include_str!("stage.wgsl").into()) });
		let entry = |binding: u32, ty: wgpu::BindingType| wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::VERTEX_FRAGMENT, ty, count: None };
		let storage = wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None };
		let texture = wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false };
		let frame_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
			label: Some("frame"),
			entries: &[
				entry(0, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }),
				entry(1, storage),
				entry(2, storage),
				entry(3, texture),
				entry(4, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
			],
		});
		let picture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("picture"), entries: &[entry(0, texture)] });
		let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("stage"), bind_group_layouts: &[Some(&frame_layout), Some(&picture_layout)], immediate_size: 0 });
		let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
			label: Some("smooth"),
			mag_filter: wgpu::FilterMode::Linear,
			min_filter: wgpu::FilterMode::Linear,
			address_mode_u: wgpu::AddressMode::ClampToEdge,
			address_mode_v: wgpu::AddressMode::ClampToEdge,
			..Default::default()
		});
		let ramp = device.create_texture(&wgpu::TextureDescriptor {
			label: Some("ramp"),
			size: wgpu::Extent3d { width: RAMP_W, height: RAMP_H, depth_or_array_layers: 1 },
			mip_level_count: 1,
			sample_count: 1,
			dimension: wgpu::TextureDimension::D2,
			format: wgpu::TextureFormat::Rgba8Unorm,
			usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
			view_formats: &[],
		});
		let ramp_view = ramp.create_view(&Default::default());
		let white_tex = device.create_texture_with_data(
			&queue,
			&wgpu::TextureDescriptor {
				label: Some("white"),
				size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
				mip_level_count: 1,
				sample_count: 1,
				dimension: wgpu::TextureDimension::D2,
				format: wgpu::TextureFormat::Rgba8Unorm,
				usage: wgpu::TextureUsages::TEXTURE_BINDING,
				view_formats: &[],
			},
			wgpu::util::TextureDataOrder::LayerMajor,
			&[255, 255, 255, 255],
		);
		let white_view = white_tex.create_view(&Default::default());
		let white = device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("white"), layout: &picture_layout, entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&white_view) }] });
		Gpu {
			device,
			queue,
			surface: None,
			textures: HashMap::new(),
			pipelines: HashMap::new(),
			frame_layout,
			picture_layout,
			pipeline_layout,
			module,
			sampler,
			ramp,
			ramp_view,
			white,
			msaa: HashMap::new(),
			lost,
			next_layer: LAYER_IDS,
		}
	}

	/// Draw to the screen through this surface from now on.
	pub fn set_surface(&mut self, surface: wgpu::Surface<'static>, adapter: &wgpu::Adapter, width: u32, height: u32) {
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
		self.surface = Some((surface, config));
	}

	fn ensure_pipelines(&mut self, format: wgpu::TextureFormat) {
		if self.pipelines.contains_key(&format) {
			return;
		}
		let blend = Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING);
		let target = [Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })];
		let multisample = wgpu::MultisampleState { count: SAMPLES, mask: !0, alpha_to_coverage_enabled: false };
		let instance_attrs = wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Float32x4, 4 => Float32x4];
		let shape = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
			label: Some("shapes"),
			layout: Some(&self.pipeline_layout),
			vertex: wgpu::VertexState {
				module: &self.module,
				entry_point: Some("vs_shape"),
				compilation_options: Default::default(),
				buffers: &[Some(wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Instance>() as u64, step_mode: wgpu::VertexStepMode::Instance, attributes: &instance_attrs })],
			},
			fragment: Some(wgpu::FragmentState { module: &self.module, entry_point: Some("fs_shape"), compilation_options: Default::default(), targets: &target }),
			primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
			depth_stencil: None,
			multisample,
			multiview_mask: None,
			cache: None,
		});
		let vertex_attrs = wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2, 2 => Float32x2, 3 => Float32x2];
		let mesh = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
			label: Some("meshes"),
			layout: Some(&self.pipeline_layout),
			vertex: wgpu::VertexState {
				module: &self.module,
				entry_point: Some("vs_mesh"),
				compilation_options: Default::default(),
				buffers: &[Some(wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &vertex_attrs })],
			},
			fragment: Some(wgpu::FragmentState { module: &self.module, entry_point: Some("fs_mesh"), compilation_options: Default::default(), targets: &target }),
			primitive: wgpu::PrimitiveState::default(),
			depth_stencil: None,
			multisample,
			multiview_mask: None,
			cache: None,
		});
		self.pipelines.insert(format, Pipelines { shape, mesh });
	}

	fn msaa_view(&mut self, width: u32, height: u32, format: wgpu::TextureFormat, depth: usize) -> wgpu::TextureView {
		let device = &self.device;
		self.msaa
			.entry((width, height, format, depth))
			.or_insert_with(|| {
				device
					.create_texture(&wgpu::TextureDescriptor {
						label: Some("multisampled"),
						size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
						mip_level_count: 1,
						sample_count: SAMPLES,
						dimension: wgpu::TextureDimension::D2,
						format,
						usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
						view_formats: &[],
					})
					.create_view(&Default::default())
			})
			.clone()
	}

	fn make_texture(&self, kind: TextureKind, width: u32, height: u32) -> Tex {
		let format = match kind {
			TextureKind::Color => wgpu::TextureFormat::Rgba8Unorm,
			TextureKind::Mask => wgpu::TextureFormat::R8Unorm,
		};
		let texture = self.device.create_texture(&wgpu::TextureDescriptor {
			label: Some("stage texture"),
			size: wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
			mip_level_count: 1,
			sample_count: 1,
			dimension: wgpu::TextureDimension::D2,
			format,
			usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::RENDER_ATTACHMENT,
			view_formats: &[],
		});
		self.wrap(texture, kind)
	}

	fn wrap(&self, texture: wgpu::Texture, kind: TextureKind) -> Tex {
		let view = texture.create_view(&Default::default());
		let picture = self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("picture"), layout: &self.picture_layout, entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) }] });
		let (width, height) = (texture.width(), texture.height());
		Tex { texture, view, kind, width, height, picture }
	}

	/// A texture the caller made elsewhere (a picture copied from an `ImageBitmap`), under our id.
	pub fn adopt(&mut self, id: u32, texture: wgpu::Texture) {
		let tex = self.wrap(texture, TextureKind::Color);
		self.textures.insert(id, tex);
	}

	pub fn texture_handle(&self, id: u32) -> Option<&wgpu::Texture> {
		self.textures.get(&id).map(|t| &t.texture)
	}

	/// A texture's pixels, RGBA8 premultiplied, rows tight: for tests and pictures of tiles.
	#[cfg(not(target_arch = "wasm32"))]
	pub fn read(&self, id: u32) -> Option<Vec<u8>> {
		let tex = self.textures.get(&id)?;
		let bytes = if tex.kind == TextureKind::Mask { 1 } else { 4 };
		let row = (tex.width * bytes).div_ceil(256) * 256;
		let buffer = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("read"), size: (row * tex.height) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
		let mut encoder = self.device.create_command_encoder(&Default::default());
		encoder.copy_texture_to_buffer(
			tex.texture.as_image_copy(),
			wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(tex.height) } },
			wgpu::Extent3d { width: tex.width, height: tex.height, depth_or_array_layers: 1 },
		);
		self.queue.submit([encoder.finish()]);
		let slice = buffer.slice(..);
		slice.map_async(wgpu::MapMode::Read, |_| {});
		self.device.poll(wgpu::PollType::wait_indefinitely()).ok()?;
		let data = slice.get_mapped_range().ok()?;
		let mut out = Vec::with_capacity((tex.width * tex.height * bytes) as usize);
		for y in 0..tex.height {
			let start = (y * row) as usize;
			out.extend_from_slice(&data[start..start + (tex.width * bytes) as usize]);
		}
		Some(out)
	}
}

/// What a draw list turns into before it goes to the card.
#[derive(Default)]
struct Built {
	paints: Vec<[f32; 16]>,
	clips: Vec<[f32; 16]>,
	ramps: Vec<[u8; (RAMP_W * 4) as usize]>,
	instances: Vec<Instance>,
	vertices: Vec<Vertex>,
	indices: Vec<u32>,
	passes: Vec<Pass>,
	/// Layers this draw needs, by id.
	layers: Vec<u32>,
}

fn affine_inverse(m: &[f32; 6]) -> [f32; 6] {
	let [a, b, c, d, e, f] = *m;
	let det = a * d - b * c;
	if det.abs() < 1e-12 {
		return [0.0; 6];
	}
	let (ia, ib, ic, id) = (d / det, -b / det, -c / det, a / det);
	[ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)]
}

/// A layer's composite quad is marked with this transform and given the target's box at draw time.
const WHOLE_TARGET: [f32; 6] = [f32::NAN; 6];

impl Built {
	fn paint(&mut self, paint: &Paint) -> (f32, Option<u32>) {
		let mut rec = [0.0f32; 16];
		let mut texture = None;
		match paint {
			Paint::Solid(c) => {
				rec[4..8].copy_from_slice(&c.0);
			}
			Paint::Linear { from, to, stops } | Paint::Radial { center: from, radius: to, stops } => {
				let row = self.ramps.len().min(RAMP_H as usize - 1);
				if self.ramps.len() < RAMP_H as usize {
					self.ramps.push(ramp_row(stops));
				}
				rec[0] = if matches!(paint, Paint::Linear { .. }) { 1.0 } else { 2.0 };
				rec[1] = row as f32;
				rec[8..12].copy_from_slice(&[from.0, from.1, to.0, to.1]);
			}
			Paint::Image { texture: t, opacity, uv } => {
				rec[0] = 3.0;
				rec[2] = *opacity;
				rec[12..16].copy_from_slice(uv);
				texture = Some(*t);
			}
		}
		self.paints.push(rec);
		((self.paints.len() - 1) as f32, texture)
	}

	fn clip(&mut self, clip: &Clip) -> f32 {
		let inv = affine_inverse(&clip.transform.0);
		let mut rec = [0.0f32; 16];
		rec[0..4].copy_from_slice(&inv[0..4]);
		rec[4..8].copy_from_slice(&[inv[4], inv[5], clip.shape.w, clip.shape.h]);
		rec[8..12].copy_from_slice(&clip.shape.radii);
		rec[12] = if clip.shape.ellipse { 1.0 } else { 0.0 };
		self.clips.push(rec);
		(self.clips.len() - 1) as f32
	}

	fn push_shape(&mut self, shape: &Shape, xf: &[f32; 6], params: [f32; 4], extra: [f32; 4], texture: Option<u32>) {
		let at = self.instances.len() as u32;
		self.instances.push(Instance { xf0: [xf[0], xf[1], xf[2], xf[3]], xf1: [xf[4], xf[5], shape.w, shape.h], radii: shape.radii, params, extra });
		let pass = self.passes.last_mut().expect("a pass is open");
		match pass.cmds.last_mut() {
			Some(Cmd::Shapes { range, texture: t }) if *t == texture && range.end == at => range.end = at + 1,
			_ => pass.cmds.push(Cmd::Shapes { range: at..at + 1, texture }),
		}
	}

	fn build(list: &DrawList, next_layer: &mut u32, sizes: &HashMap<u32, (u32, u32)>) -> Built {
		let mut b = Built::default();
		b.passes.push(Pass { layer: None, depth: 0, clear: Some(list.clear), cmds: Vec::new() });
		let mut clips: Vec<f32> = Vec::new();
		let mut layers: Vec<(u32, f32)> = Vec::new();
		for op in &list.ops {
			let clip = clips.last().copied().unwrap_or(-1.0);
			match op {
				Op::Shape { shape, transform, paint, stroke } => {
					let (p, texture) = b.paint(paint);
					let ellipse = shape.ellipse as u8 as f32;
					let params = match stroke {
						None => [0.0, 0.0, 0.0, ellipse],
						Some((w, align)) => {
							let a = match align {
								Align::Inside => -1.0,
								Align::Center => 0.0,
								Align::Outside => 1.0,
							};
							[1.0, *w, a, ellipse]
						}
					};
					b.push_shape(shape, &transform.0, params, [0.0, 0.0, p, clip], texture);
				}
				Op::Shadow { shape, transform, color, blur, spread } => {
					let (p, _) = b.paint(&Paint::Solid(*color));
					// CSS's blur radius is two of the Gaussian's sigmas.
					b.push_shape(shape, &transform.0, [2.0, 0.0, 0.0, shape.ellipse as u8 as f32], [blur / 2.0, *spread, p, clip], None);
				}
				Op::Mesh { vertices, indices, transform, paint } => {
					let (p, texture) = b.paint(paint);
					let (mut x1, mut y1) = (0.0f32, 0.0f32);
					for v in vertices {
						x1 = x1.max(v[0]);
						y1 = y1.max(v[1]);
					}
					let base = b.vertices.len() as u32;
					for v in vertices {
						let (tx, ty) = transform.apply(v[0], v[1]);
						b.vertices.push(Vertex { target: [tx, ty], local: *v, refs: [p, clip], size: [x1, y1] });
					}
					let start = b.indices.len() as u32;
					b.indices.extend(indices.iter().map(|i| i + base));
					let end = b.indices.len() as u32;
					let pass = b.passes.last_mut().expect("a pass is open");
					match pass.cmds.last_mut() {
						Some(Cmd::Mesh { range, texture: t }) if *t == texture && range.end == start => range.end = end,
						_ => pass.cmds.push(Cmd::Mesh { range: start..end, texture }),
					}
				}
				Op::Picture { texture, x, y, w, h, uv, opacity } => {
					let (p, texture) = b.paint(&Paint::Image { texture: *texture, opacity: *opacity, uv: *uv });
					b.push_shape(&Shape { w: *w, h: *h, radii: [0.0; 4], ellipse: false }, &[1.0, 0.0, 0.0, 1.0, *x, *y], [3.0, 0.0, 0.0, 0.0], [0.0, 0.0, p, clip], texture);
				}
				Op::Glyphs { texture, quads, color, transform, colored } => {
					let (p, _) = b.paint(&Paint::Solid(*color));
					let (tw, th) = sizes.get(texture).copied().unwrap_or((1, 1));
					let (tw, th) = (tw as f32, th as f32);
					let mode = if *colored { 5.0 } else { 4.0 };
					for q in quads {
						let xf = transform.then(&stage_paint::list::Affine::translate(q.x, q.y));
						let uv = [q.u / tw, q.v / th, (q.u + q.w) / tw, (q.v + q.h) / th];
						b.push_shape(&Shape { w: q.w, h: q.h, radii: uv, ellipse: false }, &xf.0, [mode, 0.0, 0.0, 0.0], [0.0, 0.0, p, clip], Some(*texture));
					}
				}
				Op::PushClip(c) => {
					// Only the innermost clip holds for now; clips inside clips are rare on a stage.
					let index = b.clip(c);
					clips.push(index);
				}
				Op::PopClip => {
					clips.pop();
				}
				Op::PushLayer { opacity } => {
					let id = *next_layer;
					*next_layer = next_layer.wrapping_add(1).max(LAYER_IDS);
					layers.push((id, *opacity));
					b.layers.push(id);
					b.passes.push(Pass { layer: Some(id), depth: layers.len(), clear: Some(Color::TRANSPARENT), cmds: Vec::new() });
				}
				Op::PopLayer => {
					let Some((id, opacity)) = layers.pop() else { continue };
					let parent = layers.last().map(|(l, _)| *l);
					b.passes.push(Pass { layer: parent, depth: layers.len(), clear: None, cmds: Vec::new() });
					// The layer laid down over its parent, across the whole target, at its opacity.
					let (p, texture) = b.paint(&Paint::Image { texture: id, opacity, uv: [0.0, 0.0, 1.0, 1.0] });
					b.push_shape(&Shape { w: 1.0, h: 1.0, radii: [0.0; 4], ellipse: false }, &WHOLE_TARGET, [0.0; 4], [0.0, 0.0, p, clip], texture);
				}
			}
		}
		b
	}
}

/// A gradient's colours along 256 texels, premultiplied, as one row of the ramp texture.
fn ramp_row(stops: &[(f32, Color)]) -> [u8; (RAMP_W * 4) as usize] {
	let mut row = [0u8; (RAMP_W * 4) as usize];
	for i in 0..RAMP_W as usize {
		let t = i as f32 / (RAMP_W - 1) as f32;
		let c = match stops.iter().position(|(at, _)| *at >= t) {
			None => stops.last().map_or([0.0; 4], |s| s.1.0),
			Some(0) => stops[0].1.0,
			Some(k) => {
				let (a, ca) = stops[k - 1];
				let (b, cb) = stops[k];
				let f = if b > a { (t - a) / (b - a) } else { 0.0 };
				[0, 1, 2, 3].map(|j| ca.0[j] + (cb.0[j] - ca.0[j]) * f)
			}
		};
		for j in 0..4 {
			row[i * 4 + j] = (c[j].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
		}
	}
	row
}

impl Backend for Gpu {
	fn texture(&mut self, id: u32, kind: TextureKind, width: u32, height: u32, pixels: Option<&[u8]>) {
		let tex = self.make_texture(kind, width, height);
		if let Some(pixels) = pixels {
			let bytes = if kind == TextureKind::Mask { 1 } else { 4 };
			self.queue.write_texture(
				tex.texture.as_image_copy(),
				pixels,
				wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(tex.width * bytes), rows_per_image: Some(tex.height) },
				wgpu::Extent3d { width: tex.width, height: tex.height, depth_or_array_layers: 1 },
			);
		}
		self.textures.insert(id, tex);
	}

	fn write(&mut self, id: u32, x: u32, y: u32, width: u32, height: u32, pixels: &[u8]) {
		let Some(tex) = self.textures.get(&id) else { return };
		let bytes = if tex.kind == TextureKind::Mask { 1 } else { 4 };
		self.queue.write_texture(
			wgpu::TexelCopyTextureInfo { texture: &tex.texture, mip_level: 0, origin: wgpu::Origin3d { x, y, z: 0 }, aspect: wgpu::TextureAspect::All },
			pixels,
			wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * bytes), rows_per_image: Some(height) },
			wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
		);
	}

	fn forget(&mut self, id: u32) {
		self.textures.remove(&id);
	}

	fn resize(&mut self, width: u32, height: u32) {
		if let Some((surface, config)) = &mut self.surface {
			config.width = width.max(1);
			config.height = height.max(1);
			surface.configure(&self.device, config);
		}
	}

	fn draw(&mut self, target: Target, list: &DrawList) {
		// The target: a texture of ours, or the surface's next frame.
		let (frame, target_view, width, height, format) = match target {
			Target::Texture(id) => {
				let Some(tex) = self.textures.get(&id) else { return };
				(None, tex.view.clone(), tex.width, tex.height, wgpu::TextureFormat::Rgba8Unorm)
			}
			Target::Screen => {
				let Some((surface, config)) = &self.surface else { return };
				let frame = match surface.get_current_texture() {
					wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
					_ => return,
				};
				let view = frame.texture.create_view(&Default::default());
				(Some(frame), view, config.width, config.height, config.format)
			}
		};
		let sizes: HashMap<u32, (u32, u32)> = list
			.ops
			.iter()
			.filter_map(|op| if let Op::Glyphs { texture, .. } = op { self.textures.get(texture).map(|t| (*texture, (t.width, t.height))) } else { None })
			.collect();
		let mut built = Built::build(list, &mut self.next_layer, &sizes);
		for inst in built.instances.iter_mut() {
			if inst.xf0[0].is_nan() {
				inst.xf0 = [width as f32, 0.0, 0.0, height as f32];
				inst.xf1[0] = 0.0;
				inst.xf1[1] = 0.0;
			}
		}
		for id in &built.layers {
			let tex = self.make_texture(TextureKind::Color, width, height);
			self.textures.insert(*id, tex);
		}
		for (i, row) in built.ramps.iter().enumerate() {
			self.queue.write_texture(
				wgpu::TexelCopyTextureInfo { texture: &self.ramp, mip_level: 0, origin: wgpu::Origin3d { x: 0, y: i as u32, z: 0 }, aspect: wgpu::TextureAspect::All },
				row,
				wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(RAMP_W * 4), rows_per_image: Some(1) },
				wgpu::Extent3d { width: RAMP_W, height: 1, depth_or_array_layers: 1 },
			);
		}
		if built.paints.is_empty() {
			built.paints.push([0.0; 16]);
		}
		if built.clips.is_empty() {
			built.clips.push([0.0; 16]);
		}
		let device = &self.device;
		let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("frame"), contents: bytemuck::cast_slice(&[width as f32, height as f32, 0.0, 0.0]), usage: wgpu::BufferUsages::UNIFORM });
		let paints = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("paints"), contents: bytemuck::cast_slice(&built.paints), usage: wgpu::BufferUsages::STORAGE });
		let clips = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("clips"), contents: bytemuck::cast_slice(&built.clips), usage: wgpu::BufferUsages::STORAGE });
		let frame_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
			label: Some("frame"),
			layout: &self.frame_layout,
			entries: &[
				wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
				wgpu::BindGroupEntry { binding: 1, resource: paints.as_entire_binding() },
				wgpu::BindGroupEntry { binding: 2, resource: clips.as_entire_binding() },
				wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&self.ramp_view) },
				wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::Sampler(&self.sampler) },
			],
		});
		let instances = (!built.instances.is_empty()).then(|| device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("instances"), contents: bytemuck::cast_slice(&built.instances), usage: wgpu::BufferUsages::VERTEX }));
		let vertices = (!built.vertices.is_empty()).then(|| device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("vertices"), contents: bytemuck::cast_slice(&built.vertices), usage: wgpu::BufferUsages::VERTEX }));
		let indices = (!built.indices.is_empty()).then(|| device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("indices"), contents: bytemuck::cast_slice(&built.indices), usage: wgpu::BufferUsages::INDEX }));
		// Everything each pass needs, made before any pass begins.
		let mut views = Vec::with_capacity(built.passes.len());
		for pass in &built.passes {
			let (resolve, pass_format) = match pass.layer {
				None => (target_view.clone(), format),
				Some(id) => (self.textures[&id].view.clone(), wgpu::TextureFormat::Rgba8Unorm),
			};
			self.ensure_pipelines(pass_format);
			let msaa = self.msaa_view(width, height, pass_format, pass.depth);
			views.push((resolve, msaa, pass_format));
		}
		let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("stage draw") });
		for (pass, (resolve, msaa, pass_format)) in built.passes.iter().zip(&views) {
			let load = match pass.clear {
				Some(c) => wgpu::LoadOp::Clear(wgpu::Color { r: c.0[0] as f64, g: c.0[1] as f64, b: c.0[2] as f64, a: c.0[3] as f64 }),
				None => wgpu::LoadOp::Load,
			};
			let pipelines = &self.pipelines[pass_format];
			let mut rp = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
				label: Some("stage pass"),
				color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: msaa, depth_slice: None, resolve_target: Some(resolve), ops: wgpu::Operations { load, store: wgpu::StoreOp::Store } })],
				depth_stencil_attachment: None,
				timestamp_writes: None,
				occlusion_query_set: None,
				multiview_mask: None,
			});
			rp.set_bind_group(0, &frame_group, &[]);
			for cmd in &pass.cmds {
				let picture = |t: &Option<u32>| t.and_then(|id| self.textures.get(&id)).map_or(&self.white, |tex| &tex.picture);
				match cmd {
					Cmd::Shapes { range, texture } => {
						rp.set_pipeline(&pipelines.shape);
						rp.set_bind_group(1, picture(texture), &[]);
						rp.set_vertex_buffer(0, instances.as_ref().expect("shapes have instances").slice(..));
						rp.draw(0..4, range.clone());
					}
					Cmd::Mesh { range, texture } => {
						rp.set_pipeline(&pipelines.mesh);
						rp.set_bind_group(1, picture(texture), &[]);
						rp.set_vertex_buffer(0, vertices.as_ref().expect("meshes have vertices").slice(..));
						rp.set_index_buffer(indices.as_ref().expect("meshes have indices").slice(..), wgpu::IndexFormat::Uint32);
						rp.draw_indexed(range.clone(), 0, 0..1);
					}
				}
			}
		}
		self.queue.submit([encoder.finish()]);
		for id in &built.layers {
			self.textures.remove(id);
		}
		if let Some(frame) = frame {
			self.queue.present(frame);
		}
	}

	fn lost(&self) -> bool {
		self.lost.load(Ordering::SeqCst)
	}
}

/// A device on this machine's own graphics card, with no window: for tests and offline pictures.
#[cfg(not(target_arch = "wasm32"))]
pub async fn headless() -> Option<Gpu> {
	let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::METAL, ..wgpu::InstanceDescriptor::new_without_display_handle() });
	let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions::default()).await.ok()?;
	let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.ok()?;
	Some(Gpu::new(device, queue))
}

#[cfg(test)]
mod tests;
