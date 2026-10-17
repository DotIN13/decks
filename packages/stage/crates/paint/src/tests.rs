use crate::painter::{Context, paint_area};
use crate::*;
use serde_json::json;
use stage_doc::Document;
use stage_scene::layout::Estimate;
use stage_scene::{Rect, Scene};
use std::collections::HashSet;

fn scene(v: serde_json::Value) -> (Document, Scene) {
	let d = Document::from_json(v).unwrap();
	let s = Scene::new(&d, false, &Estimate);
	(d, s)
}

fn no_images(_: &str) -> Option<(u32, u32, u32)> {
	None
}

fn paint(s: &Scene, area: Rect, scale: f64) -> DrawList {
	let skip = HashSet::new();
	let ctx = Context::new(s, &skip, &no_images);
	paint_area(&ctx, area, scale, Color::TRANSPARENT)
}

fn kinds(list: &DrawList) -> Vec<&'static str> {
	list.ops
		.iter()
		.map(|op| match op {
			Op::Shape { stroke: Some(_), .. } => "stroke",
			Op::Shape { .. } => "shape",
			Op::Shadow { .. } => "shadow",
			Op::Mesh { .. } => "mesh",
			Op::Glyphs { .. } => "glyphs",
			Op::PushClip(_) => "clip",
			Op::PopClip => "/clip",
			Op::PushLayer { .. } => "layer",
			Op::PopLayer => "/layer",
		})
		.collect()
}

#[test]
fn a_frame_clips_its_children_and_strokes_over_them() {
	let (_, s) = scene(json!({"children":[
		{"type":"frame","id":"f","x":10,"y":10,"width":100,"height":100,"clip":true,"layout":"none","fill":"#eee","stroke":"#000","strokeWidth":2,"children":[
			{"type":"rectangle","id":"r","x":50,"y":50,"width":100,"height":100,"fill":"#f00"}
		]}
	]}));
	let list = paint(&s, Rect { x: 0.0, y: 0.0, w: 512.0, h: 512.0 }, 1.0);
	assert_eq!(kinds(&list), vec!["shape", "clip", "shape", "/clip", "stroke"]);
	// The child is in target pixels: at (60, 60).
	let Op::Shape { transform, .. } = &list.ops[2] else { panic!() };
	assert_eq!(transform.apply(0.0, 0.0), (60.0, 60.0));
}

#[test]
fn opacity_is_a_layer_round_children_and_a_fade_on_a_leaf() {
	let (_, s) = scene(json!({"children":[
		{"type":"frame","id":"f","opacity":0.5,"layout":"none","width":50,"height":50,"children":[{"type":"rectangle","id":"a","width":10,"height":10,"fill":"#000"}]},
		{"type":"rectangle","id":"b","x":100,"opacity":0.5,"width":10,"height":10,"fill":"#000"}
	]}));
	let list = paint(&s, Rect { x: 0.0, y: 0.0, w: 512.0, h: 512.0 }, 1.0);
	assert_eq!(kinds(&list), vec!["layer", "shape", "/layer", "shape"]);
	let Op::Shape { paint: Paint::Solid(c), .. } = &list.ops[3] else { panic!() };
	assert_eq!(c.0[3], 0.5);
}

#[test]
fn an_area_draws_what_meets_it_and_opens_scopes_it_is_inside() {
	let (_, s) = scene(json!({"children":[
		{"type":"frame","id":"f","width":2000,"height":100,"clip":true,"layout":"none","children":[
			{"type":"rectangle","id":"left","x":0,"width":10,"height":10,"fill":"#000"},
			{"type":"rectangle","id":"right","x":1500,"width":10,"height":10,"fill":"#000"}
		]}
	]}));
	// A tile far right: the frame (no fill) and its clip, then only the right child.
	let list = paint(&s, Rect { x: 1024.0, y: 0.0, w: 512.0, h: 512.0 }, 1.0);
	assert_eq!(kinds(&list), vec!["clip", "shape", "/clip"]);
	let Op::Shape { transform, .. } = &list.ops[1] else { panic!() };
	assert_eq!(transform.apply(0.0, 0.0), (476.0, 0.0));
}

