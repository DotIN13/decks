//! Drawn on this machine's graphics card and read back. Set `STAGE_SHOTS` to a folder to keep the
//! pictures; set `STAGE_FIXTURES` to a folder of `.pen` files to draw real stages too. Every
//! picture is drawn a second time on a device held to WebGL 2's limits and must come out the same.

use super::*;
use stage_paint::list::{Affine, Align, Clip, Color, Paint, Shape};
use stage_paint::painter::{Context, paint_area};
use stage_paint::tiles::{Grid, TILE};

fn gpu() -> Option<Gpu> {
	pollster::block_on(headless())
}

fn px(pixels: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
	let i = ((y * width + x) * 4) as usize;
	[pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
}

fn save(name: &str, pixels: &[u8], width: u32, height: u32) {
	let Ok(dir) = std::env::var("STAGE_SHOTS") else { return };
	std::fs::create_dir_all(&dir).unwrap();
	// PNG wants straight alpha; the textures are premultiplied.
	let straight: Vec<u8> = pixels
		.chunks(4)
		.flat_map(|p| {
			let a = p[3] as f32 / 255.0;
			if a <= 0.0 { [0, 0, 0, 0] } else { [(p[0] as f32 / a).min(255.0) as u8, (p[1] as f32 / a).min(255.0) as u8, (p[2] as f32 / a).min(255.0) as u8, p[3]] }
		})
		.collect();
	let file = std::fs::File::create(format!("{dir}/{name}.png")).unwrap();
	let mut enc = png::Encoder::new(std::io::BufWriter::new(file), width, height);
	enc.set_color(png::ColorType::Rgba);
	enc.set_depth(png::BitDepth::Eight);
	enc.write_header().unwrap().write_image_data(&straight).unwrap();
}

fn solid(c: [f32; 4]) -> Paint {
	Paint::Solid(Color::straight(c, 1.0))
}

/// A device with only what every WebGL 2 context promises: no storage buffers, 2048-texel textures.
fn webgl2_gpu() -> Option<Gpu> {
	pollster::block_on(headless_with(wgpu::Limits::downlevel_webgl2_defaults()))
}

fn draw_shapes(g: &mut Gpu) -> Vec<u8> {
	g.texture(1, TextureKind::Color, 200, 100, None);
	let mut list = DrawList::new(Color::TRANSPARENT);
	let rect = Shape { w: 100.0, h: 60.0, radii: [20.0; 4], ellipse: false };
	list.push(Op::Shape { shape: rect, transform: Affine::translate(10.5, 20.0), paint: solid([1.0, 0.0, 0.0, 1.0]), stroke: None });
	let circle = Shape { w: 60.0, h: 60.0, radii: [0.0; 4], ellipse: true };
	list.push(Op::Shape { shape: circle, transform: Affine::translate(130.0, 20.0), paint: solid([0.0, 0.0, 1.0, 1.0]), stroke: Some((4.0, Align::Inside)) });
	g.draw(Target::Texture(1), &list);
	g.read(1).unwrap()
}

#[test]
fn shapes_have_exact_soft_edges() {
	let Some(mut g) = gpu() else { return };
	let p = draw_shapes(&mut g);
	save("shapes", &p, 200, 100);
	assert_eq!(px(&p, 200, 60, 50), [255, 0, 0, 255], "inside the rectangle");
	assert_eq!(px(&p, 200, 12, 22)[3], 0, "outside its rounded corner");
	// Its left edge falls half way through a pixel: half covered.
	let edge = px(&p, 200, 10, 50)[3];
	assert!((100..=160).contains(&edge), "edge {edge}");
	assert_eq!(px(&p, 200, 160, 50)[3], 0, "the ring's middle is empty");
	assert_eq!(px(&p, 200, 131, 50), [0, 0, 255, 255], "on the ring");
}

fn draw_effects(g: &mut Gpu) -> Vec<u8> {
	g.texture(1, TextureKind::Color, 200, 200, None);
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
	g.draw(Target::Texture(1), &list);
	g.read(1).unwrap()
}

#[test]
fn layers_clips_gradients_shadows_and_meshes() {
	let Some(mut g) = gpu() else { return };
	let p = draw_effects(&mut g);
	save("effects", &p, 200, 200);
	let one = px(&p, 200, 20, 30)[0];
	let both = px(&p, 200, 40, 30)[0];
	assert!((120..=135).contains(&one), "half-grey {one}");
	assert_eq!(one, both, "a layer does not darken where its insides overlap");
	assert_eq!(px(&p, 200, 130, 30), [0, 153, 0, 255], "inside the clip");
	assert_eq!(px(&p, 200, 102, 2), [255, 255, 255, 255], "outside the clip");
	let left = px(&p, 200, 12, 150);
	let right = px(&p, 200, 88, 150);
	assert!(left[0] > 230 && right[2] > 230, "{left:?} {right:?}");
	let below = px(&p, 200, 145, 170);
	assert!(below[0] < 250 && below[0] > 100, "a soft shadow below the card: {below:?}");
	assert_eq!(px(&p, 200, 172, 172), [255, 128, 0, 255], "the triangle");
}

const STAGES: [&str; 3] = ["herobrine", "rotary", "md-edit-test"];

/// A real stage from `STAGE_FIXTURES`, drawn as tiles the way the worker will and stitched into one
/// picture: its pixels, width and height.
fn draw_stage(g: &mut Gpu, name: &str) -> Option<(Vec<u8>, u32, u32)> {
	let root = std::env::var("STAGE_FIXTURES").ok()?;
	{
		let path = format!("{root}/{name}/stage.pen");
		let text = std::fs::read_to_string(&path).ok()?;
		let doc = stage_doc::Document::parse(&text).unwrap();
		let words = fonts();
		let scene = stage_scene::Scene::new(&doc, false, &words);
		let atlas = std::cell::RefCell::new(stage_text::atlas::Atlas::new());
		// The drawing only: boards are drawn by the page, not into tiles.
		let extent = scene.roots.iter().filter(|r| r.tree.items[0].kind() != "browser").map(|r| r.extent).reduce(|a, b| a.union(&b))?;
		// The whole stage in at most 2048 pixels across.
		let scale = (2048.0 / extent.w.max(extent.h)).min(1.0);
		let (w, h) = ((extent.w * scale).ceil() as u32, (extent.h * scale).ceil() as u32);
		let keys = Grid::covering(&extent, scale as f32, 0);
		let mut grid = Grid::new(1024, 100);
		let skip = std::collections::HashSet::new();
		let none = |_: &str| None;
		let ctx = Context::new(&scene, &skip, &none).with_text(&words, &atlas);
		let started = std::time::Instant::now();
		let mut out = vec![0u8; (w * h * 4) as usize];
		let todo = grid.to_paint(&keys, keys.len());
		for key in &todo {
			let list = paint_area(&ctx, key.area(), key.scale(), Color([0.98, 0.98, 0.98, 1.0]));
			let texture = grid.painted(*key, 1);
			g.texture(texture, TextureKind::Color, TILE, TILE, None);
			stage_paint::flush_glyphs(&mut atlas.borrow_mut(), g);
			g.draw(Target::Texture(texture), &list);
			let tile = g.read(texture).unwrap();
			// Copy the tile into the stitched picture.
			let a = key.area();
			let ox = ((a.x - extent.x) * scale).round() as i64;
			let oy = ((a.y - extent.y) * scale).round() as i64;
			for ty in 0..TILE as i64 {
				for tx in 0..TILE as i64 {
					let (x, y) = (ox + tx, oy + ty);
					if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
						continue;
					}
					let s = ((ty * TILE as i64 + tx) * 4) as usize;
					let d = ((y * w as i64 + x) * 4) as usize;
					out[d..d + 4].copy_from_slice(&tile[s..s + 4]);
				}
			}
		}
		eprintln!("{name}: {} tiles in {:.0} ms (with read-back)", todo.len(), started.elapsed().as_secs_f64() * 1000.0);
		Some((out, w, h))
	}
}

