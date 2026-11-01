//! The editor in the engine, as the page reaches it: the page's frame and extras read from JSON, the
//! overlay given back in the TypeScript `Overlay`'s shape for the page's hit areas, and the editor's
//! other answers by name (`call`): a pick, a drop slot, the ops for a move, a make or a delete, a key.

use crate::editing::{Editing, Extras, Frame};
use crate::editor_scene::EngineScene;
use crate::engine::Page;
use serde_json::{json, Map, Value};
use stage_editor::arrows::{self, ArrowRoute, Join, JoinedEnd};
use stage_editor::dispatch::{self, HoverAction, HoverFacts, PressAction, PressFacts, Target, Then};
use stage_editor::gesture::Mode;
use stage_editor::keys::{self, KeyContext, KeyPress};
use stage_editor::model::{Corners, Offset, Pt, Rect, Side};
use stage_editor::ops::{self, ArrowHeads, ArrowLook, Icon, MakeOptions, MakingTool};
use stage_editor::overlay::{Colours, Draft, Drawn, Kin, Role, SideHint};
use stage_editor::pick::{self, PickOptions, Policy};
use stage_editor::rules::{Form, Pointer};
use stage_editor::scene::{Props, Scene};
use stage_editor::{drop, resize, wire};
use std::collections::HashMap;

fn num(v: &Value, key: &str) -> f64 {
	v.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}
fn flag(v: &Value, key: &str) -> bool {
	v.get(key).and_then(Value::as_bool).unwrap_or(false)
}
fn text(v: &Value, key: &str) -> Option<String> {
	v.get(key).and_then(Value::as_str).map(str::to_string)
}
fn rect(v: &Value) -> Rect {
	Rect { x: num(v, "x"), y: num(v, "y"), w: num(v, "w"), h: num(v, "h") }
}
fn rect_json(r: &Rect) -> Value {
	json!({ "x": r.x, "y": r.y, "w": r.w, "h": r.h })
}
fn strings(v: &Value, key: &str) -> Vec<String> {
	v.get(key).and_then(Value::as_array).map(|list| list.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default()
}
fn colour(v: &Value, fallback: [f32; 3]) -> [f32; 3] {
	match v.as_array() {
		Some(c) if c.len() == 3 => [c[0].as_f64().unwrap_or(0.0) as f32, c[1].as_f64().unwrap_or(0.0) as f32, c[2].as_f64().unwrap_or(0.0) as f32],
		_ => fallback,
	}
}
fn side(name: &str) -> Option<Side> {
	match name {
		"top" => Some(Side::Top),
		"right" => Some(Side::Right),
		"bottom" => Some(Side::Bottom),
		"left" => Some(Side::Left),
		_ => None,
	}
}
fn side_name(s: Side) -> &'static str {
	match s {
		Side::Top => "top",
		Side::Right => "right",
		Side::Bottom => "bottom",
		Side::Left => "left",
	}
}

/// The page's frame: `{ zoom, view: {x,y,w,h}, generation, revs: {path: rev}, overComposer, selected, colours: {accent, guide, panel} }`.
pub fn frame(v: &Value) -> Frame {
	let colours = v.get("colours").cloned().unwrap_or(Value::Null);
	Frame {
		zoom: v.get("zoom").and_then(Value::as_f64).unwrap_or(1.0),
		view: rect(v.get("view").unwrap_or(&Value::Null)),
		generation: v.get("generation").and_then(Value::as_u64).unwrap_or(0),
		revs: v.get("revs").and_then(Value::as_object).map(|m| m.iter().map(|(k, r)| (k.clone(), r.as_u64().unwrap_or(0))).collect()).unwrap_or_default(),
		// The page measures the composer itself: a box standing for "under the pointer now" when it says so.
		composer: flag(v, "overComposer").then_some(Rect { x: f64::MIN / 4.0, y: f64::MIN / 4.0, w: f64::MAX / 2.0, h: f64::MAX / 2.0 }),
		selected: text(v, "selected"),
		colours: Colours { accent: colour(&colours["accent"], [0.173, 0.361, 0.937]), guide: colour(&colours["guide"], [0.949, 0.306, 0.118]), panel: colour(&colours["panel"], [1.0, 1.0, 1.0]) },
	}
}

