//! What is where: the document turned into laid-out trees, kept as derived data.
//!
//! Each top-level item has a [`Root`]: its tree (instances expanded), every item's box, and a
//! spatial index. [`Scene::update`] takes what a batch of changes touched and works out only the
//! roots that depend on it, so an edit to one item lays out one top-level item again, not the stage.

pub mod geometry;
pub mod index;
pub mod layout;
pub mod tree;
pub mod values;

use serde_json::Value;
use stage_doc::{Applied, Document, Handle};
use std::collections::HashMap;
use std::rc::Rc;

use geometry::Mat;
use index::Index;
use layout::{Measure, Placed};
use tree::{Sources, Tree};
use values::{Theme, Vars};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
	pub x: f64,
	pub y: f64,
	pub w: f64,
	pub h: f64,
}

impl Rect {
	pub fn right(&self) -> f64 {
		self.x + self.w
	}
	pub fn bottom(&self) -> f64 {
		self.y + self.h
	}
	pub fn cx(&self) -> f64 {
		self.x + self.w / 2.0
	}
	pub fn cy(&self) -> f64 {
		self.y + self.h / 2.0
	}
	pub fn union(&self, o: &Rect) -> Rect {
		let x = self.x.min(o.x);
		let y = self.y.min(o.y);
		Rect { x, y, w: self.right().max(o.right()) - x, h: self.bottom().max(o.bottom()) - y }
	}
	/// Whether the two boxes overlap or touch.
	pub fn meets(&self, o: &Rect) -> bool {
		self.x <= o.right() && o.x <= self.right() && self.y <= o.bottom() && o.y <= self.bottom()
	}
	pub fn contains(&self, x: f64, y: f64) -> bool {
		x >= self.x && x <= self.right() && y >= self.y && y <= self.bottom()
	}
	pub fn inside(&self, o: &Rect) -> bool {
		self.x >= o.x && self.y >= o.y && self.right() <= o.right() && self.bottom() <= o.bottom()
	}
}

/// One top-level item, laid out.
#[derive(Clone, Debug)]
pub struct Root {
	pub handle: Handle,
	pub id: String,
	pub tree: Tree,
	pub placed: Vec<Placed>,
	/// Each item's own space to the stage: its place, its turn and flips, and its parents'.
	pub world: Vec<Mat>,
	pub bounds: Vec<Rect>,
	/// Everything this root draws, turned boxes included.
	pub extent: Rect,
	pub index: Index,
	/// Whether it holds reusable items: a change in it can change instances anywhere.
	pub reusable: bool,
	/// Bumped every time this root is laid out again: what the painter keys its caches on.
	pub version: u64,
}

/// What an update changed, for the painter and the page.
#[derive(Clone, Debug, Default)]
pub struct Updated {
	/// Roots laid out again (new ones included), by handle, with the extent they had before.
	pub roots: Vec<(Handle, Option<Rect>)>,
	/// Roots that are gone, with the extent they covered, so their tiles are repainted.
	pub removed: Vec<(String, Rect)>,
	/// The order of the top level changed.
	pub reordered: bool,
}

/// What a press found: the item, and the items it is inside, from the top level down.
#[derive(Clone, Debug, PartialEq)]
pub struct Hit {
	pub root: Handle,
	/// Index of the item in its root's tree.
	pub item: u32,
	pub id: String,
	/// Ids from the top-level item down to the one hit.
	pub path: Vec<String>,
}

pub struct Scene {
	pub vars: Vars,
	pub dark: bool,
	base: Rc<Theme>,
	pub roots: Vec<Root>,
	at: HashMap<Handle, usize>,
	top: Index,
	versions: u64,
}

impl Scene {
	pub fn new(doc: &Document, dark: bool, measure: &dyn Measure) -> Scene {
		let vars = Vars::from_meta(&doc.meta);
		let base = Rc::new(vars.base_theme(dark));
		let mut scene = Scene { vars, dark, base, roots: Vec::new(), at: HashMap::new(), top: Index::default(), versions: 0 };
		scene.update(doc, None, measure);
		scene
	}

