//! What stays on the device from one draw to the next, so a frame writes into buffers and textures
//! it already has instead of making new ones: the instance, vertex and index buffers (grown when a
//! draw needs more, written with `write_buffer`), the frame uniform, the paint and clip table (grown
//! by rows, written with `write_texture`), the gradient ramps, and the layer and multisampled
//! textures each target size needs.

use crate::exec::pipelines::{FRAME_BYTES, FRAME_STRIDE, Pipelines};
use stage_paint::TextureKind;
use stage_render::batch::{RAMP_H, RAMP_W};
use stage_render::{Limits, Table};
use std::collections::HashMap;
use wgpu::util::DeviceExt;

/// How many sizes a `width` × `height` texture can have, each half the one before, down to one pixel.
pub fn levels_for(width: u32, height: u32) -> u32 {
	32 - width.max(height).max(1).leading_zeros()
}

/// A texture of the stage's: a tile, a glyph atlas, a picture, or a layer.
pub struct Tex {
	pub texture: wgpu::Texture,
	pub view: wgpu::TextureView,
	pub kind: TextureKind,
	pub width: u32,
	pub height: u32,
	/// The texture bound as a draw's picture (group 1).
	pub picture: wgpu::BindGroup,
}

impl Tex {
	pub fn new(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, kind: TextureKind, width: u32, height: u32) -> Tex {
		Tex::with_levels(device, layout, kind, width, height, 1)
	}

	/// As `new`, with `levels` sizes, each half the one before (`mips.rs`): a picture drawn small.
	pub fn with_levels(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, kind: TextureKind, width: u32, height: u32, levels: u32) -> Tex {
		let format = match kind {
			TextureKind::Color => wgpu::TextureFormat::Rgba8Unorm,
			TextureKind::Mask => wgpu::TextureFormat::R8Unorm,
		};
		Tex::with_format(device, layout, format, width, height, levels)
	}

	/// A colour texture of `format` with `levels` sizes: RGBA8, drawn into and read from, or a
	/// compressed picture (`ASTC`), only written and drawn from.
	pub fn with_format(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, format: wgpu::TextureFormat, width: u32, height: u32, levels: u32) -> Tex {
		let usage = wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC;
		let usage = if format.is_compressed() { usage } else { usage | wgpu::TextureUsages::RENDER_ATTACHMENT };
		let texture = device.create_texture(&wgpu::TextureDescriptor {
			label: Some("stage texture"),
			size: wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
			mip_level_count: levels.clamp(1, levels_for(width, height)),
			sample_count: 1,
			dimension: wgpu::TextureDimension::D2,
			format,
			usage,
			view_formats: &[],
		});
		let kind = if format == wgpu::TextureFormat::R8Unorm { TextureKind::Mask } else { TextureKind::Color };
		Tex::wrap(device, layout, texture, kind)
	}

	pub fn wrap(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, texture: wgpu::Texture, kind: TextureKind) -> Tex {
		let view = texture.create_view(&Default::default());
		let picture = device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("picture"), layout, entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) }] });
		let (width, height) = (texture.width(), texture.height());
		Tex { texture, view, kind, width, height, picture }
	}
}

/// A vertex or index buffer kept between draws: written in place, and made again, twice as big,
/// only when a draw needs more than it holds.
pub struct Growable {
	label: &'static str,
	usage: wgpu::BufferUsages,
	buffer: Option<wgpu::Buffer>,
}

impl Growable {
	fn new(label: &'static str, usage: wgpu::BufferUsages) -> Growable {
		Growable { label, usage: usage | wgpu::BufferUsages::COPY_DST, buffer: None }
	}

	/// Put `bytes` at the start of the buffer, growing it first if they do not fit. Nothing for none.
	fn write(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, bytes: &[u8]) {
		if bytes.is_empty() {
			return;
		}
		let need = bytes.len() as u64;
		if self.buffer.as_ref().is_none_or(|b| b.size() < need) {
			let size = need.next_power_of_two().max(4096);
			self.buffer = Some(device.create_buffer(&wgpu::BufferDescriptor { label: Some(self.label), size, usage: self.usage, mapped_at_creation: false }));
		}
		queue.write_buffer(self.buffer.as_ref().expect("just made"), 0, bytes);
	}

	pub fn get(&self) -> Option<&wgpu::Buffer> {
		self.buffer.as_ref()
	}
}

/// The paint and clip table's texture, as many rows tall as the largest draw so far has needed
/// (rounded up to a power of two), and the frame bind group that refers to it.
struct TableTexture {
	view: wgpu::TextureView,
	texture: wgpu::Texture,
	rows: u32,
}

