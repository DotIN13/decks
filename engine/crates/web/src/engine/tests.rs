//! The page's and the worker's engines, tested together on a recording backend and the GPU.

use super::*;
use stage_paint::{Backend, Recording, Target, TextureKind};

#[test]
fn a_closed_picture_is_not_copied_and_a_big_one_keeps_what_fits() {
	assert_eq!(copy_extent((0, 0), (1920, 1080)), None, "a closed ImageBitmap reads as 0 × 0");
	assert_eq!(copy_extent((1920, 0), (1920, 1080)), None);
	assert_eq!(copy_extent((1920, 1080), (1920, 1080)), Some((1920, 1080)));
	assert_eq!(copy_extent((8000, 1080), (4096, 4096)), Some((4096, 1080)));
}

const STAGE: &str = r##"{"version":"2.14","children":[
	{"type":"rectangle","id":"a","x":10,"y":10,"width":100,"height":100,"fill":"#f00"},
	{"type":"browser","id":"board","x":600,"y":0,"width":400,"height":300,"url":"boards/x.html"}
]}"##;

/// The whole loop: the page edits, the worker repaints what the edit touched, the page shows it.
/// A resize reshapes a shape's outline with it: the page lifts the outline too, and says so, so
/// the stage puts it down at the drop. Kept back, it was drawn over the tiles, and over its words.
#[test]
fn a_resize_says_it_lifted_the_outline() {
	let stage = r##"{"version":"2.6","children":[
		{"type":"frame","id":"f","x":0,"y":0,"width":200,"height":80,"layout":"vertical","children":[
			{"type":"path","id":"o","layoutPosition":"absolute","x":0,"y":0,"width":200,"height":80,"geometry":"M0 0H200V80H0Z","fill":"#e8590c"},
			{"type":"text","id":"t","content":"Words","width":"fill_container"}
		]}
	]}"##;
	let mut page = Page::new(stage, false, "s").unwrap();
	page.lift(&["f".into()]);
	let wide = |id: &str| (id.to_owned(), Preview { dx: 0.0, dy: 0.0, set: vec![("width".into(), Some(json!(300)))] });
	let lifted = page.preview(Some(vec![wide("f"), wide("o")])).unwrap();
	assert_eq!(lifted, vec!["o".to_owned()], "the outline, which the stage did not lift");
	assert!(page.preview(Some(vec![wide("f"), wide("o")])).unwrap().is_empty(), "lifted once");
	page.landed(&["f".into(), "o".into()]);
	assert!(page.lifted.is_empty());
}

#[test]
fn a_drag_bends_the_arrows_on_what_it_carries() {
	let stage = r#"{"version":"2.6","children":[
		{"type":"rectangle","id":"a","x":0,"y":0,"width":100,"height":60},
		{"type":"rectangle","id":"b","x":300,"y":0,"width":100,"height":60},
		{"type":"rectangle","id":"c","x":0,"y":300,"width":100,"height":60},
		{"type":"path","id":"ab","x":98,"y":24,"width":204,"height":12,"geometry":"M2 6 L202 6","strokeWidth":2,"metadata":{"type":"decks.arrow","from":"a","to":"b"}},
		{"type":"path","id":"bc","x":0,"y":0,"width":10,"height":10,"geometry":"M0 0 L10 10","strokeWidth":2,"metadata":{"type":"decks.arrow","from":"b","to":"c","route":"elbow"}}
	]}"#;
	let mut page = Page::new(stage, false, "s").unwrap();
	let geometry = |page: &Page, id: &str| page.doc.get(id).unwrap().props.get("geometry").cloned();
	let before = geometry(&page, "ab");
	page.lift(&["a".into()]);
	let lifted = page.preview(Some(vec![("a".into(), Preview { dx: 0.0, dy: 200.0, set: vec![] })])).unwrap();
	assert_eq!(lifted, vec!["ab".to_owned()], "only the arrow joined to what moves is lifted");
	// Routed as pen routes it, from where the moved box is now.
	let find = |id: &str| match id { "a" => Some(Rect { x: 0.0, y: 200.0, w: 100.0, h: 60.0 }), "b" => Some(Rect { x: 300.0, y: 0.0, w: 100.0, h: 60.0 }), _ => None };
	let meta = json!({"type":"decks.arrow","from":"a","to":"b"});
	let want = arrows::shape(&arrows::points(&meta, &find).unwrap(), 2.0, arrows::Route::Straight, arrows::Heads::End);
	assert_eq!(geometry(&page, "ab"), Some(json!(want.geometry)));
	// A second step lifts nothing new and keeps routing.
	assert!(page.preview(Some(vec![("a".into(), Preview { dx: 0.0, dy: 210.0, set: vec![] })])).unwrap().is_empty());
	assert_ne!(geometry(&page, "ab"), Some(json!(want.geometry)));
	// Let go: the arrow is the document's again, still drawn here until its tiles come.
	page.preview(None).unwrap();
	assert_eq!(geometry(&page, "ab"), before);
	assert!(page.lifted.contains("ab"));
}

