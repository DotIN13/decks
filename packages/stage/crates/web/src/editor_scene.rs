//! The editor's scene (`stage_editor::scene::Scene`) answered by the engine: its document, its
//! layout and its R-tree, read in place with nothing copied per question.

use crate::engine::Page;
use stage_editor::model::{PageBox, Pt, Rect};
use stage_editor::scene::{Props, Scene};
use std::collections::HashMap;

/// The engine's page, for the editor, with the reach a press has round a thin line in stage
/// units (`line.reach-px` over the zoom). Made for one input: the ids are indexed once, since the
/// scene's own `find` walks every item.
pub struct EngineScene<'a> {
	pub page: &'a Page,
	pub reach: f64,
	at: HashMap<&'a str, (usize, u32)>,
}

impl<'a> EngineScene<'a> {
	pub fn new(page: &'a Page, reach: f64) -> EngineScene<'a> {
		let mut at = HashMap::new();
		for (r, root) in page.scene.roots.iter().enumerate() {
			for (i, item) in root.tree.items.iter().enumerate() {
				at.insert(item.id.as_str(), (r, i as u32));
			}
		}
		EngineScene { page, reach, at }
	}
	fn find(&self, id: &str) -> Option<(usize, u32)> {
		self.at.get(id).copied()
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
		scene.pick_all(at.x, at.y, self.reach).into_iter().map(|(r, i)| scene.roots[r as usize].tree.items[i as usize].id.clone()).collect()
	}
	/// The scene's pick already hits a line within the reach and a fill inside it: an item it finds here is on it.
	fn on_line(&self, id: &str, at: Pt) -> Option<bool> {
		self.item(id)?;
		Some(self.under(at).iter().any(|hit| hit == id))
	}
	fn within(&self, area: Rect) -> Vec<String> {
		let scene = &self.page.scene;
		scene.query(&area).into_iter().map(|(r, i)| scene.roots[r as usize].tree.items[i as usize].id.clone()).collect()
	}
}
