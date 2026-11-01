//! What a moving selection lines up with, and the box it moves as (`edit/core/snapping.ts`). The
//! snapping arithmetic itself is `snap.rs`; this decides what it snaps against.

use crate::model::Rect;
use crate::pen;
use crate::rules::Rules;
use crate::scene::Scene;

/// How far snapping reaches in stage units at a zoom: the rules' `snap_px` on the screen, whatever the zoom.
pub fn snap_threshold(rules: &Rules, zoom: f64) -> f64 {
	rules.snap_px / zoom
}

/// Whether a box shows in the window, edges touching not counted.
fn seen(view: &Rect, b: &Rect) -> bool {
	b.x < view.x + view.w && b.x + b.w > view.x && b.y < view.y + view.h && b.y + b.h > view.y
}

/// The items around a selection and the boards, as far as `view` (the window, in stage pixels)
/// shows. Top-level items, and the siblings of an item inside a frame; never what is moving, the
/// inside of an instance, a page, or an arrow, whose box is only where its line runs.
pub fn snap_targets(scene: &dyn Scene, ids: &[String], boards: &[String], view: &Rect) -> Vec<Rect> {
	let parents: Vec<String> = ids.iter().filter_map(|id| scene.parent(id)).collect();
	let mut out = Vec::new();
	for id in scene.items() {
		let Some(node) = scene.node(&id) else { continue };
		if ids.contains(&id) || pen::in_instance(&id) || pen::is_arrow(node) || pen::is_page(node) {
			continue;
		}
		if scene.parent(&id).is_some_and(|up| !parents.contains(&up)) {
			continue;
		}
		if let Some(b) = scene.bounds(&id).filter(|b| seen(view, b)) {
			out.push(b);
		}
	}
	for board in scene.boards() {
		if !boards.contains(&board.path) && seen(view, &board.rect()) {
			out.push(board.rect());
		}
	}
	out
}

/// The boards a drag of boards alone keeps the reading gap from (`snap.rs`): every other board the
/// window shows. None when drawn items are carried too.
pub fn reading_targets(scene: &dyn Scene, ids: &[String], boards: &[String], view: &Rect) -> Vec<Rect> {
	if !ids.is_empty() || boards.is_empty() {
		return Vec::new();
	}
	scene.boards().into_iter().filter(|b| !boards.contains(&b.path) && seen(view, &b.rect())).map(|b| b.rect()).collect()
}

