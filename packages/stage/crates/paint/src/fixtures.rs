//! The pictures every backend must draw alike: a few draw lists written by hand, words and a card
//! laid out by the painter, and real stages drawn as tiles the way the worker draws them.
//!
//! Each is drawn into texture [`OUT`] on whatever [`Backend`] is given. The native tests read it
//! back and hold it to `crates/gpu/goldens/`; in a browser, `Fixtures.show` (stage-web) lays it on
//! the canvas, where `apps/web/scripts/stage-backends.ts` reads it back and holds it to the same
//! goldens, under WebGPU and WebGL 2. One source, so the two cannot drift apart.

use crate::backend::{Backend, TextureKind, flush_glyphs};
use crate::list::{Affine, Align, Clip, Color, DrawList, Op, Paint, Shape};
use crate::painter::{Context, Writer, paint_area};
use crate::tiles::{Grid, TILE};

/// The texture each fixture's picture is left in.
pub const OUT: u32 = 1;

/// The fixtures drawn from draw lists and text alone, in order.
pub const NAMES: [&str; 6] = ["shapes", "effects", "words", "card", "placeholder", "angular"];

/// The real stages, each a `.pen` file under `crates/gpu/fixtures/`.
pub const STAGES: [&str; 2] = ["herobrine", "rotary"];

/// A stage's picture is at most this many pixels across (or its own size, if smaller).
pub const STAGE_SIDE: f64 = 1024.0;

/// The fonts the fixtures use, from `packages/stage/fonts/`: family, file, and whether it is a
/// fallback for scripts the others lack.
pub const FONTS: [(&str, &str, bool); 6] = [
	("Inter", "inter_latest_latin-400-normal.ttf", false),
	("Inter", "inter_latest_latin-700-normal.ttf", false),
	("Inter", "inter_latest_latin-600-normal.ttf", false),
	("Inter", "inter_latest_latin-400-italic.ttf", false),
	("Noto Sans SC", "noto-sans-sc_latest_chinese-simplified-400-normal.ttf", true),
	("JetBrains Mono", "jetbrains-mono_latest_latin-400-normal.ttf", false),
];

fn solid(c: [f32; 4]) -> Paint {
	Paint::Solid(Color::straight(c, 1.0))
}

/// Draw fixture `name` (one of [`NAMES`]) into [`OUT`]: its width and height, or `None` for a name
/// it does not know or for words without fonts.
pub fn draw(g: &mut dyn Backend, name: &str, words: &stage_text::Text) -> Option<(u32, u32)> {
	match name {
		"shapes" => Some(shapes(g)),
		"effects" => Some(effects(g)),
		"words" => words_(g, words),
		"card" => card(g, words),
		"placeholder" => placeholder(g, words),
		"angular" => Some(angular(g, words)),
		_ => None,
	}
}

fn shapes(g: &mut dyn Backend) -> (u32, u32) {
	g.texture(OUT, TextureKind::Color, 200, 100, None);
	let mut list = DrawList::new(Color::TRANSPARENT);
	let rect = Shape { w: 100.0, h: 60.0, radii: [20.0; 4], ellipse: false };
	list.push(Op::Shape { shape: rect, transform: Affine::translate(10.5, 20.0), paint: solid([1.0, 0.0, 0.0, 1.0]), stroke: None });
	let circle = Shape { w: 60.0, h: 60.0, radii: [0.0; 4], ellipse: true };
	list.push(Op::Shape { shape: circle, transform: Affine::translate(130.0, 20.0), paint: solid([0.0, 0.0, 1.0, 1.0]), stroke: Some((4.0, Align::Inside)) });
	g.draw(crate::Target::Texture(OUT), &list);
	(200, 100)
}

