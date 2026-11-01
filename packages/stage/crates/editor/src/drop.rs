//! Where a drag would drop what it carries: which frame, and where among a frame's children
//! (`edit/core/drop.ts`).

use crate::model::{Pt, Rect};
use crate::pen;
use crate::rules::Rules;
use crate::scene::{Props, Scene};
use serde_json::Value;

/// A frame's `layout`, as the file has it.
fn layout(node: &Props) -> Option<&str> {
	node.get("layout").and_then(Value::as_str)
}

fn contains(b: &Rect, p: Pt) -> bool {
	p.x >= b.x && p.x <= b.right() && p.y >= b.y && p.y <= b.bottom()
}

/// The topmost frame under a point, by its placed box. Only frames that place their children where
/// they say, unless `stacking`, which counts frames that lay their children out too. Never an
/// instance's inside or a library shape.
pub fn frame_at(scene: &dyn Scene, point: Pt, stacking: bool) -> Option<String> {
	let mut best = None;
	for id in scene.items() {
		let Some(node) = scene.node(&id) else { continue };
		if pen::kind(node) != "frame" || pen::in_instance(&id) || pen::is_shape(node) {
			continue;
		}
		if layout(node) != Some("none") && !stacking {
			continue;
		}
		if scene.placed(&id).is_some_and(|b| contains(&b, point)) {
			best = Some(id);
		}
	}
	best
}

/// Whether an item is one of `carrying` or inside one.
fn carried(scene: &dyn Scene, id: &str, carrying: &[String]) -> bool {
	let mut up = Some(id.to_string());
	while let Some(at) = up {
		if carrying.contains(&at) {
			return true;
		}
		up = scene.parent(&at);
	}
	false
}

/// The frame under a point that a drag could drop into: never one of the items being carried, and
/// never inside one. `None` is the stage.
pub fn frame_under(scene: &dyn Scene, point: Pt, carrying: &[String]) -> Option<String> {
	let found = frame_at(scene, point, true)?;
	// Its own descendant would be a loop, which the op refuses anyway; this keeps it off the screen too.
	(!carried(scene, &found, carrying)).then_some(found)
}

/// A place among a frame's children a drop would take: the index the `move` op takes, and the line drawn there.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slot {
	pub index: usize,
	pub line: Rect,
}

/// A frame that arranges its children, as a drop asks of it: which way, its box and padding, its children as drawn.
struct LaidOut<'a> {
	node: &'a Props,
	area: Rect,
	down: bool,
	kids: Vec<(String, Option<Rect>)>,
}

fn laid_out<'a>(scene: &'a dyn Scene, frame: &str) -> Option<LaidOut<'a>> {
	let node = scene.node(frame)?;
	let down = match layout(node) {
		Some("vertical") => true,
		Some("horizontal") => false,
		_ => return None,
	};
	let area = scene.bounds(frame)?;
	let kids = scene.children(frame).into_iter().map(|kid| (kid.clone(), scene.bounds(&kid))).collect();
	Some(LaidOut { node, area, down, kids })
}

/// Where in a frame that arranges its children a drop would land: the place among them nearest the
/// pointer, and the line drawn on that boundary. `None` for a frame with no layout, where an item
/// lands on the pixel it was let go on and there is no order to join.
///
/// The index counts the frame's own children, carried ones included, so it is an index the `move` op
/// can take; a carried child is only skipped when asking which side of it the pointer is.
pub fn drop_slot(scene: &dyn Scene, frame: &str, point: Pt, carrying: &[String]) -> Option<Slot> {
	let laid = laid_out(scene, frame)?;
	let along = if laid.down { point.y } else { point.x };
	let real = |kid: &(String, Option<Rect>)| kid.1.filter(|_| !carrying.contains(&kid.0));
	let index = laid
		.kids
		.iter()
		.position(|kid| real(kid).is_some_and(|b| along < if laid.down { b.cy() } else { b.cx() }))
		.unwrap_or(laid.kids.len());
	let before = laid.kids[..index].iter().rev().find_map(real);
	let after = laid.kids[index..].iter().find_map(real);
	Some(Slot { index, line: slot_line(&laid, before, after) })
}

/// The frame's padding as top, right, bottom, left; a side that is not a number is `None`.
fn padding(node: &Props) -> [Option<f64>; 4] {
	let eight = [Some(8.0); 4];
	match node.get("padding") {
		Some(Value::Number(n)) => [n.as_f64(); 4],
		Some(Value::Array(pad)) if pad.len() == 2 => [pad[0].as_f64(), pad[1].as_f64(), pad[0].as_f64(), pad[1].as_f64()],
		Some(Value::Array(pad)) if pad.len() == 4 => [pad[0].as_f64(), pad[1].as_f64(), pad[2].as_f64(), pad[3].as_f64()],
		_ => eight,
	}
}

