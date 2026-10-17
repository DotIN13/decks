//! The tile grid: the stage cut into squares of `TILE` device pixels at a scale, painted once and
//! kept until something in them changes.
//!
//! Tiles live in the stage's own space, so a pan paints nothing it has already painted. At rest the
//! scale is the exact zoom times the screen's pixel ratio, so every glyph sits on whole pixels; while
//! a zoom moves, tiles are painted at powers of two and stretched, so a pinch does not paint every
//! scale it passes through. A tile whose contents changed is kept, and shown, until its new picture
//! arrives: a late tile is stale for a frame, never missing and never misplaced.

use stage_scene::Rect;
use std::collections::HashMap;

/// A tile's side, in target pixels.
pub const TILE: u32 = 512;

/// A tile: its scale (as the bits of an `f32`, so it can be a key) and its column and row.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Key {
	pub scale: u32,
	pub x: i32,
	pub y: i32,
}

impl Key {
	pub fn scale(&self) -> f64 {
		f32::from_bits(self.scale) as f64
	}

	/// The part of the stage the tile shows.
	pub fn area(&self) -> Rect {
		let side = TILE as f64 / self.scale();
		Rect { x: self.x as f64 * side, y: self.y as f64 * side, w: side, h: side }
	}
}

/// The scale tiles are painted at: exact at rest, the next power of two above while zooming.
pub fn scale_for(zoom_times_dpr: f64, moving: bool) -> f32 {
	let s = zoom_times_dpr.clamp(1.0 / 256.0, 256.0);
	if moving { 2f64.powf(s.log2().ceil()) as f32 } else { s as f32 }
}

#[derive(Clone, Debug)]
pub struct Tile {
	/// The texture holding its picture, once painted.
	pub texture: Option<u32>,
	/// Painted at this version of the stage; behind `Grid::version` in its area means stale.
	pub painted: u64,
	pub dirty: bool,
	pub used: u64,
}

/// Which tiles exist, which are stale, which to paint next and which to let go.
#[derive(Debug, Default)]
pub struct Grid {
	pub tiles: HashMap<Key, Tile>,
	/// The most tiles kept; past it, the ones used longest ago and out of view go.
	pub budget: usize,
	frame: u64,
	next_texture: u32,
	free: Vec<u32>,
}

impl Grid {
	pub fn new(budget: usize, first_texture: u32) -> Grid {
		Grid { budget, next_texture: first_texture, ..Default::default() }
	}

	/// The tiles covering `view` (stage units) at `scale`, with a margin of `overscan` tiles, the
	/// ones nearest the middle first.
	pub fn covering(view: &Rect, scale: f32, overscan: i32) -> Vec<Key> {
		let side = TILE as f64 / scale as f64;
		let x0 = (view.x / side).floor() as i32 - overscan;
		let y0 = (view.y / side).floor() as i32 - overscan;
		let x1 = (view.right() / side).ceil() as i32 + overscan;
		let y1 = (view.bottom() / side).ceil() as i32 + overscan;
		let (cx, cy) = (view.cx() / side, view.cy() / side);
		let mut keys: Vec<Key> = (y0..y1).flat_map(|y| (x0..x1).map(move |x| Key { scale: scale.to_bits(), x, y })).collect();
		keys.sort_by(|a, b| {
			let d = |k: &Key| (k.x as f64 + 0.5 - cx).powi(2) + (k.y as f64 + 0.5 - cy).powi(2);
			d(a).total_cmp(&d(b))
		});
		keys
	}

	/// Mark every tile meeting `area` stale, at every scale.
	pub fn invalidate(&mut self, area: &Rect) {
		for (key, tile) in self.tiles.iter_mut() {
			if key.area().meets(area) {
				tile.dirty = true;
			}
		}
	}

	pub fn invalidate_all(&mut self) {
		for tile in self.tiles.values_mut() {
			tile.dirty = true;
		}
	}

	/// The tiles to paint now, up to `limit`, from those wanted (in order): missing ones first,
	/// then stale ones. Each is marked used this frame.
	pub fn to_paint(&mut self, wanted: &[Key], limit: usize) -> Vec<Key> {
		self.frame += 1;
		let mut missing = Vec::new();
		let mut stale = Vec::new();
		for key in wanted {
			match self.tiles.get_mut(key) {
				None => missing.push(*key),
				Some(tile) => {
					tile.used = self.frame;
					if tile.dirty || tile.texture.is_none() {
						stale.push(*key);
					}
				}
			}
		}
		missing.into_iter().chain(stale).take(limit).collect()
	}

	/// A painted tile: its texture (made here when it is new), to draw the picture into.
	pub fn painted(&mut self, key: Key, version: u64) -> u32 {
		let frame = self.frame;
		let texture = match self.tiles.get(&key).and_then(|t| t.texture) {
			Some(t) => t,
			None => self.free.pop().unwrap_or_else(|| {
				self.next_texture += 1;
				self.next_texture - 1
			}),
		};
		self.tiles.insert(key, Tile { texture: Some(texture), painted: version, dirty: false, used: frame });
		texture
	}

	/// Let go of the tiles past the budget that are used longest ago and not in `keep`; returns
	/// their textures, to forget.
	pub fn evict(&mut self, keep: &[Key]) -> Vec<u32> {
		let mut out = Vec::new();
		if self.tiles.len() <= self.budget {
			return out;
		}
		let mut old: Vec<(u64, Key)> = self.tiles.iter().filter(|(k, _)| !keep.contains(k)).map(|(k, t)| (t.used, *k)).collect();
		old.sort();
		let excess = self.tiles.len() - self.budget;
		for (_, key) in old.into_iter().take(excess) {
			if let Some(tile) = self.tiles.remove(&key) {
				if let Some(t) = tile.texture {
					self.free.push(t);
					out.push(t);
				}
			}
		}
		out
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn covering_and_painting() {
		let view = Rect { x: 0.0, y: 0.0, w: 1000.0, h: 600.0 };
		let keys = Grid::covering(&view, 1.0, 0);
		assert_eq!(keys.len(), 2 * 2);
		// The middle first: (1, 0) holds the view's centre (500, 300).
		assert_eq!((keys[0].x, keys[0].y), (0, 0));
		let mut grid = Grid::new(3, 100);
		let first = grid.to_paint(&keys, 2);
		assert_eq!(first.len(), 2);
		for k in &first {
			grid.painted(*k, 1);
		}
		let second = grid.to_paint(&keys, 10);
		assert_eq!(second.len(), 2);
		for k in &second {
			grid.painted(*k, 1);
		}
		assert!(grid.to_paint(&keys, 10).is_empty());
		grid.invalidate(&Rect { x: 10.0, y: 10.0, w: 1.0, h: 1.0 });
		assert_eq!(grid.to_paint(&keys, 10), vec![Key { scale: 1f32.to_bits(), x: 0, y: 0 }]);
		let gone = grid.evict(&keys[..2]);
		assert_eq!(gone.len(), 1);
	}

	#[test]
	fn zooming_uses_powers_of_two() {
		assert_eq!(scale_for(1.3, true), 2.0);
		assert_eq!(scale_for(0.3, true), 0.5);
		assert_eq!(scale_for(1.3, false), 1.3);
	}
}