fn effects(g: &mut dyn Backend) -> (u32, u32) {
	g.texture(OUT, TextureKind::Color, 200, 200, None);
	let mut list = DrawList::new(Color([1.0, 1.0, 1.0, 1.0]));
	let sq = |w: f32| Shape { w, h: w, radii: [0.0; 4], ellipse: false };
	// Two overlapping squares in a half-opaque layer: where they overlap is no darker.
	list.push(Op::PushLayer { opacity: 0.5 });
	list.push(Op::Shape { shape: sq(40.0), transform: Affine::translate(10.0, 10.0), paint: solid([0.0, 0.0, 0.0, 1.0]), stroke: None });
	list.push(Op::Shape { shape: sq(40.0), transform: Affine::translate(30.0, 10.0), paint: solid([0.0, 0.0, 0.0, 1.0]), stroke: None });
	list.push(Op::PopLayer);
	// A clip cuts a big square to a circle.
	list.push(Op::PushClip(Clip { shape: Shape { w: 40.0, h: 40.0, radii: [0.0; 4], ellipse: true }, transform: Affine::translate(110.0, 10.0) }));
	list.push(Op::Shape { shape: sq(80.0), transform: Affine::translate(100.0, 0.0), paint: solid([0.0, 0.6, 0.0, 1.0]), stroke: None });
	list.push(Op::PopClip);
	// A gradient from red at the left to blue at the right.
	let stops = vec![(0.0, Color::straight([1.0, 0.0, 0.0, 1.0], 1.0)), (1.0, Color::straight([0.0, 0.0, 1.0, 1.0], 1.0))];
	list.push(Op::Shape { shape: sq(80.0), transform: Affine::translate(10.0, 110.0), paint: Paint::Linear { from: (0.0, 40.0), to: (80.0, 40.0), stops }, stroke: None });
	// A soft shadow under a white card, and a triangle.
	list.push(Op::Shadow { shape: sq(50.0), transform: Affine::translate(120.0, 120.0), color: Color::straight([0.0, 0.0, 0.0, 0.5], 1.0), blur: 12.0, spread: 0.0 });
	list.push(Op::Shape { shape: sq(50.0), transform: Affine::translate(115.0, 115.0), paint: solid([1.0, 1.0, 1.0, 1.0]), stroke: None });
	list.push(Op::Mesh { vertices: vec![[0.0, 0.0], [20.0, 0.0], [0.0, 20.0]], indices: vec![0, 1, 2], transform: Affine::translate(170.0, 170.0), paint: solid([1.0, 0.5, 0.0, 1.0]) });
	g.draw(crate::Target::Texture(OUT), &list);
	(200, 200)
}

/// Draw `area` of a document at `scale` into [`OUT`], `w` × `h`, over `clear`.
fn document(g: &mut dyn Backend, doc: &stage_doc::Document, words: &stage_text::Text, area: stage_scene::Rect, scale: f64, size: (u32, u32), clear: Color) {
	document_by(g, doc, words, area, scale, size, clear, None);
}

/// As [`document`], with the drawing's writer named, as its placeholder frames are marked.
#[allow(clippy::too_many_arguments)]
fn document_by(g: &mut dyn Backend, doc: &stage_doc::Document, words: &stage_text::Text, area: stage_scene::Rect, scale: f64, (w, h): (u32, u32), clear: Color, writer: Option<&Writer>) {
	let scene = stage_scene::Scene::new(doc, false, words);
	let atlas = std::cell::RefCell::new(stage_text::atlas::Atlas::new());
	let skip = std::collections::HashSet::new();
	let none = |_: &str| None;
	let mut ctx = Context::new(&scene, &skip, &none).with_text(words, &atlas);
	ctx.writer = writer;
	let list = paint_area(&ctx, area, scale, clear);
	g.texture(OUT, TextureKind::Color, w, h, None);
	flush_glyphs(&mut atlas.borrow_mut(), g);
	g.draw(crate::Target::Texture(OUT), &list);
}