/// Real stages, drawn as tiles the way the worker will, and stitched into one picture.
#[test]
fn real_stages_draw() {
	let Some(mut g) = gpu() else { return };
	for name in STAGES {
		if let Some((out, w, h)) = draw_stage(&mut g, name) {
			save(&format!("stage-{name}"), &out, w, h);
		}
	}
}

fn fonts() -> stage_text::Text {
	let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fonts");
	let mut t = stage_text::Text::new();
	for f in ["inter_latest_latin-400-normal.ttf", "inter_latest_latin-700-normal.ttf", "inter_latest_latin-600-normal.ttf", "inter_latest_latin-400-italic.ttf"] {
		if let Ok(bytes) = std::fs::read(format!("{dir}/{f}")) {
			t.add_font("Inter", bytes, false);
		}
	}
	if let Ok(bytes) = std::fs::read(format!("{dir}/noto-sans-sc_latest_chinese-simplified-400-normal.ttf")) {
		t.add_font("Noto Sans SC", bytes, true);
	}
	t
}

fn draw_words(g: &mut Gpu) -> Option<Vec<u8>> {
	let words = fonts();
	if !words.has_fonts() {
		return None;
	}
	let doc = stage_doc::Document::from_json(serde_json::json!({"children":[
		{"type":"text","id":"a","x":10,"y":10,"content":"Crisp words at 14 px, 你好","fontSize":14},
		{"type":"text","id":"b","x":10,"y":40,"content":"Bold and bigger","fontSize":28,"fontWeight":700,"fill":"#3b5cf6"},
		{"type":"text","id":"c","x":10,"y":90,"content":"Underlined, and struck","fontSize":16,"underline":true},
		{"type":"text","id":"d","x":300,"y":60,"content":"Turned","fontSize":20,"rotation":30},
		{"type":"note","id":"n","x":10,"y":130,"width":260,"content":"A note wraps its words inside its paper, as pen.dev draws it."}
	]})).unwrap();
	let scene = stage_scene::Scene::new(&doc, false, &words);
	let atlas = std::cell::RefCell::new(stage_text::atlas::Atlas::new());
	let skip = std::collections::HashSet::new();
	let none = |_: &str| None;
	let ctx = Context::new(&scene, &skip, &none).with_text(&words, &atlas);
	let area = stage_scene::Rect { x: 0.0, y: 0.0, w: 400.0, h: 256.0 };
	let list = paint_area(&ctx, area, 2.0, Color([1.0, 1.0, 1.0, 1.0]));
	assert!(list.ops.iter().filter(|o| matches!(o, Op::Glyphs { .. })).count() >= 5);
	g.texture(1, TextureKind::Color, 800, 512, None);
	stage_paint::flush_glyphs(&mut atlas.borrow_mut(), g);
	g.draw(Target::Texture(1), &list);
	g.read(1)
}

