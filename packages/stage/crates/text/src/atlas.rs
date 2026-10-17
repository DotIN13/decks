//! The glyph texture: every glyph drawn once at the pixel size and quarter-pixel offset it lands at,
//! packed in rows, and handed to the graphics card in pieces before the draw that uses it.
//!
//! Two textures: one channel of coverage for ordinary glyphs, colour for emoji. When one is full it
//! is emptied and the glyphs drawn again as they are next asked for; a draw list cut short by that
//! says so (`overflowed`), and its tile is painted again on the next turn.

use crate::GlyphRun;
use std::collections::HashMap;
use swash::scale::{Render, ScaleContext, Source, StrikeWith, image::Content};
use swash::zeno::{Format, Transform, Vector};

pub const SIZE: u32 = 2048;
/// The two textures' ids, out of the way of tiles and pictures.
pub const MASK_TEXTURE: u32 = 0xE000_0001;
pub const COLOR_TEXTURE: u32 = 0xE000_0002;
/// Quarter pixels: four positions per pixel across, whole pixels down (baselines are snapped).
const STEPS: f32 = 4.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Key {
	font: u64,
	index: u32,
	glyph: u32,
	/// The size in 1/64 pixels.
	size: u32,
	step: u8,
	embolden: bool,
	skew: i8,
}

/// Where a glyph is in its texture and how it sits on its pen position.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slot {
	pub color: bool,
	pub u: u32,
	pub v: u32,
	pub w: u32,
	pub h: u32,
	pub left: i32,
	pub top: i32,
}

struct Shelves {
	rows: Vec<(u32, u32, u32)>, // y, height, x used
	bottom: u32,
}

impl Shelves {
	fn new() -> Shelves {
		Shelves { rows: Vec::new(), bottom: 0 }
	}

	fn place(&mut self, w: u32, h: u32) -> Option<(u32, u32)> {
		let (w, h) = (w + 1, h + 1);
		for row in self.rows.iter_mut() {
			if row.1 >= h && row.1 <= h + h / 2 + 2 && row.2 + w <= SIZE {
				let at = (row.2, row.0);
				row.2 += w;
				return Some(at);
			}
		}
		if self.bottom + h > SIZE || w > SIZE {
			return None;
		}
		self.rows.push((self.bottom, h, w));
		let at = (0, self.bottom);
		self.bottom += h;
		Some(at)
	}
}

/// A piece of a texture to write before drawing: texture, x, y, width, height, pixels.
pub type Upload = (u32, u32, u32, u32, u32, Vec<u8>);

pub struct Atlas {
	scaler: ScaleContext,
	slots: HashMap<Key, Option<Slot>>,
	mask: Shelves,
	color: Shelves,
	pub uploads: Vec<Upload>,
	/// Whether a texture was emptied since the last `take_overflow`.
	overflowed: bool,
	/// Whether the textures exist on the card yet.
	pub made: bool,
}

impl Default for Atlas {
	fn default() -> Self {
		Atlas::new()
	}
}

impl Atlas {
	pub fn new() -> Atlas {
		Atlas { scaler: ScaleContext::new(), slots: HashMap::new(), mask: Shelves::new(), color: Shelves::new(), uploads: Vec::new(), overflowed: false, made: false }
	}

	pub fn take_overflow(&mut self) -> bool {
		std::mem::take(&mut self.overflowed)
	}

	/// A glyph of a run at `px` pixels, its pen at a fractional x of `frac` (0 to 1).
	/// `None` when it draws nothing (a space).
	pub fn glyph(&mut self, run: &GlyphRun, glyph: u32, px: f32, frac: f32) -> Option<(Slot, f32)> {
		let step = ((frac * STEPS).round() as u8) % STEPS as u8;
		let carry = if (frac * STEPS).round() >= STEPS { 1.0 } else { 0.0 };
		let key = Key { font: run.font.id, index: run.font.index, glyph, size: (px * 64.0).round() as u32, step, embolden: run.embolden, skew: run.skew as i8 };
		if let Some(slot) = self.slots.get(&key) {
			return slot.map(|s| (s, carry));
		}
		let slot = self.draw(run, glyph, px, step);
		self.slots.insert(key, slot);
		slot.map(|s| (s, carry))
	}

	fn draw(&mut self, run: &GlyphRun, glyph: u32, px: f32, step: u8) -> Option<Slot> {
		let data = (*run.font.data).as_ref();
		let font = swash::FontRef::from_index(data, run.font.index as usize)?;
		let mut scaler = self.scaler.builder(font).size(px).hint(false).normalized_coords(run.coords.iter().copied()).build();
		let mut render = Render::new(&[Source::ColorOutline(0), Source::ColorBitmap(StrikeWith::BestFit), Source::Outline]);
		render.format(Format::Alpha).offset(Vector::new(step as f32 / STEPS, 0.0));
		if run.embolden {
			render.embolden(px / 48.0);
		}
		if run.skew != 0.0 {
			render.transform(Some(Transform::skew(swash::zeno::Angle::from_degrees(run.skew), swash::zeno::Angle::ZERO)));
		}
		let image = render.render(&mut scaler, glyph as u16)?;
		let p = image.placement;
		if p.width == 0 || p.height == 0 {
			return None;
		}
		let color = matches!(image.content, Content::Color);
		let shelves = if color { &mut self.color } else { &mut self.mask };
		let at = match shelves.place(p.width, p.height) {
			Some(at) => at,
			None => {
				// Full: start the texture again. Glyphs already handed out for this list are lost.
				*shelves = Shelves::new();
				self.slots.retain(|_, s| s.is_none_or(|s| s.color != color));
				self.overflowed = true;
				shelves.place(p.width, p.height)?
			}
		};
		let pixels = match image.content {
			Content::Color => image.data,
			Content::Mask => image.data,
			Content::SubpixelMask => image.data.chunks(4).map(|c| ((c[0] as u16 + c[1] as u16 + c[2] as u16) / 3) as u8).collect(),
		};
		self.uploads.push((if color { COLOR_TEXTURE } else { MASK_TEXTURE }, at.0, at.1, p.width, p.height, pixels));
		Some(Slot { color, u: at.0, v: at.1, w: p.width, h: p.height, left: p.left, top: p.top })
	}
}