/// What the page knows that the editor does not: `{ typing, panning, glide: [[id, dx, dy]], ownDrag: {path, x, y}, draft, hoverItem, hoverPage, alt, readOnly, notResizable, hints: { joins, sides } }`.
pub fn extras(v: &Value) -> Extras {
	let glide = v.get("glide").and_then(Value::as_array).map(|list| list.iter().filter_map(|one| Some((one.get(0)?.as_str()?.to_string(), Offset { dx: one.get(1)?.as_f64()?, dy: one.get(2)?.as_f64()? }))).collect()).unwrap_or_else(HashMap::new);
	let hints = v.get("hints").cloned().unwrap_or(Value::Null);
	Extras {
		typing: text(v, "typing"),
		panning: flag(v, "panning"),
		glide,
		own_drag: v.get("ownDrag").filter(|d| d.is_object()).and_then(|d| Some((text(d, "path")?, Pt::new(num(d, "x"), num(d, "y"))))),
		draft: v.get("draft").filter(|d| d.is_object()).map(|d| Draft { corners: Corners { x1: num(d, "x1"), y1: num(d, "y1"), x2: num(d, "x2"), y2: num(d, "y2") }, tool: text(d, "tool").unwrap_or_default() }),
		hover_item: text(v, "hoverItem"),
		hover_page: text(v, "hoverPage"),
		alt: flag(v, "alt"),
		read_only: flag(v, "readOnly"),
		not_resizable: flag(v, "notResizable"),
		hint_joins: hints.get("joins").and_then(Value::as_array).map(|l| l.iter().map(rect).collect()).unwrap_or_default(),
		hint_sides: hints.get("sides").and_then(Value::as_array).map(|l| l.iter().map(|one| SideHint { rect: rect(&one["box"]), side: one.get("side").and_then(Value::as_str).and_then(side) }).collect()).unwrap_or_default(),
	}
}

fn joined_json(j: &JoinedEnd) -> Value {
	let mut v = json!({ "item": j.item, "box": rect_json(&j.area), "side": side_name(j.side) });
	if let Some(at) = j.at {
		v["at"] = json!(at);
	}
	v
}

