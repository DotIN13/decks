//! A gesture in progress on the page: lifted items moved and reshaped here only, and the arrows
//! joined to them bent, until the gesture ends or the saved drawing arrives.

use super::*;

impl Page {
	/// What the editor draws over the canvas, as `canvas/editor/core/overlay-json.ts` writes it; empty or bad JSON clears it.
	pub fn set_overlay(&mut self, json: &str) {
		self.overlay = stage_paint::overlay::Overlay::parse(json).filter(|o| !o.is_empty());
	}

	/// Lift items for a drag: the worker leaves them out of its tiles from now on.
	pub fn lift(&mut self, ids: &[String]) {
		self.lifted.extend(ids.iter().cloned());
	}

	/// A gesture in progress: each item moved by `dx dy` and, while resizing or restyling, with these
	/// fields, shown here only, until the gesture ends (`None`) or the saved drawing arrives. Lifts
	/// what it names. Returns the items whose layout changed, for the stage's outlines.
	///
	/// An arrow with an end on what the gesture moves or reshapes bends with it: it is routed again
	/// here at each step (`arrows.rs`, pen's router ported) and lifted too. Returns every item this
	/// step newly lifted, the bent arrows and any item the gesture names that the stage did not lift
	/// itself (a shape's outline, resized with it), which the worker must leave out of its tiles as
	/// well, and which the stage must put down at the drop; one kept back stays drawn here, over the tiles.
	pub fn preview(&mut self, moving: Option<Vec<(String, Preview)>>) -> Result<Vec<String>, String> {
		self.unpreview();
		let Some(moving) = moving else {
			self.bent = None;
			return Ok(Vec::new());
		};
		let mut changes = Vec::new();
		let mut fresh = Vec::new();
		for (id, p) in &moving {
			if p.dx != 0.0 || p.dy != 0.0 {
				self.offsets.insert(id.clone(), (p.dx, p.dy));
			}
			for (key, value) in &p.set {
				changes.push(Change::Set { id: id.clone(), key: key.clone(), value: value.clone() });
			}
			if self.lifted.insert(id.clone()) {
				fresh.push(id.clone());
			}
		}
		// Fields that no longer apply (an item that went) are left out rather than failing the gesture.
		changes.retain(|c| matches!(c, Change::Set { id, .. } if self.doc.handle(id).is_some()));
		if !changes.is_empty() {
			let applied = self.doc.apply(&changes).map_err(|e| e.0)?;
			self.preview_undo = applied.undo.clone();
			self.scene.update(&self.doc, Some(&applied), &self.text);
		}
		fresh.extend(self.bend(&moving));
		Ok(fresh)
	}

	/// Route the arrows a gesture bends from where their ends are at this step, as preview fields
	/// undone with the rest; returns the ones newly lifted.
	pub(crate) fn bend(&mut self, moving: &[(String, Preview)]) -> Vec<String> {
		let mut key: Vec<&str> = moving.iter().map(|(id, _)| id.as_str()).collect();
		key.sort_unstable();
		let mut boards: Vec<&str> = self.carry.0.iter().map(String::as_str).collect();
		boards.sort_unstable();
		let key = format!("{}|{}", key.join(","), boards.join(","));
		if self.bent.as_ref().is_none_or(|b| b.key != key) {
			self.bent = Some(Bent::find(&self.scene, moving, &self.carry.0, key));
		}
		let bent = self.bent.as_ref().expect("found above");
		if bent.arrows.is_empty() {
			return Vec::new();
		}
		let scene = &self.scene;
		let place = |id: &str| -> Option<Rect> {
			let (r, i) = match bent.at.get(id) {
				Some(&(r, i)) if scene.roots.get(r).and_then(|root| root.tree.items.get(i as usize)).is_some_and(|it| it.id == id) => (r, i),
				_ => scene.find(id)?,
			};
			Some(scene.roots[r].placed[i as usize].rect)
		};
		let find = |id: &str| -> Option<Rect> {
			if let Some(mut rect) = place(id) {
				if let Some((dx, dy)) = bent.carried.get(id).and_then(|by| self.offsets.get(by)) {
					rect.x += dx;
					rect.y += dy;
				}
				return Some(rect);
			}
			let board = self.cards.iter().find(|b| b.path == id)?;
			let (dx, dy) = if self.carry.0.contains(id) { (self.carry.1, self.carry.2) } else { (0.0, 0.0) };
			Some(Rect { x: board.x + dx, y: board.y + dy, w: board.w, h: board.h })
		};
		let mut changes = Vec::new();
		for arrow in &bent.arrows {
			let Some(points) = arrows::points(&arrow.meta, &find) else { continue };
			let (route, heads) = arrows::style(&arrow.meta);
			let shape = arrows::shape(&points, arrow.stroke, route, heads);
			let origin = arrow.parent.as_deref().and_then(place).map_or((0.0, 0.0), |r| (r.x, r.y));
			let set = |key: &str, value: Value| Change::Set { id: arrow.id.clone(), key: key.into(), value: Some(value) };
			changes.extend([
				set("x", json!(arrows::round(shape.x - origin.0))),
				set("y", json!(arrows::round(shape.y - origin.1))),
				set("width", json!(shape.width)),
				set("height", json!(shape.height)),
				set("viewBox", json!([0, 0, shape.width, shape.height])),
				set("geometry", json!(shape.geometry)),
			]);
		}
		let ids: Vec<String> = bent.arrows.iter().map(|a| a.id.clone()).collect();
		if !changes.is_empty() {
			if let Ok(applied) = self.doc.apply(&changes) {
				// Undone first, then the gesture's own fields: the two touch different items.
				let mut undo = applied.undo.clone();
				undo.append(&mut self.preview_undo);
				self.preview_undo = undo;
				self.scene.update(&self.doc, Some(&applied), &self.text);
			}
		}
		ids.into_iter().filter(|id| self.lifted.insert(id.clone())).collect()
	}

