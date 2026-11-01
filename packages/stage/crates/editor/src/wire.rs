//! What crosses between the page and the editor, in the TypeScript editor's own words
//! (`edit/core/gesture.ts`'s `Input`, `Effect` and `EditorState`), so the page's pointer layer, its
//! panels and its pill read the engine's editor as they read the TypeScript one. An arrow's ends and a
//! corner's radius pressed are named by the item alone: the editor finds them in the scene again.

use crate::arrows::{self, Which};
use crate::gesture::{Effect, Gesture, Input, Mode, PointerInput, Preview, State, Step};
use crate::model::{Mods, Pt, Rect, Side, Tool};
use crate::resize::{self, Handle};
use crate::rules::Pointer;
use crate::scene::Scene;
use serde_json::{json, Map, Value};
use std::collections::HashSet;

fn num(v: &Value, key: &str) -> f64 {
	v.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}
fn pt(v: &Value) -> Pt {
	Pt::new(num(v, "x"), num(v, "y"))
}
fn rect(v: &Value) -> Rect {
	Rect { x: num(v, "x"), y: num(v, "y"), w: num(v, "w"), h: num(v, "h") }
}
fn text(v: &Value, key: &str) -> Option<String> {
	v.get(key).and_then(Value::as_str).map(str::to_string)
}

fn pointer_input(v: &Value) -> PointerInput {
	let mods = v.get("mods").cloned().unwrap_or(Value::Null);
	let flag = |k: &str| mods.get(k).and_then(Value::as_bool).unwrap_or(false);
	PointerInput {
		at: pt(v.get("at").unwrap_or(&Value::Null)),
		client: pt(v.get("client").unwrap_or(&Value::Null)),
		mods: Mods { shift: flag("shift"), alt: flag("alt"), meta: flag("meta"), ctrl: flag("ctrl") },
		pointer: Pointer::parse(v.get("pointer").and_then(Value::as_str).unwrap_or("mouse")),
		time: num(v, "time"),
	}
}

/// One input from the page, as the TypeScript editor's `Input`.
pub fn input(v: &Value, scene: &dyn Scene) -> Option<Input> {
	let kind = v.get("type")?.as_str()?;
	let p = pointer_input(v);
	Some(match kind {
		"press-canvas" => Input::PressCanvas(p),
		"press-board" => Input::PressBoard { path: text(v, "path")?, p },
		"press-block" => Input::PressBlock { id: text(v, "id")?, p },
		"press-handle" => {
			let area = v.get("box")?;
			Input::PressHandle { handle: Handle::parse(v.get("handle")?.as_str()?)?, id: text(area, "id")?, area: rect(area), p }
		}
		"press-board-handle" => {
			let area = v.get("box")?;
			Input::PressBoardHandle { handle: Handle::parse(v.get("handle")?.as_str()?)?, path: text(area, "path")?, area: rect(area), p }
		}
		"press-radius" => {
			let handle = v.get("handle")?;
			let id = text(handle, "id")?;
			let start = resize::radius_start(scene.node(&id)?, &rect(handle)).unwrap_or(resize::RadiusStart { area: rect(handle), radius: num(handle, "radius"), most: num(handle, "most"), shape: handle.get("shape").and_then(Value::as_bool).unwrap_or(false) });
			Input::PressRadius { id, start, p }
		}
		"press-arrow-end" | "press-arrow-bend" => {
			let id = text(v.get("ends")?, "id")?;
			let ends = arrows::arrow_handles(scene, &id, crate::model::ZERO)?;
			if kind == "press-arrow-end" {
				let which = if v.get("which").and_then(Value::as_str) == Some("from") { Which::From } else { Which::To };
				Input::PressArrowEnd { which, ends, p }
			} else {
				Input::PressArrowBend { ends, p }
			}
		}
		"carry" => {
			let from = v.get("from")?;
			Input::Carry { from_at: pt(from.get("at")?), from_client: pt(from.get("client")?), p }
		}
		"move" => Input::Move(p),
		"release" => Input::Release(p),
		"cancel" => Input::Cancel,
		"drawn" => Input::Drawn {
			fresh: v.get("fresh").and_then(Value::as_bool).unwrap_or(false),
			current: v.get("current").and_then(Value::as_bool).unwrap_or(false),
			present: v.get("present").and_then(Value::as_array).map(|list| list.iter().filter_map(|id| id.as_str().map(str::to_string)).collect()).unwrap_or_else(HashSet::new),
		},
		"tick" => Input::Tick(num(v, "time")),
		"carry-pending" => Input::CarryPending(v.get("pending").and_then(Value::as_bool).unwrap_or(false)),
		_ => return None,
	})
}