	/// Bring the scene up to date. `None` works everything out again; a batch's [`Applied`]
	/// works out only the roots it touched, and the roots holding instances when it touched
	/// something reusable.
	pub fn update(&mut self, doc: &Document, applied: Option<&Applied>, measure: &dyn Measure) -> Updated {
		let mut updated = Updated::default();
		let all = applied.is_none_or(|a| a.meta);
		if all {
			self.vars = Vars::from_meta(&doc.meta);
			self.base = Rc::new(self.vars.base_theme(self.dark));
		}
		let mut dirty: Vec<Handle> = Vec::new();
		let mut refs_too = false;
		if let Some(a) = applied.filter(|_| !all) {
			let mut mark = |h: Handle| {
				let Some(root) = doc.root_of(h) else { return };
				dirty.push(root);
				let known = self.at.get(&root).map(|&i| self.roots[i].reusable);
				if known.unwrap_or(false) || is_reusable(doc, root) {
					refs_too = true;
				}
			};
			for &h in &a.touched {
				mark(h);
			}
			for parent in a.parents.iter().flatten() {
				mark(*parent);
			}
			// The top level changed: an item came or went, and refs to it may now resolve. A removed
			// reusable item leaves no handle to mark, so any change at the top re-expands refs.
			updated.reordered = a.parents.contains(&None);
			refs_too |= updated.reordered;
		}
		let top = doc.child_list(None);
		let mut old: HashMap<Handle, Root> = std::mem::take(&mut self.roots).into_iter().map(|r| (r.handle, r)).collect();
		let sources = Sources::new(doc);
		let mut roots = Vec::with_capacity(top.len());
		for &handle in top {
			let id = &doc.node(handle).expect("a top-level item exists").id;
			// A handle is reused after its item goes, so the id must match too.
			let kept = match old.remove(&handle) {
				Some(r) if &r.id != id => {
					updated.removed.push((r.id, r.extent));
					updated.reordered = true;
					None
				}
				kept => kept,
			};
			let stale = match &kept {
				None => true,
				Some(r) => all || dirty.contains(&handle) || (refs_too && r.tree.has_refs),
			};
			match kept {
				Some(root) if !stale => roots.push(root),
				kept => {
					self.versions += 1;
					updated.roots.push((handle, kept.map(|r| r.extent)));
					roots.push(self.build(&sources, handle, measure));
				}
			}
		}
		for (_, gone) in old {
			updated.removed.push((gone.id, gone.extent));
			updated.reordered = true;
		}
		self.roots = roots;
		self.at = self.roots.iter().enumerate().map(|(i, r)| (r.handle, i)).collect();
		if !updated.roots.is_empty() || updated.reordered {
			self.top = Index::build(self.roots.iter().enumerate().map(|(i, r)| (i as u32, r.extent)));
		}
		updated
	}

	fn build(&self, sources: &Sources, handle: Handle, measure: &dyn Measure) -> Root {
		let tree = sources.tree(handle);
		let placed = layout::layout(&tree, &self.vars, &self.base, measure);
		let mut world: Vec<Mat> = Vec::with_capacity(tree.items.len());
		let mut bounds = Vec::with_capacity(tree.items.len());
		let mut extent: Option<Rect> = None;
		let mut reusable = false;
		for (item, place) in tree.items.iter().zip(&placed) {
			reusable |= item.get("reusable").and_then(Value::as_bool).unwrap_or(false);
			let r = place.rect;
			let t = &place.theme;
			// Its own: placed, turned about its corner, mirrored about its middle.
			let (fx, fy) = (self.vars.bool(item.get("flipX"), t, false), self.vars.bool(item.get("flipY"), t, false));
			let mut own = Mat::translate(r.x, r.y).then(&Mat::turn(self.vars.num(item.get("rotation"), t, 0.0)));
			if fx || fy {
				let flip = Mat::translate(r.w / 2.0, r.h / 2.0).then(&Mat::scale(if fx { -1.0 } else { 1.0 }, if fy { -1.0 } else { 1.0 })).then(&Mat::translate(-r.w / 2.0, -r.h / 2.0));
				own = own.then(&flip);
			}
			// A parent's turn and flips carry its children with it, about the parent's own corner.
			let m = match item.parent {
				Some(p) => {
					let pr = placed[p as usize].rect;
					world[p as usize].then(&Mat::translate(-pr.x, -pr.y)).then(&own)
				}
				None => own,
			};
			let b = m.bounds(r.w, r.h);
			if place.visible {
				extent = Some(extent.map_or(b, |e| e.union(&b)));
			}
			world.push(m);
			bounds.push(b);
		}
		let index = Index::build(placed.iter().zip(&bounds).enumerate().filter(|(_, (p, _))| p.visible).map(|(i, (_, b))| (i as u32, *b)));
		Root {
			handle,
			id: tree.items.first().map(|i| i.id.clone()).unwrap_or_default(),
			tree,
			placed,
			world,
			bounds,
			extent: extent.unwrap_or_default(),
			index,
			reusable,
			version: self.versions,
		}
	}

