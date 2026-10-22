//! A packed R-tree: boxes sorted into nodes of sixteen once, then searched without allocating.
//! Built per top-level item when its tree is laid out again, so an edit rebuilds one small index.

use crate::Rect;

const NODE: usize = 16;

#[derive(Clone, Debug, Default)]
pub struct Index {
	/// Every level's boxes, leaves first; a leaf's value is the entry's own number.
	boxes: Vec<Rect>,
	values: Vec<u32>,
	/// Where each level starts in `boxes`.
	levels: Vec<usize>,
	/// Each entry's leaf, by its value (`u32::MAX`: left out), for `refit`.
	leaf: Vec<u32>,
}

impl Index {
	/// An index of `(value, box)` entries. Empty boxes are left out.
	pub fn build(entries: impl IntoIterator<Item = (u32, Rect)>) -> Index {
		let mut leaves: Vec<(u32, Rect)> = entries.into_iter().filter(|(_, r)| r.w >= 0.0 && r.h >= 0.0 && r.x.is_finite() && r.y.is_finite()).collect();
		if leaves.is_empty() {
			return Index::default();
		}
		// Sort-tile-recursive: by x into vertical slices, each slice by y.
		let n = leaves.len();
		let pages = n.div_ceil(NODE);
		let slices = (pages as f64).sqrt().ceil() as usize;
		let per_slice = NODE * pages.div_ceil(slices);
		leaves.sort_by(|a, b| a.1.cx().total_cmp(&b.1.cx()));
		for slice in leaves.chunks_mut(per_slice) {
			slice.sort_by(|a, b| a.1.cy().total_cmp(&b.1.cy()));
		}
		let mut leaf = vec![u32::MAX; leaves.iter().map(|(v, _)| *v as usize + 1).max().unwrap_or(0)];
		for (at, (v, _)) in leaves.iter().enumerate() {
			leaf[*v as usize] = at as u32;
		}
		let mut index = Index { boxes: leaves.iter().map(|(_, r)| *r).collect(), values: leaves.iter().map(|(v, _)| *v).collect(), levels: vec![0], leaf };
		let mut start = 0;
		let mut count = n;
		while count > 1 {
			let parents = count.div_ceil(NODE);
			let level_start = index.boxes.len();
			for p in 0..parents {
				let from = start + p * NODE;
				let to = (from + NODE).min(start + count);
				let mut b = index.boxes[from];
				for r in &index.boxes[from + 1..to] {
					b = b.union(r);
				}
				index.boxes.push(b);
				index.values.push(from as u32);
			}
			index.levels.push(level_start);
			start = level_start;
			count = parents;
		}
		index
	}

	/// An entry's box changed: its leaf takes the new box, and each node above it grows to hold it.
	/// Nodes never shrink here, so a search still finds everything, only looking a little wider until
	/// the next `build`. False when the entry is not in the index (it was left out, or is new): build it again.
	pub fn refit(&mut self, value: u32, area: Rect) -> bool {
		let Some(&at) = self.leaf.get(value as usize).filter(|&&at| at != u32::MAX) else { return false };
		if !(area.w >= 0.0 && area.h >= 0.0 && area.x.is_finite() && area.y.is_finite()) {
			return false;
		}
		let mut at = at as usize;
		self.boxes[at] = area;
		for level in 0..self.levels.len() - 1 {
			at = self.levels[level + 1] + (at - self.levels[level]) / NODE;
			let grown = self.boxes[at].union(&area);
			if grown == self.boxes[at] {
				break;
			}
			self.boxes[at] = grown;
		}
		true
	}

	pub fn is_empty(&self) -> bool {
		self.boxes.is_empty()
	}

	/// The values of every entry whose box meets `area`, in no particular order.
	pub fn search(&self, area: &Rect, out: &mut Vec<u32>) {
		if self.boxes.is_empty() {
			return;
		}
		let top = *self.levels.last().expect("a built index has a level");
		let mut stack: Vec<(usize, usize)> = (top..self.boxes.len()).map(|i| (i, self.levels.len() - 1)).collect();
		while let Some((at, level)) = stack.pop() {
			if !self.boxes[at].meets(area) {
				continue;
			}
			if level == 0 {
				out.push(self.values[at]);
				continue;
			}
			let child_level_start = self.levels[level - 1];
			let child_level_end = self.levels[level];
			let from = self.values[at] as usize;
			let to = (from + NODE).min(child_level_end);
			debug_assert!(from >= child_level_start);
			for child in from..to {
				stack.push((child, level - 1));
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn finds_what_it_should() {
		let entries: Vec<(u32, Rect)> = (0..1000).map(|i| (i, Rect { x: (i % 40) as f64 * 10.0, y: (i / 40) as f64 * 10.0, w: 5.0, h: 5.0 })).collect();
		let index = Index::build(entries.clone());
		let area = Rect { x: 52.0, y: 52.0, w: 30.0, h: 12.0 };
		let mut got = Vec::new();
		index.search(&area, &mut got);
		got.sort();
		let want: Vec<u32> = entries.iter().filter(|(_, r)| r.meets(&area)).map(|(v, _)| *v).collect();
		assert_eq!(got, want);
		assert!(!got.is_empty());
	}

	#[test]
	fn a_refitted_entry_is_found_where_it_went() {
		let mut entries: Vec<(u32, Rect)> = (0..1000).map(|i| (i, Rect { x: (i % 40) as f64 * 10.0, y: (i / 40) as f64 * 10.0, w: 5.0, h: 5.0 })).collect();
		let mut index = Index::build(entries.clone());
		for (n, v) in [3u32, 517, 999, 0].into_iter().enumerate() {
			let moved = Rect { x: 1000.0 + n as f64 * 50.0, y: -300.0, w: 20.0, h: 8.0 };
			assert!(index.refit(v, moved));
			entries[v as usize].1 = moved;
		}
		for area in [Rect { x: 52.0, y: 52.0, w: 30.0, h: 12.0 }, Rect { x: 990.0, y: -310.0, w: 200.0, h: 30.0 }, Rect { x: 0.0, y: 0.0, w: 12.0, h: 12.0 }] {
			let mut got = Vec::new();
			index.search(&area, &mut got);
			got.sort();
			let want: Vec<u32> = entries.iter().filter(|(_, r)| r.meets(&area)).map(|(v, _)| *v).collect();
			assert_eq!(got, want);
		}
		assert!(!index.refit(5000, Rect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }));
	}
}
