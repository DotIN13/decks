//! One draw: a [`Built`] batch run as render passes into a view, with the pipelines and the kept
//! resources. Each pass draws into a multisampled texture and resolves into its layer or the target;
//! with one sample a pixel it draws straight into the layer or the target.

use crate::exec::pipelines::Pipelines;
use crate::exec::resources::{Resources, Tex};
use stage_render::Limits;
use stage_render::batch::{Built, Cmd};
use std::collections::HashMap;

/// What a draw goes into: a texture of ours or a surface's frame, its size and colour format.
pub struct Out<'a> {
	pub view: &'a wgpu::TextureView,
	pub width: u32,
	pub height: u32,
	pub format: wgpu::TextureFormat,
}

/// Encode and submit `built` into `out`. `textures` are the stage's own (tiles, atlases, pictures).
#[allow(clippy::too_many_arguments)]
pub fn run(device: &wgpu::Device, queue: &wgpu::Queue, pipelines: &mut Pipelines, res: &mut Resources, limits: &Limits, textures: &HashMap<u32, Tex>, built: &Built, out: Out) {
	let (width, height) = (out.width, out.height);
	res.lend_layers(device, pipelines, &built.layers, width, height);
	res.upload(device, queue, pipelines, limits, built, width, height);
	// Everything each pass needs, made before any pass begins.
	let mut views = Vec::with_capacity(built.passes.len());
	for pass in &built.passes {
		let (resolve, format) = match pass.layer {
			None => (out.view.clone(), out.format),
			Some(id) => (res.lent[&id].view.clone(), wgpu::TextureFormat::Rgba8Unorm),
		};
		pipelines.prepare(device, format);
		let msaa = (pipelines.samples > 1).then(|| res.msaa(device, pipelines.samples, width, height, format, pass.depth));
		views.push((resolve, msaa, format));
	}
	encode(device, queue, pipelines, res, textures, built, &views);
	res.return_layers();
}

fn encode(device: &wgpu::Device, queue: &wgpu::Queue, pipelines: &Pipelines, res: &Resources, textures: &HashMap<u32, Tex>, built: &Built, views: &[(wgpu::TextureView, Option<wgpu::TextureView>, wgpu::TextureFormat)]) {
	let frame = res.frame();
	let picture = |t: &Option<u32>| t.and_then(|id| textures.get(&id).or_else(|| res.lent.get(&id))).map_or(&res.white, |tex| &tex.picture);
	let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("stage draw") });
	for (pass, (resolve, msaa, format)) in built.passes.iter().zip(views) {
		let load = match pass.clear {
			Some(c) => wgpu::LoadOp::Clear(wgpu::Color { r: c.0[0] as f64, g: c.0[1] as f64, b: c.0[2] as f64, a: c.0[3] as f64 }),
			None => wgpu::LoadOp::Load,
		};
		let set = pipelines.get(*format);
		let mut rp = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
			label: Some("stage pass"),
			color_attachments: &[Some(match msaa {
				Some(msaa) => wgpu::RenderPassColorAttachment { view: msaa, depth_slice: None, resolve_target: Some(resolve), ops: wgpu::Operations { load, store: wgpu::StoreOp::Store } },
				None => wgpu::RenderPassColorAttachment { view: resolve, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load, store: wgpu::StoreOp::Store } },
			})],
			depth_stencil_attachment: None,
			timestamp_writes: None,
			occlusion_query_set: None,
			multiview_mask: None,
		});
		rp.set_bind_group(0, frame, &[]);
		for cmd in &pass.cmds {
			match cmd {
				Cmd::Shapes { range, texture, erase } => {
					rp.set_pipeline(if *erase { &set.erase } else { &set.shape });
					rp.set_bind_group(1, picture(texture), &[]);
					rp.set_vertex_buffer(0, res.instances.get().expect("shapes have instances").slice(..));
					rp.draw(0..4, range.clone());
				}
				Cmd::Mesh { range, texture } => {
					rp.set_pipeline(&set.mesh);
					rp.set_bind_group(1, picture(texture), &[]);
					rp.set_vertex_buffer(0, res.vertices.get().expect("meshes have vertices").slice(..));
					rp.set_index_buffer(res.indices.get().expect("meshes have indices").slice(..), wgpu::IndexFormat::Uint32);
					rp.draw_indexed(range.clone(), 0, 0..1);
				}
			}
		}
	}
	queue.submit([encoder.finish()]);
}
