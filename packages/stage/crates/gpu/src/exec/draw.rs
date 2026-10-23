//! One draw: a [`Built`] batch run as render passes into a view, with the pipelines and the kept
//! resources. A draw with triangles draws each pass into a multisampled texture and resolves it into
//! its layer or the target; a draw without (and every draw on a device with one sample a pixel)
//! draws straight into the layer or the target.

use crate::exec::pipelines::{FRAME_STRIDE, Pipelines};
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

/// The samples a pixel `built` is drawn with, at most `most`: only triangles need more than one.
/// Shapes, glyphs and pictures carry their own soft edges, so a list of those alone (the page's
/// frame of tiles and board pictures, nearly always) is drawn straight into its target. Four samples
/// over the page's canvas (the window and its slack at 2×) held the card at 93% redrawing it each
/// frame (55% without), and each redraw during a pan stalled the screen for 40 to 60 ms.
pub fn samples_for(built: &Built, most: u32) -> u32 {
	let triangles = built.passes.iter().any(|p| p.cmds.iter().any(|c| matches!(c, Cmd::Mesh { .. })));
	if triangles { most } else { 1 }
}

/// Encode and submit `built` into `out`. `textures` are the stage's own (tiles, atlases, pictures).
#[allow(clippy::too_many_arguments)]
pub fn run(device: &wgpu::Device, queue: &wgpu::Queue, pipelines: &mut Pipelines, res: &mut Resources, limits: &Limits, textures: &HashMap<u32, Tex>, built: &Built, out: Out) {
	let (width, height) = (out.width, out.height);
	res.lend_layers(device, pipelines, &built.layers, width, height);
	res.upload(device, queue, pipelines, limits, built);
	let most = samples_for(built, pipelines.samples);
	// Everything each pass needs, made before any pass begins.
	let mut views = Vec::with_capacity(built.passes.len());
	for pass in &built.passes {
		let (resolve, format) = match pass.layer {
			None => (out.view.clone(), out.format),
			Some(id) => (res.lent[&id].view.clone(), wgpu::TextureFormat::Rgba8Unorm),
		};
		let samples = if pass.single { 1 } else { most };
		pipelines.prepare(device, format, samples);
		let (w, h) = (pass.view.width, pass.view.height);
		let msaa = (samples > 1).then(|| {
			res.used_size(w, h, width, height);
			res.msaa(device, samples, w, h, format, pass.depth)
		});
		views.push((resolve, msaa, format, samples));
	}
	encode(device, queue, pipelines, res, textures, built, &views);
	res.return_layers();
}

#[allow(clippy::too_many_arguments)]
fn encode(device: &wgpu::Device, queue: &wgpu::Queue, pipelines: &Pipelines, res: &Resources, textures: &HashMap<u32, Tex>, built: &Built, views: &[(wgpu::TextureView, Option<wgpu::TextureView>, wgpu::TextureFormat, u32)]) {
	let frame = res.frame();
	let picture = |t: &Option<u32>| t.and_then(|id| textures.get(&id).or_else(|| res.lent.get(&id))).map_or(&res.white, |tex| &tex.picture);
	let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("stage draw") });
	for (index, (pass, (resolve, msaa, format, samples))) in built.passes.iter().zip(views).enumerate() {
		let load = match pass.clear {
			Some(c) => wgpu::LoadOp::Clear(wgpu::Color { r: c.0[0] as f64, g: c.0[1] as f64, b: c.0[2] as f64, a: c.0[3] as f64 }),
			None => wgpu::LoadOp::Load,
		};
		let set = pipelines.get(*format, *samples);
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
		rp.set_bind_group(0, frame, &[(index as u64 * FRAME_STRIDE) as u32]);
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