/// Words, upright at three sizes and turned, drawn and read back.
#[test]
fn words_are_crisp() {
	let Some(mut g) = gpu() else { return };
	let Some(p) = draw_words(&mut g) else { return };
	save("words", &p, 800, 512);
	// Somewhere in the first line there is solid ink, not only grey smears.
	let darkest = (20..40).flat_map(|y| (20..300).map(move |x| (x, y))).map(|(x, y)| px(&p, 800, x, y)[0]).min().unwrap();
	assert!(darkest < 60, "darkest {darkest}");
}

/// A markdown card with every kind of block, drawn as a note: its pixels, width and height.
fn draw_card(g: &mut Gpu) -> Option<(Vec<u8>, u32, u32)> {
	let mut words = fonts();
	if !words.has_fonts() {
		return None;
	}
	if let Ok(bytes) = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fonts/jetbrains-mono_latest_latin-400-normal.ttf")) {
		words.add_font("JetBrains Mono", bytes, false);
	}
	let md = "# A card\n\nWords with **bold**, *italic*, `code` and a [link](https://x).\n\n- one\n- two\n  - nested\n\n- [x] done\n- [ ] to do\n\n> A quote, behind its bar.\n\n```\nfn main() {}\n```\n\n| Name | Value |\n|:-|-:|\n| frames | 120 |\n| page ms | 0.3 |\n\n---\n\nThe end.";
	let doc = stage_doc::Document::from_json(serde_json::json!({"children":[
		{"type":"note","id":"n","x":10,"y":10,"width":380,"content":md,"metadata":{"type":"decks.markdown"}}
	]})).unwrap();
	let scene = stage_scene::Scene::new(&doc, false, &words);
	let atlas = std::cell::RefCell::new(stage_text::atlas::Atlas::new());
	let skip = std::collections::HashSet::new();
	let none = |_: &str| None;
	let ctx = Context::new(&scene, &skip, &none).with_text(&words, &atlas);
	let h = scene.roots[0].placed[0].rect.h;
	assert!(h > 400.0, "the note grew to hold its card: {h}");
	let area = stage_scene::Rect { x: 0.0, y: 0.0, w: 400.0, h: h + 20.0 };
	let list = paint_area(&ctx, area, 2.0, Color([0.96, 0.96, 0.96, 1.0]));
	let (w, hh) = (800, ((h + 20.0) * 2.0) as u32);
	g.texture(1, TextureKind::Color, w, hh, None);
	stage_paint::flush_glyphs(&mut atlas.borrow_mut(), g);
	g.draw(Target::Texture(1), &list);
	Some((g.read(1)?, w, hh))
}

