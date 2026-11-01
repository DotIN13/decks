//! What a press, a hover or a tap on the stage starts (`edit/core/dispatch.ts`): given what it
//! landed on, the tool in hand, whether the drawing can be edited, and what is pressing. The numbers
//! (taps, double taps) and what differs by form (hover) are the rules table's.

use crate::model::{Pt, Tool};
use crate::rules::{Pointer, Rules};

/// Where a press landed: the bare stage, a drawn item's click shape over a page, or anything else (a page, a handle, chrome).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
	Stage,
	Drawn,
	Other,
}

fn on_canvas(target: Target) -> bool {
	matches!(target, Target::Stage | Target::Drawn)
}

/// What is known of a press as it lands. `on_item` and `picture` are asked only when they decide.
pub struct PressFacts<'a> {
	pub pointer: Pointer,
	/// The main button is 0, the middle 1.
	pub button: u8,
	pub target: Target,
	pub editable: bool,
	/// The draw tool is out: ink has the stage.
	pub drawing: bool,
	pub tool: Tool,
	/// Space is held: a drag pans.
	pub space: bool,
	/// Fingers already down before this one.
	pub fingers: usize,
	pub on_item: &'a dyn Fn() -> bool,
	pub picture: &'a dyn Fn() -> Option<String>,
}

/// What a finger does after it is pooled with the camera's fingers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Then {
	/// On the drawing: it taps or carries.
	Drawing,
	/// On bare canvas: a tap lets the selection go, a hold starts what the rules say.
	Deselect,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PressAction {
	/// A tool is armed: it makes its item from this press.
	Make,
	/// The select tool on the drawing or bare canvas: what is under the press is picked up, or a marquee drawn.
	Press,
	/// A mouse or a pen on a board's picture: carried as its node would be, or only selected.
	Picture { path: String, carry: bool },
	/// A finger, pooled with the camera's (a pan, a pinch), then the drawing's (`then`), or a board's picture selected.
	Touch { picture: Option<String>, then: Option<Then> },
	/// The camera dragged: the middle button, Space, or bare canvas, which lets the selected board go.
	Pan { deselect: bool, middle: bool },
	/// Not the stage's: a page's own press.
	Nothing,
}

/// What a press on the stage starts.
pub fn decide_press(facts: &PressFacts) -> PressAction {
	let tool = facts.tool;
	if facts.pointer == Pointer::Touch {
		// The drawing's, for the first finger only: a second is a pinch.
		let pen = facts.editable && !facts.drawing && facts.fingers == 0 && on_canvas(facts.target);
		if pen && tool != Tool::Select {
			return PressAction::Make;
		}
		let on_drawn = || facts.target == Target::Drawn || (facts.target == Target::Stage && (facts.on_item)());
		let picture = if facts.target == Target::Stage && facts.fingers == 0 && !(pen && on_drawn()) { (facts.picture)() } else { None };
		if picture.is_some() {
			return PressAction::Touch { picture, then: None };
		}
		if pen && on_drawn() {
			return PressAction::Touch { picture: None, then: Some(Then::Drawing) };
		}
		if pen {
			return PressAction::Touch { picture: None, then: Some(Then::Deselect) };
		}
		return PressAction::Touch { picture: None, then: None };
	}
	if facts.button == 0 && facts.target == Target::Stage && !facts.space && !facts.drawing && (!facts.editable || tool == Tool::Select) && !(facts.on_item)() {
		if let Some(path) = (facts.picture)() {
			return PressAction::Picture { path, carry: facts.editable };
		}
	}
	if facts.editable && !facts.drawing && facts.button == 0 && on_canvas(facts.target) && !facts.space {
		return if tool != Tool::Select { PressAction::Make } else { PressAction::Press };
	}
	let middle = facts.button == 1;
	let empty = facts.button == 0 && on_canvas(facts.target);
	if !middle && !empty && !(facts.space && facts.button == 0) {
		return PressAction::Nothing;
	}
	PressAction::Pan { deselect: empty, middle }
}

/// Whether a press is the hand's: the hand tool or Space, the main button, not a finger, not on a control.
pub fn hand_pans(hand: bool, pointer: Pointer, button: u8, control: bool) -> bool {
	hand && pointer != Pointer::Touch && button == 0 && !control
}