/// An edit routes the arrows it touches as the server will, from the laid-out drawing after it,
/// and leaves the others as the server routed them; an arrow a gesture holds is left to the gesture.
#[test]
fn an_edit_routes_the_arrows_it_touches_as_the_server_does() {
	let stage = r#"{"version":"2.6","children":[
		{"type":"rectangle","id":"a","x":0,"y":0,"width":100,"height":60},
		{"type":"rectangle","id":"b","x":300,"y":0,"width":100,"height":60},
		{"type":"rectangle","id":"c","x":0,"y":300,"width":100,"height":60},
		{"type":"path","id":"ab","x":98,"y":24,"width":204,"height":12,"geometry":"M2 6 L202 6","strokeWidth":2,"metadata":{"type":"decks.arrow","from":"a","to":"b"}},
		{"type":"path","id":"bc","x":0,"y":0,"width":10,"height":10,"geometry":"M0 0 L10 10","strokeWidth":2,"metadata":{"type":"decks.arrow","from":"b","to":"c","route":"elbow"}}
	]}"#;
	let mut page = Page::new(stage, false, "s").unwrap();
	let field = |page: &Page, id: &str, key: &str| page.doc.get(id).unwrap().props.get(key).cloned();
	let set = |id: &str, key: &str, value: Value| stage_doc::edits::Edit::Set { id: id.into(), key: key.into(), value: Some(value) };
	// A field that moves nothing leaves every arrow, the wrongly placed `bc` included.
	page.apply_edits(&[set("c", "fill", json!("#f00"))]).unwrap();
	assert_eq!(field(&page, "ab", "geometry"), Some(json!("M2 6 L202 6")));
	assert_eq!(field(&page, "bc", "geometry"), Some(json!("M0 0 L10 10")));
	// Moving `c` routes `bc` from where `c` is now, elbowed as the server would, and leaves `ab`.
	page.apply_edits(&[set("c", "y", json!(400))]).unwrap();
	let find = |id: &str| match id { "b" => Some(Rect { x: 300.0, y: 0.0, w: 100.0, h: 60.0 }), "c" => Some(Rect { x: 0.0, y: 400.0, w: 100.0, h: 60.0 }), _ => None };
	let meta = json!({"type":"decks.arrow","from":"b","to":"c","route":"elbow"});
	let want = arrows::shape(&arrows::points(&meta, &find).unwrap(), 2.0, arrows::Route::Elbow, arrows::Heads::End);
	assert_eq!(field(&page, "bc", "geometry"), Some(json!(want.geometry)));
	assert_eq!(field(&page, "bc", "x"), Some(json!(arrows::round(want.x))));
	assert_eq!(field(&page, "bc", "strokeLinecap"), Some(json!("round")), "the fields the server fills in");
	assert_eq!(field(&page, "ab", "geometry"), Some(json!("M2 6 L202 6")), "an arrow away from what moved is left");
	// An arrow a gesture holds lifted is routed too: its drop's edit arrives with the lift still on.
	page.lift(&["ab".into()]);
	page.apply_edits(&[set("a", "y", json!(100))]).unwrap();
	assert_ne!(field(&page, "ab", "geometry"), Some(json!("M2 6 L202 6")));
}

#[test]
fn a_picture_arriving_repaints_the_tiles_painted_without_it() {
	// Two pictures in a 2,000 by 1,500 frame on a 1:1 screen: one on tile (0, 0), one on tiles (1, 1) and (2, 1).
	let stage = r##"{"version":"2.14","children":[{"type":"frame","id":"big","layout":"none","x":0,"y":0,"width":2000,"height":1500,"fill":"#eeeeee","children":[
		{"type":"rectangle","id":"a","x":60,"y":60,"width":200,"height":150,"fill":{"type":"image","url":"a.png","mode":"fill"}},
		{"type":"rectangle","id":"b","x":900,"y":600,"width":300,"height":200,"fill":{"type":"image","url":"b.png","mode":"fill"}}]}]}"##;
	let mut worker = Worker::new(stage, false).unwrap();
	let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
	let paint_all = |worker: &mut Worker| {
		let mut keys = std::collections::BTreeSet::new();
		loop {
			let batch = worker.next(cam, 1.0, 2048.0, 1536.0, false, 64);
			if batch.is_empty() {
				return keys;
			}
			for (key, _) in batch {
				worker.sent(key);
				keys.insert((key.x, key.y));
			}
		}
	};
	assert!(paint_all(&mut worker).len() >= 12);
	let mut wanted = worker.pictures.take_wanted();
	wanted.sort();
	assert_eq!(wanted, ["a.png", "b.png"]);
	worker.picture("b.png", 0x8000_0001, 800, 600);
	assert_eq!(paint_all(&mut worker), [(1, 1), (2, 1)].into_iter().collect());
	worker.picture("a.png", 0x8000_0002, 800, 600);
	assert_eq!(paint_all(&mut worker), [(0, 0)].into_iter().collect());
	// A picture nothing painted was waiting for repaints nothing.
	worker.picture("c.png", 0x8000_0003, 800, 600);
	assert!(paint_all(&mut worker).is_empty());
}

