//! What the editor asks of the scene, and nothing else (`edit/core/scene.ts`'s `SceneQuery`).
//!
//! The engine answers it from its document and layout (`web` crate); the tests answer it from a
//! scene made by hand (`Fake`), so every rule is tested without an engine.

use crate::model::{PageBox, Pt, Rect};
use serde_json::{Map, Value};

pub type Props = Map<String, Value>;

pub trait Scene {
	/// Every placed item, in paint order.
	fn items(&self) -> Vec<String>;
	/// The item's fields as the document has them (`type`, `x`, `metadata`, …), without its children.
	fn node(&self, id: &str) -> Option<&Props>;
	/// The item it sits in, `None` at the top.
	fn parent(&self, id: &str) -> Option<String>;
	/// What is in it, in order.
	fn children(&self, id: &str) -> Vec<String>;
	/// Where the item is placed.
	fn placed(&self, id: &str) -> Option<Rect>;
	/// Where it is drawn (text measured, shapes at their outline), else where it is placed.
	fn bounds(&self, id: &str) -> Option<Rect> {
		self.drawn(id).or_else(|| self.placed(id))
	}
	/// Where the sheet has drawn it, and nothing until it has.
	fn drawn(&self, id: &str) -> Option<Rect>;
	/// The boards on the stage, as placed, in file order.
	fn boards(&self) -> Vec<PageBox>;
	/// Every item under a stage point, topmost first, with a press's reach round each.
	fn under(&self, at: Pt) -> Vec<String>;
	/// Whether a point is on what a line item draws; `None` when it cannot tell.
	fn on_line(&self, id: &str, at: Pt) -> Option<bool>;
	/// The items whose boxes meet an area (the scene's R-tree), any order.
	fn within(&self, area: Rect) -> Vec<String> {
		self.items().into_iter().filter(|id| self.bounds(id).is_some_and(|b| b.meets(&area))).collect()
	}
	/// The item's type.
	fn kind(&self, id: &str) -> &str {
		self.node(id).and_then(|n| n.get("type")).and_then(Value::as_str).unwrap_or("")
	}
}

/// How far round its box a fake item is found under a point, as a press's reach is in the engine.
pub const FAKE_REACH: f64 = 4.0;

/// One item of a scene made by hand.
#[derive(Clone, Debug)]
pub struct FakeItem {
	pub id: String,
	pub props: Props,
	pub placed: Rect,
	pub drawn: Option<Rect>,
	pub parent: Option<String>,
	/// Whether a point is on its line, for a line item; `None` for anything else.
	pub line: Option<bool>,
}

impl FakeItem {
	/// A rectangle at a box, its `x` and `y` written as a file has them.
	pub fn rect(id: &str, x: f64, y: f64, w: f64, h: f64) -> FakeItem {
		let mut props = Props::new();
		props.insert("type".into(), "rectangle".into());
		props.insert("x".into(), x.into());
		props.insert("y".into(), y.into());
		props.insert("width".into(), w.into());
		props.insert("height".into(), h.into());
		FakeItem { id: id.into(), props, placed: Rect { x, y, w, h }, drawn: None, parent: None, line: None }
	}
	pub fn kind(mut self, kind: &str) -> FakeItem {
		self.props.insert("type".into(), kind.into());
		self
	}
	pub fn set(mut self, key: &str, value: Value) -> FakeItem {
		self.props.insert(key.into(), value);
		self
	}
	pub fn inside(mut self, parent: &str) -> FakeItem {
		self.parent = Some(parent.into());
		self
	}
	pub fn drawn_at(mut self, drawn: Rect) -> FakeItem {
		self.drawn = Some(drawn);
		self
	}
}

/// A scene made by hand: boxes and fields, no engine and no file.
#[derive(Clone, Debug, Default)]
pub struct Fake {
	pub list: Vec<FakeItem>,
	pub pages: Vec<PageBox>,
}

impl Fake {
	pub fn new(list: Vec<FakeItem>) -> Fake {
		Fake { list, pages: Vec::new() }
	}
	pub fn with_boards(mut self, pages: Vec<PageBox>) -> Fake {
		self.pages = pages;
		self
	}
	fn get(&self, id: &str) -> Option<&FakeItem> {
		self.list.iter().find(|one| one.id == id)
	}
}

impl Scene for Fake {
	fn items(&self) -> Vec<String> {
		self.list.iter().map(|one| one.id.clone()).collect()
	}
	fn node(&self, id: &str) -> Option<&Props> {
		self.get(id).map(|one| &one.props)
	}
	fn parent(&self, id: &str) -> Option<String> {
		self.get(id).and_then(|one| one.parent.clone())
	}
	fn children(&self, id: &str) -> Vec<String> {
		self.list.iter().filter(|one| one.parent.as_deref() == Some(id)).map(|one| one.id.clone()).collect()
	}
	fn placed(&self, id: &str) -> Option<Rect> {
		self.get(id).map(|one| one.placed)
	}
	fn drawn(&self, id: &str) -> Option<Rect> {
		self.get(id).map(|one| one.drawn.unwrap_or(one.placed))
	}
	fn boards(&self) -> Vec<PageBox> {
		self.pages.clone()
	}
	fn under(&self, at: Pt) -> Vec<String> {
		let mut hits: Vec<String> = self
			.list
			.iter()
			.filter(|one| {
				let b = one.drawn.unwrap_or(one.placed);
				at.x >= b.x - FAKE_REACH && at.x <= b.right() + FAKE_REACH && at.y >= b.y - FAKE_REACH && at.y <= b.bottom() + FAKE_REACH
			})
			.map(|one| one.id.clone())
			.collect();
		hits.reverse();
		hits
	}
	fn on_line(&self, id: &str, _at: Pt) -> Option<bool> {
		self.get(id).and_then(|one| one.line)
	}
}