/// The line a slot is drawn as, between the child before it and the child after it (either may be
/// missing): halfway between two, 5 past the one there is at an end, the middle of an empty frame.
/// As long as the frame's content is wide: inside its padding, so the line spans the words, not the paper.
fn slot_line(frame: &LaidOut, before: Option<Rect>, after: Option<Rect>) -> Rect {
	let (b, down) = (frame.area, frame.down);
	let edge = |one: &Rect, end: bool| if down { one.y + if end { one.h } else { 0.0 } } else { one.x + if end { one.w } else { 0.0 } };
	let on = match (before, after) {
		(Some(p), Some(n)) => (edge(&p, true) + edge(&n, false)) / 2.0,
		(None, Some(n)) => edge(&n, false) - 5.0,
		(Some(p), None) => edge(&p, true) + 5.0,
		(None, None) => {
			if down {
				b.cy()
			} else {
				b.cx()
			}
		}
	};
	let inset = |side: Option<f64>| side.unwrap_or(8.0).max(8.0);
	let [pt, pr, pb, pl] = padding(frame.node);
	if down {
		Rect { x: b.x + inset(pl), y: on, w: (b.w - inset(pl) - inset(pr)).max(8.0), h: 0.0 }
	} else {
		Rect { x: on, y: b.y + inset(pt), w: 0.0, h: (b.h - inset(pt) - inset(pb)).max(8.0) }
	}
}

/// How far round the pointer, in stage units at a zoom, a drag shows the places it could drop into:
/// the rules' `near_px` on the screen.
pub fn near_reach(rules: &Rules, zoom: f64) -> f64 {
	rules.near_px / zoom
}

/// Every place a drag could land near the pointer: slot lines in frames that arrange their children, and frames that do not.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NearDrops {
	pub slots: Vec<Rect>,
	pub frames: Vec<Rect>,
}

/// Where the drag would drop now: the frame (`into`) and the slot line (`line`), both left out of `near_drops`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Current<'a> {
	pub into: Option<&'a str>,
	pub line: Option<Rect>,
}

/// What a drag could drop into, within `reach` stage pixels of the pointer (`near_reach`): each slot
/// of every frame that arranges its children whose line passes that near, and every frame that places
/// them where they say whose box does. The frames `frame_under` could answer: never what is carried or
/// inside it, an instance's inside or a library shape. Not the slot the drag would take now
/// (`current.line`, drawn solid) nor the frame it would drop into (`current.into`).
pub fn near_drops(scene: &dyn Scene, point: Pt, carrying: &[String], reach: f64, current: Current) -> NearDrops {
	let mut out = NearDrops::default();
	let same = |a: &Rect, b: Option<Rect>| b.is_some_and(|b| (a.x - b.x).abs() < 0.5 && (a.y - b.y).abs() < 0.5 && (a.w - b.w).abs() < 0.5 && (a.h - b.h).abs() < 0.5);
	for id in scene.items() {
		let Some(node) = scene.node(&id) else { continue };
		if pen::kind(node) != "frame" || pen::in_instance(&id) || pen::is_shape(node) || carried(scene, &id, carrying) {
			continue;
		}
		let Some(laid) = laid_out(scene, &id) else {
			if layout(node) != Some("none") || current.into == Some(id.as_str()) {
				continue;
			}
			if let Some(b) = scene.bounds(&id).filter(|b| box_distance(point, b) <= reach) {
				out.frames.push(b);
			}
			continue;
		};
		let rows: Vec<Rect> = laid.kids.iter().filter(|kid| !carrying.contains(&kid.0)).filter_map(|kid| kid.1).collect();
		for at in 0..=rows.len() {
			let line = slot_line(&laid, at.checked_sub(1).map(|i| rows[i]), rows.get(at).copied());
			if same(&line, current.line) {
				continue;
			}
			if box_distance(point, &line) <= reach {
				out.slots.push(line);
			}
		}
	}
	out
}

