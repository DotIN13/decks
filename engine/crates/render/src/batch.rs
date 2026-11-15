//! A draw list turned into what goes to the card: render passes of commands over one array of shape
//! instances and one of mesh vertices, the paints and clips they refer to, and gradient ramp rows.
//! It knows no graphics API; an executor uploads and runs it.

use stage_paint::list::{Align, Clip, Color, DrawList, LayerBlur, Op, Paint, Shape};
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
	/// What it draws into, and where target pixels land there.
	pub view: View,
	/// Drawn with one sample a pixel whatever the draw's are: a blur's passes, which only copy.
	pub single: bool,
}

/// A pass's texture: its size, and the offset a point in target pixels moves by to land in it. The
/// target's own and an unblurred layer's are the target's size with none; a blurred layer is the
/// part of the target (and past it) its contents and their blur cover; a blur's working textures
/// are their own size, drawn in their own pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
	pub width: u32,
	pub height: u32,
	pub offset: (f32, f32),
}

/// A blur's Gaussian is drawn at most this many sigmas wide in the texture it is drawn in: a wider
/// one is drawn on a texture halved (and halved again) and stretched back, so its passes cost about
/// the same whatever the radius.
pub const BLUR_SIGMA: f32 = 4.0;
/// The most a blur's texture is halved: 64 times smaller across, so a sigma of 256 pixels.
pub const BLUR_MOST_HALVED: u32 = 64;
/// A blurred layer's sides are a multiple of this, so a stage's few sizes of them are kept and used
/// again rather than made for each item.
pub const BLUR_ROUND: u32 = 128;

/// A blurred layer's texture: `blur.area` (which holds the blur's reach already), cut to `parent`
/// grown by the blur's reach (what lies further off blurs nothing onto it), its sides rounded up to
/// [`BLUR_ROUND`] and to how often it is halved, at most `max_side`. With the times it is halved.
pub fn blur_view(blur: &LayerBlur, parent: &View, max_side: u32) -> (View, u32) {
	let sigma = blur.sigma.max(0.0);
	let mut halved = 1u32;
	while sigma / halved as f32 > BLUR_SIGMA && halved < BLUR_MOST_HALVED {
		halved *= 2;
	}
	let m = (sigma * 3.0).ceil();
	let [ax, ay, aw, ah] = blur.area;
	let (px, py) = (-parent.offset.0, -parent.offset.1);
	// Its corner on a multiple of the halving in target pixels, so tiles side by side (whose corners
	// are multiples of their size) halve along the same grid and meet without a seam.
	let snap = |v: f32| (v / halved as f32).floor() * halved as f32;
	let x0 = snap(ax.max(px - m));
	let y0 = snap(ay.max(py - m));
	let x1 = (ax + aw).min(px + parent.width as f32 + m).ceil();
	let y1 = (ay + ah).min(py + parent.height as f32 + m).ceil();
	let unit = BLUR_ROUND.max(halved);
	let side = |a: f32, b: f32| {
		let want = ((b - a).max(1.0) as u32).div_ceil(unit) * unit;
		want.min((max_side / unit).max(1) * unit)
	};
	(View { width: side(x0, x1), height: side(y0, y1), offset: (-x0, -y0) }, halved)
}

/// A layer open while its contents are batched.
struct Open {
	id: u32,
	opacity: f32,
	blur: Option<(f32, u32)>,
	view: View,
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
	/// Layers this draw needs: their ids and sizes.
	pub layers: Vec<(u32, u32, u32)>,
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

	/// A new layer texture of `view`'s size, and a pass into it, cleared.
	fn layer_pass(&mut self, next_layer: &mut u32, view: View, depth: usize, single: bool) -> u32 {
		let id = *next_layer;
		*next_layer = next_layer.wrapping_add(1).max(LAYER_IDS);
		self.layers.push((id, view.width, view.height));
		self.passes.push(Pass { layer: Some(id), depth, clear: Some(Color::TRANSPARENT), cmds: Vec::new(), view, single });
		id
	}

