//! A draw list turned into what goes to the card: render passes of commands over one array of shape
//! instances and one of mesh vertices, the paints and clips they refer to, and gradient ramp rows.
//! It knows no graphics API; an executor uploads and runs it.

use stage_paint::list::{Align, Clip, Color, DrawList, Op, Paint, Shape};
use std::collections::HashMap;

/// Gradients are cut into rows of this many colours in one texture, a row per gradient a draw.
pub const RAMP_W: u32 = 256;
pub const RAMP_H: u32 = 256;
/// Texture ids at and above this are the backend's own: layers.
pub const LAYER_IDS: u32 = 0xF000_0000;

/// One shape quad, read by `vs_shape` as instance attributes 0 to 4.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Instance {
	pub xf0: [f32; 4],
	pub xf1: [f32; 4],
	pub radii: [f32; 4],
	pub params: [f32; 4],
	pub extra: [f32; 4],
}

/// One mesh vertex, read by `vs_mesh` as vertex attributes 0 to 3.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
	pub target: [f32; 2],
	pub local: [f32; 2],
	pub refs: [f32; 2],
	pub size: [f32; 2],
}

/// What a pass draws, in order.
pub enum Cmd {
	Shapes { range: std::ops::Range<u32>, texture: Option<u32>, erase: bool },
	Mesh { range: std::ops::Range<u32>, texture: Option<u32> },
}

pub struct Pass {
	/// `None`: the list's own target; `Some(id)`: a layer's texture.
	pub layer: Option<u32>,
	pub depth: usize,
	pub clear: Option<Color>,
	pub cmds: Vec<Cmd>,
}

/// What a draw list turns into before it goes to the card.
#[derive(Default)]
pub struct Built {
	pub paints: Vec<[f32; 16]>,
	pub clips: Vec<[f32; 16]>,
	pub ramps: Vec<[u8; (RAMP_W * 4) as usize]>,
	pub instances: Vec<Instance>,
	pub vertices: Vec<Vertex>,
	pub indices: Vec<u32>,
	pub passes: Vec<Pass>,
	/// Layers this draw needs, by id.
	pub layers: Vec<u32>,
}

pub fn affine_inverse(m: &[f32; 6]) -> [f32; 6] {
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
			Paint::Linear { from, to, stops } | Paint::Radial { center: from, radius: to, stops } | Paint::Conic { center: from, radius: to, stops, .. } => {
				let row = self.ramps.len().min(RAMP_H as usize - 1);
				if self.ramps.len() < RAMP_H as usize {
					self.ramps.push(ramp_row(stops));
				}
				rec[0] = match paint {
					Paint::Linear { .. } => 1.0,
					Paint::Radial { .. } => 2.0,
					_ => 4.0,
				};
				rec[1] = row as f32;
				if let Paint::Conic { start, .. } = paint {
					rec[2] = *start;
				}
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
		self.push_instance(shape, xf, params, extra, texture, false);
	}

	fn push_instance(&mut self, shape: &Shape, xf: &[f32; 6], params: [f32; 4], extra: [f32; 4], texture: Option<u32>, erase: bool) {
		let at = self.instances.len() as u32;
		self.instances.push(Instance { xf0: [xf[0], xf[1], xf[2], xf[3]], xf1: [xf[4], xf[5], shape.w, shape.h], radii: shape.radii, params, extra });
		let pass = self.passes.last_mut().expect("a pass is open");
		match pass.cmds.last_mut() {
			Some(Cmd::Shapes { range, texture: t, erase: e }) if *t == texture && *e == erase && range.end == at => range.end = at + 1,
			_ => pass.cmds.push(Cmd::Shapes { range: at..at + 1, texture, erase }),
		}
	}

	/// Batch a list for a target `width` × `height` pixels. `next_layer` hands out layer texture ids;
	/// `sizes` are the glyph textures' sizes, for their quads' uv.
	pub fn build(list: &DrawList, next_layer: &mut u32, sizes: &HashMap<u32, (u32, u32)>, width: u32, height: u32) -> Built {
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
				Op::Erase { shape, transform } => {
					let (p, _) = b.paint(&Paint::Solid(Color([0.0, 0.0, 0.0, 1.0])));
					b.push_instance(shape, &transform.0, [0.0, 0.0, 0.0, shape.ellipse as u8 as f32], [0.0, 0.0, p, clip], None, true);
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
		// The layers' composite quads take the target's whole box.
		for inst in b.instances.iter_mut() {
			if inst.xf0[0].is_nan() {
				inst.xf0 = [width as f32, 0.0, 0.0, height as f32];
				inst.xf1[0] = 0.0;
				inst.xf1[1] = 0.0;
			}
		}
		b
	}
}

/// A gradient's colours along 256 texels, premultiplied, as one row of the ramp texture.
pub fn ramp_row(stops: &[(f32, Color)]) -> [u8; (RAMP_W * 4) as usize] {
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
