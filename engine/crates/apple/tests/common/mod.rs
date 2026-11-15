//! What the tests share: the drawings, their fonts, goldens and the comparisons.

#![allow(dead_code)]

use serde_json::Value;
use stage_apple::{Engine, View};

pub const DRAWINGS: [&str; 6] = ["arrows", "flex-frames", "nested-groups", "notes-and-text", "refs", "themed"];
/// A channel may be this many levels off from the web engine's picture...
pub const DELTA: u8 = 3;
/// ...on at most this share of its pixels (the rule `stage-backends.ts` holds browsers to).
pub const SHARE: f64 = 0.005;
/// How far a box may be from the fixture's, in stage units.
pub const SLACK: f64 = 0.5;

const FONTS: [(&str, &str, bool); 6] = [
	("Inter", "inter_latest_latin-400-normal.ttf", false),
	("Inter", "inter_latest_latin-700-normal.ttf", false),
	("Inter", "inter_latest_latin-600-normal.ttf", false),
	("Inter", "inter_latest_latin-400-italic.ttf", false),
	("Noto Sans SC", "noto-sans-sc_latest_chinese-simplified-400-normal.ttf", true),
	("JetBrains Mono", "jetbrains-mono_latest_latin-400-normal.ttf", false),
];

pub fn drawing(name: &str, ext: &str) -> String {
	format!("{}/../../../tools/fixtures/drawings/{name}.{ext}", env!("CARGO_MANIFEST_DIR"))
}

pub fn golden(name: &str) -> String {
	format!("{}/goldens/{name}.png", env!("CARGO_MANIFEST_DIR"))
}

/// An engine on a drawing with the fixture fonts; none (and a note why) when the fonts are not fetched.
pub fn engine_for(name: &str) -> Option<Engine> {
	let pen = std::fs::read_to_string(drawing(name, "pen")).expect("the drawing");
	let mut engine = Engine::new(&pen, false, "test").expect("an engine on this Mac's Metal device");
	for (family, file, fallback) in FONTS {
		let path = format!("{}/../../fonts/{file}", env!("CARGO_MANIFEST_DIR"));
		let Ok(bytes) = std::fs::read(&path) else {
			eprintln!("skipped: no {file} (npm run fonts -w packages/stage)");
			return None;
		};
		engine.add_font(family, bytes, fallback);
	}
	Some(engine)
}

/// The view the golden was drawn at (`goldens/<name>.view.json`).
pub fn golden_view(name: &str) -> View {
	let path = format!("{}/goldens/{name}.view.json", env!("CARGO_MANIFEST_DIR"));
	let v: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("the golden's view")).unwrap();
	let n = |k: &str| v[k].as_f64().unwrap();
	View { x: n("x"), y: n("y"), zoom: n("zoom"), scale: n("scale"), width: n("width"), height: n("height") }
}

/// A PNG's pixels as straight RGBA: width, height.
pub fn read_png(path: &str) -> (Vec<u8>, u32, u32) {
	let bytes = std::fs::read(path).unwrap_or_else(|_| panic!("no {path}: draw it with tools/web-goldens.mjs"));
	let mut reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().unwrap();
	let mut buf = vec![0; reader.output_buffer_size().unwrap()];
	let info = reader.next_frame(&mut buf).unwrap();
	buf.truncate(info.buffer_size());
	let rgba = match info.color_type {
		png::ColorType::Rgba => buf,
		png::ColorType::Rgb => buf.chunks(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
		other => panic!("{path}: {other:?} is not read here"),
	};
	(rgba, info.width, info.height)
}

pub fn write_png(path: &str, rgba: &[u8], width: u32, height: u32) {
	let file = std::fs::File::create(path).unwrap();
	let mut enc = png::Encoder::new(std::io::BufWriter::new(file), width, height);
	enc.set_color(png::ColorType::Rgba);
	enc.set_depth(png::BitDepth::Eight);
	enc.write_header().unwrap().write_image_data(rgba).unwrap();
}

/// Premultiplied pixels laid over white, as the golden was read off the web page.
pub fn over_white(rgba: &[u8]) -> Vec<u8> {
	rgba.chunks(4).flat_map(|p| [p[0].saturating_add(255 - p[3]), p[1].saturating_add(255 - p[3]), p[2].saturating_add(255 - p[3]), 255]).collect()
}

/// Pixels with a channel more than `delta` apart, and the largest difference.
pub fn differ(a: &[u8], b: &[u8], delta: u8) -> (usize, u8) {
	let mut far = 0;
	let mut most = 0;
	for (p, q) in a.chunks(4).zip(b.chunks(4)) {
		let d = p.iter().zip(q).map(|(x, y)| x.abs_diff(*y)).max().unwrap_or(0);
		most = most.max(d);
		far += (d > delta) as usize;
	}
	(far, most)
}

/// With `STAGE_APPLE_SHOTS`, what was drawn and a picture of where it differs (red).
pub fn keep(name: &str, ours: &[u8], want: &[u8], w: u32, h: u32) {
	let Ok(dir) = std::env::var("STAGE_APPLE_SHOTS") else { return };
	std::fs::create_dir_all(&dir).unwrap();
	write_png(&format!("{dir}/{name}.png"), ours, w, h);
	let diff: Vec<u8> = ours.chunks(4).zip(want.chunks(4)).flat_map(|(p, q)| if p.iter().zip(q).any(|(x, y)| x.abs_diff(*y) > DELTA) { [255, 0, 0, 255] } else { [q[0] / 3 + 170, q[1] / 3 + 170, q[2] / 3 + 170, 255] }).collect();
	write_png(&format!("{dir}/{name}-diff.png"), &diff, w, h);
}

/// Items whose own size comes from their words: real fonts here, pen's estimate in the fixture.
fn sized_by_words(kind: &str, item: &Value) -> bool {
	let _ = item;
	kind == "text" || kind == "note"
}

/// Whether `at` is `id` or inside it, by the fixture's parents.
fn inside<'a>(mut at: &'a str, id: &str, items: &'a serde_json::Map<String, Value>) -> bool {
	loop {
		if at == id {
			return true;
		}
		match items.get(at).and_then(|it| it["parent"].as_str()) {
			Some(up) => at = up,
			None => return false,
		}
	}
}