/// A markdown card with every kind of block, drawn as a note.
#[test]
fn cards_are_drawn() {
	let Some(mut g) = gpu() else { return };
	let Some((p, w, h)) = draw_card(&mut g) else { return };
	save("card", &p, w, h);
}

/// Under WebGL 2's limits (no storage buffers at all) the pipelines build and every picture comes out
/// byte for byte as on the full device.
#[test]
fn webgl2_limits_draw_the_same() {
	let (Some(mut full), Some(mut small)) = (gpu(), webgl2_gpu()) else { return };
	assert_eq!(small.device.limits().max_storage_buffers_per_shader_stage, 0);
	let same = |name: &str, a: Option<Vec<u8>>, b: Option<Vec<u8>>| {
		assert_eq!(a.is_some(), b.is_some(), "{name}");
		if let (Some(a), Some(b)) = (a, b) {
			assert_eq!(a.len(), b.len(), "{name}");
			let differ = a.iter().zip(&b).filter(|(x, y)| x != y).count();
			assert_eq!(differ, 0, "{name}: {differ} bytes differ");
		}
	};
	same("shapes", Some(draw_shapes(&mut full)), Some(draw_shapes(&mut small)));
	same("effects", Some(draw_effects(&mut full)), Some(draw_effects(&mut small)));
	same("words", draw_words(&mut full), draw_words(&mut small));
	same("card", draw_card(&mut full).map(|c| c.0), draw_card(&mut small).map(|c| c.0));
	for name in STAGES {
		same(name, draw_stage(&mut full, name).map(|s| s.0), draw_stage(&mut small, name).map(|s| s.0));
	}
	// Nothing was lost on the way: the small device reported no errors.
	assert!(!small.lost());
}

/// With one sample a pixel (a device short of memory, or of samples) every picture still draws:
/// shapes' edges are the shader's own and come out as with four; meshes lose their smoothing only.
#[test]
fn one_sample_draws() {
	let (Some(mut four), Some(mut one)) = (gpu(), pollster::block_on(headless_sampled(wgpu::Limits::downlevel_webgl2_defaults(), 1))) else { return };
	assert_eq!(one.limits().samples, 1);
	assert_eq!(four.limits(), DeviceLimits { max_texture: four.device.limits().max_texture_dimension_2d, samples: 4 });
	let (a, b) = (draw_shapes(&mut four), draw_shapes(&mut one));
	assert_eq!(px(&b, 200, 60, 50), [255, 0, 0, 255], "inside the rectangle");
	assert_eq!(px(&b, 200, 12, 22)[3], 0, "outside its rounded corner");
	let far = a.iter().zip(&b).filter(|(x, y)| x.abs_diff(**y) > 8).count();
	assert!(far < a.len() / 100, "{far} bytes far from four samples' shapes");
	let (a, b) = (draw_effects(&mut four), draw_effects(&mut one));
	let far = a.iter().zip(&b).filter(|(x, y)| x.abs_diff(**y) > 64).count();
	assert!(far < a.len() / 50, "{far} bytes far from four samples' effects");
	if let (Some(a), Some(b)) = (draw_card(&mut four), draw_card(&mut one)) {
		save("card-1x", &b.0, b.1, b.2);
		let far = a.0.iter().zip(&b.0).filter(|(x, y)| x.abs_diff(**y) > 64).count();
		assert!(far < a.0.len() / 50, "{far} bytes far from four samples' card");
	}
	assert!(!one.lost());
}