/// The overlay as the page's hit areas read it: the TypeScript `Overlay`'s shape.
pub fn drawn(d: &Drawn, editing: &Editing, scene: &dyn Scene, extras: &Extras) -> Value {
	let outline = |id: &str, role: Role, r: &Rect, round: bool| {
		let mut v = json!({ "id": id, "role": match role { Role::Item => "item", Role::Page => "page", Role::Marquee => "marquee" }, "x": r.x, "y": r.y, "w": r.w, "h": r.h });
		if round {
			v["round"] = json!(true);
		}
		v
	};
	let mut out = Map::new();
	out.insert("outlines".into(), json!(d.outlines.iter().map(|o| outline(&o.id, o.role, &o.rect, o.round)).collect::<Vec<_>>()));
	out.insert("kin".into(), json!(d.kin.iter().map(|k| { let mut v = json!({ "id": k.id, "kin": if k.kin == Kin::Child { "child" } else { "parent" }, "of": "selection", "x": k.rect.x, "y": k.rect.y, "w": k.rect.w, "h": k.rect.h }); if k.round { v["round"] = json!(true); } v }).collect::<Vec<_>>()));
	if let Some((r, many)) = &d.frame {
		out.insert("selectionFrame".into(), json!({ "x": r.x, "y": r.y, "w": r.w, "h": r.h, "many": many, "label": stage_editor::overlay::size_label(r) }));
	}
	if let Some((from, to, lines)) = &d.distances {
		out.insert("distances".into(), json!({ "from": rect_json(from), "to": rect_json(to), "lines": lines.iter().map(|l| { let mut v = json!({ "x1": l.x1, "y1": l.y1, "x2": l.x2, "y2": l.y2 }); if let Some(label) = &l.label { v["label"] = json!(label); } if l.dashed { v["dashed"] = json!(true); } v }).collect::<Vec<_>>() }));
	}
	if let Some(h) = &d.handles {
		out.insert("handles".into(), outline(&h.id, h.role, &h.rect, h.round));
		if let Some(r) = &d.anchors {
			out.insert("anchors".into(), outline(&h.id, Role::Item, r, h.round));
		}
		if let Some(radius) = &d.radius {
			let shape = scene.node(&h.id).and_then(|node| resize::radius_start(node, &h.rect)).map(|s| s.shape).unwrap_or(false);
			out.insert("radius".into(), json!({ "id": h.id, "role": "item", "x": radius.rect.x, "y": radius.rect.y, "w": radius.rect.w, "h": radius.rect.h, "radius": radius.radius, "most": radius.most, "shape": shape }));
		}
	}
	if let Some((id, radius)) = &d.radius_drag {
		out.insert("radiusDrag".into(), json!({ "id": id, "radius": radius }));
	}
	if let Some((path, r)) = &d.page_handles {
		out.insert("pageHandles".into(), json!({ "id": format!("page:{path}"), "role": "page", "path": path, "x": r.x, "y": r.y, "w": r.w, "h": r.h }));
	}
	if d.arrow.is_some() {
		let s = &editing.editor.state;
		if let Some(ends) = s.selection.items.first().and_then(|id| arrows::arrow_handles(scene, id, s.drag)) {
			let mut v = json!({ "id": ends.id, "route": ends.route.name(), "from": ends.from, "to": ends.to, "bent": ends.bent });
			if let Some(j) = &ends.from_join {
				v["fromJoin"] = joined_json(j);
			}
			if let Some(j) = &ends.to_join {
				v["toJoin"] = joined_json(j);
			}
			if let Some(m) = ends.middle {
				v["middle"] = json!(m);
			}
			out.insert("arrow".into(), v);
		}
	}
	if let Some((r, round)) = &d.hover {
		let mut v = rect_json(r);
		match extras.hover_item.as_ref().filter(|id| scene.bounds(id).is_some()) {
			Some(id) => v["id"] = json!(id),
			None => v["board"] = json!(true),
		}
		if *round {
			v["round"] = json!(true);
		}
		out.insert("hover".into(), v);
	}
	if let (Some(r), Some(Some(id))) = (&d.drop, &editing.editor.state.drop.into) {
		out.insert("drop".into(), json!({ "id": id, "x": r.x, "y": r.y, "w": r.w, "h": r.h }));
	}
	if let Some(r) = &d.insert {
		out.insert("insert".into(), rect_json(r));
	}
	out.insert("slots".into(), json!(d.slots.iter().map(rect_json).collect::<Vec<_>>()));
	out.insert("slotFrames".into(), json!(d.slot_frames.iter().map(rect_json).collect::<Vec<_>>()));
	out.insert("joins".into(), json!(d.joins.iter().map(rect_json).collect::<Vec<_>>()));
	out.insert("sides".into(), json!(d.sides.iter().map(|h| { let mut v = json!({ "box": rect_json(&h.rect) }); if let Some(s) = h.side { v["side"] = json!(side_name(s)); } v }).collect::<Vec<_>>()));
	out.insert("guides".into(), serde_json::to_value(&d.guides).unwrap_or_default());
	if let Some(draft) = &d.draft {
		out.insert("draft".into(), json!({ "x1": draft.corners.x1, "y1": draft.corners.y1, "x2": draft.corners.x2, "y2": draft.corners.y2, "tool": draft.tool }));
	}
	if let Some(r) = &d.route {
		out.insert("route".into(), json!({ "d": r.d, "x": r.x, "y": r.y }));
	}
	if let Some(c) = &d.end_draft {
		out.insert("endDraft".into(), json!({ "x1": c.x1, "y1": c.y1, "x2": c.x2, "y2": c.y2 }));
	}
	let s = &editing.editor.state;
	out.insert("gripHidden".into(), json!(s.drag.dx != 0.0 || s.drag.dy != 0.0 || s.resize.is_some()));
	Value::Object(out)
}