/// How far words measured with real fonts are from pen's estimate, inside `id` (itself included):
/// the sum of each words-sized item's difference in width (`i` 3) or height (4).
fn words_slack(id: &str, i: usize, rows: &[Value], items: &serde_json::Map<String, Value>) -> f64 {
	let key = if i == 3 { "w" } else { "h" };
	items
		.iter()
		.filter(|(k, it)| sized_by_words(it["type"].as_str().unwrap_or(""), it) && inside(k, id, items))
		.filter_map(|(k, it)| rows.iter().find(|r| r[0] == k.as_str()).map(|r| (r[i].as_f64().unwrap() - it["box"][key].as_f64().unwrap()).abs()))
		.sum()
}

/// Where the native layout differs from a fixture's `layout.json`, one line each. Positions and
/// parents are held exactly; a size may differ only by the words inside it (`words_slack`).
pub fn compare_layout(name: &str, ours: &Value, want: &Value) -> Vec<String> {
	let mut misses = Vec::new();
	let rows = ours.as_array().unwrap();
	let items = want["items"].as_object().unwrap();
	for (id, item) in items {
		let Some(row) = rows.iter().find(|r| r[0] == id.as_str()) else {
			misses.push(format!("{name}/{id}: not laid out"));
			continue;
		};
		let kind = item["type"].as_str().unwrap_or("");
		for (k, i) in [("x", 1), ("y", 2), ("w", 3), ("h", 4)] {
			let (have, need) = (row[i].as_f64().unwrap(), item["box"][k].as_f64().unwrap());
			let slack = if i >= 3 { SLACK + words_slack(id, i, rows, items) } else { SLACK };
			if (have - need).abs() > slack {
				misses.push(format!("{name}/{id} ({kind}): {k} {have} where the fixture has {need} (allowed {slack:.1})"));
			}
		}
		if row[5] != item["parent"] {
			misses.push(format!("{name}/{id}: parent {} where the fixture has {}", row[5], item["parent"]));
		}
	}
	let mut by_order: Vec<(&String, i64)> = items.iter().map(|(id, it)| (id, it["order"].as_i64().unwrap())).collect();
	by_order.sort_by_key(|(_, o)| *o);
	let want_order: Vec<&str> = by_order.iter().map(|(id, _)| id.as_str()).collect();
	let mut ours_order: Vec<(&str, i64)> = rows.iter().filter(|r| items.contains_key(r[0].as_str().unwrap())).map(|r| (r[0].as_str().unwrap(), r[6].as_i64().unwrap())).collect();
	ours_order.sort_by_key(|(_, o)| *o);
	let ours_order: Vec<&str> = ours_order.into_iter().map(|(id, _)| id).collect();
	if ours_order != want_order {
		misses.push(format!("{name}: paint order {ours_order:?} where the fixture has {want_order:?}"));
	}
	misses
}

/// The words-sized items' own sizes beside the fixture's, for the report.
pub fn word_sizes(name: &str, ours: &Value, want: &Value) -> Vec<String> {
	let rows = ours.as_array().unwrap();
	let mut out = Vec::new();
	for (id, item) in want["items"].as_object().unwrap() {
		let kind = item["type"].as_str().unwrap_or("");
		if !sized_by_words(kind, item) {
			continue;
		}
		if let Some(r) = rows.iter().find(|r| r[0] == id.as_str()) {
			out.push(format!("{name}/{id}: {:.1}×{:.1} here, {}×{} estimated", r[3].as_f64().unwrap(), r[4].as_f64().unwrap(), item["box"]["w"], item["box"]["h"]));
		}
	}
	out
}
