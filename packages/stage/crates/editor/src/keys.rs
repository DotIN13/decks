//! The keys of the drawing, in edit mode, decided (`edit/core/keys.ts`): given the key and its
//! modifiers, what is selected and the tool in hand, what the key does — the ops it writes, what is
//! selected after, the tool it arms. Whether the key reaches here at all (a text box with the
//! caret, the pen out) and doing what it says are the page's.
//!
//! Delete and Backspace, the arrows (the rules' nudge, more with Shift) and ⌘D act on what is
//! selected; ⌘Z and ⇧⌘Z step through the person's own edits; Escape puts the tool down, then lets
//! go; a letter arms a tool.

use crate::arrows::js_num;
use crate::model::{Op, Tool};
use crate::ops::{PageMove, delete_ops, duplicate_ops, move_ops, page_moves};
use crate::pick::{children_of, parent_of};
use crate::rules::Rules;
use crate::scene::Scene;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Value, json};

/// A key as it was pressed: `KeyboardEvent.key` and the modifiers held.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyPress {
	pub key: String,
	#[serde(default)]
	pub meta: bool,
	#[serde(default)]
	pub ctrl: bool,
	#[serde(default)]
	pub alt: bool,
	#[serde(default)]
	pub shift: bool,
}

impl KeyPress {
	pub fn new(key: &str) -> KeyPress {
		KeyPress { key: key.into(), ..Default::default() }
	}
}

/// What a key acts on.
pub struct KeyContext<'a> {
	/// The selected items, in the order they were picked.
	pub selection: &'a [String],
	/// The selected boards (the drawing's own picks, moved by the arrows with the items).
	pub boards: &'a [String],
	pub tool: Tool,
	/// Whether a board is selected as the page's own selection: its letters are the board's, not tools.
	pub page_selected: bool,
	/// That board, which the arrows move with the rest of what is selected.
	pub selected_page: Option<&'a str>,
	/// Whether the page can step through edits (undo, redo).
	pub can_step: bool,
	pub scene: &'a dyn Scene,
	/// Ids for what a duplicate makes.
	pub next_id: &'a mut dyn FnMut() -> String,
}

/// Which way a step through the edits goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
	Undo,
	Redo,
}

/// What a key does, when it is one of the drawing's.
#[derive(Clone, Debug, PartialEq)]
pub enum KeyAct {
	/// Not the drawing's key.
	Unhandled,
	Step(Step),
	/// The selection taken off the canvas; it is let go once the sheet has drawn without it.
	Delete { ops: Vec<Op> },
	/// Escape with a tool in hand: it is put down (back to select).
	PutDown,
	/// Escape with no tool: the items and boards selected are let go.
	LetGo,
	/// Copies of the selection, selected in its place once they arrive.
	Duplicate { ops: Vec<Op>, select: Vec<String> },
	Nudge { ops: Vec<Op>, boards: Vec<PageMove> },
	/// Another selection: the parents of what is selected (⇧Enter), or its children (Enter).
	Select { select: Vec<String> },
	Arm { tool: Tool },
}

impl KeyAct {
	pub fn handled(&self) -> bool {
		*self != KeyAct::Unhandled
	}
	/// The act as the TypeScript's `KeyAct` writes it: `{ handled, do, … }`.
	pub fn to_value(&self) -> Value {
		let ops = |ops: &Vec<Op>| serde_json::to_value(ops).unwrap_or(Value::Null);
		match self {
			KeyAct::Unhandled => json!({ "handled": false }),
			KeyAct::Step(step) => json!({ "handled": true, "do": "step", "step": step }),
			KeyAct::Delete { ops: list } => json!({ "handled": true, "do": "delete", "ops": ops(list), "select": [] }),
			KeyAct::PutDown => json!({ "handled": true, "do": "escape", "tool": "select" }),
			KeyAct::LetGo => json!({ "handled": true, "do": "escape", "select": [], "boards": [] }),
			KeyAct::Duplicate { ops: list, select } => json!({ "handled": true, "do": "duplicate", "ops": ops(list), "select": select }),
			KeyAct::Nudge { ops: list, boards } => json!({ "handled": true, "do": "nudge", "ops": ops(list), "boards": boards.iter().map(|b| json!({ "path": b.path, "x": js_num(b.x), "y": js_num(b.y) })).collect::<Vec<_>>() }),
			KeyAct::Select { select } => json!({ "handled": true, "do": "select", "select": select }),
			KeyAct::Arm { tool } => json!({ "handled": true, "do": "arm", "tool": tool }),
		}
	}
}