fn picked_json(p: Option<pick::Picked>) -> Value {
	p.map(|p| json!({ "id": p.id, "box": rect_json(&p.bounds) })).unwrap_or(Value::Null)
}

fn target(name: &str) -> Target {
	match name {
		"stage" => Target::Stage,
		"drawn" => Target::Drawn,
		_ => Target::Other,
	}
}

fn press_json(a: PressAction) -> Value {
	match a {
		PressAction::Make => json!({ "do": "make" }),
		PressAction::Press => json!({ "do": "press" }),
		PressAction::Picture { path, carry } => json!({ "do": "picture", "path": path, "carry": carry }),
		PressAction::Touch { picture, then } => {
			let mut v = json!({ "do": "touch" });
			if let Some(p) = picture {
				v["picture"] = json!(p);
			}
			if let Some(t) = then {
				v["then"] = json!(if t == Then::Drawing { "drawing" } else { "deselect" });
			}
			v
		}
		PressAction::Pan { deselect, middle } => json!({ "do": "pan", "deselect": deselect, "middle": middle }),
		PressAction::Nothing => json!({ "do": "nothing" }),
	}
}

fn join_of(v: &Value) -> Option<Join> {
	v.is_object().then(|| Join { name: text(v, "name").unwrap_or_default(), area: rect(&v["box"]), side: v.get("side").and_then(Value::as_str).and_then(side) })
}
fn join_json(j: &Join) -> Value {
	let mut v = json!({ "name": j.name, "box": rect_json(&j.area) });
	if let Some(s) = j.side {
		v["side"] = json!(side_name(s));
	}
	v
}

/// A made item: its op, its node and its box, as the TypeScript `Made`.
fn made_json(m: ops::Made) -> Value {
	json!({ "op": m.op, "node": m.node, "box": rect_json(&m.area) })
}