#[test]
fn paths_polygons_and_lifted_items() {
	let (_, s) = scene(json!({"children":[
		{"type":"path","id":"p","geometry":"M0 0 L100 0 L100 100 Z","fill":"#000","stroke":"#f00","strokeWidth":2},
		{"type":"polygon","id":"q","x":200,"polygonCount":6,"fill":"#000"},
		{"type":"rectangle","id":"lifted","x":300,"fill":"#000"}
	]}));
	let skip: HashSet<String> = ["lifted".to_owned()].into();
	let ctx = Context::new(&s, &skip, &no_images);
	let list = paint_area(&ctx, Rect { x: 0.0, y: 0.0, w: 512.0, h: 512.0 }, 2.0, Color::TRANSPARENT);
	assert_eq!(kinds(&list), vec!["mesh", "mesh", "mesh"]);
}

#[test]
fn pictures_wait_for_their_texture() {
	let (_, s) = scene(json!({"children":[{"type":"rectangle","id":"r","fill":{"type":"image","url":"a.png"}}]}));
	let skip = HashSet::new();
	let ctx = Context::new(&s, &skip, &no_images);
	let list = paint_area(&ctx, Rect { x: 0.0, y: 0.0, w: 512.0, h: 512.0 }, 1.0, Color::TRANSPARENT);
	assert!(list.ops.is_empty());
	assert_eq!(ctx.wanted.borrow().as_slice(), ["a.png"]);
	let loaded = |_: &str| Some((7, 200, 100));
	let ctx = Context::new(&s, &skip, &loaded);
	let list = paint_area(&ctx, Rect { x: 0.0, y: 0.0, w: 512.0, h: 512.0 }, 1.0, Color::TRANSPARENT);
	// A 200 × 100 picture filling a 100 × 100 box shows its middle half.
	let Op::Shape { paint: Paint::Image { texture, uv, .. }, .. } = &list.ops[0] else { panic!() };
	assert_eq!((*texture, *uv), (7, [0.25, 0.0, 0.75, 1.0]));
}

#[test]
fn the_recording_backend_takes_tiles() {
	let (_, s) = scene(json!({"children":[{"type":"rectangle","id":"r","fill":"#000"}]}));
	let mut grid = tiles::Grid::new(64, 1);
	let mut gpu = Recording::default();
	let view = Rect { x: -100.0, y: -100.0, w: 800.0, h: 600.0 };
	let wanted = tiles::Grid::covering(&view, 2.0, 0);
	for key in grid.to_paint(&wanted, 4) {
		let list = paint(&s, key.area(), key.scale());
		let texture = grid.painted(key, 1);
		gpu.texture(texture, TextureKind::Color, tiles::TILE, tiles::TILE, None);
		gpu.draw(Target::Texture(texture), &list);
	}
	assert_eq!(gpu.frames.len(), 4);
	assert!(gpu.frames.iter().any(|(_, l)| !l.ops.is_empty()));
}

/// Every saved stage paints, whole, at one scale; and how long the painter takes.
#[test]
fn real_stages_paint() {
	let Ok(root) = std::env::var("STAGE_FIXTURES") else { return };
	let mut files = Vec::new();
	collect(std::path::Path::new(&root), &mut files);
	let (mut ops, mut total) = (0usize, 0.0f64);
	for path in files {
		let Ok(text) = std::fs::read_to_string(&path) else { continue };
		let Ok(d) = Document::parse(&text) else { continue };
		let s = Scene::new(&d, false, &Estimate);
		let extent = s.roots.iter().fold(None::<Rect>, |acc, r| Some(acc.map_or(r.extent, |a| a.union(&r.extent))));
		let Some(extent) = extent else { continue };
		let start = std::time::Instant::now();
		let list = paint(&s, extent, 1.0);
		total += start.elapsed().as_secs_f64() * 1000.0;
		ops += list.ops.len();
	}
	eprintln!("{ops} ops painted in {total:.1} ms");
}

fn collect(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
	if let Ok(read) = std::fs::read_dir(dir) {
		for e in read.flatten() {
			let p = e.path();
			if p.is_dir() {
				collect(&p, out);
			} else if p.extension().is_some_and(|x| x == "pen") {
				out.push(p);
			}
		}
	}
}
