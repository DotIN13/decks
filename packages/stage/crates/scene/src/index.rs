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
		let mut index = Index { boxes: leaves.iter().map(|(_, r)| *r).collect(), values: leaves.iter().map(|(v, _)| *v).collect(), levels: vec![0] };
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
}