/// Words, upright at three sizes and turned, and a note, at 2×.
fn words_(g: &mut dyn Backend, words: &stage_text::Text) -> Option<(u32, u32)> {
	if !words.has_fonts() {
		return None;
	}
	let doc = stage_doc::Document::from_json(serde_json::json!({"children":[
		{"type":"text","id":"a","x":10,"y":10,"content":"Crisp words at 14 px, 你好","fontSize":14},
		{"type":"text","id":"b","x":10,"y":40,"content":"Bold and bigger","fontSize":28,"fontWeight":700,"fill":"#3b5cf6"},
		{"type":"text","id":"c","x":10,"y":90,"content":"Underlined, and struck","fontSize":16,"underline":true},
		{"type":"text","id":"d","x":300,"y":60,"content":"Turned","fontSize":20,"rotation":30},
		{"type":"note","id":"n","x":10,"y":130,"width":260,"content":"A note wraps its words inside its paper, as pen.dev draws it."}
	]}))
	.ok()?;
	let area = stage_scene::Rect { x: 0.0, y: 0.0, w: 400.0, h: 256.0 };
	document(g, &doc, words, area, 2.0, (800, 512), Color([1.0, 1.0, 1.0, 1.0]));
	Some((800, 512))
}

/// A markdown card with every kind of block, drawn as a note at 2×.
fn card(g: &mut dyn Backend, words: &stage_text::Text) -> Option<(u32, u32)> {
	if !words.has_fonts() {
		return None;
	}
	let md = "# A card\n\nWords with **bold**, *italic*, `code` and a [link](https://x).\n\n- one\n- two\n  - nested\n\n- [x] done\n- [ ] to do\n\n> A quote, behind its bar.\n\n```\nfn main() {}\n```\n\n| Name | Value |\n|:-|-:|\n| frames | 120 |\n| page ms | 0.3 |\n\n---\n\nThe end.";
	let doc = stage_doc::Document::from_json(serde_json::json!({"children":[
		{"type":"note","id":"n","x":10,"y":10,"width":380,"content":md,"metadata":{"type":"decks.markdown"}}
	]}))
	.ok()?;
	let h = stage_scene::Scene::new(&doc, false, words).roots.first()?.placed.first()?.rect.h;
	let area = stage_scene::Rect { x: 0.0, y: 0.0, w: 400.0, h: h + 20.0 };
	let size = (800, ((h + 20.0) * 2.0) as u32);
	document(g, &doc, words, area, 2.0, size, Color([0.96, 0.96, 0.96, 1.0]));
	Some(size)
}

/// Two placeholder frames at 2×: one written by a named agent, its dashed outline and name tag in
/// the agent's green over a rounded frame with a child; one too small for the tag, outline alone.
fn placeholder(g: &mut dyn Backend, words: &stage_text::Text) -> Option<(u32, u32)> {
	if !words.has_fonts() {
		return None;
	}
	let doc = stage_doc::Document::from_json(serde_json::json!({"children":[
		{"type":"frame","id":"p","x":10,"y":10,"width":220,"height":120,"cornerRadius":12,"layout":"none","placeholder":true,"fill":"#f4f6fa","children":[
			{"type":"rectangle","id":"r","x":20,"y":50,"width":120,"height":40,"fill":"#d0d7e2","cornerRadius":6}
		]},
		{"type":"frame","id":"q","x":250,"y":10,"width":40,"height":40,"layout":"none","placeholder":true}
	]}))
	.ok()?;
	let area = stage_scene::Rect { x: 0.0, y: 0.0, w: 300.0, h: 140.0 };
	let writer = Writer { name: Some("Atelier".into()), color: [0.180, 0.686, 0.353, 1.0] };
	document_by(g, &doc, words, area, 2.0, (600, 280), Color([1.0, 1.0, 1.0, 1.0]), Some(&writer));
	Some((600, 280))
}

