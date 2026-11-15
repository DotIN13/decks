//! A picture's smaller sizes, made on the GPU: each level half the one before, drawn from it with a
//! linear filter, so a board's picture is copied in once at one size and drawn at any zoom from the
//! level nearest the size it shows at. And a picture shrunk to its next size down, GPU to GPU, when
//! the pictures held outgrow their memory (`Gpu::shrink`).

const HALVE: &str = "
@group(0) @binding(0) var bigger: texture_2d<f32>;
@group(0) @binding(1) var smooth_sampler: sampler;

struct Out {
	@builtin(position) pos: vec4<f32>,
	@location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Out {
	// One triangle over the whole target.
	let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
	var out: Out;
	out.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
	out.uv = vec2<f32>(p.x, 1.0 - p.y);
	return out;
}

@fragment
fn fs(in: Out) -> @location(0) vec4<f32> {
	// Halfway between four texels of the level above: their average, premultiplied as they are.
	return textureSampleLevel(bigger, smooth_sampler, in.uv, 0.0);
}
";

pub struct Mips {
	pipeline: wgpu::RenderPipeline,
	layout: wgpu::BindGroupLayout,
	sampler: wgpu::Sampler,
}

impl Mips {
	pub fn new(device: &wgpu::Device) -> Mips {
		let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("halve"), source: wgpu::ShaderSource::Wgsl(HALVE.into()) });
		let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
			label: Some("halve"),
			entries: &[
				wgpu::BindGroupLayoutEntry {
					binding: 0,
					visibility: wgpu::ShaderStages::FRAGMENT,
					ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
					count: None,
				},
				wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
			],
		});
		let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("halve"), bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
		let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
			label: Some("halve"),
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
		let sampler = device.create_sampler(&wgpu::SamplerDescriptor { label: Some("halve"), mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() });
		Mips { pipeline, layout, sampler }
	}

	/// Fill every level of `texture` below the first from the one above it.
	pub fn fill(&self, device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture) {
		let levels = texture.mip_level_count();
		if levels < 2 {
			return;
		}
		let level = |n: u32| texture.create_view(&wgpu::TextureViewDescriptor { label: Some("level"), base_mip_level: n, mip_level_count: Some(1), ..Default::default() });
		let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("halve") });
		for n in 1..levels {
			let (from, to) = (level(n - 1), level(n));
			let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
				label: Some("halve"),
				layout: &self.layout,
				entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&from) }, wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) }],
			});
			let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
				label: Some("halve"),
				color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &to, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store } })],
				depth_stencil_attachment: None,
				timestamp_writes: None,
				occlusion_query_set: None,
				multiview_mask: None,
			});
			pass.set_pipeline(&self.pipeline);
			pass.set_bind_group(0, &group, &[]);
			pass.draw(0..3, 0..1);
		}
		queue.submit([encoder.finish()]);
	}
}
