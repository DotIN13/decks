//! Drawn on this machine's graphics card and read back. Set `STAGE_SHOTS` to a folder to keep the
//! pictures; set `STAGE_FIXTURES` to a folder of `<name>/stage.pen` to draw more real stages. Every
//! picture is drawn a second time on a device held to WebGL 2's limits and must come out the same,
//! and the fixtures (`stage_paint::fixtures`) must match their goldens in `goldens/` on both:
//! `STAGE_UPDATE_GOLDENS=1` draws them anew. The browser's backends are held to the same goldens by
//! `apps/web/scripts/stage-backends.ts`.

use super::*;
use stage_paint::fixtures;
use stage_paint::list::Color;
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
	write_png(&format!("{dir}/{name}.png"), pixels, width, height);
}

/// Write premultiplied pixels as a PNG (which wants straight alpha), as small as it compresses.
fn write_png(path: &str, pixels: &[u8], width: u32, height: u32) {
	if let Some(dir) = std::path::Path::new(path).parent() {
		std::fs::create_dir_all(dir).unwrap();
	}
	// PNG wants straight alpha; the textures are premultiplied.
	let straight: Vec<u8> = pixels
		.chunks(4)
		.flat_map(|p| {
			let a = p[3] as f32 / 255.0;
			if a <= 0.0 { [0, 0, 0, 0] } else { [(p[0] as f32 / a).min(255.0) as u8, (p[1] as f32 / a).min(255.0) as u8, (p[2] as f32 / a).min(255.0) as u8, p[3]] }
		})
		.collect();
	let file = std::fs::File::create(path).unwrap();
	let mut enc = png::Encoder::new(std::io::BufWriter::new(file), width, height);
	enc.set_color(png::ColorType::Rgba);
	enc.set_depth(png::BitDepth::Eight);
	enc.set_compression(png::Compression::High);
	enc.write_header().unwrap().write_image_data(&straight).unwrap();
}

/// A device with only what every WebGL 2 context promises: no storage buffers, 2048-texel textures.
fn webgl2_gpu() -> Option<Gpu> {
	pollster::block_on(headless_with(wgpu::Limits::downlevel_webgl2_defaults()))
}