/// The editor's other answers, by name: what the page's pointer, keys, typing and insert panel ask.
pub fn call(editing: &mut Editing, page: &Page, name: &str, a: &Value) -> Value {
	let zoom = a.get("zoom").and_then(Value::as_f64).unwrap_or(1.0);
	// The editor and the scene's ids are borrowed apart: the scene reads the ids while a call changes the editor.
	let Editing { editor, ids, .. } = editing;
	ids.refresh(page);
	let scene = EngineScene::with(page, editor.rules.line_reach / zoom.max(1e-6), ids);
	let at = Pt::new(num(a, "x"), num(a, "y"));
	let owned_rules = editor.rules.clone();
	let rules = &owned_rules;
	match name {
		"pick" => {
			let skip_ids = strings(a, "skip");
			let skip_arrows = flag(a, "skipArrows");
			let skip = |id: &str, node: &Props| skip_ids.iter().any(|s| s == id) || (skip_arrows && stage_editor::pen::is_arrow(node));
			let policy = if a.get("policy").and_then(Value::as_str) == Some("outermost") { Policy::Outermost } else { Policy::Exact };
			picked_json(pick::pick_at(&scene, at, PickOptions { policy, deep: flag(a, "deep"), skip: Some(&skip) }))
		}
		"block-at" => pick::block_at(&scene, at, text(a, "typing").as_deref()).map(Value::String).unwrap_or(Value::Null),
		"picture-at" => {
			let rendered = strings(a, "rendered");
			let boards: Vec<stage_editor::model::PageBox> = a.get("boards").and_then(Value::as_array).map(|l| l.iter().map(|b| stage_editor::model::PageBox { path: text(b, "path").unwrap_or_default(), x: num(b, "x"), y: num(b, "y"), w: num(b, "w"), h: num(b, "h"), least: None }).collect()).unwrap_or_else(|| scene.boards());
			pick::picture_at(&boards, at, &|path| rendered.iter().any(|r| r == path)).map(Value::String).unwrap_or(Value::Null)
		}
		"decide-press" => {
			let on_item = flag(a, "onItem");
			let picture = text(a, "picture");
			let item = || on_item;
			let pic = || picture.clone();
			let facts = PressFacts { pointer: Pointer::parse(a["pointer"].as_str().unwrap_or("mouse")), button: num(a, "button") as u8, target: target(a["target"].as_str().unwrap_or("other")), editable: flag(a, "editable"), drawing: flag(a, "drawing"), tool: wire::tool(a["tool"].as_str().unwrap_or("select")), space: flag(a, "space"), fingers: num(a, "fingers") as usize, on_item: &item, picture: &pic };
			press_json(dispatch::decide_press(&facts))
		}
		"decide-hover" => {
			let facts = HoverFacts { pointer: Pointer::parse(a["pointer"].as_str().unwrap_or("mouse")), editable: flag(a, "editable"), editing: flag(a, "editing"), drawing: flag(a, "drawing"), on_grip: flag(a, "onGrip"), buttons: num(a, "buttons") != 0.0, tool: wire::tool(a["tool"].as_str().unwrap_or("select")), target: target(a["target"].as_str().unwrap_or("other")), hand: flag(a, "hand") };
			match dispatch::decide_hover(&facts, rules) {
				HoverAction::None => json!({ "do": "none" }),
				HoverAction::Clear { block } => json!({ "do": "clear", "block": block }),
				HoverAction::Track { outlines } => json!({ "do": "track", "outlines": outlines }),
			}
		}
		"hand-pans" => json!(dispatch::hand_pans(flag(a, "hand"), Pointer::parse(a["pointer"].as_str().unwrap_or("mouse")), num(a, "button") as u8, flag(a, "control"))),
		"frame-under" => drop::frame_under(&scene, at, &strings(a, "carrying")).map(Value::String).unwrap_or(Value::Null),
		"frame-at" => drop::frame_at(&scene, at, flag(a, "stacking")).map(Value::String).unwrap_or(Value::Null),
		"drop-slot" => text(a, "frame").and_then(|frame| drop::drop_slot(&scene, &frame, at, &strings(a, "carrying"))).map(|s| json!({ "index": s.index, "line": rect_json(&s.line) })).unwrap_or(Value::Null),
		"move-ops" => {
			let into = match a.get("into") {
				None => None,
				Some(Value::Null) => Some(None),
				Some(v) => Some(v.as_str()),
			};
			let slot = a.get("slot").and_then(Value::as_u64).map(|n| n as usize);
			json!(ops::move_ops(&scene, &strings(a, "ids"), num(a, "dx"), num(a, "dy"), into, slot))
		}
		"duplicate-ops" | "copy-ops" => {
			let mut next = ops::id_maker(scene.items().into_iter().chain(strings(a, "taken")));
			let ids = strings(a, "ids");
			let copies = if name == "duplicate-ops" { ops::duplicate_ops(&scene, &ids, &mut next, rules) } else { ops::copy_ops(&scene, &ids, num(a, "dx"), num(a, "dy"), &mut next) };
			json!({ "ops": copies.ops, "made": copies.made })
		}
		"delete-ops" => json!(ops::delete_ops(&strings(a, "ids"), Some(&scene))),
		"make-at-op" | "drawn-op" => {
			let Some(tool) = MakingTool::of(wire::tool(a["tool"].as_str().unwrap_or("select"))) else { return Value::Null };
			let id = text(a, "id").unwrap_or_default();
			let mut next = ops::id_maker(scene.items().into_iter().chain([id.clone()]).chain(strings(a, "taken")));
			let card = a.get("card").and_then(Value::as_object).cloned().unwrap_or_default();
			let card_of = move |_: &str, _: &str| card.clone();
			let (shape, library, icon) = (text(a, "shape").unwrap_or_default(), text(&a["icon"], "library").unwrap_or_default(), text(&a["icon"], "name").unwrap_or_default());
			let parent = text(a, "parent");
			let mut options = MakeOptions { shape: &shape, icon: Icon { library: &library, name: &icon }, next_id: &mut next, card: &card_of, centred: flag(a, "centred"), parent: parent.as_deref() };
			if name == "make-at-op" {
				made_json(ops::make_at_op(tool, &id, at, &mut options))
			} else {
				made_json(ops::drawn_op(tool, &id, at, Pt::new(num(&a["end"], "x"), num(&a["end"], "y")), &mut options))
			}
		}
		"arrow-insert-op" => {
			let route = a.get("route").and_then(Value::as_str).map(|r| ArrowRoute::of(&json!({ "route": r })));
			let heads = if a.get("heads").and_then(Value::as_str) == Some("none") { ArrowHeads::None } else { ArrowHeads::End };
			json!(ops::arrow_insert_op(&text(a, "id").unwrap_or_default(), a.get("from").cloned().unwrap_or(Value::Null), a.get("to").cloned().unwrap_or(Value::Null), ArrowLook { route, heads }))
		}
		"join-at" => arrows::join_at(&scene, at, zoom, text(a, "not").as_deref(), rules).map(|j| join_json(&j)).unwrap_or(Value::Null),
		"new-arrow-ends" => {
			let (from, to) = (join_of(&a["fromJoin"]), join_of(&a["toJoin"]));
			arrows::new_arrow_ends(from.as_ref(), to.as_ref(), at, Pt::new(num(&a["end"], "x"), num(&a["end"], "y")), flag(a, "moved")).map(|e| json!({ "from": e.from.to_value(), "to": e.to.to_value() })).unwrap_or(Value::Null)
		}
		"pen-key" => {
			let press: KeyPress = serde_json::from_value(a["press"].clone()).unwrap_or_default();
			let (selection, boards) = (strings(a, "selection"), strings(a, "boards"));
			let selected = text(a, "selectedPage");
			let mut next = ops::id_maker(scene.items());
			let mut ctx = KeyContext { selection: &selection, boards: &boards, tool: wire::tool(a["tool"].as_str().unwrap_or("select")), page_selected: flag(a, "pageSelected"), selected_page: selected.as_deref(), can_step: flag(a, "canStep"), scene: &scene, next_id: &mut next };
			keys::pen_key(&press, &mut ctx, rules).to_value()
		}
		"form" => {
			editor.rules = stage_editor::rules::Rules::for_form(a["form"].as_str().and_then(Form::parse).unwrap_or(Form::Desk));
			Value::Null
		}
		"mode" => {
			editor.state.mode = if a["mode"].as_str() == Some("edit") { Mode::Edit } else { Mode::Browse };
			editor.state.tool = wire::tool(a["tool"].as_str().unwrap_or("select"));
			wire::state(&editor.state)
		}
		"select" => {
			let s = &mut editor.state;
			if a.get("items").is_some() {
				s.selection.items = strings(a, "items");
			}
			if a.get("boards").is_some() {
				s.selection.boards = strings(a, "boards");
			}
			if a.get("made").is_some() {
				s.select_made(&strings(a, "made"));
			}
			wire::state(s)
		}
		"land" => {
			let boards: Vec<(stage_editor::model::PageBox, u64)> = a.get("boards").and_then(Value::as_array).map(|l| l.iter().map(|b| (stage_editor::model::PageBox { path: text(b, "path").unwrap_or_default(), x: num(b, "x"), y: num(b, "y"), w: num(b, "w"), h: num(b, "h"), least: None }, b.get("rev").and_then(Value::as_u64).unwrap_or(0))).collect()).unwrap_or_default();
			let s = &mut editor.state;
			let present: Vec<&str> = boards.iter().map(|(b, _)| b.path.as_str()).collect();
			s.selection.boards.retain(|path| present.contains(&path.as_str()));
			if let Some((path, _, _)) = s.page_resize.clone() {
				let board = boards.iter().find(|(b, _)| b.path == path).map(|(b, rev)| (b, *rev));
				s.land_page_resize(board);
			}
			let placed: Vec<stage_editor::model::PageBox> = boards.into_iter().map(|(b, _)| b).collect();
			s.land_page_drag(&placed);
			wire::state(s)
		}
		"state" => wire::state(&editor.state),
		_ => json!({ "error": format!("no editor call named {name}") }),
	}
}

