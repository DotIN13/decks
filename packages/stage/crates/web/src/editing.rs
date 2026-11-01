//! The editor in the engine: `Editing` holds the Rust editor (`stage_editor`) beside the engine's
//! page, steps it against the page's own scene, applies the preview it asks for, and paints its
//! overlay into the same frame as the drawing. What the page must still do (send the ops, the
//! ghost, the composer, a board's move) comes back as the step's ops and effects.

use crate::editor_scene::EngineScene;
use crate::engine::{Page, Preview};
use serde_json::{json, Value};
use stage_editor::gesture::{Context, Editor, Input, Mode, Preview as Wanted, Step};
use stage_editor::model::{Pt, Rect};
use stage_editor::overlay::{self, ArrowEnds, Colours, RadiusAt, SideHint};
use stage_editor::rules::{Form, Rules};
use stage_editor::scene::Scene;
use stage_editor::{arrows, ops, resize};
use std::collections::HashMap;

/// What the page says with each input: where the camera is, the drawing's generation, the boards'
/// revisions, where the composer is on the screen, what is hovered and selected outside the editor.
#[derive(Clone, Debug)]
pub struct Frame {
	pub zoom: f64,
	/// The window, in stage units.
	pub view: Rect,
	pub generation: u64,
	pub revs: HashMap<String, u64>,
	/// The composer's box on the screen, for a drag to mention what it carries there.
	pub composer: Option<Rect>,
	/// The board the app has selected, outlined as an item is.
	pub selected: Option<String>,
	pub colours: Colours,
}

/// The editor kept beside the page.
#[derive(Clone, Debug)]
pub struct Editing {
	pub editor: Editor,
	/// What was drawn last, for the page's hit areas (handles, an arrow's ends) until the next step.
	pub drawn: overlay::Drawn,
}

impl Editing {
	pub fn new(form: Form) -> Editing {
		Editing { editor: Editor::new(Rules::for_form(form)), drawn: overlay::Drawn::default() }
	}

	/// The device form changed (`?device=`, or the page learned it): the rules' column changes with it.
	pub fn set_form(&mut self, form: Form) {
		self.editor.rules = Rules::for_form(form);
	}

	/// One input, stepped against the page's scene. The preview is applied to the page and the overlay painted into it.
	pub fn step(&mut self, page: &mut Page, input: Input, frame: &Frame) -> Step {
		let step = {
			let scene = EngineScene::new(page, self.editor.rules.line_reach / frame.zoom.max(1e-6));
			let mut next = ops::id_maker(scene.items());
			let revs = frame.revs.clone();
			let rev = move |path: &str| revs.get(path).copied().unwrap_or(0);
			let links = links(page);
			let link_at = move |at: Pt| links.iter().find(|(r, _)| at.x >= r.x && at.x <= r.right() && at.y >= r.y && at.y <= r.bottom()).map(|(_, href)| href.clone());
			let composer = frame.composer;
			let over_composer = move |client: Pt, _: &[String], _: &[String]| composer.is_some_and(|r| client.x >= r.x && client.x <= r.right() && client.y >= r.y && client.y <= r.bottom());
			let mut ctx = Context { zoom: frame.zoom, view: frame.view, generation: frame.generation, next_id: &mut next, page_rev: &rev, link_at: &link_at, over_composer: &over_composer };
			self.editor.step(input, &scene, &mut ctx)
		};
		match &step.preview {
			Wanted::Keep => {}
			Wanted::Clear => {
				let _ = page.preview(None);
			}
			Wanted::Show(changes) => {
				let moving = changes
					.iter()
					.map(|(id, change)| {
						let mut set = Vec::new();
						if let Some(w) = change.w {
							set.push(("width".to_string(), Some(json!(w))));
						}
						if let Some(h) = change.h {
							set.push(("height".to_string(), Some(json!(h))));
						}
						if let Some(r) = change.radius {
							set.push(("cornerRadius".to_string(), Some(json!(r))));
						}
						(id.clone(), Preview { dx: change.dx, dy: change.dy, set })
					})
					.collect();
				let _ = page.preview(Some(moving));
			}
		}
		self.paint(page, frame);
		step
	}

