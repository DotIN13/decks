//! What is where: the document turned into laid-out trees, kept as derived data.
//!
//! Each top-level item has a [`Root`]: its tree (instances expanded), every item's box, and a
//! spatial index. [`Scene::update`] takes what a batch of changes touched and works out only the
//! roots that depend on it, so an edit to one item lays out one top-level item again, not the stage.

pub mod arrows;
pub mod geometry;
pub mod index;
pub mod layout;
pub mod tree;
pub mod values;

use serde_json::Value;
use stage_doc::{Applied, Document, Handle};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

/// Root versions, counted across every scene in the process: a scene made again (a new document, the
/// other scheme) never gives a root a version an earlier scene's root had, so what is keyed on one
/// (the painter's caches, the page's last layout sent, `Page::layout_changes`) never mistakes the two.
static VERSIONS: AtomicU64 = AtomicU64::new(0);

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
	/// What each item paints on: its box grown by its stroke, shadows and card paper.
	pub ink: Vec<Rect>,
	/// Everything this root paints, turned boxes, strokes and shadows included.
	pub extent: Rect,
	pub index: Index,
	/// Whether it holds reusable items: a change in it can change instances anywhere.
	pub reusable: bool,
	/// Bumped every time this root is laid out again: what the painter keys its caches on.
	pub version: u64,
}

