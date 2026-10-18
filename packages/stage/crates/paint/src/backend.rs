//! The one interface every graphics backend implements: wgpu on WebGPU or WebGL 2 today, Metal
//! later, without the painter, the tiles or the document knowing.

use crate::list::{Color, DrawList};

/// Where a draw list lands: a texture of ours (a tile, a layer) or the screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
	Texture(u32),
	/// The first screen surface.
	Screen,
	/// Another screen surface, by the order it was added: the page has one under its boards' pages
	/// and one over them.
	Surface(u32),
}

/// What a texture is for, which decides its format.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextureKind {
	/// Colour, premultiplied: tiles, pictures.
	Color,
	/// One channel of coverage: glyphs.
	Mask,
}

/// What the device a backend draws on allows, as far as the engine above it needs to know.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DeviceLimits {
	/// The widest and tallest texture, in texels.
	pub max_texture: u32,
	/// Samples a pixel the backend draws with (4, or 1 on a device short of them or of memory).
	pub samples: u32,
}

/// No picture is kept bigger than this across, whatever the device allows: a 4096-texel picture is
/// 64 MiB, and a board's picture is never shown wider than a screen.
pub const PICTURE_MAX: u32 = 4096;

impl DeviceLimits {
	/// The widest and tallest a picture (an image fill, a board's picture) is kept.
	pub fn max_picture(&self) -> u32 {
		self.max_texture.min(PICTURE_MAX)
	}
}

pub trait Backend {
	/// What the device allows: its biggest texture, and the samples a pixel drawn with.
	fn limits(&self) -> DeviceLimits;
	/// Make or remake a texture, optionally with pixels (RGBA8 premultiplied, or one byte a texel
	/// for a mask), rows tightly packed.
	fn texture(&mut self, id: u32, kind: TextureKind, width: u32, height: u32, pixels: Option<&[u8]>);
	/// Write pixels into part of a texture: a glyph into the glyph texture.
	fn write(&mut self, id: u32, x: u32, y: u32, width: u32, height: u32, pixels: &[u8]);
	fn forget(&mut self, id: u32);
	/// The screen's size in device pixels, when it changes.
	fn resize(&mut self, width: u32, height: u32);
	/// Draw a list onto a target, cleared first. Target pixels are the list's units.
	fn draw(&mut self, target: Target, list: &DrawList);
	/// Whether the device is gone and everything must be made again.
	fn lost(&self) -> bool;
}

/// A backend that keeps what it was asked to do, for tests that need no graphics card.
#[derive(Default, Debug)]
pub struct Recording {
	pub textures: std::collections::HashMap<u32, (TextureKind, u32, u32)>,
	pub frames: Vec<(Target, DrawList)>,
	pub screen: (u32, u32),
}

impl Backend for Recording {
	/// What WebGPU promises by default.
	fn limits(&self) -> DeviceLimits {
		DeviceLimits { max_texture: 8192, samples: 4 }
	}
	fn texture(&mut self, id: u32, kind: TextureKind, width: u32, height: u32, _: Option<&[u8]>) {
		self.textures.insert(id, (kind, width, height));
	}
	fn write(&mut self, id: u32, _: u32, _: u32, _: u32, _: u32, _: &[u8]) {
		assert!(self.textures.contains_key(&id), "write to texture {id}, which was never made");
	}
	fn forget(&mut self, id: u32) {
		self.textures.remove(&id);
	}
	fn resize(&mut self, width: u32, height: u32) {
		self.screen = (width, height);
	}
	fn draw(&mut self, target: Target, list: &DrawList) {
		if let Target::Texture(id) = target {
			assert!(self.textures.contains_key(&id), "draw to texture {id}, which was never made");
		}
		self.frames.push((target, list.clone()));
	}
	fn lost(&self) -> bool {
		false
	}
}

impl Recording {
	pub fn last(&self) -> Option<&DrawList> {
		self.frames.last().map(|(_, l)| l)
	}
}

pub const CLEAR: Color = Color::TRANSPARENT;

/// Hand the glyph texture's new glyphs to the card, making its two textures the first time.
pub fn flush_glyphs(atlas: &mut stage_text::atlas::Atlas, backend: &mut dyn Backend) {
	use stage_text::atlas::{COLOR_TEXTURE, MASK_TEXTURE, SIZE};
	if !atlas.made {
		backend.texture(MASK_TEXTURE, TextureKind::Mask, SIZE, SIZE, None);
		backend.texture(COLOR_TEXTURE, TextureKind::Color, SIZE, SIZE, None);
		atlas.made = true;
	}
	for (texture, x, y, w, h, pixels) in atlas.uploads.drain(..) {
		backend.write(texture, x, y, w, h, &pixels);
	}
}