	pub fn root(&self, handle: Handle) -> Option<&Root> {
		self.at.get(&handle).map(|&i| &self.roots[i])
	}

	/// Every visible item meeting `area`, as `(root index, item index)`, in paint order.
	pub fn query(&self, area: &Rect) -> Vec<(u32, u32)> {
		let mut roots = Vec::new();
		self.top.search(area, &mut roots);
		roots.sort_unstable();
		let mut out = Vec::new();
		let mut items = Vec::new();
		for r in roots {
			items.clear();
			self.roots[r as usize].index.search(area, &mut items);
			items.sort_unstable();
			out.extend(items.iter().map(|&i| (r, i)));
		}
		out
	}

	/// The topmost item under a point on the stage. `slop` widens thin lines, in stage pixels.
	pub fn pick(&self, x: f64, y: f64, slop: f64) -> Option<Hit> {
		let area = Rect { x: x - slop, y: y - slop, w: slop * 2.0, h: slop * 2.0 };
		for (r, i) in self.query(&area).into_iter().rev() {
			let root = &self.roots[r as usize];
			if self.hits(root, i, x, y, slop) {
				let mut path = Vec::new();
				let mut at = Some(i);
				while let Some(n) = at {
					path.push(root.tree.items[n as usize].id.clone());
					at = root.tree.items[n as usize].parent;
				}
				path.reverse();
				return Some(Hit { root: root.handle, item: i, id: root.tree.items[i as usize].id.clone(), path });
			}
		}
		None
	}

	/// Items whose whole box is inside `area`: what a marquee selects.
	pub fn within(&self, area: &Rect) -> Vec<(u32, u32)> {
		self.query(area).into_iter().filter(|&(r, i)| self.roots[r as usize].bounds[i as usize].inside(area)).collect()
	}

	fn hits(&self, root: &Root, i: u32, x: f64, y: f64, slop: f64) -> bool {
		let item = &root.tree.items[i as usize];
		let r = root.placed[i as usize].rect;
		// Into the item's own space.
		let Some(back) = root.world[i as usize].invert() else { return false };
		let (lx, ly) = back.apply(x, y);
		let local = Rect { x: -slop, y: -slop, w: r.w + slop * 2.0, h: r.h + slop * 2.0 };
		if !local.contains(lx, ly) {
			return false;
		}
		match item.kind() {
			"ellipse" => {
				let (rx, ry) = (r.w / 2.0 + slop, r.h / 2.0 + slop);
				if rx <= 0.0 || ry <= 0.0 {
					return false;
				}
				let (dx, dy) = ((lx - r.w / 2.0) / rx, (ly - r.h / 2.0) / ry);
				dx * dx + dy * dy <= 1.0
			}
			// A group is only what is in it; its children answer for it.
			"group" => false,
			_ => true,
		}
	}
}

fn is_reusable(doc: &Document, root: Handle) -> bool {
	let reusable = |h: Handle| doc.node(h).and_then(|n| n.get("reusable")).and_then(Value::as_bool).unwrap_or(false);
	let mut stack = vec![root];
	while let Some(h) = stack.pop() {
		if reusable(h) {
			return true;
		}
		stack.extend(doc.child_list(Some(h)));
	}
	false
}

#[cfg(test)]
mod tests;