fn rect_json(r: &Rect) -> Value {
	json!({ "x": r.x, "y": r.y, "w": r.w, "h": r.h })
}
fn with(mut base: Value, extra: Value) -> Value {
	if let (Some(base), Some(extra)) = (base.as_object_mut(), extra.as_object()) {
		for (k, v) in extra {
			base.insert(k.clone(), v.clone());
		}
	}
	base
}
fn side_name(side: Side) -> &'static str {
	match side {
		Side::Top => "top",
		Side::Right => "right",
		Side::Bottom => "bottom",
		Side::Left => "left",
	}
}

/// What the page reads of a gesture in hand: its kind, and whether a finger carries it.
fn gesture_json(g: &Gesture) -> Value {
	match g {
		Gesture::Carry(c) => json!({ "kind": if c.moved { "move" } else { "press" }, "ids": c.ids, "boards": c.boards, "touch": c.touch, "offset": { "dx": c.offset.dx, "dy": c.offset.dy } }),
		Gesture::Marquee { .. } => json!({ "kind": "marquee" }),
		Gesture::Resize { id, handle, .. } => json!({ "kind": "resize", "id": id, "handle": handle.name() }),
		Gesture::Radius { id, .. } => json!({ "kind": "radius", "id": id }),
		Gesture::ArrowEnd { id, which, .. } => json!({ "kind": "arrowEnd", "id": id, "which": which.key() }),
		Gesture::ArrowBend { id, .. } => json!({ "kind": "arrowBend", "id": id }),
		Gesture::PageResize { path, handle, .. } => json!({ "kind": "pageResize", "path": path, "handle": handle.name() }),
	}
}

/// The editor's state in the TypeScript `EditorState`'s shape (less what the page keeps itself: the hover, the words open, a board's own drag, a draft).
pub fn state(s: &State) -> Value {
	let mut out = Map::new();
	out.insert("mode".into(), json!(if s.mode == Mode::Edit { "edit" } else { "browse" }));
	out.insert("selection".into(), json!({ "items": s.selection.items, "boards": s.selection.boards, "awaited": s.selection.awaited }));
	out.insert("gesture".into(), s.gesture.as_ref().map(gesture_json).unwrap_or(Value::Null));
	out.insert("drag".into(), json!({ "dx": s.drag.dx, "dy": s.drag.dy }));
	if let Some(d) = &s.page_drag {
		let mut drag = json!({ "paths": d.paths, "dx": d.offset.dx, "dy": d.offset.dy });
		if let Some((to, until)) = &d.released {
			drag = with(drag, json!({ "released": { "to": to, "until": until } }));
		}
		out.insert("pageDrag".into(), drag);
	}
	if let Some((id, r)) = &s.resize {
		let resize = with(rect_json(r), json!({ "id": id }));
		out.insert("resize".into(), resize.clone());
		// The engine paints the resize in the frame the step is in: what the sheet has drawn is what was asked.
		out.insert("shownResize".into(), resize);
	}
	if let Some((path, r, released)) = &s.page_resize {
		let mut held = with(rect_json(r), json!({ "path": path }));
		if let Some((rev, until)) = released {
			held = with(held, json!({ "released": { "rev": rev, "until": until } }));
		}
		out.insert("pageResize".into(), held);
	}
	if let Some((id, radius, until)) = &s.radius {
		let mut held = json!({ "id": id, "radius": radius });
		if let Some(until) = until {
			held = with(held, json!({ "done": true, "until": until }));
		}
		out.insert("radius".into(), held);
	}
	if let Some(m) = &s.marquee {
		out.insert("marquee".into(), json!({ "x1": m.x1, "y1": m.y1, "x2": m.x2, "y2": m.y2 }));
	}
	out.insert("guides".into(), serde_json::to_value(&s.guides).unwrap_or_default());
	let mut drop = Map::new();
	if let Some(into) = &s.drop.into {
		drop.insert("into".into(), into.clone().map(Value::String).unwrap_or(Value::Null));
	}
	if let Some(slot) = &s.drop.slot {
		drop.insert("slot".into(), json!({ "index": slot.index, "line": rect_json(&slot.line) }));
	}
	if let Some(near) = &s.drop.near {
		drop.insert("near".into(), json!({ "slots": near.slots.iter().map(rect_json).collect::<Vec<_>>(), "frames": near.frames.iter().map(rect_json).collect::<Vec<_>>() }));
	}
	out.insert("drop".into(), Value::Object(drop));
	out.insert("joins".into(), json!(s.joins.iter().map(rect_json).collect::<Vec<_>>()));
	out.insert("sides".into(), json!(s.sides.iter().map(|(r, side)| { let mut one = json!({ "box": rect_json(r) }); if let Some(side) = side { one = with(one, json!({ "side": side_name(*side) })); } one }).collect::<Vec<_>>()));
	if let Some(c) = &s.end_draft {
		out.insert("endDraft".into(), json!({ "x1": c.x1, "y1": c.y1, "x2": c.x2, "y2": c.y2 }));
	}
	if let Some(r) = &s.route {
		out.insert("route".into(), json!({ "d": r.d, "x": r.x, "y": r.y }));
	}
	out.insert("carryPending".into(), json!(s.carry_pending));
	out.insert("settling".into(), json!(s.settling.iter().map(|(generation, until)| json!({ "generation": generation, "until": until })).collect::<Vec<_>>()));
	Value::Object(out)
}