pub struct Resources {
	ramp: wgpu::Texture,
	ramp_view: wgpu::TextureView,
	sampler: wgpu::Sampler,
	/// White, for commands that draw with no picture.
	pub white: wgpu::BindGroup,
	/// The passes' frame uniforms, [`FRAME_STRIDE`] apart; grown when a draw has more passes.
	uniform: wgpu::Buffer,
	table: Option<TableTexture>,
	/// The frame bind group (uniform, table, ramps, sampler): made again only when the table grows.
	frame: Option<wgpu::BindGroup>,
	pub instances: Growable,
	pub vertices: Growable,
	pub indices: Growable,
	/// Multisampled textures, one for each size, format and layer depth drawn into.
	msaa: HashMap<(u32, u32, wgpu::TextureFormat, usize), wgpu::TextureView>,
	/// Layer textures not in use, by size; a draw borrows them into `lent` and gives them back.
	spare: HashMap<(u32, u32), Vec<Tex>>,
	/// The layer textures of the draw under way, by the ids its passes and commands know them by.
	pub lent: HashMap<u32, Tex>,
	/// Sizes other than a target's (blurred layers' and their blurs'), with the draw each was last
	/// used in: what is kept for them goes when none has used it for [`ODD_SIZES_KEPT`] draws.
	odd: HashMap<(u32, u32), u64>,
	draws: u64,
}

/// Draws a size no target has stays kept for after its last use.
const ODD_SIZES_KEPT: u64 = 240;