/// How far a point is from a box: 0 inside it. A slot's line is a box with no width or no height.
pub fn box_distance(p: Pt, b: &Rect) -> f64 {
	(b.x - p.x).max(0.0).max(p.x - b.x - b.w).hypot((b.y - p.y).max(0.0).max(p.y - b.y - b.h))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::rules::Form;
	use crate::scene::{Fake, FakeItem};
	use serde_json::json;

	fn r(x: f64, y: f64, w: f64, h: f64) -> Rect {
		Rect { x, y, w, h }
	}
	fn ids(list: &[&str]) -> Vec<String> {
		list.iter().map(|s| s.to_string()).collect()
	}
	fn column() -> Fake {
		Fake::new(vec![
			FakeItem::rect("col", 0.0, 0.0, 200.0, 300.0).kind("frame").set("layout", json!("vertical")).set("padding", json!(12)),
			FakeItem::rect("a", 12.0, 12.0, 176.0, 40.0).inside("col"),
			FakeItem::rect("b", 12.0, 62.0, 176.0, 40.0).inside("col"),
			FakeItem::rect("c", 12.0, 112.0, 176.0, 40.0).inside("col"),
			FakeItem::rect("free", 400.0, 0.0, 200.0, 200.0).kind("frame").set("layout", json!("none")),
		])
	}

	#[test]
	fn a_frame_with_layout_is_found_only_when_stacking_frames_count() {
		let s = column();
		assert_eq!(frame_at(&s, Pt::new(50.0, 50.0), false), None);
		assert_eq!(frame_at(&s, Pt::new(50.0, 50.0), true), Some("col".into()));
		assert_eq!(frame_at(&s, Pt::new(450.0, 50.0), false), Some("free".into()));
	}

	#[test]
	fn the_topmost_frame_wins_and_a_library_shape_or_an_instances_inside_is_never_one() {
		let s = Fake::new(vec![
			FakeItem::rect("under", 0.0, 0.0, 200.0, 200.0).kind("frame").set("layout", json!("none")),
			FakeItem::rect("over", 50.0, 50.0, 100.0, 100.0).kind("frame").set("layout", json!("none")),
			FakeItem::rect("shape", 60.0, 60.0, 20.0, 20.0).kind("frame").set("layout", json!("none")).set("metadata", json!({ "type": "decks.shape", "kind": "Rounded" })),
			FakeItem::rect("ref/inner", 90.0, 90.0, 20.0, 20.0).kind("frame").set("layout", json!("none")),
		]);
		assert_eq!(frame_at(&s, Pt::new(70.0, 70.0), false), Some("over".into()));
		assert_eq!(frame_at(&s, Pt::new(100.0, 100.0), false), Some("over".into()));
		assert_eq!(frame_at(&s, Pt::new(10.0, 10.0), false), Some("under".into()));
	}

	#[test]
	fn a_drag_never_drops_into_what_it_carries_nor_into_anything_inside_it() {
		let s = Fake::new(vec![
			FakeItem::rect("outer", 0.0, 0.0, 300.0, 300.0).kind("frame").set("layout", json!("none")),
			FakeItem::rect("inner", 10.0, 10.0, 100.0, 100.0).kind("frame").set("layout", json!("none")).inside("outer"),
		]);
		assert_eq!(frame_under(&s, Pt::new(50.0, 50.0), &ids(&["outer"])), None);
		assert_eq!(frame_under(&s, Pt::new(50.0, 50.0), &ids(&["inner"])), None);
		assert_eq!(frame_under(&s, Pt::new(200.0, 200.0), &ids(&["inner"])), Some("outer".into()));
		let col = column();
		assert_eq!(frame_under(&col, Pt::new(50.0, 50.0), &ids(&["a"])), Some("col".into()));
		assert_eq!(frame_under(&col, Pt::new(900.0, 900.0), &[]), None);
	}

	#[test]
	fn the_slot_is_the_boundary_nearest_the_pointer_and_its_line_sits_inside_the_padding() {
		let s = column();
		assert_eq!(drop_slot(&s, "col", Pt::new(50.0, 70.0), &[]), Some(Slot { index: 1, line: r(12.0, 57.0, 176.0, 0.0) }));
		assert_eq!(drop_slot(&s, "col", Pt::new(50.0, 5.0), &[]), Some(Slot { index: 0, line: r(12.0, 7.0, 176.0, 0.0) }));
		assert_eq!(drop_slot(&s, "col", Pt::new(50.0, 290.0), &[]), Some(Slot { index: 3, line: r(12.0, 157.0, 176.0, 0.0) }));
		assert_eq!(drop_slot(&s, "free", Pt::new(450.0, 50.0), &[]), None);
	}

	#[test]
	fn a_carried_child_is_skipped_when_asking_which_side_but_still_counted_in_the_index() {
		let s = column();
		// Carrying b: just under a's middle is before c, which is index 2 counting b, drawn between a and c.
		assert_eq!(drop_slot(&s, "col", Pt::new(50.0, 70.0), &ids(&["b"])), Some(Slot { index: 2, line: r(12.0, 82.0, 176.0, 0.0) }));
	}

	#[test]
	fn a_row_takes_its_slots_across_and_an_empty_frame_its_middle_with_padding_never_under_eight() {
		let s = Fake::new(vec![
			FakeItem::rect("row", 0.0, 0.0, 300.0, 100.0).kind("frame").set("layout", json!("horizontal")).set("padding", json!([4, 20])),
			FakeItem::rect("x", 20.0, 8.0, 50.0, 84.0).inside("row"),
			FakeItem::rect("empty", 0.0, 200.0, 100.0, 100.0).kind("frame").set("layout", json!("vertical")),
		]);
		// Padding [4, 20]: top and bottom 4, held at 8.
		assert_eq!(drop_slot(&s, "row", Pt::new(100.0, 50.0), &[]), Some(Slot { index: 1, line: r(75.0, 8.0, 0.0, 84.0) }));
		assert_eq!(drop_slot(&s, "row", Pt::new(10.0, 50.0), &[]), Some(Slot { index: 0, line: r(15.0, 8.0, 0.0, 84.0) }));
		assert_eq!(drop_slot(&s, "empty", Pt::new(50.0, 250.0), &[]), Some(Slot { index: 0, line: r(8.0, 250.0, 84.0, 0.0) }));
	}

	#[test]
	fn near_the_pointer_every_slot_within_reach_shows_but_not_the_one_the_drop_takes() {
		let s = column();
		// Carrying c, its place folds away: three slots are left, and the drop takes the middle one.
		let now = Current { into: Some("col"), line: Some(r(12.0, 57.0, 176.0, 0.0)) };
		let near = near_drops(&s, Pt::new(100.0, 57.0), &ids(&["c"]), 60.0, now);
		assert_eq!(near.slots, vec![r(12.0, 7.0, 176.0, 0.0), r(12.0, 107.0, 176.0, 0.0)]);
		// The frame with no layout is 300 away: out of reach; within 320 it shows, whole.
		assert!(near.frames.is_empty());
		assert_eq!(near_drops(&s, Pt::new(100.0, 57.0), &ids(&["c"]), 320.0, Current::default()).frames, vec![r(400.0, 0.0, 200.0, 200.0)]);
	}

	#[test]
	fn a_carried_frame_offers_no_slots_and_the_frame_a_drop_goes_into_is_not_shown_as_near() {
		let s = column();
		assert!(near_drops(&s, Pt::new(100.0, 57.0), &ids(&["col"]), 1000.0, Current::default()).slots.is_empty());
		assert!(near_drops(&s, Pt::new(450.0, 50.0), &ids(&["a"]), 10.0, Current { into: Some("free"), line: None }).frames.is_empty());
		assert_eq!(near_drops(&s, Pt::new(450.0, 50.0), &ids(&["a"]), 10.0, Current::default()).frames, vec![r(400.0, 0.0, 200.0, 200.0)]);
	}

	#[test]
	fn the_near_reach_is_the_rules_screen_pixels_over_the_zoom_on_every_form() {
		let s = column();
		for form in Form::ALL {
			let rules = Rules::for_form(form);
			assert_eq!(near_reach(&rules, 2.0), rules.near_px / 2.0, "{form:?}");
			// The free frame, just within the rules' reach of a point to its left at zoom 1, and just out of it.
			let inside = near_drops(&s, Pt::new(400.0 - rules.near_px + 1.0, 50.0), &[], near_reach(&rules, 1.0), Current::default());
			assert_eq!(inside.frames, vec![r(400.0, 0.0, 200.0, 200.0)], "{form:?}");
			let outside = near_drops(&s, Pt::new(400.0 - rules.near_px - 1.0, 50.0), &[], near_reach(&rules, 1.0), Current::default());
			assert!(outside.frames.is_empty(), "{form:?}");
		}
	}

	#[test]
	fn a_points_distance_from_a_box_is_nothing_inside_it_and_straight_line_outside() {
		assert_eq!(box_distance(Pt::new(5.0, 5.0), &r(0.0, 0.0, 10.0, 10.0)), 0.0);
		assert_eq!(box_distance(Pt::new(13.0, 14.0), &r(0.0, 0.0, 10.0, 10.0)), 5.0);
		assert_eq!(box_distance(Pt::new(-3.0, 5.0), &r(0.0, 0.0, 10.0, 10.0)), 3.0);
	}
}
