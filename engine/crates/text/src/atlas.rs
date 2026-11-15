//! The glyph texture: every glyph drawn once at the pixel size and quarter-pixel offset it lands at,
//! packed in rows, and handed to the graphics card in pieces before the draw that uses it.
//!
//! Two textures: one channel of coverage for ordinary glyphs, colour for emoji. Each is cut into
//! eight bands of 256 rows. A band remembers the last draw list that used it (`begin` starts one),
//! so when a texture is full the band used longest ago is emptied: the glyphs of a zoom you just
//! left stay for a zoom back, and the ones of zooms long gone make room. Only when every band is in
//! use by the list being built is one of its own emptied; that list then says so (`take_overflow`)
//! and is built again. A list must be drawn before the next one begins.

use crate::GlyphRun;
use std::collections::HashMap;
use swash::scale::{Render, ScaleContext, Source, StrikeWith, image::Content};
use swash::zeno::{Format, Transform, Vector};

pub const SIZE: u32 = 2048;
/// Bands a texture is cut into, each emptied on its own; a band holds glyphs up to its height,
/// above the painter's largest (`MAX_GLYPH_PX`, 192).
const BANDS: usize = 8;
const BAND: u32 = SIZE / BANDS as u32;
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
	/// The band it is in.
	pub band: u8,
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
		if self.bottom + h > BAND || w > SIZE {
			return None;
		}
		self.rows.push((self.bottom, h, w));
		let at = (0, self.bottom);
		self.bottom += h;
		Some(at)
	}
}

/// One texture's bands: each band's rows, and the last list that used it.
struct Bands {
	bands: Vec<(Shelves, u64)>,
}

impl Bands {
	fn new() -> Bands {
		Bands { bands: (0..BANDS).map(|_| (Shelves::new(), 0)).collect() }
	}

	/// Room for a glyph in any band, in the band's own rows: `(band, x, y)` on the texture.
	fn place(&mut self, w: u32, h: u32, now: u64) -> Option<(u8, u32, u32)> {
		for (i, (shelves, used)) in self.bands.iter_mut().enumerate() {
			if let Some((x, y)) = shelves.place(w, h) {
				*used = now;
				return Some((i as u8, x, i as u32 * BAND + y));
			}
		}
		None
	}

	/// Empty the band used longest ago; says which, and whether the list being built had used it.
	fn evict(&mut self, now: u64) -> (u8, bool) {
		let (i, used) = self.bands.iter().enumerate().map(|(i, (_, used))| (i, *used)).min_by_key(|&(_, used)| used).expect("a texture has bands");
		self.bands[i] = (Shelves::new(), 0);
		(i as u8, used == now)
	}

	fn touch(&mut self, band: u8, now: u64) {
		if let Some(b) = self.bands.get_mut(band as usize) {
			b.1 = now;
		}
	}
}

/// A piece of a texture to write before drawing: texture, x, y, width, height, pixels.
pub type Upload = (u32, u32, u32, u32, u32, Vec<u8>);

pub struct Atlas {
	scaler: ScaleContext,
	slots: HashMap<Key, Option<Slot>>,
	mask: Bands,
	color: Bands,
	pub uploads: Vec<Upload>,
	/// Whether a band the current list used was emptied since the last `take_overflow`.
	overflowed: bool,
	/// The draw list being built (`begin`), to know which bands it uses.
	now: u64,
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
		Atlas { scaler: ScaleContext::new(), slots: HashMap::new(), mask: Bands::new(), color: Bands::new(), uploads: Vec::new(), overflowed: false, now: 1, made: false }
	}

	/// A new draw list starts: what it uses is kept over everything used before it.
	pub fn begin(&mut self) {
		self.now += 1;
		self.overflowed = false;
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
			if let Some(s) = slot {
				let bands = if s.color { &mut self.color } else { &mut self.mask };
				bands.touch(s.band, self.now);
			}
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
		let now = self.now;
		let bands = if color { &mut self.color } else { &mut self.mask };
		let at = match bands.place(p.width, p.height, now) {
			Some(at) => at,
			None => {
				// Full: the band used longest ago is emptied, and the glyphs in it drawn again when next asked for.
				let (band, ours) = bands.evict(now);
				self.overflowed |= ours;
				self.slots.retain(|_, s| s.is_none_or(|s| s.color != color || s.band != band));
				let bands = if color { &mut self.color } else { &mut self.mask };
				bands.place(p.width, p.height, now)?
			}
		};
		let pixels = match image.content {
			Content::Color => image.data,
			Content::Mask => image.data,
			Content::SubpixelMask => image.data.chunks(4).map(|c| ((c[0] as u16 + c[1] as u16 + c[2] as u16) / 3) as u8).collect(),
		};
		self.uploads.push((if color { COLOR_TEXTURE } else { MASK_TEXTURE }, at.1, at.2, p.width, p.height, pixels));
		Some(Slot { color, u: at.1, v: at.2, w: p.width, h: p.height, left: p.left, top: p.top, band: at.0 })
	}
}
