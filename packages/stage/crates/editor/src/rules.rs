//! The rules table (`packages/canvas/src/device/rules.json`), read here as the TypeScript reads it
//! (`device/rules.ts`): one file, a row per rule, a column per form, pointer, system, engine or GPU
//! class. The editor is built to it; nothing it does differs by device except through these fields.

use serde_json::Value;
use std::sync::OnceLock;

/// The table, as written.
pub const TABLE: &str = include_str!("../../../../canvas/src/device/rules.json");

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Form {
	Desk,
	Tablet,
	Phone,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Pointer {
	Mouse,
	Pen,
	Touch,
}

impl Form {
	pub fn name(self) -> &'static str {
		match self {
			Form::Desk => "desk",
			Form::Tablet => "tablet",
			Form::Phone => "phone",
		}
	}
	pub fn parse(name: &str) -> Option<Form> {
		match name {
			"desk" => Some(Form::Desk),
			"tablet" => Some(Form::Tablet),
			"phone" => Some(Form::Phone),
			_ => None,
		}
	}
	pub const ALL: [Form; 3] = [Form::Desk, Form::Tablet, Form::Phone];
}

impl Pointer {
	pub fn name(self) -> &'static str {
		match self {
			Pointer::Mouse => "mouse",
			Pointer::Pen => "pen",
			Pointer::Touch => "touch",
		}
	}
	pub fn parse(name: &str) -> Pointer {
		match name {
			"touch" => Pointer::Touch,
			"pen" => Pointer::Pen,
			_ => Pointer::Mouse,
		}
	}
}

/// A value per pointer kind.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ByPointer<T> {
	pub mouse: T,
	pub pen: T,
	pub touch: T,
}

impl<T: Copy> ByPointer<T> {
	pub fn get(&self, pointer: Pointer) -> T {
		match pointer {
			Pointer::Mouse => self.mouse,
			Pointer::Pen => self.pen,
			Pointer::Touch => self.touch,
		}
	}
}

/// What a hold does on an item or on bare canvas.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hold {
	None,
	Menu,
	Marquee,
}

/// The editor's rules for one form: every row the editor reads, by the name the TypeScript reads it under.
#[derive(Clone, Debug, PartialEq)]
pub struct Rules {
	pub form: Form,
	pub slop: ByPointer<f64>,
	pub tap_ms: f64,
	pub tap_px: f64,
	pub second_tap_ms: f64,
	/// A double tap on an item: `true` activates it (touch), `false` opens its words (desk).
	pub second_tap_activates: bool,
	pub bare_second_tap_ms: f64,
	pub bare_second_tap_px: f64,
	pub click_after_pan_ms: f64,
	pub click_after_make_ms: f64,
	pub hold_ms: f64,
	pub hold_on_item: Hold,
	pub hold_on_bare: Hold,
	pub hover: bool,
	/// A press on a live card's page is covered (touch) rather than the page's (desk).
	pub covers_live_pages: bool,
	pub copy_with_alt: ByPointer<bool>,
	pub handle_size: f64,
	/// Round dots (touch) rather than squares (desk).
	pub handle_round: bool,
	/// Four corners (touch) rather than eight (desk).
	pub handle_corners_only: bool,
	pub handle_reach: f64,
	pub handle_min: f64,
	pub size_label: bool,
	pub arrow_anchors: bool,
	pub anchor_size: f64,
	pub anchor_out: f64,
	pub arrow_end: f64,
	pub arrow_bend: f64,
	pub line_reach: f64,
	pub edge_out: f64,
	pub edge_in: f64,
	pub snap_px: f64,
	pub snap_by: ByPointer<bool>,
	pub reading_gap: f64,
	pub join_px: f64,
	pub side_px: f64,
	pub slide_px: f64,
	pub near_px: f64,
	pub glide_ms: f64,
	pub selection_fade_ms: f64,
	/// The pill always below (touch) rather than either side (desk).
	pub pill_below: bool,
	pub nudge: f64,
	pub nudge_shift: f64,
	pub duplicate_offset: f64,
	pub coast_ours: bool,
	pub coast_tau_ms: f64,
	pub pinch_travel: f64,
	pub wheel_travel: f64,
	pub live_zoom: f64,
}

/// Every row the editor reads, by its name in the file. The rest are the page's (chrome, pages, layers).
pub const READ: &[&str] = &[
	"press.slop-px", "tap.ms", "tap.px", "tap.second-ms", "tap.second-on-item", "tap.bare-second-ms", "tap.bare-second-px", "click.after-pan-ms", "click.after-make-ms", "hold.ms", "hold.on-item", "hold.on-bare", "hover.outline", "press.on-live-page", "drag.copy-with-alt", "handle.size-px", "handle.shape", "handle.which", "handle.reach-px", "handle.min-px", "handle.size-label", "arrow.anchors", "arrow.anchor-px", "arrow.anchor-out-px", "arrow.end-px", "arrow.bend-px", "line.reach-px", "edge.out-px", "edge.in-px", "snap.px", "snap.by-pointer", "snap.reading-gap-px", "arrow.join-px", "arrow.side-px", "arrow.slide-px", "drop.near-px", "glide.ms", "selection.fade-ms", "pill.place", "nudge.px", "nudge.shift-px", "duplicate.offset-px", "coast.by", "coast.tau-ms", "pinch.travel-px", "wheel.travel-px", "live.zoom",
];

fn table() -> &'static Value {
	static PARSED: OnceLock<Value> = OnceLock::new();
	PARSED.get_or_init(|| serde_json::from_str(TABLE).expect("device/rules.json is JSON"))
}