	/// Work the overlay out from the editor's state and paint it into the page's next frame.
	pub fn paint(&mut self, page: &mut Page, frame: &Frame) {
		let drawn = {
			let scene = EngineScene::new(page, self.editor.rules.line_reach / frame.zoom.max(1e-6));
			let s = &self.editor.state;
			let one = (s.selection.items.len() == 1).then(|| s.selection.items[0].clone());
			let arrow = one.as_deref().and_then(|id| arrows::arrow_handles(&scene, id, s.drag)).map(|ends| ArrowEnds { from: ends.from, to: ends.to, from_joined: ends.from_join.is_some(), to_joined: ends.to_join.is_some(), middle: ends.middle, bent: ends.bent });
			let radius = one.as_deref().and_then(|id| Some((scene.node(id)?, scene.bounds(id)?))).and_then(|(node, area)| resize::radius_start(node, &area)).map(|start| RadiusAt { rect: start.area, radius: start.radius, most: start.most });
			let input = overlay::Input {
				selection: s.selection.items.clone(),
				drag: s.drag,
				pointer_drag: s.drag,
				resize: s.resize.clone(),
				boards: scene.boards(),
				page_picks: s.selection.boards.clone(),
				page_drag: s.page_drag.as_ref().map(|d| (d.paths.clone(), d.offset)),
				selected: frame.selected.clone(),
				page_resize: s.page_resize.as_ref().map(|(path, r, _)| (path.clone(), *r)),
				marquee: s.marquee,
				editable: true,
				resizing: s.resize.is_some(),
				editing: s.mode == Mode::Edit,
				hover_item: s.hover.item.clone(),
				hover_page: s.hover.board.clone(),
				zoom: frame.zoom,
				gesture: s.gesture.is_some(),
				resizable: true,
				drop_into: s.drop.into.clone().flatten(),
				drop_line: s.drop.slot.as_ref().map(|slot| slot.line),
				drop_slots: s.drop.near.as_ref().map(|n| n.slots.clone()).unwrap_or_default(),
				drop_frames: s.drop.near.as_ref().map(|n| n.frames.clone()).unwrap_or_default(),
				radius_drag: s.radius.as_ref().map(|(id, r, _)| (id.clone(), *r)),
				joins: s.joins.clone(),
				sides: s.sides.iter().map(|(rect, side)| SideHint { rect: *rect, side: *side }).collect(),
				guides: s.guides.clone(),
				route: s.route.as_ref().map(|r| overlay::Route { x: r.x, y: r.y, d: r.d.clone() }),
				end_draft: s.end_draft,
				arrow,
				radius,
				..Default::default()
			};
			overlay::derive(&input, &scene, &self.editor.rules)
		};
		let painted = overlay::paint(&drawn, frame.zoom, &self.editor.rules, frame.colours);
		page.overlay = (!painted.is_empty()).then_some(painted);
		self.drawn = drawn;
	}
}

/// Every link in a markdown card, on the stage: its box and where it goes.
fn links(page: &Page) -> Vec<(Rect, String)> {
	let mut out = Vec::new();
	let cards = page.cards_json();
	for card in cards.as_array().into_iter().flatten() {
		let (Some(x), Some(y), pad) = (card["box"]["x"].as_f64(), card["box"]["y"].as_f64(), card["pad"].as_f64().unwrap_or(0.0)) else { continue };
		for link in card["links"].as_array().into_iter().flatten() {
			let n = |k: &str| link[k].as_f64().unwrap_or(0.0);
			if let Some(href) = link["href"].as_str() {
				out.push((Rect { x: x + pad + n("x"), y: y + pad + n("y"), w: n("w"), h: n("h") }, href.to_string()));
			}
		}
	}
	out
}

/// The step as the page reads it: the ops to send, the preview's kind, the effects in order, and the selection.
pub fn step_json(step: &Step, editing: &Editing) -> Value {
	let preview = match &step.preview {
		Wanted::Keep => Value::Null,
		Wanted::Clear => json!("clear"),
		Wanted::Show(changes) => json!(changes.iter().map(|(id, c)| json!([id, c])).collect::<Vec<_>>()),
	};
	json!({ "ops": step.ops, "preview": preview, "effects": step.effects, "selection": { "items": editing.editor.state.selection.items, "boards": editing.editor.state.selection.boards } })
}

