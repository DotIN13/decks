//! The engine as the app uses it: hit testing, the server's edits and this session's changes
//! reaching the picture, a picture handed in, and what a frame costs on this Mac.

#![cfg(target_vendor = "apple")]

mod common;

use common::*;
use stage_apple::View;

/// The colour at a stage point of a picture of `view` (straight, over white).
fn at(rgba: &[u8], view: &View, x: f64, y: f64) -> [u8; 3] {
	let (w, _) = view.pixels();
	let px = ((x - view.x) * view.zoom * view.scale) as usize;
	let py = ((y - view.y) * view.zoom * view.scale) as usize;
	let i = (py * w as usize + px) * 4;
	let p = &over_white(&rgba[i..i + 4]);
	[p[0], p[1], p[2]]
}

fn view() -> View {
	View { x: -40.0, y: -100.0, zoom: 1.0, scale: 2.0, width: 600.0, height: 420.0 }
}

#[test]
fn a_tap_finds_the_topmost_item() {
	let Some(engine) = engine_for("notes-and-text") else { return };
	assert_eq!(engine.pick(230.0, 230.0, 0.0)["id"], "dot");
	assert_eq!(engine.pick(80.0, 240.0, 0.0)["id"], "box");
	assert!(engine.pick(1000.0, 1000.0, 0.0).is_null());
	let inside = engine.within(-10.0, 190.0, 300.0, 120.0);
	assert_eq!(inside, serde_json::json!(["box", "dot"]));
}

#[test]
fn the_servers_edits_reach_the_picture() {
	let Some(mut engine) = engine_for("notes-and-text") else { return };
	let v = view();
	let before = engine.pixels(&v).unwrap().0;
	assert_eq!(at(&before, &v, 230.0, 230.0), [0x14, 0x80, 0x6f], "the dot is drawn");
	engine.apply_edits(r##"[{"op":"set","id":"dot","key":"fill","value":"#d03030"},{"op":"set","id":"box","key":"x","value":300}]"##).unwrap();
	let after = engine.pixels(&v).unwrap().0;
	assert_eq!(at(&after, &v, 230.0, 230.0), [0xd0, 0x30, 0x30], "the dot is red");
	assert_eq!(at(&after, &v, 40.0, 240.0), [255, 255, 255], "the box left its place");
	assert_eq!(at(&after, &v, 340.0, 240.0), [0xe8, 0xee, 0xfc], "and is drawn at its new one");
	assert_eq!(engine.pick(340.0, 240.0, 0.0)["id"], "box");
}

#[test]
fn this_sessions_changes_reach_the_picture() {
	let Some(mut engine) = engine_for("notes-and-text") else { return };
	let v = view();
	let generation = engine.apply(r#"[{"op":"remove","id":"dot"}]"#, true).unwrap();
	assert!(generation > 0);
	let after = engine.pixels(&v).unwrap().0;
	assert_eq!(at(&after, &v, 230.0, 230.0), [255, 255, 255], "the dot is gone");
	assert!(engine.pick(230.0, 230.0, 0.0).is_null());
}

#[test]
fn a_picture_handed_in_fills_its_item() {
	let pen = r#"{"version":"2.14","children":[{"type":"rectangle","id":"photo","x":0,"y":0,"width":100,"height":100,"fill":{"type":"image","url":"a.png","mode":"fill"}}]}"#;
	let mut engine = stage_apple::Engine::new(pen, false, "test").unwrap();
	let v = View { x: 0.0, y: 0.0, zoom: 1.0, scale: 1.0, width: 100.0, height: 100.0 };
	engine.pixels(&v).unwrap();
	assert_eq!(engine.wanted()["pictures"], serde_json::json!(["a.png"]));
	let green: Vec<u8> = [0u8, 200, 0, 255].repeat(16 * 16);
	engine.put_picture_pixels("a.png", &green, 16, 16, 64).unwrap();
	let (rgba, ..) = engine.pixels(&v).unwrap();
	assert_eq!(at(&rgba, &v, 50.0, 50.0), [0, 200, 0]);
	assert_eq!(engine.wanted()["pictures"], serde_json::json!([]));
}

/// What a frame costs on this Mac, for the report: the first (every tile painted) and the next
/// ones (tiles kept, the frame composed and drawn). Read with `--nocapture`.
#[test]
fn frame_time_on_this_mac() {
	let Some(mut engine) = engine_for("notes-and-text") else { return };
	let v = View { x: -40.0, y: -100.0, zoom: 1.0, scale: 2.0, width: 1180.0, height: 820.0 };
	let started = std::time::Instant::now();
	engine.pixels(&v).unwrap();
	let first = started.elapsed().as_secs_f64() * 1000.0;
	let rounds = 120;
	let started = std::time::Instant::now();
	for i in 0..rounds {
		engine.draw_and_wait(&View { x: v.x + i as f64 * 0.5, ..v });
	}
	let each = started.elapsed().as_secs_f64() * 1000.0 / rounds as f64;
	eprintln!("frame time, notes-and-text at 2360×1640: first {first:.1} ms (tiles painted, read back); a panning frame {each:.2} ms (composed, drawn, waited for)");
	assert!(each < 1000.0);
}

/// A drag as the web shows it: lifted, moved at each step by the page alone, nothing in undo; then
/// taken back, saved once, and put down, after which the worker's tiles carry it again.
#[test]
fn a_drag_previews_then_lands() {
	let Some(mut engine) = engine_for("notes-and-text") else { return };
	let v = view();
	engine.pixels(&v).unwrap();
	let tiles = engine.page.tiles.len();
	for step in 1..=10 {
		let lifted = engine.preview(&format!(r#"[["dot", {{ "dx": {}, "dy": 0 }}]]"#, step * 10)).unwrap();
		assert_eq!(lifted, vec!["dot".to_owned()]);
	}
	let moved = engine.pixels(&v).unwrap().0;
	assert_eq!(at(&moved, &v, 330.0, 230.0), [0x14, 0x80, 0x6f], "the dot is drawn where the drag has it");
	assert_eq!(at(&moved, &v, 230.0, 230.0), [255, 255, 255], "and not where it was");
	assert!(engine.page.history.undo(&mut engine.page.doc.clone()).is_none(), "nothing went into undo");
	assert_eq!(engine.page.tiles.len(), tiles, "no tile was added for the steps");
	engine.preview("null").unwrap();
	engine.apply(r#"[{"op":"set","id":"dot","key":"x","value":300}]"#, true).unwrap();
	engine.put_down();
	let saved = engine.pixels(&v).unwrap().0;
	assert_eq!(at(&saved, &v, 330.0, 230.0), [0x14, 0x80, 0x6f], "saved where it was dropped");
	assert!(engine.page.lifted.is_empty(), "the worker's tiles carry it again");
	assert_eq!(engine.pick(330.0, 230.0, 0.0)["id"], "dot");
}

/// The whole drawing arriving again keeps the tiles on screen until new ones replace them.
#[test]
fn a_new_document_does_not_blank_the_canvas() {
	let Some(mut engine) = engine_for("notes-and-text") else { return };
	let v = view();
	engine.pixels(&v).unwrap();
	let pen = std::fs::read_to_string(drawing("notes-and-text", "pen")).unwrap();
	engine.set_document(&pen).unwrap();
	assert!(!engine.page.tiles.is_empty(), "the page still holds its tiles");
	let again = engine.pixels(&v).unwrap().0;
	assert_eq!(at(&again, &v, 230.0, 230.0), [0x14, 0x80, 0x6f]);
}