/// Buffers, the table and layer textures are kept between draws: a picture drawn after bigger and
/// smaller ones, into the same textures, comes out as on a device that drew nothing before.
#[test]
fn kept_resources_draw_the_same() {
	let (Some(mut fresh), Some(mut used)) = (gpu(), gpu()) else { return };
	let first = draw_effects(&mut fresh);
	let _ = draw_card(&mut used);
	let _ = draw_words(&mut used);
	let _ = draw_effects(&mut used);
	let _ = draw_shapes(&mut used);
	assert!(first == draw_effects(&mut used), "effects after other draws");
	assert!(draw_shapes(&mut fresh) == draw_shapes(&mut used), "shapes after other draws");
}

/// How long drawing takes, without reading back: every tile of each `STAGE_FIXTURES` stage, painted
/// once, then drawn `STAGE_BENCH_ROUNDS` times (default 20). Run alone with `--ignored --nocapture`.
#[test]
#[ignore]
fn draw_bench() {
	let Some(mut g) = gpu() else { return };
	let Ok(root) = std::env::var("STAGE_FIXTURES") else { return };
	let rounds: usize = std::env::var("STAGE_BENCH_ROUNDS").ok().and_then(|r| r.parse().ok()).unwrap_or(20);
	for name in STAGES {
		let Ok(text) = std::fs::read_to_string(format!("{root}/{name}/stage.pen")) else { continue };
		let doc = stage_doc::Document::parse(&text).unwrap();
		let words = fonts();
		let scene = stage_scene::Scene::new(&doc, false, &words);
		let atlas = std::cell::RefCell::new(stage_text::atlas::Atlas::new());
		let Some(extent) = scene.roots.iter().filter(|r| r.tree.items[0].kind() != "browser").map(|r| r.extent).reduce(|a, b| a.union(&b)) else { continue };
		let scale = (2048.0 / extent.w.max(extent.h)).min(1.0);
		let keys = Grid::covering(&extent, scale as f32, 0);
		let skip = std::collections::HashSet::new();
		let none = |_: &str| None;
		let ctx = Context::new(&scene, &skip, &none).with_text(&words, &atlas);
		let lists: Vec<DrawList> = keys.iter().map(|k| paint_area(&ctx, k.area(), k.scale(), Color([0.98, 0.98, 0.98, 1.0]))).collect();
		stage_paint::flush_glyphs(&mut atlas.borrow_mut(), &mut g);
		for i in 0..lists.len() {
			g.texture(1000 + i as u32, TextureKind::Color, TILE, TILE, None);
		}
		let mut cpu = std::time::Duration::ZERO;
		let mut wall = Vec::new();
		for round in 0..=rounds {
			let start = std::time::Instant::now();
			for (i, list) in lists.iter().enumerate() {
				let t = std::time::Instant::now();
				g.draw(Target::Texture(1000 + i as u32), list);
				if round > 0 {
					cpu += t.elapsed();
				}
			}
			g.device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
			// The first round makes pipelines and buffers; it is not counted.
			if round > 0 {
				wall.push(start.elapsed().as_secs_f64() * 1000.0);
			}
		}
		wall.sort_by(f64::total_cmp);
		let draws = (lists.len() * rounds) as f64;
		eprintln!(
			"bench {name}: {} tiles, {:.3} ms CPU a draw, round wall median {:.2} ms (min {:.2}, max {:.2}), {:.3} ms a draw",
			lists.len(),
			cpu.as_secs_f64() * 1000.0 / draws,
			wall[wall.len() / 2],
			wall[0],
			wall[wall.len() - 1],
			wall[wall.len() / 2] / lists.len() as f64
		);
		for i in 0..lists.len() {
			g.forget(1000 + i as u32);
		}
	}
}