impl Root {
	/// Where this root paints differently from `was`, the same root laid out before: for each item
	/// whose fields, place, theme, turn or shown-ness changed, what it and everything inside it
	/// painted before and paints now. `None` when the two do not hold the same items in the same order
	/// (one came, went or moved among its siblings): its whole extent then, before and after.
	pub fn changed_ink(&self, was: &Root) -> Option<Vec<Rect>> {
		let (now, then) = (&self.tree.items, &was.tree.items);
		if now.len() != then.len() || now.iter().zip(then).any(|(a, b)| a.id != b.id || a.parent != b.parent) {
			return None;
		}
		let mut marked = vec![false; now.len()];
		let mut out = Vec::new();
		for i in 0..now.len() {
			let (a, b) = (&self.placed[i], &was.placed[i]);
			let own = (!Rc::ptr_eq(&now[i].props, &then[i].props) && *now[i].props != *then[i].props)
				|| a.rect != b.rect
				|| a.visible != b.visible
				|| (!Rc::ptr_eq(&a.theme, &b.theme) && *a.theme != *b.theme)
				|| self.world[i].0 != was.world[i].0
				|| self.ink[i] != was.ink[i];
			// What is inside a changed item paints under its opacity, its clip, its turn: changed with it.
			marked[i] = own || now[i].parent.is_some_and(|p| marked[p as usize]);
			if marked[i] {
				if b.visible {
					out.push(was.ink[i]);
				}
				if a.visible {
					out.push(self.ink[i]);
				}
			}
		}
		Some(out)
	}
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
	/// The roots in `roots` as they were before (the ones kept, laid out again): what changed in them is
	/// found item by item (`Root::changed_ink`), so a change inside a big frame repaints that change only.
	pub old: Vec<Root>,
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
		// The common change, a drag's step or an edit: items inside top-level items that stay where
		// they are, nothing reusable. Those roots are laid out again in place, and the index of the
		// top level refitted to their new extents, rather than every root moved through a map.
		if !all && !updated.reordered && !refs_too && !dirty.is_empty() {
			dirty.sort_unstable();
			dirty.dedup();
			let kept = dirty.iter().all(|h| self.at.get(h).is_some_and(|&i| doc.node(*h).is_some_and(|n| n.id == self.roots[i].id)));
			if kept {
				let sources = Sources::new(doc);
				let mut refit = true;
				for h in dirty {
					let i = self.at[&h];
					let before = self.roots[i].extent;
					self.versions = VERSIONS.fetch_add(1, Ordering::Relaxed) + 1;
					let built = self.build(&sources, h, measure);
					updated.old.push(std::mem::replace(&mut self.roots[i], built));
					let after = self.roots[i].extent;
					if after != before {
						refit = refit && self.top.refit(i as u32, after);
					}
					updated.roots.push((h, Some(before)));
				}
				if !refit {
					self.top = Index::build(self.roots.iter().enumerate().map(|(i, r)| (i as u32, r.extent)));
				}
				return updated;
			}
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
					self.versions = VERSIONS.fetch_add(1, Ordering::Relaxed) + 1;
					updated.roots.push((handle, kept.as_ref().map(|r| r.extent)));
					roots.push(self.build(&sources, handle, measure));
					// Kept for a change worked out item by item; not for a scene laid out whole.
					if let Some(was) = kept.filter(|_| !all) {
						updated.old.push(was);
					}
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
		let mut ink = Vec::with_capacity(tree.items.len());
		let mut extent: Option<Rect> = None;
		let mut reusable = false;
		// How far blurs spread an item: its own, and its parents' (they blur it with them).
		let mut spills: Vec<f64> = Vec::with_capacity(tree.items.len());
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
			let spill = blur_spill(blur_radius(&self.vars, item, t)) + item.parent.map_or(0.0, |p| spills[p as usize]);
			spills.push(spill);
			let reach = reach(&self.vars, item, t) + spill;
			let k = Rect { x: b.x - reach, y: b.y - reach, w: b.w + reach * 2.0, h: b.h + reach * 2.0 };
			if place.visible {
				extent = Some(extent.map_or(k, |e| e.union(&k)));
			}
			world.push(m);
			bounds.push(b);
			ink.push(k);
		}
		let index = Index::build(placed.iter().zip(&ink).enumerate().filter(|(_, (p, _))| p.visible).map(|(i, (_, b))| (i as u32, *b)));
		Root {
			handle,
			id: tree.items.first().map(|i| i.id.clone()).unwrap_or_default(),
			tree,
			placed,
			world,
			bounds,
			ink,
			extent: extent.unwrap_or_default(),
			index,
			reusable,
			version: self.versions,
		}
	}

	/// Where an item is: its root's index and its index in that root's tree, by id.
	pub fn find(&self, id: &str) -> Option<(usize, u32)> {
		self.roots.iter().enumerate().find_map(|(r, root)| root.tree.items.iter().position(|it| it.id == id).map(|i| (r, i as u32)))
	}

	/// The ids of the frames marked `placeholder: true`: what is drawn again when the writer they
	/// are marked with changes.
	pub fn placeholders(&self) -> Vec<String> {
		let mut out = Vec::new();
		for root in &self.roots {
			for (i, item) in root.tree.items.iter().enumerate() {
				if item.kind() == "frame" && self.vars.bool(item.get("placeholder"), &root.placed[i].theme, false) {
					out.push(item.id.clone());
				}
			}
		}
		out
	}

	/// What an item and everything in it paint on: the union of their ink boxes.
	/// What the whole stage covers, everything drawn on it.
	pub fn extent(&self) -> Option<Rect> {
		self.roots.iter().map(|r| r.extent).filter(|r| r.w > 0.0 || r.h > 0.0).reduce(|a, b| {
			let x = a.x.min(b.x);
			let y = a.y.min(b.y);
			Rect { x, y, w: a.right().max(b.right()) - x, h: a.bottom().max(b.bottom()) - y }
		})
	}

	pub fn extent_of(&self, id: &str) -> Option<Rect> {
		let (r, i) = self.find(id)?;
		let root = &self.roots[r];
		let mut out = root.ink[i as usize];
		let mut stack = root.tree.items[i as usize].children.clone();
		while let Some(c) = stack.pop() {
			if root.placed[c as usize].visible {
				out = out.union(&root.ink[c as usize]);
			}
			stack.extend(root.tree.items[c as usize].children.iter().copied());
		}
		Some(out)
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

	/// Every visible item under a point, topmost first, as `(root index, item index)`.
	pub fn pick_all(&self, x: f64, y: f64, slop: f64) -> Vec<(u32, u32)> {
		let area = Rect { x: x - slop, y: y - slop, w: slop * 2.0, h: slop * 2.0 };
		self.query(&area).into_iter().rev().filter(|&(r, i)| self.hits(&self.roots[r as usize], i, x, y, slop)).collect()
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

/// An item's blur radius: its enabled `blur` effects' radii added up, 0 for none.
pub fn blur_radius(vars: &Vars, item: &tree::Item, theme: &Theme) -> f64 {
	let effects = match item.get("effect") {
		Some(Value::Array(list)) => list.iter().collect(),
		Some(one) => vec![one],
		None => vec![],
	};
	effects
		.into_iter()
		.filter(|e| e.get("type").and_then(Value::as_str) == Some("blur") && vars.bool(e.get("enabled"), theme, true))
		.map(|e| vars.num(e.get("radius"), theme, 0.0).max(0.0))
		.sum()
}

/// How far a blur of this radius spreads what it blurs: three of its Gaussian's sigmas.
pub fn blur_spill(radius: f64) -> f64 {
	radius * 1.5
}

/// How far past its box an item paints: its stroke, its shadows, a card's paper shadow.
fn reach(vars: &Vars, item: &tree::Item, theme: &Theme) -> f64 {
	let mut r: f64 = 0.0;
	if item.get("stroke").is_some_and(|s| !s.is_null()) {
		let w = match item.get("strokeWidth").or_else(|| item.get("stroke").and_then(|s| s.get("thickness"))) {
			Some(Value::Object(sides)) => sides.values().map(|v| vars.num(Some(v), theme, 0.0)).fold(0.0, f64::max),
			other => vars.num(other, theme, 1.0),
		};
		// A mitred corner of a path reaches further than half the width; four widths covers it.
		r = r.max(if item.kind() == "path" { w * 4.0 } else { w });
	}
	let effects = match item.get("effect") {
		Some(Value::Array(list)) => list.iter().collect(),
		Some(one) => vec![one],
		None => vec![],
	};
	for e in effects {
		if e.get("type").and_then(Value::as_str) == Some("shadow") {
			let off = e.get("offset");
			let dx = vars.num(off.and_then(|o| o.get("x")), theme, 0.0).abs();
			let dy = vars.num(off.and_then(|o| o.get("y")), theme, 0.0).abs();
			r = r.max(dx.max(dy) + vars.num(e.get("blur"), theme, 0.0) * 1.5 + vars.num(e.get("spread"), theme, 0.0).max(0.0));
		}
	}
	// A markdown card, by its tag or its old one (an HTML card is a browser item, never a frame).
	let card = item.kind() == "frame" && matches!(item.get("metadata").and_then(|m| m.get("type")).and_then(Value::as_str), Some("decks.markdown-card" | "decks.card"));
	if matches!(item.kind(), "note" | "prompt" | "context") || card {
		r = r.max(6.0 + 18.0 * 1.5);
	}
	r
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