	pub(crate) fn unpreview_fields(&mut self) {
		if !self.preview_undo.is_empty() {
			let undo = std::mem::take(&mut self.preview_undo);
			if let Ok(applied) = self.doc.apply(&undo) {
				self.scene.update(&self.doc, Some(&applied), &self.text);
			}
		}
	}

	/// Take a gesture's shown fields and offsets back.
	pub(crate) fn unpreview(&mut self) {
		self.offsets.clear();
		if !self.preview_undo.is_empty() {
			let undo = std::mem::take(&mut self.preview_undo);
			if let Ok(applied) = self.doc.apply(&undo) {
				self.scene.update(&self.doc, Some(&applied), &self.text);
			}
		}
	}

	/// Put them down: drawn here until the worker's tiles with them arrive (`landed`).
	pub fn landed(&mut self, ids: &[String]) {
		for id in ids {
			self.lifted.remove(id);
		}
	}
}

/// The arrows one gesture bends: each with an end on what it moves (or in it), or on a board it
/// carries, and not itself moved. Found once per gesture; only the routing runs at each step.
pub(crate) struct Bent {
	pub(crate) key: String,
	pub(crate) arrows: Vec<BentArrow>,
	/// Each item the gesture moves, and everything in one, to the moved item whose offset it takes.
	pub(crate) carried: HashMap<String, String>,
	/// Where each arrow end and parent is in the scene, so a step does not search for it.
	pub(crate) at: HashMap<String, (usize, u32)>,
}

pub(crate) struct BentArrow {
	pub(crate) id: String,
	pub(crate) meta: Value,
	pub(crate) stroke: f64,
	pub(crate) parent: Option<String>,
}

impl Bent {
	fn find(scene: &Scene, moving: &[(String, Preview)], boards: &HashSet<String>, key: String) -> Bent {
		let moved: HashSet<&str> = moving.iter().map(|(id, _)| id.as_str()).collect();
		let mut carried = HashMap::new();
		for root in &scene.roots {
			let items = &root.tree.items;
			for (i, item) in items.iter().enumerate() {
				let mut at = Some(i as u32);
				while let Some(a) = at {
					let up = &items[a as usize];
					if moved.contains(up.id.as_str()) {
						carried.insert(item.id.clone(), up.id.clone());
						break;
					}
					at = up.parent;
				}
			}
		}
		let mut arrows = Vec::new();
		let mut at = HashMap::new();
		for root in &scene.roots {
			let items = &root.tree.items;
			for item in items {
				// Arrows in the document itself: an instance's copies are routed where they are defined.
				if item.handle.is_none() || carried.contains_key(&item.id) || !arrows::is_arrow(&item.props) {
					continue;
				}
				let Some(meta) = item.get("metadata") else { continue };
				let ends = arrows::end_items(meta);
				if !ends.iter().flatten().any(|e| carried.contains_key(*e) || boards.contains(*e)) {
					continue;
				}
				let parent = item.parent.map(|p| items[p as usize].id.clone());
				for name in ends.iter().flatten().map(|e| e.to_string()).chain(parent.clone()) {
					if let Some(found) = scene.find(&name) {
						at.insert(name, found);
					}
				}
				arrows.push(BentArrow { id: item.id.clone(), meta: meta.clone(), stroke: item.get("strokeWidth").and_then(Value::as_f64).unwrap_or(2.0), parent });
			}
		}
		Bent { key, arrows, carried, at }
	}
}

/// A gesture's preview of one item (`PenPreview` in the app): moved by `dx dy`, and fields shown.
#[derive(Clone, Debug, Default)]
pub struct Preview {
	pub dx: f64,
	pub dy: f64,
	pub set: Vec<(String, Option<Value>)>,
}
