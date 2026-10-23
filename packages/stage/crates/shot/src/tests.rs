//! The native picture on this machine's card: what lies over what, what it asks for, and the
//! fixture stages against goldens of their own (`crates/gpu/goldens/shot-*.png`) and against the
//! goldens of the tiles the page draws (`stage-*.png`).

use super::*;
use stage_paint::fixtures;

fn shooter() -> Option<Shooter> {
	let s = Shooter::open();
	if s.is_none() {
		eprintln!("skipped: no graphics card");
	}
	s
}

/// The fonts in `packages/stage/fonts`, handed over as the server would; false when they are not there.
fn with_fonts(s: &mut Shooter) -> bool {
	let dir = format!("{}/../../fonts", env!("CARGO_MANIFEST_DIR"));
	let mut any = false;
	for (family, file, fallback) in fixtures::FONTS {
		if let Ok(bytes) = std::fs::read(format!("{dir}/{file}")) {
			s.add_font(Font { key: file.to_owned(), family: family.to_owned(), bytes: Rc::new(bytes), fallback });
			any = true;
		}
	}
	any
}

fn request(doc: &Value, area: Rect, scale: f64, boards: Vec<Board>) -> Request {
	Request { doc: doc.to_string(), dark: false, area, scale, width: (area.w * scale).round() as u32, height: (area.h * scale).round() as u32, paper: [0.945, 0.945, 0.953], boards, writer: None }
}

fn px(p: &Picture, x: u32, y: u32) -> [u8; 4] {
	let i = ((y * p.width + x) * 4) as usize;
	[p.rgba[i], p.rgba[i + 1], p.rgba[i + 2], p.rgba[i + 3]]
}

fn near(a: [u8; 4], b: [u8; 3], slack: u8) -> bool {
	(0..3).all(|c| a[c].abs_diff(b[c]) <= slack)
}

/// A green picture, written where a board's picture or an image fill would be.
fn green_picture() -> String {
	let path = std::env::temp_dir().join("stage-shot-green.png");
	image::RgbaImage::from_pixel(64, 48, image::Rgba([0, 200, 0, 255])).save(&path).unwrap();
	path.to_string_lossy().into_owned()
}

/// The paper, a board's picture in its place, the drawing over it with a hole for the board, an
/// item under the board hidden by it and one after it drawn over it; at zoom 1, below and above it.
#[test]
fn the_drawing_lies_over_the_boards_with_a_hole_for_each() {
	let Some(mut s) = shooter() else { return };
	let doc = json!({ "version": "2.14", "children": [
		{ "type": "rectangle", "id": "under", "x": 150, "y": 50, "width": 100, "height": 60, "fill": "#ff0000" },
		{ "type": "browser", "id": "board", "x": 200, "y": 20, "width": 160, "height": 120, "url": "boards/x.html" },
		{ "type": "rectangle", "id": "over", "x": 300, "y": 100, "width": 100, "height": 60, "fill": "#0000ff" },
		{ "type": "rectangle", "id": "alone", "x": 20, "y": 160, "width": 80, "height": 30, "fill": "#222222" }
	]});
	let boards = vec![Board { rect: Rect { x: 200.0, y: 20.0, w: 160.0, h: 120.0 }, picture: Some(green_picture()) }];
	for scale in [1.0, 0.5, 2.0] {
		let area = Rect { x: 0.0, y: 0.0, w: 420.0, h: 210.0 };
		let p = s.shoot(&request(&doc, area, scale, boards.clone())).unwrap().unwrap_or_else(|needs| panic!("needs {needs:?}"));
		assert_eq!((p.width, p.height), ((420.0 * scale) as u32, (210.0 * scale) as u32));
		let at = |x: f64, y: f64| px(&p, (x * scale) as u32, (y * scale) as u32);
		assert!(near(at(5.0, 5.0), [241, 241, 243], 1), "paper at {scale}: {:?}", at(5.0, 5.0));
		assert!(near(at(170.0, 80.0), [255, 0, 0], 2), "the red item, left of the board, at {scale}: {:?}", at(170.0, 80.0));
		assert!(near(at(230.0, 80.0), [0, 200, 0], 2), "the board's picture over the item under it, at {scale}: {:?}", at(230.0, 80.0));
		assert!(near(at(330.0, 120.0), [0, 0, 255], 2), "the item after the board, over it, at {scale}: {:?}", at(330.0, 120.0));
		assert!(near(at(60.0, 175.0), [34, 34, 34], 2), "an item alone, at {scale}: {:?}", at(60.0, 175.0));
	}
	// A box that is one item, at zoom 1: the item where it is in the box, the paper round it.
	let p = s.shoot(&request(&doc, Rect { x: 10.0, y: 150.0, w: 100.0, h: 50.0 }, 1.0, Vec::new())).unwrap().ok().unwrap();
	assert!(near(px(&p, 50, 25), [34, 34, 34], 2) && near(px(&p, 5, 5), [241, 241, 243], 1), "an item alone in its box");
	// Dark: the dark paper.
	let mut dark = request(&doc, Rect { x: 10.0, y: 150.0, w: 100.0, h: 50.0 }, 1.0, Vec::new());
	dark.dark = true;
	dark.paper = [16.0 / 255.0; 3];
	let p = s.shoot(&dark).unwrap().ok().unwrap();
	assert!(near(px(&p, 5, 5), [16, 16, 16], 1), "the dark paper: {:?}", px(&p, 5, 5));
}