#[cfg(test)]
mod tests {
	use super::*;
	use stage_editor::gesture::PointerInput;
	use stage_editor::model::Mods;
	use stage_editor::rules::Pointer;

	const DOC: &str = r#"{"version":"2.6","children":[
		{"type":"rectangle","id":"a","x":0,"y":0,"width":100,"height":60},
		{"type":"rectangle","id":"b","x":300,"y":0,"width":100,"height":60}
	]}"#;
	const COLOURS: Colours = Colours { accent: [0.0, 0.0, 1.0], guide: [1.0, 0.0, 0.0], panel: [1.0, 1.0, 1.0] };

	fn frame() -> Frame {
		Frame { zoom: 1.0, view: Rect { x: -1000.0, y: -1000.0, w: 3000.0, h: 3000.0 }, generation: 1, revs: HashMap::new(), composer: None, selected: None, colours: COLOURS }
	}
	fn mouse(x: f64, y: f64) -> PointerInput {
		PointerInput { at: Pt::new(x, y), client: Pt::new(x, y), mods: Mods::default(), pointer: Pointer::Mouse, time: 1000.0 }
	}
	fn page() -> Page {
		let mut page = Page::new(DOC, false, "s").unwrap();
		page.lay_out();
		page
	}

	#[test]
	fn the_engine_steps_the_editor_against_its_own_layout_and_a_drag_moves_what_it_pressed() {
		let mut page = page();
		let mut editing = Editing::new(Form::Desk);
		editing.editor.state.mode = Mode::Edit;
		editing.step(&mut page, Input::PressCanvas(mouse(50.0, 30.0)), &frame());
		assert_eq!(editing.editor.state.selection.items, vec!["a".to_string()]);
		editing.step(&mut page, Input::Move(mouse(90.0, 30.0)), &frame());
		assert_eq!(page.offsets.get("a"), Some(&(40.0, 0.0)), "the engine shows the drag itself");
		let lift = editing.step(&mut page, Input::Release(mouse(90.0, 30.0)), &frame());
		let json = step_json(&lift, &editing);
		assert_eq!(json["ops"], json!([{ "op": "update", "id": "a", "set": { "x": 40, "y": 0 } }]));
	}

	#[test]
	fn the_overlay_the_engine_paints_is_the_forms_eight_squares_on_a_desk_and_four_dots_on_a_tablet() {
		for (form, count, kind) in [(Form::Desk, 8, "handle"), (Form::Tablet, 4, "handle-round")] {
			let mut page = page();
			let mut editing = Editing::new(form);
			editing.editor.state.mode = Mode::Edit;
			editing.step(&mut page, Input::PressCanvas(mouse(50.0, 30.0)), &frame());
			editing.step(&mut page, Input::Release(mouse(50.0, 30.0)), &frame());
			let painted = page.overlay.as_ref().expect("an overlay");
			assert_eq!(painted.dots.iter().filter(|d| d.kind == kind).count(), count, "{form:?}");
			assert!(editing.drawn.handles.is_some());
		}
	}

	#[test]
	fn a_pinch_puts_back_what_a_fingers_carry_showed_in_the_engine() {
		let mut page = page();
		let mut editing = Editing::new(Form::Tablet);
		editing.editor.state.mode = Mode::Edit;
		editing.editor.state.selection.items = vec!["a".into()];
		let finger = |x: f64| PointerInput { pointer: Pointer::Touch, ..mouse(x, 30.0) };
		editing.step(&mut page, Input::Carry { from_at: Pt::new(50.0, 30.0), from_client: Pt::new(50.0, 30.0), p: finger(80.0) }, &frame());
		editing.step(&mut page, Input::Move(finger(80.0)), &frame());
		assert!(page.offsets.contains_key("a"));
		editing.step(&mut page, Input::Cancel, &frame());
		assert!(page.offsets.is_empty(), "the preview is gone");
	}
}