fn draw_shapes(g: &mut Gpu) -> Vec<u8> {
	fixtures::draw(g, "shapes", &stage_text::Text::new()).unwrap();
	g.read(fixtures::OUT).unwrap()
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
	fixtures::draw(g, "effects", &stage_text::Text::new()).unwrap();
	g.read(fixtures::OUT).unwrap()
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

/// An angular gradient runs clockwise from straight up, and its rotation turns where it starts
/// counter-clockwise.
#[test]
fn angular_gradients_go_round() {
	let Some(mut g) = gpu() else { return };
	let (w, h) = fixtures::draw(&mut g, "angular", &stage_text::Text::new()).unwrap();
	let p = g.read(fixtures::OUT).unwrap();
	save("angular", &p, w, h);
	// The square at (10, 10) 100 wide, at 2×: its centre is at (120, 120).
	let near = |c: [u8; 4], want: [u8; 3]| (0..3).all(|k| (c[k] as i32 - want[k] as i32).abs() < 40);
	assert!(near(px(&p, w, 125, 40), [255, 50, 0]), "just right of up is red: {:?}", px(&p, w, 125, 40));
	assert!(near(px(&p, w, 200, 120), [255, 255, 0]), "right is yellow: {:?}", px(&p, w, 200, 120));
	assert!(near(px(&p, w, 120, 200), [0, 192, 0]), "down is green: {:?}", px(&p, w, 120, 200));
	assert!(near(px(&p, w, 40, 120), [0, 64, 255]), "left is blue: {:?}", px(&p, w, 40, 120));
	// Turned 90° counter-clockwise, about (130 + 40, 60) = (340, 120) at 2×: red starts at the left,
	// so up is where yellow is.
	assert!(near(px(&p, w, 340, 40), [255, 255, 0]), "turned: up is yellow: {:?}", px(&p, w, 340, 40));
	assert!(near(px(&p, w, 300, 116), [255, 50, 0]), "turned: just above left is red: {:?}", px(&p, w, 300, 116));
}

/// An inner shadow lies inside its shape: moved down, it shades the top edge and not the bottom, and
/// nothing spills outside; soft, it fades towards the middle; under a frame's child, the child is over it.
#[test]
fn inner_shadows_lie_inside() {
	let Some(mut g) = gpu() else { return };
	let (w, h) = fixtures::draw(&mut g, "inner", &stage_text::Text::new()).unwrap();
	let p = g.read(fixtures::OUT).unwrap();
	save("inner", &p, w, h);
	// The square at (10, 10), 100 wide, at 2×, with a hard shadow 10 down: the top 20 px are blue.
	assert_eq!(px(&p, w, 120, 30), [59, 92, 246, 255], "the top band");
	assert_eq!(px(&p, w, 120, 60), [255, 255, 255, 255], "below it, the fill");
	assert_eq!(px(&p, w, 120, 210), [255, 255, 255, 255], "the bottom edge has none");
	assert_eq!(px(&p, w, 120, 12), [255, 255, 255, 255], "none above the square");
	// The frame: dark at its top-left inside edge, its fill in the middle, its child over the shadow.
	let edge = px(&p, w, 266, 120);
	let middle = px(&p, w, 420, 120);
	assert!(edge[0] < middle[0] - 40, "shade at the edge {edge:?}, the fill in the middle {middle:?}");
	assert_eq!(px(&p, w, 270, 190), [255, 204, 0, 255], "the child is over the shadow");
	// The ellipse: red inside its bottom edge (the shadow is moved up), white in its middle.
	let low = px(&p, w, 720, 214);
	assert!(low[0] > low[2] + 30, "red low inside the ellipse: {low:?}");
	assert_eq!(px(&p, w, 720, 120), [255, 255, 255, 255], "white in its middle");
}

/// A blurred item is soft at its edges and past them, solid in its middle, and leaves what is drawn
/// over it sharp.
#[test]
fn blurs_soften_an_item_and_nothing_else() {
	let Some(mut g) = gpu() else { return };
	let (w, h) = fixtures::draw(&mut g, "blur", &stage_text::Text::new()).unwrap();
	let p = g.read(fixtures::OUT).unwrap();
	save("blur", &p, w, h);
	// The frame at (20, 20), 100 wide at 2×, blurred by 6 (a sigma of 6 pixels here): its yellow
	// child is solid in its middle, and the frame's left edge (x = 40) is half blue.
	assert_eq!(px(&p, w, 140, 140), [255, 204, 0, 255], "the child's middle");
	let edge = px(&p, w, 40, 140);
	assert!((90..=170).contains(&edge[0]) && edge[2] > 200, "half way across the edge: {edge:?}");
	assert!(px(&p, w, 30, 140)[0] < 250, "the blur reaches past the box: {:?}", px(&p, w, 30, 140));
	assert_eq!(px(&p, w, 10, 140), [255, 255, 255, 255], "and stops");
	// The ring, blurred by 30: its hole is no longer white, and the blur spreads well past it.
	let hole = px(&p, w, 400, 140);
	assert!(hole[1] < 245, "the hole is shaded: {hole:?}");
	assert!(px(&p, w, 400, 252)[1] < 250, "the blur reaches below the ring");
	// The dark square is drawn after the blurred green one and stays sharp.
	assert_eq!(px(&p, w, 700, 200), [17, 17, 17, 255], "inside the sharp square");
	assert_eq!(px(&p, w, 641, 200)[0], 17, "its edge is sharp");
}

/// A blurred item across tiles is drawn as one: the tiles hold what lies past their edges, so
/// stitched together they are the picture drawn whole.
#[test]
fn a_blur_across_tiles_has_no_seam() {
	let Some(mut g) = gpu() else { return };
	let pen = serde_json::json!({"version":"2.6","children":[
		{"type":"rectangle","id":"a","x":0,"y":0,"width":900,"height":300,"fill":"#ffffff"},
		{"type":"frame","id":"f","x":380,"y":60,"width":250,"height":180,"layout":"none","fill":"#3b5cf6","effect":{"type":"blur","radius":40},"children":[
			{"type":"rectangle","id":"r","x":100,"y":40,"width":60,"height":100,"fill":"#ffcc00"}
		]}
	]})
	.to_string();
	let words = stage_text::Text::new();
	let (w, h) = fixtures::draw_stage(&mut g, &pen, &words).unwrap();
	let tiled = g.read(fixtures::OUT).unwrap();
	// The same, drawn whole.
	let doc = stage_doc::Document::parse(&pen).unwrap();
	let scene = stage_scene::Scene::new(&doc, false, &words);
	let extent = scene.roots.iter().map(|r| r.extent).reduce(|a, b| a.union(&b)).unwrap();
	let skip = std::collections::HashSet::new();
	let none = |_: &str| None;
	let list = paint_area(&Context::new(&scene, &skip, &none), extent, 1.0, Color([0.98, 0.98, 0.98, 1.0]));
	g.texture(2, TextureKind::Color, w, h, None);
	g.draw(Target::Texture(2), &list);
	let whole = g.read(2).unwrap();
	save("blur-tiled", &tiled, w, h);
	save("blur-whole", &whole, w, h);
	let (far, most) = differ(&tiled, &whole, 3);
	assert!(far == 0, "{far} pixels more than 3 off, by up to {most}");
}

/// The stages drawn: the two under `fixtures/`, and any more in `STAGE_FIXTURES` (a folder of
/// `<name>/stage.pen`).
fn stages() -> Vec<(String, String)> {
	let mut out: Vec<(String, String)> = fixtures::STAGES.iter().map(|n| (n.to_string(), std::fs::read_to_string(format!("{}/fixtures/{n}.pen", env!("CARGO_MANIFEST_DIR"))).unwrap())).collect();
	if let Ok(root) = std::env::var("STAGE_FIXTURES")
		&& let Ok(dirs) = std::fs::read_dir(&root)
	{
		for dir in dirs.flatten() {
			let name = dir.file_name().to_string_lossy().into_owned();
			if out.iter().any(|(n, _)| *n == name) {
				continue;
			}
			if let Ok(text) = std::fs::read_to_string(dir.path().join("stage.pen")) {
				out.push((name, text));
			}
		}
	}
	out
}

/// A stage drawn as tiles the way the worker will, laid edge to edge into one picture: its pixels,
/// width and height.
fn draw_stage(g: &mut Gpu, pen: &str) -> Option<(Vec<u8>, u32, u32)> {
	let started = std::time::Instant::now();
	let (w, h) = fixtures::draw_stage(g, pen, &fonts())?;
	let out = g.read(fixtures::OUT)?;
	eprintln!("stage {w}×{h} in {:.0} ms (with read-back)", started.elapsed().as_secs_f64() * 1000.0);
	Some((out, w, h))
}

/// Real stages, drawn as tiles the way the worker will, and stitched into one picture.
#[test]
fn real_stages_draw() {
	let Some(mut g) = gpu() else { return };
	for (name, pen) in stages() {
		if let Some((out, w, h)) = draw_stage(&mut g, &pen) {
			save(&format!("stage-{name}"), &out, w, h);
		}
	}
}

/// The fixtures' fonts from `packages/stage/fonts/`, where they have been fetched (they are not
/// committed): without them, the fixtures with words are skipped.
fn fonts() -> stage_text::Text {
	let mut t = stage_text::Text::new();
	for (family, file, fallback) in fixtures::FONTS {
		if let Ok(bytes) = std::fs::read(format!("{}/../../fonts/{file}", env!("CARGO_MANIFEST_DIR"))) {
			t.add_font(family, bytes, fallback);
		}
	}
	t
}

fn draw_words(g: &mut Gpu) -> Option<Vec<u8>> {
	fixtures::draw(g, "words", &fonts())?;
	g.read(fixtures::OUT)
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
	let (w, h) = fixtures::draw(g, "card", &fonts())?;
	Some((g.read(fixtures::OUT)?, w, h))
}

/// A markdown card with every kind of block, drawn as a note.
#[test]
fn cards_are_drawn() {
	let Some(mut g) = gpu() else { return };
	let Some((p, w, h)) = draw_card(&mut g) else { return };
	save("card", &p, w, h);
	assert!(h > 800, "the note grew to hold its card: {h}");
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
	for (name, pen) in stages() {
		same(&name, draw_stage(&mut full, &pen).map(|s| s.0), draw_stage(&mut small, &pen).map(|s| s.0));
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

/// A list with no triangles is drawn with one sample even on a device with four: its shapes, clips,
/// layers and shadows come out as they do with four, since each carries its own soft edge.
#[test]
fn one_sample_draws_what_four_do() {
	use stage_paint::list::{Affine, Align, Clip, Paint, Shape};
	let Some(mut g) = gpu() else { return };
	let solid = |c: [f32; 4]| Paint::Solid(Color::straight(c, 1.0));
	let draw = |g: &mut Gpu, triangle: bool| {
		g.texture(1, TextureKind::Color, 200, 200, None);
		let mut list = DrawList::new(Color([1.0, 1.0, 1.0, 1.0]));
		let sq = |w: f32| Shape { w, h: w, radii: [6.0; 4], ellipse: false };
		list.push(Op::PushLayer { opacity: 0.5, blur: None });
		list.push(Op::Shape { shape: sq(40.0), transform: Affine::translate(10.3, 10.7), paint: solid([0.0, 0.0, 0.0, 1.0]), stroke: None });
		list.push(Op::PopLayer);
		// Turned a third of the way round: edges across the pixel grid.
		list.push(Op::Shape { shape: sq(50.0), transform: Affine([0.866, 0.5, -0.5, 0.866, 90.0, 10.0]), paint: solid([0.8, 0.1, 0.1, 1.0]), stroke: Some((3.0, Align::Center)) });
		list.push(Op::PushClip(Clip { shape: Shape { w: 40.0, h: 40.0, radii: [0.0; 4], ellipse: true }, transform: Affine::translate(110.5, 110.5) }));
		list.push(Op::Shape { shape: sq(80.0), transform: Affine::translate(100.0, 100.0), paint: solid([0.0, 0.6, 0.0, 1.0]), stroke: None });
		list.push(Op::PopClip);
		list.push(Op::Shadow { shape: sq(50.0), transform: Affine::translate(20.0, 120.0), color: Color::straight([0.0, 0.0, 0.0, 0.5], 1.0), blur: 12.0, spread: 0.0 });
		list.push(Op::Shape { shape: Shape { w: 30.0, h: 20.0, radii: [0.0; 4], ellipse: true }, transform: Affine::translate(25.5, 125.25), paint: solid([0.2, 0.3, 0.9, 1.0]), stroke: None });
		if triangle {
			// Nothing to see, but a triangle: the list is drawn with four samples.
			list.push(Op::Mesh { vertices: vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]], indices: vec![0, 1, 2], transform: Affine::translate(0.0, 0.0), paint: solid([1.0, 1.0, 1.0, 0.0]) });
		}
		let mut next = LAYER_IDS;
		let built = Built::build(&list, &mut next, &HashMap::new(), 200, 200, 8192);
		let samples = draw::samples_for(&built, g.pipelines.samples);
		g.draw(Target::Texture(1), &list);
		(g.read(1).unwrap(), samples)
	};
	let (one, n) = draw(&mut g, false);
	let (four, m) = draw(&mut g, true);
	assert_eq!((n, m), (1, 4), "samples without and with a triangle");
	save("one-sample", &one, 200, 200);
	save("four-samples", &four, 200, 200);
	let worst = one.iter().zip(&four).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
	assert!(worst <= 3, "the most a channel differs is {worst}");
}

/// What one page frame costs the card: the window and its slack covered in 512-pixel tiles, drawn
/// as the page draws them. `cargo test -p stage-gpu --release page_frame_cost -- --ignored --nocapture`.
#[test]
#[ignore]
fn page_frame_cost() {
	let Some(mut g) = gpu() else { return };
	for (name, w, h) in [("1440x900 window @2x", 4160u32, 3080u32), ("2560x1440 window @2x", 6400, 4160)] {
		g.texture(1, TextureKind::Color, w, h, None);
		let mut tiles = 0;
		let pixels = vec![200u8; (TILE * TILE * 4) as usize];
		for t in 0..64u32 {
			g.texture(100 + t, TextureKind::Color, TILE, TILE, Some(&pixels));
		}
		let mut list = DrawList::new(Color::TRANSPARENT);
		for y in 0..h.div_ceil(TILE) {
			for x in 0..w.div_ceil(TILE) {
				list.push(Op::Picture { texture: 100 + (tiles % 64), x: (x * TILE) as f32, y: (y * TILE) as f32, w: TILE as f32, h: TILE as f32, uv: [0.0, 0.0, 1.0, 1.0], opacity: 1.0 });
				tiles += 1;
			}
		}
		g.draw(Target::Texture(1), &list);
		g.device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
		let n = 20;
		let started = std::time::Instant::now();
		for _ in 0..n {
			g.draw(Target::Texture(1), &list);
			g.device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
		}
		eprintln!("{name}: {tiles} tiles, {:.2} ms a frame", started.elapsed().as_secs_f64() * 1000.0 / n as f64);
	}
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

/// How long drawing takes, without reading back: every tile of each stage (`fixtures/`, and any in
/// `STAGE_FIXTURES`), painted once, then drawn `STAGE_BENCH_ROUNDS` times (default 20). Run alone with `--ignored --nocapture`.
#[test]
#[ignore]
fn draw_bench() {
	let Some(mut g) = gpu() else { return };
	let rounds: usize = std::env::var("STAGE_BENCH_ROUNDS").ok().and_then(|r| r.parse().ok()).unwrap_or(20);
	for (name, text) in stages() {
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

/// A golden, premultiplied again as the textures are: its pixels, width and height.
fn read_golden(name: &str) -> Option<(Vec<u8>, u32, u32)> {
	let file = std::fs::File::open(format!("{}/goldens/{name}.png", env!("CARGO_MANIFEST_DIR"))).ok()?;
	let mut reader = png::Decoder::new(std::io::BufReader::new(file)).read_info().ok()?;
	let mut buf = vec![0; reader.output_buffer_size()?];
	let info = reader.next_frame(&mut buf).ok()?;
	assert_eq!((info.color_type, info.bit_depth), (png::ColorType::Rgba, png::BitDepth::Eight), "{name}.png: RGBA, 8 bits");
	buf.truncate(info.buffer_size());
	for p in buf.chunks_mut(4) {
		let a = p[3] as u32;
		for c in &mut p[..3] {
			*c = ((*c as u32 * a + 127) / 255) as u8;
		}
	}
	Some((buf, info.width, info.height))
}

/// How far a picture may be from its golden on this machine: a channel more than `GOLDEN_DELTA` off
/// on no more than `GOLDEN_SHARE` of its pixels. The goldens were drawn here, so the only slack
/// needed is the PNG's straight alpha (premultiplying again is ±1); the rest is room for another
/// Mac's GPU. The browsers' rule is looser (`stage-backends.ts`): they sample differently.
const GOLDEN_DELTA: u8 = 2;
const GOLDEN_SHARE: f64 = 0.001;

/// Pixels whose channels are more than `delta` from the golden's, and the largest difference.
fn differ(a: &[u8], b: &[u8], delta: u8) -> (usize, u8) {
	let mut far = 0;
	let mut most = 0;
	for (p, q) in a.chunks(4).zip(b.chunks(4)) {
		let d = p.iter().zip(q).map(|(x, y)| x.abs_diff(*y)).max().unwrap_or(0);
		most = most.max(d);
		if d > delta {
			far += 1;
		}
	}
	(far, most)
}

/// Hold `pixels` to golden `name`: or, with `STAGE_UPDATE_GOLDENS=1`, make them the golden. A miss
/// leaves a picture of where it differs in the system's temp folder.
fn golden(name: &str, device: &str, pixels: &[u8], width: u32, height: u32) {
	if std::env::var("STAGE_UPDATE_GOLDENS").is_ok_and(|v| v == "1") {
		if device == "full" {
			write_png(&format!("{}/goldens/{name}.png", env!("CARGO_MANIFEST_DIR")), pixels, width, height);
		}
		return;
	}
	let Some((want, w, h)) = read_golden(name) else { panic!("no goldens/{name}.png: draw it with STAGE_UPDATE_GOLDENS=1") };
	assert_eq!((width, height), (w, h), "{name} on the {device} device: its size");
	let (far, most) = differ(pixels, &want, GOLDEN_DELTA);
	let share = far as f64 / (w * h) as f64;
	if share > GOLDEN_SHARE {
		// Where it differs in red, over the golden in grey.
		let diff: Vec<u8> = pixels
			.chunks(4)
			.zip(want.chunks(4))
			.flat_map(|(p, q)| {
				let d = p.iter().zip(q).map(|(x, y)| x.abs_diff(*y)).max().unwrap_or(0);
				let grey = (q[0] as u32 + q[1] as u32 + q[2] as u32) / 3 / 3 + 170;
				if d > GOLDEN_DELTA { [255, 0, 0, 255] } else { [grey as u8, grey as u8, grey as u8, 255] }
			})
			.collect();
		let path = std::env::temp_dir().join(format!("stage-goldens/{name}-{device}-diff.png"));
		write_png(path.to_str().unwrap(), &diff, w, h);
		panic!("{name} on the {device} device: {far} pixels ({:.3}%) more than {GOLDEN_DELTA} off its golden, by up to {most}: {}", share * 100.0, path.display());
	}
}

/// Every fixture matches its golden, on a device with the full limits and on one held to WebGL 2's.
#[test]
fn fixtures_match_their_goldens() {
	let (Some(mut full), Some(mut small)) = (gpu(), webgl2_gpu()) else { return };
	let words = fonts();
	for (device, g) in [("full", &mut full), ("webgl2", &mut small)] {
		for name in fixtures::NAMES {
			let Some((w, h)) = fixtures::draw(g, name, &words) else {
				eprintln!("{name}: skipped, no fonts in packages/stage/fonts");
				continue;
			};
			golden(name, device, &g.read(fixtures::OUT).unwrap(), w, h);
		}
		if !words.has_fonts() {
			continue;
		}
		for name in fixtures::STAGES {
			let pen = std::fs::read_to_string(format!("{}/fixtures/{name}.pen", env!("CARGO_MANIFEST_DIR"))).unwrap();
			let (w, h) = fixtures::draw_stage(g, &pen, &words).unwrap();
			golden(&format!("stage-{name}"), device, &g.read(fixtures::OUT).unwrap(), w, h);
		}
	}
	assert!(!small.lost());
}

/// A texture let go of to the spares comes back for the next of its size and kind, and drawn after
/// a warm-up (`Gpu::warm`) the picture is the same as without one.
#[test]
fn spares_come_back_and_warming_draws_the_same() {
	let Some(mut cold) = gpu() else { return };
	let Some(mut g) = gpu() else { return };
	g.warm(true);
	assert_eq!(draw_shapes(&mut g), draw_shapes(&mut cold));
	g.make_spares(TextureKind::Color, 64, 64, 2);
	g.texture_from_spare(7, TextureKind::Color, 64, 64);
	let first = g.texture_handle(7).unwrap().clone();
	g.forget_to_spare(7);
	assert!(g.texture_handle(7).is_none());
	g.texture_from_spare(8, TextureKind::Color, 64, 64);
	assert_eq!(g.texture_handle(8).unwrap(), &first, "the spare let go of last is used first");
	// No more spares are kept than the cap.
	for id in 20..25 {
		g.texture_from_spare(id, TextureKind::Color, 64, 64);
	}
	for id in 20..25 {
		g.forget_to_spare(id);
	}
	assert_eq!(g.spare_textures[&(64, 64, TextureKind::Color as u8)].len(), 2);
}