pub struct HoverFacts {
	pub pointer: Pointer,
	pub editable: bool,
	/// Edit mode: browsing, nothing answers the pointer before a press but a link's hand.
	pub editing: bool,
	pub drawing: bool,
	/// Over a card block's grip.
	pub on_grip: bool,
	/// Any button held.
	pub buttons: bool,
	pub tool: Tool,
	pub target: Target,
	/// The hand tool, or Space held.
	pub hand: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HoverAction {
	None,
	/// Clear what is lit; the grip's block too when no button is held.
	Clear { block: bool },
	/// Follow the pointer: the outline round what is under it (`outlines`, edit mode), or only a link's hand and a block's grip.
	Track { outlines: bool },
}

/// What a hover does. A form whose rules have no hover (`hover.outline`: touch) never tracks, nor does a finger anywhere.
pub fn decide_hover(facts: &HoverFacts, rules: &Rules) -> HoverAction {
	if facts.pointer == Pointer::Touch || !rules.hover || !facts.editable || facts.drawing || facts.on_grip {
		return HoverAction::None;
	}
	if facts.hand || facts.buttons || facts.tool != Tool::Select || !on_canvas(facts.target) {
		return HoverAction::Clear { block: facts.hand || !facts.buttons };
	}
	HoverAction::Track { outlines: facts.editing }
}

/// A tap on a drawn item before this one: which, and when (milliseconds).
#[derive(Clone, Debug, PartialEq)]
pub struct LastTap {
	pub id: String,
	pub at: f64,
}

/// Whether a tap on `id` at `now` is the second of a double tap on it (`tap.second-ms`).
pub fn is_second_tap(last: Option<&LastTap>, id: &str, now: f64, rules: &Rules) -> bool {
	last.is_some_and(|last| last.id == id && now - last.at < rules.second_tap_ms)
}

/// A tap on bare canvas before this one, on the screen, and when.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BareTap {
	pub at: Pt,
	pub time: f64,
}

/// Whether a tap on bare canvas is the second of two close together (`tap.bare-second-ms`, `tap.bare-second-px`): a note there.
pub fn is_bare_second_tap(last: Option<&BareTap>, at: Pt, now: f64, rules: &Rules) -> bool {
	last.is_some_and(|last| now - last.time < rules.bare_second_tap_ms && (at.x - last.at.x).hypot(at.y - last.at.y) < rules.bare_second_tap_px)
}

/// Whether a press let go at `moved` screen pixels from where it landed, after `held` ms, is a tap (`tap.ms`, `tap.px`).
pub fn is_tap(moved: f64, held: f64, rules: &Rules) -> bool {
	moved < rules.tap_px && held <= rules.tap_ms
}