/// The box round everything in a selection: items as drawn, boards as placed.
pub fn selection_box(scene: &dyn Scene, ids: &[String], boards: &[String]) -> Option<Rect> {
	let items = ids.iter().filter_map(|id| scene.bounds(id));
	let pages = scene.boards().into_iter().filter(|b| boards.contains(&b.path)).map(|b| b.rect());
	items.chain(pages).reduce(|all, one| all.union(&one))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::model::PageBox;
	use crate::rules::Form;
	use crate::scene::{Fake, FakeItem};
	use serde_json::json;

	const VIEW: Rect = Rect { x: 0.0, y: 0.0, w: 1000.0, h: 1000.0 };

	fn r(x: f64, y: f64, w: f64, h: f64) -> Rect {
		Rect { x, y, w, h }
	}
	fn ids(list: &[&str]) -> Vec<String> {
		list.iter().map(|s| s.to_string()).collect()
	}
	fn board(path: &str, x: f64, y: f64, w: f64, h: f64) -> PageBox {
		PageBox { path: path.into(), x, y, w, h, least: None }
	}

	#[test]
	fn the_targets_are_the_other_top_level_items_and_boards_in_view_never_what_moves() {
		let scene = Fake::new(vec![FakeItem::rect("a", 0.0, 0.0, 10.0, 10.0), FakeItem::rect("b", 50.0, 0.0, 10.0, 10.0), FakeItem::rect("far", 5000.0, 0.0, 10.0, 10.0)])
			.with_boards(vec![board("boards/x.html", 100.0, 100.0, 200.0, 100.0)]);
		assert_eq!(snap_targets(&scene, &ids(&["a"]), &[], &VIEW), vec![r(50.0, 0.0, 10.0, 10.0), r(100.0, 100.0, 200.0, 100.0)]);
		assert_eq!(snap_targets(&scene, &ids(&["a"]), &ids(&["boards/x.html"]), &VIEW), vec![r(50.0, 0.0, 10.0, 10.0)]);
	}

	#[test]
	fn inside_a_frame_only_siblings_count_and_arrows_pages_and_an_instances_inside_never_do() {
		let scene = Fake::new(vec![
			FakeItem::rect("f", 0.0, 0.0, 300.0, 300.0).kind("frame"),
			FakeItem::rect("k1", 10.0, 10.0, 10.0, 10.0).inside("f"),
			FakeItem::rect("k2", 40.0, 10.0, 10.0, 10.0).inside("f"),
			FakeItem::rect("g", 500.0, 500.0, 300.0, 300.0).kind("frame"),
			FakeItem::rect("cousin", 510.0, 510.0, 10.0, 10.0).inside("g"),
			FakeItem::rect("other", 400.0, 0.0, 10.0, 10.0),
			FakeItem::rect("line", 0.0, 450.0, 100.0, 1.0).kind("path").set("metadata", json!({ "type": "decks.arrow" })),
			FakeItem::rect("ref/inner", 0.0, 600.0, 10.0, 10.0),
			FakeItem::rect("page", 0.0, 700.0, 100.0, 100.0).kind("browser").set("metadata", json!({ "type": "decks.board" })),
		]);
		let got = snap_targets(&scene, &ids(&["k1"]), &[], &VIEW);
		assert!(got.contains(&r(40.0, 10.0, 10.0, 10.0)), "the sibling");
		assert!(got.contains(&r(400.0, 0.0, 10.0, 10.0)), "a top-level item");
		assert!(got.contains(&r(0.0, 0.0, 300.0, 300.0)), "its own frame, which is top-level");
		assert!(!got.contains(&r(510.0, 510.0, 10.0, 10.0)), "not a child of another frame");
		assert!(!got.iter().any(|b| b.y == 450.0), "not an arrow");
		assert!(!got.iter().any(|b| b.y == 600.0), "not an instance's inside");
		assert!(!got.iter().any(|b| b.y == 700.0), "not a page");
	}

	#[test]
	fn a_target_is_taken_as_drawn_and_only_when_the_window_shows_it() {
		let scene = Fake::new(vec![FakeItem::rect("t", 0.0, 0.0, 10.0, 10.0).drawn_at(r(0.0, 0.0, 40.0, 12.0)), FakeItem::rect("edge", 1000.0, 0.0, 10.0, 10.0)]);
		assert_eq!(snap_targets(&scene, &ids(&["x"]), &[], &VIEW), vec![r(0.0, 0.0, 40.0, 12.0)]);
	}

	#[test]
	fn only_a_drag_of_boards_alone_keeps_the_reading_gap_from_the_other_boards_in_view() {
		let scene = Fake::new(vec![FakeItem::rect("a", 0.0, 0.0, 10.0, 10.0)]).with_boards(vec![
			board("one.html", 0.0, 0.0, 400.0, 300.0),
			board("two.html", 560.0, 0.0, 400.0, 300.0),
			board("far.html", 5000.0, 0.0, 400.0, 300.0),
		]);
		assert_eq!(reading_targets(&scene, &[], &ids(&["one.html"]), &VIEW), vec![r(560.0, 0.0, 400.0, 300.0)]);
		assert!(reading_targets(&scene, &ids(&["a"]), &ids(&["one.html"]), &VIEW).is_empty(), "items carried too");
		assert!(reading_targets(&scene, &ids(&["a"]), &[], &VIEW).is_empty(), "no boards carried");
	}

	#[test]
	fn a_selections_box_takes_items_as_drawn_and_boards_as_placed() {
		let scene = Fake::new(vec![FakeItem::rect("t", 0.0, 0.0, 10.0, 10.0).drawn_at(r(0.0, 0.0, 40.0, 12.0))]).with_boards(vec![board("b", 100.0, 50.0, 20.0, 20.0)]);
		assert_eq!(selection_box(&scene, &ids(&["t"]), &ids(&["b"])), Some(r(0.0, 0.0, 120.0, 70.0)));
		assert_eq!(selection_box(&scene, &[], &[]), None);
		assert_eq!(selection_box(&scene, &ids(&["gone"]), &[]), None);
	}

	#[test]
	fn the_snap_reach_is_the_rules_screen_pixels_over_the_zoom_on_every_form() {
		for form in Form::ALL {
			let rules = Rules::for_form(form);
			assert_eq!(snap_threshold(&rules, 1.0), rules.snap_px, "{form:?}");
			assert_eq!(snap_threshold(&rules, 2.0), rules.snap_px / 2.0, "{form:?}");
		}
	}
}