/// A row's value for a form: its one value, or the form's column.
pub fn cell(name: &str, form: Form) -> &'static Value {
	let row = table().get("rules").and_then(|rules| rules.get(name)).unwrap_or_else(|| panic!("no rule \"{name}\" in device/rules.json"));
	match row.get("by").and_then(Value::as_str) {
		None => row.get("value").unwrap_or(&Value::Null),
		Some("form") => row.get(form.name()).unwrap_or(&Value::Null),
		Some(_) => row,
	}
}

fn num(name: &str, form: Form) -> f64 {
	cell(name, form).as_f64().unwrap_or_else(|| panic!("rule {name} is not a number"))
}
fn flag(name: &str, form: Form) -> bool {
	cell(name, form).as_bool().unwrap_or_else(|| panic!("rule {name} is not true or false"))
}
fn word(name: &str, form: Form) -> &'static str {
	cell(name, form).as_str().unwrap_or_else(|| panic!("rule {name} is not a word"))
}
fn pointers<T>(name: &str, form: Form, read: impl Fn(&Value) -> Option<T>) -> ByPointer<T> {
	let row = cell(name, form);
	let at = |key: &str| read(row.get(key).unwrap_or(&Value::Null)).unwrap_or_else(|| panic!("rule {name} has no {key}"));
	ByPointer { mouse: at("mouse"), pen: at("pen"), touch: at("touch") }
}
fn hold(name: &str, form: Form) -> Hold {
	match word(name, form) {
		"menu" => Hold::Menu,
		"marquee" => Hold::Marquee,
		_ => Hold::None,
	}
}

impl Rules {
	pub fn for_form(form: Form) -> Rules {
		Rules {
			form,
			slop: pointers("press.slop-px", form, Value::as_f64),
			tap_ms: num("tap.ms", form),
			tap_px: num("tap.px", form),
			second_tap_ms: num("tap.second-ms", form),
			second_tap_activates: word("tap.second-on-item", form) == "activate",
			bare_second_tap_ms: num("tap.bare-second-ms", form),
			bare_second_tap_px: num("tap.bare-second-px", form),
			click_after_pan_ms: num("click.after-pan-ms", form),
			click_after_make_ms: num("click.after-make-ms", form),
			hold_ms: num("hold.ms", form),
			hold_on_item: hold("hold.on-item", form),
			hold_on_bare: hold("hold.on-bare", form),
			hover: flag("hover.outline", form),
			covers_live_pages: word("press.on-live-page", form) == "cover",
			copy_with_alt: pointers("drag.copy-with-alt", form, Value::as_bool),
			handle_size: num("handle.size-px", form),
			handle_round: word("handle.shape", form) == "round",
			handle_corners_only: word("handle.which", form) == "corners",
			handle_reach: num("handle.reach-px", form),
			handle_min: num("handle.min-px", form),
			size_label: flag("handle.size-label", form),
			arrow_anchors: flag("arrow.anchors", form),
			anchor_size: num("arrow.anchor-px", form),
			anchor_out: num("arrow.anchor-out-px", form),
			arrow_end: num("arrow.end-px", form),
			arrow_bend: num("arrow.bend-px", form),
			line_reach: num("line.reach-px", form),
			edge_out: num("edge.out-px", form),
			edge_in: num("edge.in-px", form),
			snap_px: num("snap.px", form),
			snap_by: pointers("snap.by-pointer", form, Value::as_bool),
			reading_gap: num("snap.reading-gap-px", form),
			join_px: num("arrow.join-px", form),
			side_px: num("arrow.side-px", form),
			slide_px: num("arrow.slide-px", form),
			near_px: num("drop.near-px", form),
			glide_ms: num("glide.ms", form),
			selection_fade_ms: num("selection.fade-ms", form),
			pill_below: word("pill.place", form) == "below",
			nudge: num("nudge.px", form),
			nudge_shift: num("nudge.shift-px", form),
			duplicate_offset: num("duplicate.offset-px", form),
			coast_ours: word("coast.by", form) == "ours",
			coast_tau_ms: num("coast.tau-ms", form),
			pinch_travel: num("pinch.travel-px", form),
			wheel_travel: num("wheel.travel-px", form),
			live_zoom: num("live.zoom", form),
		}
	}
	pub fn desk() -> Rules {
		Rules::for_form(Form::Desk)
	}
	pub fn tablet() -> Rules {
		Rules::for_form(Form::Tablet)
	}
	pub fn phone() -> Rules {
		Rules::for_form(Form::Phone)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn every_row_the_editor_reads_is_in_the_table_and_every_form_reads_whole() {
		let rules = table().get("rules").and_then(Value::as_object).unwrap();
		for name in READ {
			assert!(rules.contains_key(*name), "{name} is read but not in rules.json");
		}
		for form in Form::ALL {
			let _ = Rules::for_form(form);
		}
	}

	#[test]
	fn each_form_has_its_own_column() {
		let (desk, tablet, phone) = (Rules::desk(), Rules::tablet(), Rules::phone());
		assert_eq!((desk.handle_size, tablet.handle_size, phone.handle_size), (9.0, 10.0, 10.0));
		assert_eq!((desk.handle_reach, tablet.handle_reach), (15.0, 44.0));
		assert_eq!((desk.hold_on_bare, tablet.hold_on_bare, phone.hold_on_bare), (Hold::None, Hold::Marquee, Hold::Marquee));
		assert!(!desk.handle_corners_only && tablet.handle_corners_only && phone.handle_corners_only);
		assert_eq!(desk.slop, ByPointer { mouse: 3.0, pen: 4.0, touch: 8.0 });
		assert!(desk.snap_by.touch, "a finger snaps as a mouse does");
		assert!(!desk.coast_ours && tablet.coast_ours);
	}
}