/// What only the app has is asked for: a card's reading, an image fill, an icon; a formula is named.
#[test]
fn what_the_box_needs_is_asked_for_and_kept_once_handed_over() {
	let Some(mut s) = shooter() else { return };
	with_fonts(&mut s);
	let doc = json!({ "version": "2.14", "children": [
		{ "type": "note", "id": "card", "x": 0, "y": 0, "width": 200, "content": "# Hi\n\nWords", "metadata": { "type": "decks.markdown" } },
		{ "type": "text", "id": "sum", "x": 0, "y": 300, "content": "Area $\\pi r^2$ here" },
		{ "type": "rectangle", "id": "pic", "x": 300, "y": 0, "width": 50, "height": 50, "fill": { "type": "image", "url": "pics/a.png", "mode": "fill" } },
		{ "type": "icon_font", "id": "ic", "x": 300, "y": 100, "width": 24, "height": 24, "iconFontFamily": "lucide", "iconFontName": "star" }
	]});
	let r = request(&doc, Rect { x: -10.0, y: -10.0, w: 400.0, h: 200.0 }, 1.0, Vec::new());
	let needs = s.shoot(&r).unwrap().err().expect("needs first");
	assert_eq!(needs.cards, vec!["# Hi\n\nWords".to_owned()]);
	assert!(needs.math.is_empty(), "the formula is outside this box");
	// Asked again with nothing handed over: still needed (the layout is kept, the need too).
	assert_eq!(s.needs(&r).unwrap().cards.len(), 1);
	let blocks = json!([{ "kind": "heading", "level": 1, "runs": [{ "text": "Hi" }] }, { "kind": "paragraph", "runs": [{ "text": "Words" }] }]);
	s.add_card(false, "# Hi\n\nWords".into(), blocks.to_string());
	let needs = s.shoot(&r).unwrap().err().expect("then the picture and the icon");
	assert!(needs.cards.is_empty(), "the card is read now: {needs:?}");
	assert_eq!(needs.pictures, vec!["pics/a.png".to_owned()]);
	assert_eq!(needs.icons.len(), 1, "{needs:?}");
	let picture = std::fs::read(green_picture()).unwrap();
	s.add_picture("pics/a.png", Some(&picture)).unwrap();
	s.add_icon(&needs.icons[0], None);
	let p = s.shoot(&r).unwrap().ok().expect("drawn once everything is handed over");
	assert!(near(px(&p, 335, 35), [0, 200, 0], 3), "the image fill: {:?}", px(&p, 335, 35));
	// A box over the formula names its item.
	let math = s.shoot(&request(&doc, Rect { x: -10.0, y: 280.0, w: 300.0, h: 60.0 }, 1.0, Vec::new())).unwrap().err().expect("math");
	assert_eq!(math.math, vec!["sum".to_owned()]);
	// A file that is not a picture is said so, and kept as missing.
	assert!(s.add_picture("pics/b.png", Some(b"not a picture")).is_err());
}

fn read_png(path: &str) -> Option<(Vec<u8>, u32, u32)> {
	let img = image::open(path).ok()?.into_rgba8();
	Some((img.as_raw().clone(), img.width(), img.height()))
}

