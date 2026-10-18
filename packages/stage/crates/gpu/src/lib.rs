//! The first backend: wgpu, on WebGPU in the browser (and on Metal when the tests run on a Mac).
//!
//! It implements [`Backend`]: it turns a draw list into render passes and knows nothing of the
//! document. Shapes are instanced quads whose edges the shader works out exactly; meshes are the
//! painter's triangles, smoothed by four samples a pixel. Layers are drawn into a texture of their
//! own and laid down at their opacity. Paints and clips go up once a draw as one small table
//! texture. Batching, the table and the shader are stage-render's; this crate runs them on wgpu.

use stage_paint::list::{DrawList, Op};
use stage_paint::{Backend, Target, TextureKind};
use stage_render::batch::{Built, Cmd, Instance, LAYER_IDS, RAMP_H, RAMP_W, Vertex};
use stage_render::{Limits, Table};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use wgpu::util::DeviceExt;

const SAMPLES: u32 = 4;

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
	erase: wgpu::RenderPipeline,
	mesh: wgpu::RenderPipeline,
}

pub struct Gpu {
	pub device: wgpu::Device,
	pub queue: wgpu::Queue,
	surfaces: Vec<(wgpu::Surface<'static>, wgpu::SurfaceConfiguration)>,
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
	limits: Limits,
}

impl Gpu {
	/// A backend on a device the caller opened: the page's or the worker's.
	pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Gpu {
		let lost = Arc::new(AtomicBool::new(false));
		let flag = lost.clone();
		device.set_device_lost_callback(move |_, _| flag.store(true, Ordering::SeqCst));
		let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("stage"), source: wgpu::ShaderSource::Wgsl(stage_render::shaders::STAGE_WGSL.into()) });
		let entry = |binding: u32, ty: wgpu::BindingType| wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::VERTEX_FRAGMENT, ty, count: None };
		// The paint and clip table: 32-bit floats, read texel by texel, never filtered.
		let table = wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false };
		let texture = wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false };
		let frame_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
			label: Some("frame"),
			entries: &[
				entry(0, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }),
				entry(1, table),
				entry(2, texture),
				entry(3, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
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
		let limits = Limits { max_texture: device.limits().max_texture_dimension_2d, max_samples: SAMPLES, table_width: stage_render::limits::TABLE_WIDTH };
		Gpu {
			limits,
			device,
			queue,
			surfaces: Vec::new(),
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
		// Erasing keeps what is drawn only where the shape does not cover: dst × (1 − coverage).
		let clear = wgpu::BlendComponent { src_factor: wgpu::BlendFactor::Zero, dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha, operation: wgpu::BlendOperation::Add };
		let erase_target = [Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState { color: clear, alpha: clear }), write_mask: wgpu::ColorWrites::ALL })];
		let erase = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
			label: Some("erase"),
			layout: Some(&self.pipeline_layout),
			vertex: wgpu::VertexState {
				module: &self.module,
				entry_point: Some("vs_shape"),
				compilation_options: Default::default(),
				buffers: &[Some(wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Instance>() as u64, step_mode: wgpu::VertexStepMode::Instance, attributes: &instance_attrs })],
			},
			fragment: Some(wgpu::FragmentState { module: &self.module, entry_point: Some("fs_shape"), compilation_options: Default::default(), targets: &erase_target }),
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
		self.pipelines.insert(format, Pipelines { shape, erase, mesh });
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
		for (surface, config) in self.surfaces.iter_mut() {
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
			Target::Screen | Target::Surface(_) => {
				let index = if let Target::Surface(i) = target { i as usize } else { 0 };
				let Some((surface, config)) = self.surfaces.get(index) else { return };
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
		let built = Built::build(list, &mut self.next_layer, &sizes, width, height);
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
		let table = Table::pack(&built.paints, &built.clips, self.limits.table_width, self.limits.max_texture);
		let device = &self.device;
		let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
			label: Some("frame"),
			contents: bytemuck::cast_slice(&[(width as f32).to_bits(), (height as f32).to_bits(), table.clip_base, 0]),
			usage: wgpu::BufferUsages::UNIFORM,
		});
		let table_texture = device.create_texture_with_data(
			&self.queue,
			&wgpu::TextureDescriptor {
				label: Some("table"),
				size: wgpu::Extent3d { width: table.width, height: table.rows, depth_or_array_layers: 1 },
				mip_level_count: 1,
				sample_count: 1,
				dimension: wgpu::TextureDimension::D2,
				format: wgpu::TextureFormat::Rgba32Float,
				usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
				view_formats: &[],
			},
			wgpu::util::TextureDataOrder::LayerMajor,
			table.bytes(),
		);
		let table_view = table_texture.create_view(&Default::default());
		let frame_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
			label: Some("frame"),
			layout: &self.frame_layout,
			entries: &[
				wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
				wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&table_view) },
				wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&self.ramp_view) },
				wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&self.sampler) },
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
					Cmd::Shapes { range, texture, erase } => {
						rp.set_pipeline(if *erase { &pipelines.erase } else { &pipelines.shape });
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
	headless_with(wgpu::Limits::default()).await
}

/// The same, with the device held to these limits: `wgpu::Limits::downlevel_webgl2_defaults()`
/// draws on Metal as WebGL 2 would let it (no storage buffers, 2048-texel textures).
#[cfg(not(target_arch = "wasm32"))]
pub async fn headless_with(limits: wgpu::Limits) -> Option<Gpu> {
	let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::METAL, ..wgpu::InstanceDescriptor::new_without_display_handle() });
	let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions::default()).await.ok()?;
	let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor { required_limits: limits, ..Default::default() }).await.ok()?;
	Some(Gpu::new(device, queue))
}

#[cfg(test)]
mod tests;