	/// Blur layer `source` (`view`'s size) by `sigma` pixels, halved `halved` times first: the
	/// texture it ends in, a `halved`-th of the size.
	fn blur(&mut self, next_layer: &mut u32, source: u32, view: View, sigma: f32, halved: u32, depth: usize) -> u32 {
		let (mut at, mut w, mut h) = (source, view.width, view.height);
		let mut left = halved;
		while left > 1 {
			// Each pixel half the size samples the four under it, between them.
			(w, h) = ((w / 2).max(1), (h / 2).max(1));
			let into = View { width: w, height: h, offset: (0.0, 0.0) };
			let next = self.layer_pass(next_layer, into, depth, true);
			let (p, texture) = self.paint(&Paint::Image { texture: at, opacity: 1.0, uv: [0.0, 0.0, 1.0, 1.0] });
			self.push_shape(&Shape { w: w as f32, h: h as f32, radii: [0.0; 4], ellipse: false }, &[1.0, 0.0, 0.0, 1.0, 0.0, 0.0], [3.0, 0.0, 0.0, 0.0], [0.0, 0.0, p, -1.0], texture);
			at = next;
			left /= 2;
		}
		// Across, then down: a Gaussian is the two one-dimensional ones, one after the other.
		let small = sigma / halved as f32;
		for dir in [(1.0 / w as f32, 0.0), (0.0, 1.0 / h as f32)] {
			let into = View { width: w, height: h, offset: (0.0, 0.0) };
			let next = self.layer_pass(next_layer, into, depth, true);
			self.push_shape(&Shape { w: w as f32, h: h as f32, radii: [0.0; 4], ellipse: false }, &[1.0, 0.0, 0.0, 1.0, 0.0, 0.0], [7.0, dir.0, dir.1, 0.0], [small, 0.0, 0.0, -1.0], Some(at));
			at = next;
		}
		at
	}

	/// Batch a list for a target `width` × `height` pixels. `next_layer` hands out layer texture ids;
	/// `sizes` are the glyph textures' sizes, for their quads' uv; `max_side` is the largest texture
	/// the device makes, which a blurred layer is held to.
	pub fn build(list: &DrawList, next_layer: &mut u32, sizes: &HashMap<u32, (u32, u32)>, width: u32, height: u32, max_side: u32) -> Built {
		let mut b = Built::default();
		let whole = View { width, height, offset: (0.0, 0.0) };
		b.passes.push(Pass { layer: None, depth: 0, clear: Some(list.clear), cmds: Vec::new(), view: whole, single: false });
		let mut clips: Vec<f32> = Vec::new();
		let mut layers: Vec<Open> = Vec::new();
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
				Op::InnerShadow { shape, transform, offset, color, blur, spread } => {
					let (p, _) = b.paint(&Paint::Solid(*color));
					b.push_shape(shape, &transform.0, [6.0, offset.0, offset.1, shape.ellipse as u8 as f32], [blur / 2.0, *spread, p, clip], None);
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
				Op::PushLayer { opacity, blur } => {
					let parent = layers.last().map_or(whole, |l| l.view);
					let (view, blur) = match blur.filter(|bl| bl.sigma > 0.0) {
						Some(bl) => {
							let (view, halved) = blur_view(&bl, &parent, max_side.max(BLUR_ROUND));
							(view, Some((bl.sigma, halved)))
						}
						None => (parent, None),
					};
					let id = b.layer_pass(next_layer, view, layers.len() + 1, false);
					layers.push(Open { id, opacity: *opacity, blur, view });
				}
				Op::PopLayer => {
					let Some(open) = layers.pop() else { continue };
					let depth = layers.len();
					let shown = match open.blur {
						Some((sigma, halved)) => b.blur(next_layer, open.id, open.view, sigma, halved, depth + 1),
						None => open.id,
					};
					let parent = layers.last();
					b.passes.push(Pass { layer: parent.map(|l| l.id), depth, clear: None, cmds: Vec::new(), view: parent.map_or(whole, |l| l.view), single: false });
					// The layer laid down over its parent, where it lies in target pixels, at its opacity.
					let (p, texture) = b.paint(&Paint::Image { texture: shown, opacity: open.opacity, uv: [0.0, 0.0, 1.0, 1.0] });
					let (ox, oy) = open.view.offset;
					b.push_shape(&Shape { w: open.view.width as f32, h: open.view.height as f32, radii: [0.0; 4], ellipse: false }, &[1.0, 0.0, 0.0, 1.0, -ox, -oy], [0.0; 4], [0.0, 0.0, p, clip], texture);
				}
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