/// Angular gradients at 2×: round a square's centre from straight up; turned a quarter
/// counter-clockwise and off centre in a wide rounded rectangle; and in an ellipse, half its size.
fn angular(g: &mut dyn Backend, words: &stage_text::Text) -> (u32, u32) {
	let wheel = serde_json::json!([
		{"color":"#ff0000","position":0},{"color":"#ffff00","position":0.25},{"color":"#00c000","position":0.5},{"color":"#0040ff","position":0.75},{"color":"#ff0000","position":1}
	]);
	let doc = stage_doc::Document::from_json(serde_json::json!({"children":[
		{"type":"rectangle","id":"a","x":10,"y":10,"width":100,"height":100,"fill":{"type":"gradient","gradientType":"angular","colors":wheel}},
		{"type":"rectangle","id":"b","x":130,"y":10,"width":160,"height":100,"cornerRadius":20,"fill":{"type":"gradient","gradientType":"angular","rotation":90,"center":{"x":0.25,"y":0.5},"colors":wheel}},
		{"type":"ellipse","id":"c","x":310,"y":10,"width":100,"height":100,"fill":{"type":"gradient","gradientType":"angular","size":{"width":0.5,"height":0.5},"colors":[{"color":"#3b5cf6","position":0},{"color":"#3b5cf600","position":1}]}}
	]}))
	.expect("the fixture parses");
	let area = stage_scene::Rect { x: 0.0, y: 0.0, w: 420.0, h: 120.0 };
	document(g, &doc, words, area, 2.0, (840, 240), Color([1.0, 1.0, 1.0, 1.0]));
	(840, 240)
}

/// A real stage (a `.pen` file's text): its drawing, not its boards (the page draws those), as
/// tiles the way the worker paints them, laid edge to edge into [`OUT`] the way the page shows
/// them, at most [`STAGE_SIDE`] pixels across. Its width and height, or `None` for a stage that
/// does not parse or has nothing drawn.
pub fn draw_stage(g: &mut dyn Backend, pen: &str, words: &stage_text::Text) -> Option<(u32, u32)> {
	let doc = stage_doc::Document::parse(pen).ok()?;
	let scene = stage_scene::Scene::new(&doc, false, words);
	let atlas = std::cell::RefCell::new(stage_text::atlas::Atlas::new());
	let extent = scene.roots.iter().filter(|r| r.tree.items[0].kind() != "browser").map(|r| r.extent).reduce(|a, b| a.union(&b))?;
	let scale = (STAGE_SIDE / extent.w.max(extent.h)).min(1.0);
	let (w, h) = ((extent.w * scale).ceil() as u32, (extent.h * scale).ceil() as u32);
	let keys = Grid::covering(&extent, scale as f32, 0);
	let mut grid = Grid::new(1024, 100);
	let skip = std::collections::HashSet::new();
	let none = |_: &str| None;
	let ctx = Context::new(&scene, &skip, &none).with_text(words, &atlas);
	let mut laid = DrawList::new(Color::TRANSPARENT);
	let mut made = Vec::new();
	for key in grid.to_paint(&keys, keys.len()) {
		let list = paint_area(&ctx, key.area(), key.scale(), Color([0.98, 0.98, 0.98, 1.0]));
		let texture = grid.painted(key, 1);
		g.texture(texture, TextureKind::Color, TILE, TILE, None);
		flush_glyphs(&mut atlas.borrow_mut(), g);
		g.draw(crate::Target::Texture(texture), &list);
		made.push(texture);
		let a = key.area();
		let x = ((a.x - extent.x) * scale).round() as f32;
		let y = ((a.y - extent.y) * scale).round() as f32;
		laid.push(Op::Picture { texture, x, y, w: TILE as f32, h: TILE as f32, uv: [0.0, 0.0, 1.0, 1.0], opacity: 1.0 });
	}
	g.texture(OUT, TextureKind::Color, w, h, None);
	g.draw(crate::Target::Texture(OUT), &laid);
	for texture in made {
		g.forget(texture);
	}
	Some((w, h))
}