/// A step's answer as the page reads it: the ops, the preview (absent: leave it; `null`: take it away; else `[id, change]` pairs), the effects.
pub fn step(step: &Step) -> Value {
	let mut out = json!({ "ops": step.ops, "effects": step.effects.iter().map(effect).collect::<Vec<_>>() });
	match &step.preview {
		Preview::Keep => {}
		Preview::Clear => {
			out["preview"] = Value::Null;
		}
		Preview::Show(changes) => {
			out["preview"] = json!(changes.iter().map(|(id, c)| json!([id, c])).collect::<Vec<_>>());
		}
	}
	out
}

/// An effect as the TypeScript `Effect`: what is absent is left out rather than `null`.
fn effect(e: &Effect) -> Value {
	let mut v = serde_json::to_value(e).unwrap_or_default();
	if let Some(map) = v.as_object_mut() {
		map.retain(|_, value| !value.is_null());
	}
	v
}

/// A tool as the page names it.
pub fn tool(name: &str) -> Tool {
	serde_json::from_value(Value::String(name.into())).unwrap_or(Tool::Select)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::gesture::Editor;
	use crate::rules::Rules;
	use crate::scene::{Fake, FakeItem};

	#[test]
	fn an_input_in_the_typescript_editors_words_is_read_and_a_handle_press_names_its_box() {
		let scene = Fake::new(vec![FakeItem::rect("a", 0.0, 0.0, 100.0, 50.0)]);
		let press = json!({ "type": "press-handle", "handle": "se", "box": { "x": 0, "y": 0, "w": 100, "h": 50, "id": "a" }, "at": { "x": 100, "y": 50 }, "client": { "x": 100, "y": 50 }, "mods": { "shift": true, "alt": false, "meta": false, "ctrl": false }, "pointer": "touch", "time": 12 });
		match input(&press, &scene) {
			Some(Input::PressHandle { handle, id, area, p }) => {
				assert_eq!((handle, id.as_str(), area.w, p.mods.shift, p.pointer, p.time), (Handle::Se, "a", 100.0, true, Pointer::Touch, 12.0));
			}
			other => panic!("not a handle press: {other:?}"),
		}
		assert!(matches!(input(&json!({ "type": "drawn", "fresh": true, "current": true, "present": ["a"] }), &scene), Some(Input::Drawn { fresh: true, current: true, .. })));
		assert_eq!(input(&json!({ "type": "nonsense" }), &scene), None);
	}

	#[test]
	fn the_state_and_the_step_go_back_in_the_typescript_editors_shape() {
		let scene = Fake::new(vec![FakeItem::rect("a", 0.0, 0.0, 100.0, 50.0)]);
		let mut editor = Editor::new(Rules::desk());
		let mut next = || "n".to_string();
		let (rev, link, composer) = (|_: &str| 0u64, |_: Pt| None, |_: Pt, _: &[String], _: &[String]| false);
		let mut ctx = crate::gesture::Context { zoom: 1.0, view: Rect::default(), generation: 1, next_id: &mut next, page_rev: &rev, link_at: &link, over_composer: &composer };
		let press = input(&json!({ "type": "press-canvas", "at": { "x": 10, "y": 10 }, "client": { "x": 10, "y": 10 }, "mods": {}, "pointer": "mouse", "time": 1 }), &scene).unwrap();
		let answer = editor.step(press, &scene, &mut ctx);
		let s = state(&editor.state);
		assert_eq!(s["selection"]["items"], json!(["a"]));
		assert_eq!(s["gesture"]["kind"], "press");
		let a = super::step(&answer);
		assert_eq!(a["effects"][0], json!({ "do": "select-board" }), "an absent path is left out, as the TypeScript leaves it");
		assert!(a.get("preview").is_none(), "no preview said: the page leaves the engine's as it is");
	}
}
