//! The editor's own words for what it works with, as `edit/core/model.ts` has them.

pub use stage_scene::Rect;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Pt {
	pub x: f64,
	pub y: f64,
}

impl Pt {
	pub fn new(x: f64, y: f64) -> Pt {
		Pt { x, y }
	}
}

/// A move in progress, by how much.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Offset {
	pub dx: f64,
	pub dy: f64,
}

pub const ZERO: Offset = Offset { dx: 0.0, dy: 0.0 };

/// Two corners, as a drag has them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Corners {
	pub x1: f64,
	pub y1: f64,
	pub x2: f64,
	pub y2: f64,
}

impl Corners {
	/// The box the two corners span, whichever way round they are.
	pub fn rect(&self) -> Rect {
		Rect { x: self.x1.min(self.x2), y: self.y1.min(self.y2), w: (self.x2 - self.x1).abs(), h: (self.y2 - self.y1).abs() }
	}
}

/// The keys held with a press or a move.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Mods {
	#[serde(default)]
	pub shift: bool,
	#[serde(default)]
	pub alt: bool,
	#[serde(default)]
	pub meta: bool,
	#[serde(default)]
	pub ctrl: bool,
}

impl Mods {
	/// ⌘ or Ctrl: "ignore what is around me" during a drag (no snap, no new parent).
	pub fn free(&self) -> bool {
		self.meta || self.ctrl
	}
}

/// A board as the stage places it; `least` is the height its content needs, a floor for a drag of its height.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PageBox {
	pub path: String,
	pub x: f64,
	pub y: f64,
	pub w: f64,
	pub h: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub least: Option<f64>,
}

impl PageBox {
	pub fn rect(&self) -> Rect {
		Rect { x: self.x, y: self.y, w: self.w, h: self.h }
	}
}

/// What a press on the drawing does: `select` picks up, every other tool makes one item.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
	Select,
	Note,
	Card,
	Text,
	Rectangle,
	Ellipse,
	Frame,
	Arrow,
	Shape,
	Icon,
}

/// A line the stage draws where a drag snapped: an edge lined up (`line`) or an equal gap (`gap`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Guide {
	pub kind: GuideKind,
	pub x1: f64,
	pub y1: f64,
	pub x2: f64,
	pub y2: f64,
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub points: Vec<Pt>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub label: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuideKind {
	Line,
	Gap,
}

/// The side of an item an arrow's end keeps to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
	Top,
	Right,
	Bottom,
	Left,
}

/// Part of a box, as an op moves or sizes an item by it (`@decks/pen`'s `Partial<Box>`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct BoxPart {
	#[serde(default, skip_serializing_if = "Option::is_none", serialize_with = "as_js")]
	pub x1: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none", serialize_with = "as_js")]
	pub y1: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none", serialize_with = "as_js")]
	pub x2: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none", serialize_with = "as_js")]
	pub y2: Option<f64>,
}

/// A number written as JavaScript writes it: a whole one with no fraction (`15`, not `15.0`), so an op's text is the TypeScript's.
fn as_js<S: serde::Serializer>(n: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
	match n {
		Some(n) if n.fract() == 0.0 && n.abs() < 9.0e15 => serializer.serialize_i64(*n as i64),
		Some(n) => serializer.serialize_f64(*n),
		None => serializer.serialize_none(),
	}
}

/// One edit to the drawing, in `@decks/pen`'s own form (`Op` in `packages/pen/src/ops.ts`), so what the
/// editor sends is what the page sends today. `parent` is absent to leave it, `null` for the top.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Op {
	Insert {
		#[serde(default, skip_serializing_if = "Option::is_none")]
		parent: Option<serde_json::Value>,
		#[serde(default, skip_serializing_if = "Option::is_none")]
		index: Option<usize>,
		node: serde_json::Map<String, serde_json::Value>,
		#[serde(rename = "box", default, skip_serializing_if = "Option::is_none")]
		area: Option<BoxPart>,
	},
	Update {
		id: String,
		#[serde(default, skip_serializing_if = "Option::is_none")]
		set: Option<serde_json::Map<String, serde_json::Value>>,
		#[serde(rename = "box", default, skip_serializing_if = "Option::is_none")]
		area: Option<BoxPart>,
	},
	Replace {
		id: String,
		node: serde_json::Map<String, serde_json::Value>,
	},
	Delete {
		id: String,
	},
	Move {
		id: String,
		#[serde(default, skip_serializing_if = "Option::is_none")]
		parent: Option<serde_json::Value>,
		#[serde(default, skip_serializing_if = "Option::is_none")]
		index: Option<usize>,
		#[serde(rename = "box", default, skip_serializing_if = "Option::is_none")]
		area: Option<BoxPart>,
	},
	Copy {
		id: String,
		#[serde(default, skip_serializing_if = "Option::is_none")]
		parent: Option<serde_json::Value>,
		#[serde(default, skip_serializing_if = "Option::is_none")]
		index: Option<usize>,
		#[serde(rename = "box", default, skip_serializing_if = "Option::is_none")]
		area: Option<BoxPart>,
		#[serde(rename = "as", default, skip_serializing_if = "Option::is_none")]
		as_id: Option<String>,
	},
}

impl Op {
	/// Set fields of an item.
	pub fn set(id: &str, fields: serde_json::Map<String, serde_json::Value>) -> Op {
		Op::Update { id: id.into(), set: Some(fields), area: None }
	}
}
