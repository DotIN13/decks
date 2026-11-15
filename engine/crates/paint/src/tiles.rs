//! The tile grid: the stage cut into squares of `TILE` device pixels at a scale, painted once and
//! kept until something in them changes.
//!
//! Tiles live in the stage's own space, so a pan paints nothing it has already painted. At rest the
//! scale is the exact zoom times the screen's pixel ratio, so every glyph sits on whole pixels; while
//! a zoom moves, tiles are painted at the power of two under it and stretched, so a pinch does not
//! paint every scale it passes through. A tile whose contents changed is kept, and shown, until its new picture
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

/// The most tiles a window asks for, its border included; a window that touches more asks for those alone.
pub const HELD: usize = 48;

/// The scale tiles are painted at: exact at rest; while zooming, the power of two at or under it,
/// never finer than the screen, as the old engine did. It changes once each time the zoom halves or
/// doubles, and between those its tiles are drawn stretched rather than painted again.
pub fn scale_for(zoom_times_dpr: f64, zooming: bool) -> f32 {
	let s = zoom_times_dpr.clamp(1.0 / 256.0, 256.0);
	// A hair over a power of two (the float the zoom lands on) rounds to it, not to the one below.
	if zooming { 2f64.powf((s.log2() + 1e-9).floor()) as f32 } else { s as f32 }
}

