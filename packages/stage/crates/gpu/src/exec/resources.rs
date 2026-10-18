//! What stays on the device from one draw to the next, so a frame writes into buffers and textures
//! it already has instead of making new ones: the instance, vertex and index buffers (grown when a
//! draw needs more, written with `write_buffer`), the frame uniform, the paint and clip table (grown
//! by rows, written with `write_texture`), the gradient ramps, and the layer and multisampled
//! textures each target size needs.

use crate::exec::pipelines::Pipelines;
use stage_paint::TextureKind;
use stage_render::batch::{RAMP_H, RAMP_W};
use stage_render::{Limits, Table};
use std::collections::HashMap;
use wgpu::util::DeviceExt;

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
		let format = match kind {
			TextureKind::Color => wgpu::TextureFormat::Rgba8Unorm,
			TextureKind::Mask => wgpu::TextureFormat::R8Unorm,
		};
		let texture = device.create_texture(&wgpu::TextureDescriptor {
			label: Some("stage texture"),
			size: wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
			mip_level_count: 1,
			sample_count: 1,
			dimension: wgpu::TextureDimension::D2,
			format,
			usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::RENDER_ATTACHMENT,
			view_formats: &[],
		});
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
}

impl Resources {
	pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, pipelines: &Pipelines) -> Resources {
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
		let uniform = device.create_buffer(&wgpu::BufferDescriptor { label: Some("frame"), size: 16, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
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
		}
	}

	/// Write a draw's ramps, table, frame uniform and geometry.
	#[allow(clippy::too_many_arguments)]
	pub fn upload(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, pipelines: &Pipelines, limits: &Limits, built: &stage_render::Built, width: u32, height: u32) {
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
		queue.write_buffer(&self.uniform, 0, bytemuck::cast_slice(&[(width as f32).to_bits(), (height as f32).to_bits(), table.clip_base, 0]));
		self.instances.write(device, queue, bytemuck::cast_slice(&built.instances));
		self.vertices.write(device, queue, bytemuck::cast_slice(&built.vertices));
		self.indices.write(device, queue, bytemuck::cast_slice(&built.indices));
		self.frame.get_or_insert_with(|| {
			device.create_bind_group(&wgpu::BindGroupDescriptor {
				label: Some("frame"),
				layout: &pipelines.frame_layout,
				entries: &[
					wgpu::BindGroupEntry { binding: 0, resource: self.uniform.as_entire_binding() },
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

	/// Lend the draw a layer texture of this size for each of its layers. Each pass that begins a
	/// layer clears it, so what a texture held before does not show.
	pub fn lend_layers(&mut self, device: &wgpu::Device, pipelines: &Pipelines, ids: &[u32], width: u32, height: u32) {
		let spare = self.spare.entry((width, height)).or_default();
		for id in ids {
			let tex = spare.pop().unwrap_or_else(|| Tex::new(device, &pipelines.picture_layout, TextureKind::Color, width, height));
			self.lent.insert(*id, tex);
		}
	}

	/// Take back the layer textures lent to the draw just submitted.
	pub fn return_layers(&mut self) {
		for (_, tex) in self.lent.drain() {
			self.spare.entry((tex.width, tex.height)).or_default().push(tex);
		}
	}

	/// Let go of what was kept for drawing at this size: the screen was this size and is not now.
	pub fn forget_size(&mut self, width: u32, height: u32) {
		self.msaa.retain(|(w, h, _, _), _| (*w, *h) != (width, height));
		self.spare.remove(&(width, height));
	}
}