impl Serialize for KeyAct {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		self.to_value().serialize(serializer)
	}
}

/// The key that arms each tool (`PEN_TOOL_KEYS`). `v` is select, handled with the camera's keys.
/// `s` still makes a note, because it made a sticky when the tools inserted into boards.
fn tool_key(key: &str) -> Option<Tool> {
	Some(match key {
		"n" | "s" => Tool::Note,
		"c" => Tool::Card,
		"t" => Tool::Text,
		"r" => Tool::Rectangle,
		"o" => Tool::Ellipse,
		"f" => Tool::Frame,
		"a" => Tool::Arrow,
		_ => return None,
	})
}

/// Which way an arrow key nudges.
fn nudge_of(key: &str) -> Option<(f64, f64)> {
	match key {
		"ArrowLeft" => Some((-1.0, 0.0)),
		"ArrowRight" => Some((1.0, 0.0)),
		"ArrowUp" => Some((0.0, -1.0)),
		"ArrowDown" => Some((0.0, 1.0)),
		_ => None,
	}
}

/// What a key does to the drawing.
pub fn pen_key(press: &KeyPress, context: &mut KeyContext, rules: &Rules) -> KeyAct {
	let (selection, boards, tool) = (context.selection, context.boards, context.tool);
	let command = press.meta || press.ctrl;
	let alt = press.alt;
	let key = press.key.as_str();
	let lower = key.to_lowercase();
	if command && !alt && lower == "z" && context.can_step {
		return KeyAct::Step(if press.shift { Step::Redo } else { Step::Undo });
	}
	if !selection.is_empty() && (key == "Delete" || key == "Backspace") {
		return KeyAct::Delete { ops: delete_ops(selection, Some(context.scene)) };
	}
	if key == "Escape" && (!selection.is_empty() || !boards.is_empty() || tool != Tool::Select) {
		return if tool != Tool::Select { KeyAct::PutDown } else { KeyAct::LetGo };
	}
	if !selection.is_empty() && command && !alt && lower == "d" {
		let copies = duplicate_ops(context.scene, selection, context.next_id, rules);
		return KeyAct::Duplicate { ops: copies.ops, select: copies.made };
	}
	// ⇧Enter climbs to what the selection sits in, Enter goes down into what it holds: a group's or
	// a frame's children, never the parts of what is one thing (a shape, a file, a card).
	if key == "Enter" && !selection.is_empty() && !command && !alt {
		let next: Vec<String> = if press.shift { selection.iter().filter_map(|id| parent_of(context.scene, id)).collect() } else { selection.iter().flat_map(|id| children_of(context.scene, id)).collect() };
		let mut unique: Vec<String> = Vec::new();
		for id in next {
			if !unique.contains(&id) {
				unique.push(id);
			}
		}
		return if unique.is_empty() { KeyAct::Unhandled } else { KeyAct::Select { select: unique } };
	}
	// The boards picked with the drawing, and the board selected on its own (a press on it).
	let mut moving: Vec<&str> = boards.iter().map(String::as_str).collect();
	if let Some(page) = context.selected_page
		&& !moving.contains(&page)
	{
		moving.push(page);
	}
	if let Some((x, y)) = nudge_of(key)
		&& (!selection.is_empty() || !moving.is_empty())
		&& !command
		&& !alt
	{
		let step = if press.shift { rules.nudge_shift } else { rules.nudge };
		let (dx, dy) = (x * step, y * step);
		return KeyAct::Nudge { ops: move_ops(context.scene, selection, dx, dy, None, None), boards: page_moves(&context.scene.boards(), &moving, dx, dy) };
	}
	// The letters that arm a tool: only while no board is selected. With a board selected the keys
	// are the board's; a press on bare canvas lets it go, and then they are the drawing's.
	if !command && !alt && !context.page_selected
		&& let Some(armed) = tool_key(key)
	{
		return KeyAct::Arm { tool: armed };
	}
	KeyAct::Unhandled
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::model::PageBox;
	use crate::rules::{Form, Rules};
	use crate::scene::{Fake, FakeItem};

	const BOARD: &str = "boards/one.html";

	fn rules() -> Rules {
		Rules::for_form(Form::Desk)
	}
	fn scene() -> Fake {
		Fake::new(vec![FakeItem::rect("a", 10.0, 20.0, 100.0, 50.0), FakeItem::rect("b", 200.0, 20.0, 100.0, 50.0)])
			.with_boards(vec![PageBox { path: BOARD.into(), x: 1000.0, y: 0.0, w: 400.0, h: 300.0, least: None }])
	}
	fn strings(ids: &[&str]) -> Vec<String> {
		ids.iter().map(|id| id.to_string()).collect()
	}

	/// What a key does with a context like the TS tests' default: `a` selected, the select tool, can step.
	struct Ctx {
		scene: Fake,
		selection: Vec<String>,
		boards: Vec<String>,
		tool: Tool,
		page_selected: bool,
		selected_page: Option<&'static str>,
		can_step: bool,
	}
	impl Ctx {
		fn new() -> Ctx {
			Ctx { scene: scene(), selection: strings(&["a"]), boards: Vec::new(), tool: Tool::Select, page_selected: false, selected_page: None, can_step: true }
		}
		fn sel(mut self, ids: &[&str]) -> Ctx {
			self.selection = strings(ids);
			self
		}
		fn boards(mut self, paths: &[&str]) -> Ctx {
			self.boards = strings(paths);
			self
		}
		fn tool(mut self, tool: Tool) -> Ctx {
			self.tool = tool;
			self
		}
		fn page(mut self, selected: bool, page: Option<&'static str>) -> Ctx {
			self.page_selected = selected;
			self.selected_page = page;
			self
		}
		fn no_step(mut self) -> Ctx {
			self.can_step = false;
			self
		}
		fn on(mut self, scene: Fake) -> Ctx {
			self.scene = scene;
			self
		}
		fn press(&self, press: KeyPress) -> Value {
			let mut n = 0;
			let mut next = move || {
				n += 1;
				format!("n{n}")
			};
			let mut context = KeyContext { selection: &self.selection, boards: &self.boards, tool: self.tool, page_selected: self.page_selected, selected_page: self.selected_page, can_step: self.can_step, scene: &self.scene, next_id: &mut next };
			pen_key(&press, &mut context, &rules()).to_value()
		}
	}
	fn key(name: &str) -> KeyPress {
		KeyPress::new(name)
	}
	fn meta(name: &str) -> KeyPress {
		KeyPress { meta: true, ..key(name) }
	}
	fn shift(name: &str) -> KeyPress {
		KeyPress { shift: true, ..key(name) }
	}
	fn alt(name: &str) -> KeyPress {
		KeyPress { alt: true, ..key(name) }
	}
	fn none() -> Value {
		json!({ "handled": false })
	}

	#[test]
	fn command_z_undoes_and_shift_command_z_redoes_with_ctrl_too_when_the_page_can_step_and_never_with_alt() {
		assert_eq!(Ctx::new().press(meta("z")), json!({ "handled": true, "do": "step", "step": "undo" }));
		assert_eq!(Ctx::new().press(KeyPress { shift: true, ..meta("Z") }), json!({ "handled": true, "do": "step", "step": "redo" }));
		assert_eq!(Ctx::new().sel(&[]).press(KeyPress { ctrl: true, ..key("z") }), json!({ "handled": true, "do": "step", "step": "undo" }));
		assert_eq!(Ctx::new().press(KeyPress { alt: true, ..meta("z") }), none());
		assert_eq!(Ctx::new().no_step().press(meta("z")), none());
	}

	#[test]
	fn delete_and_backspace_take_the_selection_off_and_nothing_without_one() {
		let gone = json!({ "handled": true, "do": "delete", "ops": [{ "op": "delete", "id": "a" }, { "op": "delete", "id": "b" }], "select": [] });
		assert_eq!(Ctx::new().sel(&["a", "b"]).press(key("Delete")), gone);
		assert_eq!(Ctx::new().sel(&["a", "b"]).press(key("Backspace")), gone);
		assert_eq!(Ctx::new().sel(&[]).press(key("Delete")), none());
	}

	#[test]
	fn escape_puts_a_tool_down_first_then_lets_go_and_with_nothing_to_let_go_is_not_the_drawings() {
		let put_down = json!({ "handled": true, "do": "escape", "tool": "select" });
		let let_go = json!({ "handled": true, "do": "escape", "select": [], "boards": [] });
		assert_eq!(Ctx::new().tool(Tool::Rectangle).press(key("Escape")), put_down);
		assert_eq!(Ctx::new().tool(Tool::Rectangle).sel(&[]).press(key("Escape")), put_down);
		assert_eq!(Ctx::new().press(key("Escape")), let_go);
		assert_eq!(Ctx::new().sel(&[]).boards(&[BOARD]).press(key("Escape")), let_go);
		assert_eq!(Ctx::new().sel(&[]).press(key("Escape")), none());
	}

	#[test]
	fn command_d_duplicates_the_selection_by_the_rules_offset_and_selects_the_copies() {
		let o = rules().duplicate_offset;
		assert_eq!(
			Ctx::new().sel(&["a", "b"]).press(meta("d")),
			json!({
				"handled": true,
				"do": "duplicate",
				"ops": [
					{ "op": "copy", "id": "a", "as": "n1" },
					{ "op": "update", "id": "n1", "set": { "x": js_num(10.0 + o), "y": js_num(20.0 + o) } },
					{ "op": "copy", "id": "b", "as": "n2" },
					{ "op": "update", "id": "n2", "set": { "x": js_num(200.0 + o), "y": js_num(20.0 + o) } },
				],
				"select": ["n1", "n2"],
			})
		);
		assert_eq!(Ctx::new().press(KeyPress { ctrl: true, ..key("D") })["handled"], json!(true));
		assert_eq!(Ctx::new().press(KeyPress { alt: true, ..meta("d") }), none());
		// With nothing selected ⌘D is not the drawing's, and a bare d is no tool.
		assert_eq!(Ctx::new().sel(&[]).press(meta("d")), none());
		assert_eq!(Ctx::new().press(key("d")), none());
	}

	#[test]
	fn the_arrows_nudge_items_by_the_rules_step_and_boards_with_them_and_shift_makes_it_the_bigger_step() {
		let r = rules();
		assert_eq!(Ctx::new().press(key("ArrowRight")), json!({ "handled": true, "do": "nudge", "ops": [{ "op": "update", "id": "a", "set": { "x": js_num(10.0 + r.nudge), "y": 20 } }], "boards": [] }));
		assert_eq!(
			Ctx::new().boards(&[BOARD]).press(shift("ArrowUp")),
			json!({ "handled": true, "do": "nudge", "ops": [{ "op": "update", "id": "a", "set": { "x": 10, "y": js_num(20.0 - r.nudge_shift) } }], "boards": [{ "path": BOARD, "x": 1000, "y": js_num(-r.nudge_shift) }] })
		);
		assert_eq!(
			Ctx::new().sel(&["a", "b"]).press(shift("ArrowLeft")),
			json!({ "handled": true, "do": "nudge", "ops": [{ "op": "update", "id": "a", "set": { "x": js_num(10.0 - r.nudge_shift), "y": 20 } }, { "op": "update", "id": "b", "set": { "x": js_num(200.0 - r.nudge_shift), "y": 20 } }], "boards": [] })
		);
	}

	#[test]
	fn boards_alone_move_nothing_selected_moves_nothing_and_command_or_alt_are_not_a_nudge() {
		let r = rules();
		assert_eq!(Ctx::new().sel(&[]).boards(&[BOARD]).press(key("ArrowDown")), json!({ "handled": true, "do": "nudge", "ops": [], "boards": [{ "path": BOARD, "x": 1000, "y": js_num(r.nudge) }] }));
		assert_eq!(Ctx::new().sel(&[]).press(key("ArrowDown")), none());
		assert_eq!(Ctx::new().press(meta("ArrowDown")), none());
		assert_eq!(Ctx::new().press(alt("ArrowDown")), none());
	}

	#[test]
	fn the_board_selected_on_its_own_moves_with_the_arrows_alone_or_with_what_is_picked_and_only_once() {
		let r = rules();
		assert_eq!(Ctx::new().sel(&[]).page(true, Some(BOARD)).press(key("ArrowRight")), json!({ "handled": true, "do": "nudge", "ops": [], "boards": [{ "path": BOARD, "x": js_num(1000.0 + r.nudge), "y": 0 }] }));
		assert_eq!(
			Ctx::new().page(true, Some(BOARD)).press(shift("ArrowDown")),
			json!({ "handled": true, "do": "nudge", "ops": [{ "op": "update", "id": "a", "set": { "x": 10, "y": js_num(20.0 + r.nudge_shift) } }], "boards": [{ "path": BOARD, "x": 1000, "y": js_num(r.nudge_shift) }] })
		);
		assert_eq!(Ctx::new().sel(&[]).boards(&[BOARD]).page(false, Some(BOARD)).press(key("ArrowLeft")), json!({ "handled": true, "do": "nudge", "ops": [], "boards": [{ "path": BOARD, "x": js_num(1000.0 - r.nudge), "y": 0 }] }));
		// A selected board not on the stage moves nothing.
		assert_eq!(Ctx::new().sel(&[]).page(false, Some("boards/gone.html")).press(key("ArrowLeft")), json!({ "handled": true, "do": "nudge", "ops": [], "boards": [] }));
	}

	#[test]
	fn a_letter_arms_its_tool_unless_a_board_is_selected_or_a_modifier_is_held() {
		for (letter, tool) in [("n", "note"), ("s", "note"), ("c", "card"), ("t", "text"), ("r", "rectangle"), ("o", "ellipse"), ("f", "frame"), ("a", "arrow")] {
			assert_eq!(Ctx::new().sel(&[]).press(key(letter)), json!({ "handled": true, "do": "arm", "tool": tool }), "{letter}");
		}
		assert_eq!(Ctx::new().page(true, None).press(key("r")), none());
		assert_eq!(Ctx::new().press(meta("r")), none());
		assert_eq!(Ctx::new().press(alt("r")), none());
		// Capitals and other letters are not tools.
		assert_eq!(Ctx::new().press(key("R")), none());
		assert_eq!(Ctx::new().press(key("v")), none());
		assert_eq!(Ctx::new().press(key("x")), none());
	}

	#[test]
	fn shift_enter_picks_what_the_selection_sits_in_and_enter_what_it_holds() {
		let nested = Fake::new(vec![
			FakeItem::rect("g", 0.0, 0.0, 300.0, 100.0).kind("group"),
			FakeItem::rect("f", 0.0, 0.0, 140.0, 100.0).kind("frame").inside("g"),
			FakeItem::rect("f1", 10.0, 10.0, 50.0, 50.0).inside("f"),
			FakeItem::rect("f2", 70.0, 10.0, 50.0, 50.0).inside("f"),
			FakeItem::rect("x", 200.0, 0.0, 100.0, 100.0).inside("g"),
			FakeItem::rect("sh", 500.0, 0.0, 100.0, 100.0).kind("frame").set("metadata", json!({ "type": "decks.shape" })),
			FakeItem::rect("sh-words", 520.0, 40.0, 60.0, 20.0).kind("text").inside("sh"),
		]);
		let at = |ids: &[&str]| Ctx::new().on(nested.clone()).sel(ids);
		let select = |ids: &[&str]| json!({ "handled": true, "do": "select", "select": ids });
		assert_eq!(at(&["f1"]).press(shift("Enter")), select(&["f"]));
		assert_eq!(at(&["f1", "f2"]).press(shift("Enter")), select(&["f"]), "the parent once");
		assert_eq!(at(&["f"]).press(shift("Enter")), select(&["g"]));
		assert_eq!(at(&["g"]).press(shift("Enter")), none());
		assert_eq!(at(&["g"]).press(key("Enter")), select(&["f", "x"]));
		assert_eq!(at(&["f"]).press(key("Enter")), select(&["f1", "f2"]));
		assert_eq!(at(&["f1"]).press(key("Enter")), none());
		// A shape is one thing: Enter does not reach its parts.
		assert_eq!(at(&["sh"]).press(key("Enter")), none());
		assert_eq!(at(&[]).press(key("Enter")), none());
		assert_eq!(at(&["g"]).press(meta("Enter")), none());
		assert_eq!(at(&["f1"]).press(KeyPress { alt: true, ..shift("Enter") }), none());
	}
}