/// Whether a press has moved past its pointer's slop (`press.slop-px`), and so means to move.
pub fn past_slop(moved: f64, pointer: Pointer, rules: &Rules) -> bool {
	moved >= rules.slop.get(pointer)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::rules::{Form, Rules};

	fn press(change: impl FnOnce(&mut PressFacts)) -> PressAction {
		let item = || false;
		let picture = || None;
		let mut facts = PressFacts { pointer: Pointer::Mouse, button: 0, target: Target::Stage, editable: true, drawing: false, tool: Tool::Select, space: false, fingers: 0, on_item: &item, picture: &picture };
		change(&mut facts);
		decide_press(&facts)
	}
	const ON_ITEM: &dyn Fn() -> bool = &|| true;
	const A_PICTURE: &dyn Fn() -> Option<String> = &|| Some("boards/one.html".into());

	#[test]
	fn a_mouse_on_bare_stage_presses_and_an_armed_tool_makes_but_not_on_a_board() {
		assert_eq!(press(|_| {}), PressAction::Press);
		assert_eq!(press(|f| f.tool = Tool::Rectangle), PressAction::Make);
		assert_eq!(press(|f| {
			f.tool = Tool::Note;
			f.target = Target::Other;
		}), PressAction::Nothing);
	}

	#[test]
	fn a_boards_picture_is_carried_with_the_selection_or_only_selected_when_read_only() {
		assert_eq!(press(|f| f.picture = A_PICTURE), PressAction::Picture { path: "boards/one.html".into(), carry: true });
		assert_eq!(press(|f| {
			f.picture = A_PICTURE;
			f.editable = false;
		}), PressAction::Picture { path: "boards/one.html".into(), carry: false });
		assert_eq!(press(|f| {
			f.picture = A_PICTURE;
			f.on_item = ON_ITEM;
		}), PressAction::Press, "a drawn item over the picture is what is pressed");
	}

	#[test]
	fn space_the_middle_button_the_pen_or_a_read_only_stage_pan() {
		assert_eq!(press(|f| f.space = true), PressAction::Pan { deselect: true, middle: false });
		assert_eq!(press(|f| {
			f.space = true;
			f.target = Target::Other;
		}), PressAction::Pan { deselect: false, middle: false });
		assert_eq!(press(|f| f.button = 1), PressAction::Pan { deselect: false, middle: true });
		assert_eq!(press(|f| f.drawing = true), PressAction::Pan { deselect: true, middle: false });
		assert_eq!(press(|f| f.editable = false), PressAction::Pan { deselect: true, middle: false });
		assert_eq!(press(|f| f.button = 2), PressAction::Nothing);
	}

	#[test]
	fn a_finger_is_pooled_and_then_taps_carries_or_lets_go_and_a_second_finger_only_pinches() {
		let touch = |f: &mut PressFacts| f.pointer = Pointer::Touch;
		assert_eq!(press(touch), PressAction::Touch { picture: None, then: Some(Then::Deselect) });
		assert_eq!(press(|f| {
			touch(f);
			f.on_item = ON_ITEM;
		}), PressAction::Touch { picture: None, then: Some(Then::Drawing) });
		assert_eq!(press(|f| {
			touch(f);
			f.tool = Tool::Card;
		}), PressAction::Make);
		assert_eq!(press(|f| {
			touch(f);
			f.tool = Tool::Card;
			f.fingers = 1;
		}), PressAction::Touch { picture: None, then: None });
		assert_eq!(press(|f| {
			touch(f);
			f.picture = A_PICTURE;
		}), PressAction::Touch { picture: Some("boards/one.html".into()), then: None });
		assert_eq!(press(|f| {
			touch(f);
			f.drawing = true;
		}), PressAction::Touch { picture: None, then: None });
	}

	#[test]
	fn what_is_under_a_press_is_asked_only_when_it_decides() {
		use std::cell::Cell;
		let asked = Cell::new(0);
		let item = || {
			asked.set(asked.get() + 1);
			false
		};
		let picture = || {
			asked.set(asked.get() + 1);
			None
		};
		let facts = PressFacts { pointer: Pointer::Mouse, button: 0, target: Target::Other, editable: true, drawing: false, tool: Tool::Rectangle, space: false, fingers: 0, on_item: &item, picture: &picture };
		decide_press(&facts);
		assert_eq!(asked.get(), 0);
	}

	#[test]
	fn rules_hover_outline_a_desk_tracks_the_pointer_in_edit_mode_and_touch_forms_never_do() {
		let facts = HoverFacts { pointer: Pointer::Mouse, editable: true, editing: true, drawing: false, on_grip: false, buttons: false, tool: Tool::Select, target: Target::Stage, hand: false };
		assert_eq!(decide_hover(&facts, &Rules::desk()), HoverAction::Track { outlines: true });
		assert_eq!(decide_hover(&facts, &Rules::tablet()), HoverAction::None, "an iPad with a mouse still has no hover outline");
		assert_eq!(decide_hover(&facts, &Rules::phone()), HoverAction::None);
		assert_eq!(decide_hover(&HoverFacts { pointer: Pointer::Touch, ..facts }, &Rules::desk()), HoverAction::None);
		assert_eq!(decide_hover(&HoverFacts { editing: false, ..facts }, &Rules::desk()), HoverAction::Track { outlines: false });
		assert_eq!(decide_hover(&HoverFacts { buttons: true, ..facts }, &Rules::desk()), HoverAction::Clear { block: false });
		assert_eq!(decide_hover(&HoverFacts { tool: Tool::Note, ..facts }, &Rules::desk()), HoverAction::Clear { block: true });
	}

	#[test]
	fn rules_tap_second_ms_and_bare_second_a_double_tap_is_two_taps_within_the_tables_time_and_reach() {
		for form in Form::ALL {
			let rules = Rules::for_form(form);
			let last = LastTap { id: "a".into(), at: 1000.0 };
			assert!(is_second_tap(Some(&last), "a", 1000.0 + rules.second_tap_ms - 1.0, &rules));
			assert!(!is_second_tap(Some(&last), "a", 1000.0 + rules.second_tap_ms + 1.0, &rules));
			assert!(!is_second_tap(Some(&last), "b", 1001.0, &rules));
			let bare = BareTap { at: Pt::new(100.0, 100.0), time: 0.0 };
			assert!(is_bare_second_tap(Some(&bare), Pt::new(100.0 + rules.bare_second_tap_px - 1.0, 100.0), rules.bare_second_tap_ms - 1.0, &rules));
			assert!(!is_bare_second_tap(Some(&bare), Pt::new(100.0 + rules.bare_second_tap_px + 1.0, 100.0), 10.0, &rules));
			assert!(!is_bare_second_tap(Some(&bare), Pt::new(100.0, 100.0), rules.bare_second_tap_ms + 1.0, &rules));
		}
	}

	#[test]
	fn rules_press_slop_a_press_means_to_move_past_its_pointers_slop() {
		let rules = Rules::desk();
		assert!(!past_slop(2.0, Pointer::Mouse, &rules) && past_slop(3.0, Pointer::Mouse, &rules));
		assert!(!past_slop(7.0, Pointer::Touch, &rules) && past_slop(8.0, Pointer::Touch, &rules));
		assert!(!past_slop(3.0, Pointer::Pen, &rules) && past_slop(4.0, Pointer::Pen, &rules));
		assert!(is_tap(9.0, 600.0, &rules) && !is_tap(10.0, 100.0, &rules) && !is_tap(0.0, 601.0, &rules));
	}

	#[test]
	fn the_hand_pans_for_a_mouse_or_a_pen_not_a_finger_nor_on_a_control() {
		assert!(hand_pans(true, Pointer::Mouse, 0, false));
		assert!(!hand_pans(true, Pointer::Touch, 0, false));
		assert!(!hand_pans(true, Pointer::Mouse, 0, true));
		assert!(!hand_pans(false, Pointer::Pen, 0, false));
	}
}