/// The fixture stages, whole, as the server pictures them: each matches its own golden here, and
/// is close to the page's tiles' golden (`stage-*.png`, drawn by `fixtures::draw_stage`), which
/// places each tile to the nearest pixel where this draws at the exact scale.
#[test]
fn fixture_stages_match_their_goldens() {
	let Some(mut s) = shooter() else { return };
	if !with_fonts(&mut s) {
		eprintln!("skipped: no fonts in packages/stage/fonts");
		return;
	}
	s.own_reader = true;
	let goldens = format!("{}/../gpu/goldens", env!("CARGO_MANIFEST_DIR"));
	for name in fixtures::STAGES {
		let pen = std::fs::read_to_string(format!("{}/../gpu/fixtures/{name}.pen", env!("CARGO_MANIFEST_DIR"))).unwrap();
		// The fixture's own framing (`draw_stage`): its drawing's extent, at most 1024 across.
		let doc = Document::parse(&pen).unwrap();
		let mut words = Text::new();
		for (family, file, fallback) in fixtures::FONTS {
			if let Ok(bytes) = std::fs::read(format!("{}/../../fonts/{file}", env!("CARGO_MANIFEST_DIR"))) {
				words.add_font(family, bytes, fallback);
			}
		}
		let extent = Scene::new(&doc, false, &words).roots.iter().filter(|r| r.tree.items[0].kind() != "browser").map(|r| r.extent).reduce(|a, b| a.union(&b)).unwrap();
		let scale = (fixtures::STAGE_SIDE / extent.w.max(extent.h)).min(1.0);
		let r = Request { doc: pen.clone(), dark: false, area: extent, scale, width: (extent.w * scale).ceil() as u32, height: (extent.h * scale).ceil() as u32, paper: [0.98, 0.98, 0.98], boards: Vec::new(), writer: None };
		let p = match s.shoot(&r).unwrap() {
			Ok(p) => p,
			Err(needs) => {
				assert!(needs.math.is_empty() && needs.cards.is_empty(), "{name}: {needs:?}");
				for url in needs.pictures {
					s.add_picture(&url, None).ok();
				}
				for key in needs.icons {
					s.add_icon(&key, None);
				}
				s.shoot(&r).unwrap().ok().expect("drawn")
			}
		};
		let own = format!("{goldens}/shot-{name}.png");
		if std::env::var("STAGE_UPDATE_GOLDENS").is_ok_and(|v| v == "1") {
			image::RgbaImage::from_raw(p.width, p.height, p.rgba.clone()).unwrap().save(&own).unwrap();
		}
		let (want, w, h) = read_png(&own).unwrap_or_else(|| panic!("no goldens/shot-{name}.png: draw it with STAGE_UPDATE_GOLDENS=1"));
		assert_eq!((p.width, p.height), (w, h), "{name}: its size");
		let far = p.rgba.chunks(4).zip(want.chunks(4)).filter(|(a, b)| a.iter().zip(b.iter()).any(|(x, y)| x.abs_diff(*y) > 2)).count();
		assert!((far as f64) < 0.001 * (w * h) as f64, "{name}: {far} pixels off its own golden");
		// The page's tiles' golden: the same drawing, each tile placed to the nearest pixel.
		let (tiles, tw, th) = read_png(&format!("{goldens}/stage-{name}.png")).unwrap();
		assert_eq!((tw, th), (w, h), "{name}: the same framing as the tiles' golden");
		let (mut sum, mut big, mut n) = (0u64, 0usize, 0usize);
		for (a, b) in p.rgba.chunks(4).zip(tiles.chunks(4)) {
			// The tiles' golden is clear outside its tiles; only where it drew is compared.
			if b[3] < 255 {
				continue;
			}
			let d = (0..3).map(|c| a[c].abs_diff(b[c])).max().unwrap();
			sum += d as u64;
			n += 1;
			if d > 64 {
				big += 1;
			}
		}
		let mean = sum as f64 / n.max(1) as f64;
		let share = big as f64 / n.max(1) as f64;
		eprintln!("{name}: {:.2} mean off the tiles' golden, {:.2}% of pixels by more than 64", mean, share * 100.0);
		assert!(mean < 4.0 && share < 0.02, "{name}: far from the page's tiles ({mean:.2}, {:.2}%)", share * 100.0);
	}
}