impl Resources {
	pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, pipelines: &Pipelines) -> Resources {
		let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
			label: Some("smooth"),
			mag_filter: wgpu::FilterMode::Linear,
			min_filter: wgpu::FilterMode::Linear,
			// Between a picture's sizes too (`mips.rs`); a texture with one size is unchanged.
			mipmap_filter: wgpu::MipmapFilterMode::Linear,
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
			queue,
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
		let white = device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("white"), layout: &pipelines.picture_layout, entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&white_view) }] });
		let uniform = device.create_buffer(&wgpu::BufferDescriptor { label: Some("frame"), size: FRAME_STRIDE * 4, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
		Resources {
			ramp,
			ramp_view,
			sampler,
			white,
			uniform,
			table: None,
			frame: None,
			instances: Growable::new("instances", wgpu::BufferUsages::VERTEX),
			vertices: Growable::new("vertices", wgpu::BufferUsages::VERTEX),
			indices: Growable::new("indices", wgpu::BufferUsages::INDEX),
			msaa: HashMap::new(),
			spare: HashMap::new(),
			lent: HashMap::new(),
			odd: HashMap::new(),
			draws: 0,
		}
	}

	/// Write a draw's ramps, table, frame uniform and geometry.
	#[allow(clippy::too_many_arguments)]
	pub fn upload(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, pipelines: &Pipelines, limits: &Limits, built: &stage_render::Built) {
		for (i, row) in built.ramps.iter().enumerate() {
			queue.write_texture(
				wgpu::TexelCopyTextureInfo { texture: &self.ramp, mip_level: 0, origin: wgpu::Origin3d { x: 0, y: i as u32, z: 0 }, aspect: wgpu::TextureAspect::All },
				row,
				wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(RAMP_W * 4), rows_per_image: Some(1) },
				wgpu::Extent3d { width: RAMP_W, height: 1, depth_or_array_layers: 1 },
			);
		}
		let table = Table::pack(&built.paints, &built.clips, limits.table_width, limits.max_texture);
		if self.table.as_ref().is_none_or(|t| t.rows < table.rows) {
			let rows = table.rows.next_power_of_two().min(limits.max_texture.max(table.rows));
			let texture = device.create_texture(&wgpu::TextureDescriptor {
				label: Some("table"),
				size: wgpu::Extent3d { width: table.width, height: rows, depth_or_array_layers: 1 },
				mip_level_count: 1,
				sample_count: 1,
				dimension: wgpu::TextureDimension::D2,
				format: wgpu::TextureFormat::Rgba32Float,
				usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
				view_formats: &[],
			});
			let view = texture.create_view(&Default::default());
			self.table = Some(TableTexture { view, texture, rows });
			self.frame = None;
		}
		let tt = self.table.as_ref().expect("just made");
		queue.write_texture(
			tt.texture.as_image_copy(),
			table.bytes(),
			wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(table.row_bytes()), rows_per_image: Some(table.rows) },
			wgpu::Extent3d { width: table.width, height: table.rows, depth_or_array_layers: 1 },
		);
		// Each pass's frame: what it draws into, and where target pixels land in it.
		let need = FRAME_STRIDE * built.passes.len().max(1) as u64;
		if self.uniform.size() < need {
			self.uniform = device.create_buffer(&wgpu::BufferDescriptor { label: Some("frame"), size: need.next_power_of_two(), usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
			self.frame = None;
		}
		let mut frames = vec![0u32; (need / 4) as usize];
		for (i, pass) in built.passes.iter().enumerate() {
			let v = pass.view;
			let at = i * (FRAME_STRIDE / 4) as usize;
			frames[at..at + 8].copy_from_slice(&[(v.width as f32).to_bits(), (v.height as f32).to_bits(), table.clip_base, 0, v.offset.0.to_bits(), v.offset.1.to_bits(), 0, 0]);
		}
		queue.write_buffer(&self.uniform, 0, bytemuck::cast_slice(&frames));
		self.instances.write(device, queue, bytemuck::cast_slice(&built.instances));
		self.vertices.write(device, queue, bytemuck::cast_slice(&built.vertices));
		self.indices.write(device, queue, bytemuck::cast_slice(&built.indices));
		self.frame.get_or_insert_with(|| {
			device.create_bind_group(&wgpu::BindGroupDescriptor {
				label: Some("frame"),
				layout: &pipelines.frame_layout,
				entries: &[
					wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: &self.uniform, offset: 0, size: wgpu::BufferSize::new(FRAME_BYTES) }) },
					wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&tt.view) },
					wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&self.ramp_view) },
					wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&self.sampler) },
				],
			})
		});
	}

	/// The frame bind group of the last [`upload`](Self::upload).
	pub fn frame(&self) -> &wgpu::BindGroup {
		self.frame.as_ref().expect("uploaded first")
	}

	/// The multisampled texture a pass of this size, format and layer depth draws into.
	pub fn msaa(&mut self, device: &wgpu::Device, samples: u32, width: u32, height: u32, format: wgpu::TextureFormat, depth: usize) -> wgpu::TextureView {
		self.msaa
			.entry((width, height, format, depth))
			.or_insert_with(|| {
				device
					.create_texture(&wgpu::TextureDescriptor {
						label: Some("multisampled"),
						size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
						mip_level_count: 1,
						sample_count: samples,
						dimension: wgpu::TextureDimension::D2,
						format,
						usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
						view_formats: &[],
					})
					.create_view(&Default::default())
			})
			.clone()
	}

	/// Lend the draw a layer texture of its size for each of its layers (`(id, width, height)`), for
	/// a target `width` × `height`. Each pass that begins a layer clears it, so what a texture held
	/// before does not show.
	pub fn lend_layers(&mut self, device: &wgpu::Device, pipelines: &Pipelines, layers: &[(u32, u32, u32)], width: u32, height: u32) {
		self.draws += 1;
		for &(id, w, h) in layers {
			if (w, h) != (width, height) {
				self.odd.insert((w, h), self.draws);
			}
			let tex = self.spare.entry((w, h)).or_default().pop().unwrap_or_else(|| Tex::new(device, &pipelines.picture_layout, TextureKind::Color, w, h));
			self.lent.insert(id, tex);
		}
	}

	/// Mark a size as used by this draw (a blurred layer's multisampled texture), when no target has it.
	pub fn used_size(&mut self, w: u32, h: u32, width: u32, height: u32) {
		if (w, h) != (width, height) {
			self.odd.insert((w, h), self.draws);
		}
	}

	/// Take back the layer textures lent to the draw just submitted, and let go of what was kept
	/// for sizes no draw has used for a while.
	pub fn return_layers(&mut self) {
		for (_, tex) in self.lent.drain() {
			self.spare.entry((tex.width, tex.height)).or_default().push(tex);
		}
		let now = self.draws;
		let stale: Vec<(u32, u32)> = self.odd.iter().filter(|(_, at)| now - **at > ODD_SIZES_KEPT).map(|(s, _)| *s).collect();
		for (w, h) in stale {
			self.odd.remove(&(w, h));
			self.forget_size(w, h);
		}
	}

	/// Let go of what was kept for drawing at this size: the screen was this size and is not now.
	pub fn forget_size(&mut self, width: u32, height: u32) {
		self.msaa.retain(|(w, h, _, _), _| (*w, *h) != (width, height));
		self.spare.remove(&(width, height));
	}
}