#[test]
fn a_change_inside_a_big_frame_repaints_the_change_not_the_frame() {
	// A 2,000 px frame of sixteen squares on a 1:1 screen of 2,048 by 1,536: the window's tiles are 4 by 3
	// (and the overview's are the same ones here).
	let squares: Vec<String> = (0..16).map(|i| format!(r##"{{"type":"rectangle","id":"s{i}","x":{},"y":{},"width":100,"height":100,"fill":"#88aaff"}}"##, 60 + (i % 4) * 480, 60 + (i / 4) * 360)).collect();
	let stage = format!(r##"{{"version":"2.14","children":[{{"type":"frame","id":"big","layout":"none","x":0,"y":0,"width":2000,"height":1500,"fill":"#eeeeee","children":[{}]}}]}}"##, squares.join(","));
	let mut worker = Worker::new(&stage, false).unwrap();
	let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
	let mut paint_all = |worker: &mut Worker| {
		let mut keys = std::collections::BTreeSet::new();
		loop {
			let batch = worker.next(cam, 1.0, 2048.0, 1536.0, false, 64);
			if batch.is_empty() {
				return keys;
			}
			for (key, _) in batch {
				worker.sent(key);
				keys.insert((key.x, key.y));
			}
		}
	};
	paint_all(&mut worker);
	let edit = |worker: &mut Worker, json: &str| {
		let list: Vec<Value> = serde_json::from_str(json).unwrap();
		let edits: Vec<_> = list.iter().map(|v| stage_doc::edits::Edit::from_json(v).unwrap()).collect();
		worker.apply_edits(&edits).unwrap();
	};
	assert!(paint_all(&mut worker).is_empty());
	// One square's colour: the two tiles it is on (540 to 640 across, 420 to 520 down).
	edit(&mut worker, r##"[{"op":"set","id":"s5","key":"fill","value":"#ff0000"}]"##);
	assert_eq!(paint_all(&mut worker), [(1, 0), (1, 1)].into_iter().collect());
	// The frame's own colour: every tile it covers, in the window and the margin painted round it.
	edit(&mut worker, r##"[{"op":"set","id":"big","key":"fill","value":"#dddddd"}]"##);
	let whole = paint_all(&mut worker).len();
	assert!(whole >= 12, "{whole}");
	// A square moved: where it was and where it went.
	edit(&mut worker, r##"[{"op":"set","id":"s0","key":"x","value":1500}]"##);
	assert_eq!(paint_all(&mut worker), [(0, 0), (2, 0), (3, 0)].into_iter().collect());
	// A square added: the frame's whole extent, as before (its items changed).
	edit(&mut worker, r##"[{"op":"insert","id":"s16","parent":"big","after":"s15","props":{"type":"rectangle","x":10,"y":10,"width":5,"height":5}}]"##);
	assert_eq!(paint_all(&mut worker).len(), whole);
}

#[test]
fn fonts_and_icons_that_come_together_are_laid_out_and_painted_once_at_the_next_paint() {
	let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fonts");
	let Ok(inter) = std::fs::read(format!("{dir}/inter_latest_latin-400-normal.ttf")) else { return };
	let stage = r##"{"version":"2.14","children":[
		{"type":"text","id":"t","x":0,"y":0,"width":1800,"textGrowth":"fixed-width","fontSize":40,"fontFamily":"Inter","content":"Words across the whole window"},
		{"type":"rectangle","id":"r","x":0,"y":900,"width":1800,"height":200,"fill":"#88aaff"}
	]}"##;
	let mut worker = Worker::new(stage, false).unwrap();
	let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
	let mut paint_all = |worker: &mut Worker| {
		let mut painted = 0;
		loop {
			let batch = worker.next(cam, 1.0, 2048.0, 1536.0, false, 64);
			if batch.is_empty() {
				return painted;
			}
			for (key, _) in batch {
				worker.sent(key);
				painted += 1;
			}
		}
	};
	let first = paint_all(&mut worker);
	assert!(first > 0);
	// Three fonts and an icon before the next paint: nothing is laid out or marked as each comes,
	// then the stage is laid out once and each tile painted once.
	worker.add_font("Inter", inter.clone(), false);
	worker.add_font("Inter Ext", inter.clone(), false);
	worker.icon("lucide|x|400", IconShape { view_box: [0.0, 0.0, 24.0, 24.0], parts: Vec::new() });
	worker.add_font("Noto Sans", inter, true);
	assert!(worker.grid.tiles.values().all(|t| !t.dirty));
	assert_eq!(paint_all(&mut worker), first);
	assert_eq!(paint_all(&mut worker), 0);
}

#[test]
fn a_lifted_arrow_repaints_only_the_tiles_its_line_crosses_on_screen() {
	// The arrow measured on the tile-repaint board: 7,804 by 6,045 px of box, three thin lines.
	let stage = r##"{"version":"2.6","children":[
		{"type":"rectangle","id":"b","x":9400,"y":9000,"width":120,"height":70,"fill":"#f5a34c"},
		{"type":"path","id":"long","x":1598,"y":2992,"width":7804,"height":6045,"viewBox":[0,0,7804,6045],"stroke":"#4a5568","strokeWidth":2,
			"geometry":"M7802 6043 L3902 6043 L3902 8 L2 8 M12 2 L2 8 L12 14","metadata":{"type":"decks.arrow","from":"b","to":[1600,3000],"route":"elbow"}}
	]}"##;
	let mut page = Page::new(stage, false, "s").unwrap();
	let mut worker = Worker::new(stage, false).unwrap();
	let cam = Camera { x: 8200.0, y: 8350.0, zoom: 1.0 };
	let mut gpu = Recording::default();
	let mut paint_all = |worker: &mut Worker| {
		let mut keys = Vec::new();
		loop {
			let batch = worker.next(cam, 1.0, 1400.0, 900.0, false, 64);
			if batch.is_empty() {
				return keys;
			}
			for (key, list) in batch {
				let t = page.tile_texture(key);
				gpu.texture(t, TextureKind::Color, TILE, TILE, None);
				gpu.draw(Target::Texture(t), &list);
				worker.sent(key);
				keys.push(key);
			}
		}
	};
	paint_all(&mut worker);
	worker.lift(&["long".into()]);
	let lifted = paint_all(&mut worker);
	// The bottom line runs along tile row 17 (y 8704 to 9216): three of its tiles are on screen.
	assert_eq!(lifted.iter().map(|k| (k.x, k.y)).collect::<Vec<_>>().len(), 3, "{lifted:?}");
	assert!(lifted.iter().all(|k| k.y == 17 && (16..=18).contains(&k.x)), "{lifted:?}");
	// Put down: those three with it again, the one margin tile it crosses, and the overview's tiles
	// (2,048 px here) along its three lines: 8, where its box covers 20. Then nothing more.
	worker.drop_items(&["long".into()]);
	let dropped = paint_all(&mut worker);
	let screen: Vec<(i32, i32)> = dropped.iter().filter(|k| k.scale() == 1.0).map(|k| (k.x, k.y)).collect();
	let overview: std::collections::BTreeSet<(i32, i32)> = dropped.iter().filter(|k| k.scale() != 1.0).map(|k| (k.x, k.y)).collect();
	assert!(screen.len() == 4 && screen.iter().all(|&(x, y)| y == 17 && (15..=18).contains(&x)), "{screen:?}");
	assert_eq!(overview, [(0, 1), (1, 1), (2, 1), (2, 2), (2, 3), (2, 4), (3, 4), (4, 4)].into_iter().collect(), "{dropped:?}");
	assert!(paint_all(&mut worker).is_empty());
}

#[test]
fn the_layout_is_told_as_it_changed() {
	let doc = r#"{"version":"2.14","children":[
		{"type":"rectangle","id":"a","x":0,"y":0,"width":100,"height":100},
		{"type":"frame","id":"f","layout":"none","x":300,"y":0,"width":200,"height":200,"children":[{"type":"rectangle","id":"k","x":10,"y":10,"width":20,"height":20}]},
		{"type":"ellipse","id":"e","x":600,"y":0,"width":50,"height":50}]}"#;
	let mut page = Page::new(doc, false, "s").unwrap();
	let ids = |v: &Value, key: &str| -> Vec<String> { v[key].as_array().unwrap().iter().map(|r| if r.is_string() { r.as_str().unwrap().to_owned() } else if r.is_array() { r[0].as_str().unwrap().to_owned() } else { r["id"].as_str().unwrap().to_owned() }).collect() };
	let first = page.layout_changes();
	assert_eq!(first["all"], true, "the first time, read whole");
	assert_eq!(ids(&first, "roots").len(), 0);
	let none = page.layout_changes();
	assert_eq!((none["all"].as_bool(), ids(&none, "roots").len(), ids(&none, "removed").len(), ids(&none, "bases").len()), (Some(false), 0, 0, 0));
	// A child edited: only its top-level item, with the child where it went.
	let edit = |page: &mut Page, json: &str| {
		let list: Vec<Value> = serde_json::from_str(json).unwrap();
		let edits: Vec<_> = list.iter().map(|v| stage_doc::edits::Edit::from_json(v).unwrap()).collect();
		page.apply_edits(&edits).unwrap();
	};
	edit(&mut page, r#"[{"op":"set","id":"k","key":"x","value":50}]"#);
	let one = page.layout_changes();
	assert_eq!(one["all"], false);
	assert_eq!(ids(&one, "roots"), ["f"]);
	assert_eq!(one["roots"][0]["items"][1][1], 350.0);
	// A drag's step that bends nothing re-lays nothing.
	page.preview(Some(vec![("a".into(), Preview { dx: 50.0, dy: 0.0, set: vec![] })])).unwrap();
	assert_eq!(ids(&page.layout_changes(), "roots").len(), 0);
	page.preview(None).unwrap();
	// A child added: the frame again, and the ellipse after it starts one later.
	edit(&mut page, r#"[{"op":"insert","id":"k2","parent":"f","after":"k","props":{"type":"rectangle","width":5,"height":5}}]"#);
	let more = page.layout_changes();
	assert_eq!(ids(&more, "roots"), ["f"]);
	assert_eq!(more["bases"], json!([["e", 4]]));
	// A top-level item gone, one new at the end.
	edit(&mut page, r#"[{"op":"remove","id":"a"},{"op":"insert","id":"n","parent":null,"after":"e","props":{"type":"rectangle","width":5,"height":5}}]"#);
	let swap = page.layout_changes();
	assert_eq!(ids(&swap, "removed"), ["a"]);
	assert_eq!(ids(&swap, "roots"), ["n"]);
	assert_eq!(swap["roots"][0]["base"], 4);
	assert_eq!(swap["bases"], json!([["f", 0], ["e", 3]]));
	// A new document: everything again.
	page.set_document(doc).unwrap();
	let again = page.layout_changes();
	assert_eq!(again["all"], true);
	// One root changed of three: told root by root, with its items and their place in it.
	edit(&mut page, r#"[{"op":"set","id":"e","key":"x","value":700}]"#);
	let e = page.layout_changes();
	assert_eq!((e["all"].as_bool(), ids(&e, "roots")), (Some(false), vec!["e".to_owned()]));
	assert_eq!(e["roots"][0]["base"], 3);
	assert_eq!(e["roots"][0]["items"][0][6], 0);
}

#[test]
fn page_and_worker_stay_in_step() {
	let mut page = Page::new(STAGE, false, "s").unwrap();
	let mut worker = Worker::new(STAGE, false).unwrap();
	let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
	let mut gpu = Recording::default();
	let paint_all = |worker: &mut Worker, page: &mut Page, gpu: &mut Recording| {
		let mut n = 0;
		for (key, list) in worker.next(cam, 1.0, 1200.0, 800.0, false, 64) {
			let t = page.tile_texture(key);
			gpu.texture(t, TextureKind::Color, TILE, TILE, None);
			gpu.draw(Target::Texture(t), &list);
			worker.sent(key);
			n += 1;
		}
		n
	};
	let first = paint_all(&mut worker, &mut page, &mut gpu);
	assert!(first >= 6, "{first}");
	assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 0, "nothing changed, nothing to paint");
	let changes = crate::wire::parse(r#"[{"op":"set","id":"a","key":"x","value":1100}]"#).unwrap();
	let generation = page.apply(&changes, true).unwrap();
	worker.apply(&changes, generation).unwrap();
	// The tile the square left, the tile it went to, and the overview's tile under both.
	assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 3);
	assert_eq!(page.pick(1150.0, 50.0, 0.0)["id"], "a");
	// A missed batch is noticed.
	assert!(worker.apply(&changes, generation + 5).is_err());
	// No boards placed yet: only tiles.
	let over = page.frame(cam, 1.0, 1200.0, 800.0, 0);
	assert!(over.ops.iter().all(|op| matches!(op, Op::Picture { .. })));
	// A drag: the worker repaints its tile on screen without the square, and the page draws it. The
	// overview's tile waits for the drop: nothing shows it during a drag.
	page.lift(&["a".into()]);
	worker.lift(&["a".into()]);
	assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 1);
	// The drag's moves are the page's alone: the worker paints nothing.
	page.preview(Some(vec![("a".into(), Preview { dx: 50.0, dy: 0.0, set: vec![] })])).unwrap();
	assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 0, "moving a lifted item paints no tiles");
	let over = page.frame(cam, 1.0, 1200.0, 800.0, 0);
	assert!(over.ops.iter().any(|op| matches!(op, Op::Shape { .. })), "the page draws it");
	// Let go: saved, and the saved drawing is what both draw.
	let saved = crate::wire::parse(r#"[{"op":"set","id":"a","key":"x","value":1150}]"#).unwrap();
	page.preview(None).unwrap();
	let generation = page.apply(&saved, true).unwrap();
	worker.apply(&saved, generation).unwrap();
	worker.drop_items(&["a".into()]);
	assert!(worker.landed().is_empty());
	assert_eq!(paint_all(&mut worker, &mut page, &mut gpu), 2);
	assert_eq!(worker.landed(), vec!["a".to_owned()]);
	assert_eq!(page.cards()[0]["id"], "board");
}

#[test]
fn an_item_put_down_just_before_a_zoom_lands_at_the_new_scale() {
	let mut worker = Worker::new(STAGE, false).unwrap();
	let paint = |worker: &mut Worker, zoom: f64| {
		let cam = Camera { x: 0.0, y: 0.0, zoom };
		let keys: Vec<Key> = worker.next(cam, 1.0, 1200.0, 800.0, false, 256).into_iter().map(|(key, _)| key).collect();
		for key in &keys {
			worker.sent(*key);
		}
		keys.len()
	};
	assert!(paint(&mut worker, 2.0) > 0);
	// Lifted and put down at 200%, then a zoom to 600% before the 200% tiles are painted again:
	// those are no longer wanted, so the item must not wait on them to land.
	worker.lift(&["a".into()]);
	worker.drop_items(&["a".into()]);
	assert!(worker.landed().is_empty());
	assert!(paint(&mut worker, 6.0) > 0);
	while paint(&mut worker, 6.0) > 0 {}
	assert_eq!(worker.landed(), vec!["a".to_owned()], "landed once the tiles of the scale shown have it");
}

/// A sleeping card's picture has its item's corners, as the drawing's hole for it does; 12 with none.
#[test]
fn a_cards_picture_has_its_items_corners() {
	let doc = r##"{"version":"2.14","children":[{"type":"browser","id":"sq","x":0,"y":0,"width":400,"height":300,"url":"u","cornerRadius":[0,4,8,200]},{"type":"browser","id":"plain","x":500,"y":0,"width":400,"height":300,"url":"v"}]}"##;
	let page = Page::new(doc, false, "s").unwrap();
	assert_eq!(page.card_radii("sq", 400.0, 300.0), [0.0, 4.0, 8.0, 150.0], "its own, none rounder than half its shorter side");
	assert_eq!(page.card_radii("plain", 400.0, 300.0), [12.0; 4]);
	assert_eq!(page.card_radii("gone", 400.0, 300.0), [12.0; 4]);
}

/// A carried card that frames itself has its shadow drawn under its picture and its outline over it, where the drag has it.
#[test]
fn a_carried_card_takes_its_frame_with_it() {
	let doc = r##"{"version":"2.14","children":[{"type":"browser","id":"b","x":0,"y":0,"width":400,"height":300,"url":"u","cornerRadius":0,"stroke":"#ff0000","strokeWidth":6,"effect":{"type":"shadow","offset":{"x":0,"y":0},"blur":0,"spread":14,"color":"#0000ff"}}]}"##;
	let mut page = Page::new(doc, false, "s").unwrap();
	page.cards = vec![CardPlace { path: "p".into(), id: "b".into(), picture: "card:p".into(), x: 0.0, y: 0.0, w: 400.0, h: 300.0, live: true, news: None, glow: false, title: String::new(), kind: "card".into(), status: String::new(), corners: Some([0.0; 4]) }];
	let cam = Camera { x: -100.0, y: -100.0, zoom: 1.0 };
	page.carry = (["p".to_owned()].into_iter().collect(), 50.0, 20.0);
	let over = page.frame(cam, 1.0, 1200.0, 800.0, 0);
	let shadow = over.ops.iter().position(|op| matches!(op, Op::Shadow { .. }));
	let paper = over.ops.iter().position(|op| matches!(op, Op::Shape { stroke: None, .. }));
	let outline = over.ops.iter().position(|op| matches!(op, Op::Shape { stroke: Some(_), .. }));
	assert!(matches!((shadow, paper, outline), (Some(a), Some(b), Some(c)) if a < b && b < c), "shadow, then its paper, then its outline: {shadow:?} {paper:?} {outline:?}");
	let Some(Op::Shadow { transform, .. }) = over.ops.iter().find(|op| matches!(op, Op::Shadow { .. })) else { panic!() };
	assert_eq!(transform.apply(0.0, 0.0), (150.0, 120.0), "where the drag has it");
	// At 40%: the outline round the picture, at the picture's place on the screen.
	let cam = Camera { x: -100.0, y: -100.0, zoom: 0.4 };
	let over = page.frame(cam, 1.0, 1200.0, 800.0, 0);
	let picture_at = over.ops.iter().find_map(|op| match op { Op::Shape { stroke: None, transform, .. } => Some(transform.apply(0.0, 0.0)), _ => None }).unwrap();
	let Some(Op::Shape { transform, shape, .. }) = over.ops.iter().find(|op| matches!(op, Op::Shape { stroke: Some(_), .. })) else { panic!() };
	assert_eq!(transform.apply(0.0, 0.0), picture_at, "the outline where the picture is");
	assert!((transform.apply(shape.w, shape.h).0 - picture_at.0 - 160.0).abs() < 1.0, "and as wide: {:?} {shape:?}", transform);
	// A dashed outline, carried, is plain shapes and no mesh: a mesh in the frame draws the whole canvas with four samples a pixel.
	let dashed = r##"{"version":"2.14","children":[{"type":"browser","id":"b","x":0,"y":0,"width":400,"height":300,"url":"u","cornerRadius":0,"stroke":"#ffffff","strokeWidth":2,"strokeDash":"dashed"}]}"##;
	let mut dpage = Page::new(dashed, false, "s").unwrap();
	dpage.cards = page.cards.clone();
	dpage.carry = (["p".to_owned()].into_iter().collect(), 50.0, 20.0);
	let over = dpage.frame(cam, 1.0, 1200.0, 800.0, 0);
	assert!(!over.ops.iter().any(|op| matches!(op, Op::Mesh { .. })), "no mesh");
	let bars = over.ops.iter().filter(|op| matches!(op, Op::Shape { shape, .. } if (shape.w.min(shape.h) - 2.0).abs() < 0.01)).count();
	assert!(bars > 40, "a bar per dash round the card: {bars}");
	// Not carried: nothing of its frame here, the tiles have it.
	page.carry = (HashSet::new(), 0.0, 0.0);
	let over = page.frame(cam, 1.0, 1200.0, 800.0, 0);
	assert!(!over.ops.iter().any(|op| matches!(op, Op::Shadow { .. })));
}

#[test]
fn a_sleeping_boards_picture_lies_over_its_page_and_under_the_tiles() {
	let mut page = Page::new(STAGE, false, "s").unwrap();
	let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
	page.tile_texture(Key { scale: 1f32.to_bits(), x: 1, y: 0 });
	page.pictures.held.insert("card:boards/x.html".into(), (900, 400, 300));
	let board = |live| CardPlace { path: "boards/x.html".into(), id: "x".into(), picture: "card:boards/x.html".into(), x: 600.0, y: 0.0, w: 400.0, h: 300.0, live, news: None, glow: false, title: String::new(), kind: String::new(), status: String::new(), corners: None };
	page.cards = vec![board(false)];
	let over = page.frame(cam, 1.0, 1200.0, 800.0, 0);
	let picture = over.ops.iter().position(|op| matches!(op, Op::Shape { paint: stage_paint::list::Paint::Image { texture: 900, .. }, .. }));
	let tile = over.ops.iter().position(|op| matches!(op, Op::Picture { .. }));
	assert!(matches!((picture, tile), (Some(p), Some(t)) if p < t), "the picture first, then the tiles: {picture:?} {tile:?}");
	assert_eq!(page.pictured, vec!["boards/x.html".to_owned()]);
	// The marks move only when what is pictured does: a frame the same as the last leaves them.
	let marks = page.marks;
	page.frame(cam, 1.0, 1200.0, 800.0, 0);
	assert_eq!(page.marks, marks);
	// Live: its page shows through the tiles' hole, with nothing of the board drawn.
	page.cards = vec![board(true)];
	let over = page.frame(cam, 1.0, 1200.0, 800.0, 0);
	assert!(over.ops.iter().all(|op| matches!(op, Op::Picture { .. })));
	assert!(page.pictured.is_empty());
	assert_ne!(page.marks, marks);
}

#[test]
fn a_tile_on_screen_is_never_evicted() {
	let mut page = Page::new(STAGE, false, "s").unwrap();
	let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
	// The window's own tiles, drawn in a frame.
	for key in Grid::covering(&Rect { x: 0.0, y: 0.0, w: 1200.0, h: 800.0 }, 1.0, 0) {
		page.tile_texture(key);
	}
	let on_screen = page.tiles.len();
	page.frame(cam, 1.0, 1200.0, 800.0, 0);
	// Far more tiles than the budget arrive elsewhere.
	for x in 0..400 {
		page.tile_texture(Key { scale: 1f32.to_bits(), x: 100 + x, y: 50 });
	}
	page.frame(Camera { x: 0.0, y: 0.0, zoom: 1.0 }, 1.0, 1200.0, 800.0, 0);
	let gone = page.evict();
	assert!(!gone.is_empty());
	for key in Grid::covering(&Rect { x: 0.0, y: 0.0, w: 1200.0, h: 800.0 }, 1.0, 0) {
		assert!(page.tiles.contains_key(&key), "a tile on screen was evicted");
	}
	assert!(on_screen > 0);
}

#[test]
fn a_new_level_is_shown_only_once_it_covers_the_window_and_then_alone() {
	let mut page = Page::new(STAGE, false, "s").unwrap();
	let view = Rect { x: 0.0, y: 0.0, w: 1200.0, h: 800.0 };
	let one = 2f32.to_bits();
	let two = 4f32.to_bits();
	for key in Grid::covering(&view, 2.0, 0) {
		page.tile_texture(key);
	}
	let cam = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
	let textures = |page: &Page, over: &DrawList| -> HashSet<u32> {
		let scale_of: HashMap<u32, u32> = page.tiles.iter().map(|(k, (t, _))| (*t, k.scale)).collect();
		over.ops.iter().filter_map(|op| if let Op::Picture { texture, .. } = op { scale_of.get(texture).copied() } else { None }).collect()
	};
	let over = page.frame(cam, 2.0, 1200.0, 800.0, one);
	assert_eq!(page.shown_scale(), one);
	assert_eq!(textures(&page, &over), [one].into());
	// The zoom asks for scale 4: its tiles come one by one, unseen, the level shown stretched.
	let wanted = Grid::covering(&view, 4.0, 0);
	for key in &wanted[..wanted.len() - 1] {
		page.tile_texture(*key);
		let over = page.frame(cam, 2.0, 1200.0, 800.0, two);
		assert_eq!(textures(&page, &over), [one].into(), "no patchwork of two levels");
	}
	assert!(page.evict().is_empty());
	// The last one: the new level is shown whole, in one frame, and the old one let go.
	page.tile_texture(*wanted.last().unwrap());
	let over = page.frame(cam, 2.0, 1200.0, 800.0, two);
	assert_eq!(page.shown_scale(), two);
	assert_eq!(textures(&page, &over), [two].into());
	// The old level is kept unseen, for a zoom back.
	assert!(page.tiles.keys().any(|k| k.scale == one));
	// Tiles that stop coming are shown anyway when the page says so.
	let three = 3f32.to_bits();
	page.tile_texture(Key { scale: three, x: 0, y: 0 });
	page.frame(cam, 2.0, 1200.0, 800.0, three);
	assert_eq!(page.shown_scale(), two);
	page.show_wanted();
	page.frame(cam, 2.0, 1200.0, 800.0, three);
	assert_eq!(page.shown_scale(), three);
}

#[test]
fn a_zoom_out_shows_the_sharper_tiles_until_its_own_come() {
	let mut page = Page::new(STAGE, false, "s").unwrap();
	let mut worker = Worker::new(STAGE, false).unwrap();
	let near = Camera { x: 0.0, y: 0.0, zoom: 1.0 };
	for (key, _) in worker.next(near, 1.0, 1200.0, 800.0, false, 64) {
		if key.scale() == 1.0 {
			page.tile_texture(key);
		}
	}
	// Zoomed out to a fifth: no tile at that scale or coarser is held, only the ones at 1.
	let far = Camera { x: -2000.0, y: -2000.0, zoom: 0.2 };
	let over = page.frame(far, 1.0, 1200.0, 800.0, scale_for(0.2, true).to_bits());
	let pictures = over.ops.iter().filter(|op| matches!(op, Op::Picture { .. })).count();
	assert!(pictures >= 6, "the sharper tiles stand in: {pictures}");
}

// Bending arrows and the glyph texture under load: a check of glyphs through a zoom, and two measures.
mod bend_bench {
	use super::*;

	/// `STAGE_BENCH=path/to/stage.pen cargo test --release -p stage-web bend_cost -- --ignored --nocapture`:
	/// a box with ten arrows joined to it, added to a real stage, dragged 200 steps.
	#[test]
	#[ignore]
	fn bend_cost() {
		let path = std::env::var("STAGE_BENCH").expect("STAGE_BENCH");
		let mut doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
		let children = doc["children"].as_array_mut().unwrap();
		let items = children.len();
		children.push(json!({"type":"rectangle","id":"bench-hub","x":-5000,"y":-5000,"width":140,"height":80}));
		for k in 0..10 {
			let (x, y) = (-5600.0 + 130.0 * k as f64, -4600.0 - 40.0 * (k % 3) as f64);
			children.push(json!({"type":"rectangle","id":format!("bench-{k}"),"x":x,"y":y,"width":100,"height":60}));
			let route = ["straight", "curved", "elbow"][k % 3];
			children.push(json!({"type":"path","id":format!("bench-a{k}"),"geometry":"M0 0 L1 1","strokeWidth":2,"metadata":{"type":"decks.arrow","from":"bench-hub","to":format!("bench-{k}"),"route":route}}));
		}
		let mut page = Page::new(&doc.to_string(), false, "s").unwrap();
		let t = std::time::Instant::now();
		let first = page.preview(Some(vec![("bench-hub".into(), Preview { dx: 1.0, dy: 1.0, set: vec![] })])).unwrap();
		let first_ms = t.elapsed().as_secs_f64() * 1e3;
		let t = std::time::Instant::now();
		for s in 0..200 {
			page.preview(Some(vec![("bench-hub".into(), Preview { dx: s as f64 * 3.0, dy: (s as f64 * 0.1).sin() * 200.0, set: vec![] })])).unwrap();
		}
		let step_us = t.elapsed().as_secs_f64() * 1e6 / 200.0;
		println!("{items} top-level items; first step {first_ms:.2} ms ({} arrows found); each later step {step_us:.0} µs", first.len());
	}
}

mod glyph_overflow {
	use super::*;

	/// Chinese text zoomed in and out at 2× pixels, as in the report of broken text at 400%: tiles are
	/// painted as the app paints them, and as each is drawn every glyph it uses is checked against a
	/// copy of the glyph texture: it must still be the last thing written where it points.
	/// Returns (tiles drawn, glyphs checked, glyphs pointing at something else).
	pub fn zoom_cycle(worker: &mut Worker, limit: usize) -> (usize, usize, usize) {
		// Each texture's writes, in order: x, y, w, h.
		let mut writes: HashMap<u32, Vec<[u32; 4]>> = HashMap::new();
		let (mut tiles, mut checked, mut wrong) = (0, 0, 0);
		for zoom in [1.0, 2.0, 0.5, 3.0, 4.0, 1.0, 2.5, 4.0, 0.7, 4.0, 3.3, 4.0] {
			for moving in [true, false] {
				// The view's middle stays on the text, as a pinch about it does.
				let (w, h) = (1600.0, 1000.0);
				let cam = Camera { x: 450.0 - w / 2.0 / zoom, y: 300.0 - h / 2.0 / zoom, zoom };
				loop {
					let mut sent = Vec::new();
					worker.paint(cam, 2.0, w, h, moving, limit, &mut |key, list, atlas| {
						for (texture, x, y, w, h, _) in atlas.uploads.drain(..) {
							writes.entry(texture).or_default().push([x, y, w, h]);
						}
						for op in &list.ops {
							let Op::Glyphs { texture, quads, .. } = op else { continue };
							let log = writes.get(texture).map(Vec::as_slice).unwrap_or(&[]);
							for q in quads {
								checked += 1;
								let want = [q.u as u32, q.v as u32, q.w as u32, q.h as u32];
								let meets = |r: &[u32; 4]| r[0] < want[0] + want[2] && want[0] < r[0] + r[2] && r[1] < want[1] + want[3] && want[1] < r[1] + r[3];
								if log.iter().rev().find(|r| meets(r)) != Some(&want) {
									wrong += 1;
								}
							}
						}
						sent.push(key);
					});
					if sent.is_empty() {
						break;
					}
					tiles += sent.len();
					for key in sent {
						worker.sent(key);
					}
				}
			}
		}
		(tiles, checked, wrong)
	}

	pub fn chinese_worker() -> Option<Worker> {
		let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fonts");
		let sc = std::fs::read(format!("{dir}/noto-sans-sc_latest_chinese-simplified-400-normal.ttf")).ok()?;
		let inter = std::fs::read(format!("{dir}/inter_latest_latin-400-normal.ttf")).ok()?;
		// Ten paragraphs of different characters, 17 px, in a 900 px column.
		let para = |p: u32| (0..90u32).map(|i| char::from_u32(0x4E00 + p * 211 + i * 7).unwrap()).collect::<String>();
		let children: Vec<Value> = (0..10u32).map(|p| json!({"type":"text","id":format!("t{p}"),"x":0,"y":p * 80,"width":900,"textGrowth":"fixed-width","fontSize":17,"fontFamily":"Inter","content":para(p)})).collect();
		let stage = json!({"version":"2.6","children":children}).to_string();
		let mut worker = Worker::new(&stage, false).ok()?;
		worker.add_font("Inter", inter, false);
		worker.add_font("Noto Sans SC", sc, true);
		Some(worker)
	}

	#[test]
	fn zooming_chinese_text_in_and_out_never_draws_a_tile_with_another_glyph() {
		let Some(mut worker) = chinese_worker() else { return };
		let (tiles, checked, wrong) = zoom_cycle(&mut worker, 12);
		println!("{tiles} tiles drawn, {checked} glyphs checked, {wrong} pointing at another glyph");
		// A tile asks only for the glyphs that reach it (`Context::glyph_area`), about 8,700 of them
		// here; the texture still fills and empties its bands some twenty times on the way.
		assert!(checked > 5_000, "{checked}");
		assert_eq!(wrong, 0);
	}
}

mod glyph_cost {
	use super::*;

	/// What a zoom back costs when its glyphs are still in the texture, and when they were emptied:
	/// `cargo test --release -p stage-web glyph_cost -- --ignored --nocapture`.
	#[test]
	#[ignore]
	fn glyph_cost() {
		let Some(mut worker) = super::glyph_overflow::chinese_worker() else { return };
		let (w, h) = (1600.0, 1000.0);
		let cam = |zoom: f64| Camera { x: 450.0 - w / 2.0 / zoom, y: 300.0 - h / 2.0 / zoom, zoom };
		let mut screen = |worker: &mut Worker, zoom: f64| -> (f64, usize) {
			worker.grid.invalidate_all();
			let t = std::time::Instant::now();
			let mut n = 0;
			loop {
				let batch = worker.next(cam(zoom), 2.0, w, h, false, 64);
				if batch.is_empty() {
					break;
				}
				for (key, _) in &batch {
					worker.sent(*key);
				}
				n += batch.len();
				worker.atlas.borrow_mut().uploads.clear();
			}
			(t.elapsed().as_secs_f64() * 1e3, n)
		};
		for zoom in [4.0, 2.0, 1.0] {
			worker.atlas.replace(stage_text::atlas::Atlas::new());
			let (cold, n) = screen(&mut worker, zoom);
			let (warm, _) = screen(&mut worker, zoom);
			println!("zoom {zoom}: {n} tiles; glyphs drawn anew {cold:.1} ms, glyphs kept {warm:.1} ms");
		}
		// The case the bands are for: 400%, out to 200% and 100%, and back to 400%.
		worker.atlas.replace(stage_text::atlas::Atlas::new());
		screen(&mut worker, 4.0);
		screen(&mut worker, 2.0);
		screen(&mut worker, 1.0);
		let (back, _) = screen(&mut worker, 4.0);
		println!("back to 400% after 200% and 100%: {back:.1} ms");
	}
}
