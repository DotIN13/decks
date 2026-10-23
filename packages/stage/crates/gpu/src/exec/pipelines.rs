//! The three pipelines a stage is drawn with (shapes, erasing shapes, meshes) and the bind group
//! layouts they share, made from the one shader. They are the same on every wgpu target; only the
//! colour format of what they draw into and the number of samples a pixel differ.

use stage_render::batch::{Instance, Vertex};
use std::collections::HashMap;

/// A pass's frame uniform: its size, the clips' start, its offset (`stage.wgsl`'s `Frame`).
pub const FRAME_BYTES: u64 = 32;
/// Where each pass's frame uniform starts in the buffer: what every device allows an offset at.
pub const FRAME_STRIDE: u64 = 256;

/// The pipelines for one colour format and sample count.
pub struct Set {
	pub shape: wgpu::RenderPipeline,
	pub erase: wgpu::RenderPipeline,
	pub mesh: wgpu::RenderPipeline,
}

pub struct Pipelines {
	/// Group 0: the frame uniform, the paint and clip table, the gradient ramps and their sampler.
	pub frame_layout: wgpu::BindGroupLayout,
	/// Group 1: the picture a command draws with (a glyph atlas, a tile, a layer, or white).
	pub picture_layout: wgpu::BindGroupLayout,
	layout: wgpu::PipelineLayout,
	module: wgpu::ShaderModule,
	/// The most samples a pixel any pass draws with (4, or 1 on a device short of memory or of
	/// samples). A draw with no triangles draws with one: see [`crate::exec::draw::samples_for`].
	pub samples: u32,
	sets: HashMap<(wgpu::TextureFormat, u32), Set>,
}

impl Pipelines {
	pub fn new(device: &wgpu::Device, samples: u32) -> Pipelines {
		let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("stage"), source: wgpu::ShaderSource::Wgsl(stage_render::shaders::STAGE_WGSL.into()) });
		let entry = |binding: u32, ty: wgpu::BindingType| wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::VERTEX_FRAGMENT, ty, count: None };
		// The paint and clip table: 32-bit floats, read texel by texel, never filtered.
		let table = wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false };
		let texture = wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false };
		let frame_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
			label: Some("frame"),
			entries: &[
				// Each pass's frame uniform, at its own offset in one buffer.
				entry(0, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: true, min_binding_size: wgpu::BufferSize::new(FRAME_BYTES) }),
				entry(1, table),
				entry(2, texture),
				entry(3, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
			],
		});
		let picture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("picture"), entries: &[entry(0, texture)] });
		let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("stage"), bind_group_layouts: &[Some(&frame_layout), Some(&picture_layout)], immediate_size: 0 });
		Pipelines { frame_layout, picture_layout, layout, module, samples, sets: HashMap::new() }
	}

	/// Make the pipelines for drawing into `format` with `samples` samples a pixel, once.
	pub fn prepare(&mut self, device: &wgpu::Device, format: wgpu::TextureFormat, samples: u32) {
		if !self.sets.contains_key(&(format, samples)) {
			let set = self.build(device, format, samples);
			self.sets.insert((format, samples), set);
		}
	}

	/// The pipelines for `format` and `samples`, made by [`prepare`](Self::prepare).
	pub fn get(&self, format: wgpu::TextureFormat, samples: u32) -> &Set {
		&self.sets[&(format, samples)]
	}

	fn build(&self, device: &wgpu::Device, format: wgpu::TextureFormat, samples: u32) -> Set {
		let blend = Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING);
		let target = [Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })];
		let multisample = wgpu::MultisampleState { count: samples, mask: !0, alpha_to_coverage_enabled: false };
		let instance_attrs = wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Float32x4, 4 => Float32x4];
		let instances = [Some(wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Instance>() as u64, step_mode: wgpu::VertexStepMode::Instance, attributes: &instance_attrs })];
		let strip = wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() };
		let pipeline = |label: &str, vs: &str, fs: &str, buffers: &[Option<wgpu::VertexBufferLayout>], targets: &[Option<wgpu::ColorTargetState>], primitive: wgpu::PrimitiveState| {
			device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
				label: Some(label),
				layout: Some(&self.layout),
				vertex: wgpu::VertexState { module: &self.module, entry_point: Some(vs), compilation_options: Default::default(), buffers },
				fragment: Some(wgpu::FragmentState { module: &self.module, entry_point: Some(fs), compilation_options: Default::default(), targets }),
				primitive,
				depth_stencil: None,
				multisample,
				multiview_mask: None,
				cache: None,
			})
		};
		let shape = pipeline("shapes", "vs_shape", "fs_shape", &instances, &target, strip);
		// Erasing keeps what is drawn only where the shape does not cover: dst × (1 − coverage).
		let clear = wgpu::BlendComponent { src_factor: wgpu::BlendFactor::Zero, dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha, operation: wgpu::BlendOperation::Add };
		let erase_target = [Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState { color: clear, alpha: clear }), write_mask: wgpu::ColorWrites::ALL })];
		let erase = pipeline("erase", "vs_shape", "fs_shape", &instances, &erase_target, strip);
		let vertex_attrs = wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2, 2 => Float32x2, 3 => Float32x2];
		let vertices = [Some(wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &vertex_attrs })];
		let mesh = pipeline("meshes", "vs_mesh", "fs_mesh", &vertices, &target, wgpu::PrimitiveState::default());
		Set { shape, erase, mesh }
	}
}
