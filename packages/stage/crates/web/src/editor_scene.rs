//! The editor's scene (`stage_editor::scene::Scene`) answered by the engine: its document, its
//! layout and its R-tree, read in place with nothing copied per question.

use crate::engine::Page;
use stage_editor::model::{PageBox, Pt, Rect};
use stage_editor::scene::{Props, Scene};
use std::collections::HashMap;

/// Where each item is in the scene, by id: built again only when the layout has changed (each root's
/// version rises when it is laid out again), since the scene's own `find` walks every item and a hover
/// asks at every pointer move.
#[derive(Clone, Debug, Default)]
pub struct SceneIds {
	key: Vec<(u32, u64)>,
	at: HashMap<String, (usize, u32)>,
}

impl SceneIds {
	/// Up to date with the page's layout.
	pub fn refresh(&mut self, page: &Page) {
		let key: Vec<(u32, u64)> = page.scene.roots.iter().map(|root| (root.handle.0, root.version)).collect();
		if key == self.key {
			return;
		}
		self.at.clear();
		for (r, root) in page.scene.roots.iter().enumerate() {
			for (i, item) in root.tree.items.iter().enumerate() {
				self.at.insert(item.id.clone(), (r, i as u32));
			}
		}
		self.key = key;
	}
}

/// The engine's page, for the editor, with the reach a press has round a thin line in stage
/// units (`line.reach-px` over the zoom), and the ids indexed (`SceneIds`).
pub struct EngineScene<'a> {
	pub page: &'a Page,
	pub reach: f64,
	ids: std::borrow::Cow<'a, SceneIds>,
}

impl<'a> EngineScene<'a> {
	/// With its own index, made now: for one-off questions and the tests.
	pub fn new(page: &'a Page, reach: f64) -> EngineScene<'a> {
		let mut ids = SceneIds::default();
		ids.refresh(page);
		EngineScene { page, reach, ids: std::borrow::Cow::Owned(ids) }
	}
	/// With an index kept between inputs (refreshed by the caller).
	pub fn with(page: &'a Page, reach: f64, ids: &'a SceneIds) -> EngineScene<'a> {
		EngineScene { page, reach, ids: std::borrow::Cow::Borrowed(ids) }
	}
	fn find(&self, id: &str) -> Option<(usize, u32)> {
		self.ids.at.get(id).copied()
	}
	fn item(&self, id: &str) -> Option<(&stage_scene::tree::Item, Rect)> {
		let (root, index) = self.find(id)?;
		let root = &self.page.scene.roots[root];
		let item = root.tree.items.get(index as usize)?;
		let place = root.placed.get(index as usize)?;
		Some((item, place.rect))
	}
}

impl Scene for EngineScene<'_> {
	fn items(&self) -> Vec<String> {
		let mut out = Vec::new();
		for root in &self.page.scene.roots {
			for (item, place) in root.tree.items.iter().zip(&root.placed) {
				if place.visible {
					out.push(item.id.clone());
				}
			}
		}
		out
	}
	fn node(&self, id: &str) -> Option<&Props> {
		self.item(id).map(|(item, _)| &*item.props)
	}
	fn parent(&self, id: &str) -> Option<String> {
		let (root, index) = self.find(id)?;
		let tree = &self.page.scene.roots[root].tree;
		tree.items[index as usize].parent.map(|up| tree.items[up as usize].id.clone())
	}
	fn children(&self, id: &str) -> Vec<String> {
		let Some((root, index)) = self.find(id) else { return Vec::new() };
		let tree = &self.page.scene.roots[root].tree;
		tree.items[index as usize].children.iter().map(|&child| tree.items[child as usize].id.clone()).collect()
	}
	fn placed(&self, id: &str) -> Option<Rect> {
		self.item(id).map(|(_, rect)| rect)
	}
	/// The engine draws an item where it lays it out: placed and drawn are one.
	fn drawn(&self, id: &str) -> Option<Rect> {
		self.placed(id)
	}
	fn boards(&self) -> Vec<PageBox> {
		self.page.cards.iter().map(|card| PageBox { path: card.path.clone(), x: card.x, y: card.y, w: card.w, h: card.h, least: None }).collect()
	}
	fn under(&self, at: Pt) -> Vec<String> {
		let scene = &self.page.scene;
		scene.pick_all(at.x, at.y, self.reach * 2.0).into_iter().map(|(r, i)| scene.roots[r as usize].tree.items[i as usize].id.clone()).collect()
	}
	/// Whether a point is on what a path draws: within the reach of its line (or half its stroke, whichever
	/// is wider), or inside its fill when it has one. The path is read in its own space, its viewBox (or its
	/// bounds) scaled to its box, as the page's canvas tested it. `None` for an item with no geometry.
	fn on_line(&self, id: &str, at: Pt) -> Option<bool> {
		let (item, place) = self.item(id)?;
		let d = item.get("geometry")?.as_str()?;
		let path = kurbo::BezPath::from_svg(d).ok()?;
		let vb = match item.get("viewBox").and_then(serde_json::Value::as_array) {
			Some(v) if v.len() == 4 => [v[0].as_f64()?, v[1].as_f64()?, v[2].as_f64()?, v[3].as_f64()?],
			_ => {
				let b = kurbo::Shape::bounding_box(&path);
				[b.x0, b.y0, b.width(), b.height()]
			}
		};
		if vb[2] <= 0.0 || vb[3] <= 0.0 || place.w <= 0.0 || place.h <= 0.0 {
			return None;
		}
		let (sx, sy) = (place.w / vb[2], place.h / vb[3]);
		let p = kurbo::Point::new((at.x - place.x) / sx + vb[0], (at.y - place.y) / sy + vb[1]);
		let stroke = item.get("strokeWidth").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
		let half = (stroke / 2.0).max(self.reach) / sx.max(sy);
		let near = path.segments().any(|seg| kurbo::ParamCurveNearest::nearest(&seg, p, 1e-3).distance_sq <= half * half);
		let filled = item.get("fill").is_some_and(|f| !f.is_null());
		Some(near || (filled && kurbo::Shape::contains(&path, p)))
	}
	fn within(&self, area: Rect) -> Vec<String> {
		let scene = &self.page.scene;
		scene.query(&area).into_iter().map(|(r, i)| scene.roots[r as usize].tree.items[i as usize].id.clone()).collect()
	}
}