/// The overview's scale: the whole stage in at most four tiles a side, a power of two. Its tiles are
/// painted once the view's are done and never let go, so a zoom out always has something to show.
pub fn overview_scale(extent: &Rect) -> f32 {
	let side = extent.w.max(extent.h).max(1.0);
	2f64.powf((4.0 * TILE as f64 / side).log2().floor()).clamp(1.0 / 256.0, 1.0) as f32
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
	/// How many tiles are held at each scale, so `invalidate` looks tiles up where an area is rather
	/// than going through every tile held at every scale.
	scales: HashMap<u32, usize>,
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

	/// The tiles to paint for a window, `view` (stage units), at `scale`: every tile the window
	/// touches, the middle first, then the border of half a tile round it, nearest first, as far as
	/// `HELD` tiles in all (never fewer than the window's own), as the old engine asked for its
	/// tiles. A pan paints the edge it uncovers as it goes; no ring of whole tiles is painted ahead.
	pub fn wanted(view: &Rect, scale: f32) -> Vec<Key> {
		let side = TILE as f64 / scale as f64;
		let grown = Rect { x: view.x - side / 2.0, y: view.y - side / 2.0, w: view.w + side, h: view.h + side };
		let touches = |k: &Key| {
			let a = k.area();
			a.x < view.right() && view.x < a.right() && a.y < view.bottom() && view.y < a.bottom()
		};
		let (mut keys, border): (Vec<Key>, Vec<Key>) = Grid::covering(&grown, scale, 0).into_iter().partition(touches);
		let room = HELD.max(keys.len()) - keys.len();
		keys.extend(border.into_iter().take(room));
		keys
	}

	/// Mark every tile `area` paints on stale, at every scale: half a pixel of soft edge included.
	/// At each scale the tiles under the area are looked up by their place in the grid; an area with
	/// more places under it than tiles held there (a whole-stage change) goes through those tiles instead.
	pub fn invalidate(&mut self, area: &Rect) {
		let hits = |key: &Key| {
			let edge = 0.5 / key.scale();
			let a = key.area();
			let grown = Rect { x: area.x - edge, y: area.y - edge, w: area.w + edge * 2.0, h: area.h + edge * 2.0 };
			grown.x < a.right() && a.x < grown.right() && grown.y < a.bottom() && a.y < grown.bottom()
		};
		let mut through = false;
		for (&scale, &held) in &self.scales {
			let s = f32::from_bits(scale) as f64;
			let side = TILE as f64 / s;
			let edge = 0.5 / s;
			let (x0, x1) = (((area.x - edge) / side).floor() - 1.0, ((area.right() + edge) / side).ceil() + 1.0);
			let (y0, y1) = (((area.y - edge) / side).floor() - 1.0, ((area.bottom() + edge) / side).ceil() + 1.0);
			let places = (x1 - x0) * (y1 - y0);
			if !places.is_finite() || places > held as f64 || x0 < i32::MIN as f64 || x1 > i32::MAX as f64 || y0 < i32::MIN as f64 || y1 > i32::MAX as f64 {
				through = true;
				continue;
			}
			for y in y0 as i32..y1 as i32 {
				for x in x0 as i32..x1 as i32 {
					let key = Key { scale, x, y };
					if let Some(tile) = self.tiles.get_mut(&key) {
						if hits(&key) {
							tile.dirty = true;
						}
					}
				}
			}
		}
		if through {
			for (key, tile) in self.tiles.iter_mut() {
				if hits(key) {
					tile.dirty = true;
				}
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
		if self.tiles.insert(key, Tile { texture: Some(texture), painted: version, dirty: false, used: frame }).is_none() {
			*self.scales.entry(key.scale).or_default() += 1;
		}
		texture
	}

	/// The page let go of a tile's picture: paint it again when it is wanted.
	pub fn forget(&mut self, key: &Key) -> Option<u32> {
		let tile = self.tiles.remove(key)?;
		self.held_one_less(key.scale);
		if let Some(t) = tile.texture {
			self.free.push(t);
		}
		tile.texture
	}

	fn held_one_less(&mut self, scale: u32) {
		if let Some(n) = self.scales.get_mut(&scale) {
			*n -= 1;
			if *n == 0 {
				self.scales.remove(&scale);
			}
		}
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
				self.held_one_less(key.scale);
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
	fn invalidating_finds_the_same_tiles_by_place_as_by_going_through_them_all() {
		let mut grid = Grid::new(10_000, 1);
		for scale in [0.5f32, 1.0, 1.3, 2.0] {
			for y in -6..6 {
				for x in -8..8 {
					grid.painted(Key { scale: scale.to_bits(), x, y }, 1);
				}
			}
		}
		let areas = [
			Rect { x: 10.0, y: 10.0, w: 1.0, h: 1.0 },
			Rect { x: -700.0, y: 300.5, w: 900.0, h: 2.0 },
			Rect { x: 511.9, y: -0.2, w: 0.1, h: 0.1 },
			Rect { x: -1e6, y: -1e6, w: 2e6, h: 2e6 },
			Rect { x: 393.846, y: 0.0, w: 0.0, h: 0.0 },
		];
		for area in areas {
			for t in grid.tiles.values_mut() {
				t.dirty = false;
			}
			grid.invalidate(&area);
			let got: std::collections::BTreeSet<Key> = grid.tiles.iter().filter(|(_, t)| t.dirty).map(|(k, _)| *k).collect();
			let want: std::collections::BTreeSet<Key> = grid
				.tiles
				.keys()
				.filter(|k| {
					let edge = 0.5 / k.scale();
					let a = k.area();
					let g = Rect { x: area.x - edge, y: area.y - edge, w: area.w + edge * 2.0, h: area.h + edge * 2.0 };
					g.x < a.right() && a.x < g.right() && g.y < a.bottom() && a.y < g.bottom()
				})
				.copied()
				.collect();
			assert_eq!(got, want, "{area:?}");
			assert!(!got.is_empty());
		}
		grid.forget(&Key { scale: 1f32.to_bits(), x: 0, y: 0 });
		assert_eq!(grid.scales[&1f32.to_bits()], 16 * 12 - 1);
	}

	#[test]
	fn a_window_wants_its_own_tiles_then_half_a_tile_round_it() {
		// 1,400 by 900 at scale 1 from (100, 100): the window touches 3 by 2 tiles (0..1536, 0..1024).
		let view = Rect { x: 100.0, y: 100.0, w: 1400.0, h: 900.0 };
		let keys = Grid::wanted(&view, 1.0);
		let seen = Grid::covering(&view, 1.0, 0);
		assert_eq!(&keys[..seen.len()], &seen[..], "the window's own first, the middle first");
		// Half a tile round it (-156..1756, -156..1256): columns -1..3, rows -1..2, 20 tiles in all.
		assert_eq!(keys.len(), 20);
		assert!(keys.iter().all(|k| (-1..=3).contains(&k.x) && (-1..=2).contains(&k.y)));
		// A big window's border is cut at `HELD`; its own tiles never are.
		let big = Rect { x: 0.0, y: 0.0, w: 4000.0, h: 3000.0 };
		assert_eq!(Grid::wanted(&big, 1.0).len(), HELD.max(Grid::covering(&big, 1.0, 0).len()));
		let huge = Rect { x: 0.0, y: 0.0, w: 6000.0, h: 5000.0 };
		assert_eq!(Grid::wanted(&huge, 1.0), Grid::covering(&huge, 1.0, 0));
	}

	#[test]
	fn zooming_uses_the_power_of_two_at_or_under_the_screen() {
		assert_eq!(scale_for(1.3, true), 1.0);
		assert_eq!(scale_for(1.99, true), 1.0);
		assert_eq!(scale_for(2.0, true), 2.0);
		assert_eq!(scale_for(2.13, true), 2.0);
		assert_eq!(scale_for(0.3, true), 0.25);
		assert_eq!(scale_for(0.24, true), 0.125);
		assert_eq!(scale_for(1.3, false), 1.3);
	}
}
