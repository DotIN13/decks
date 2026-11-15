//! The six drawings in `tools/fixtures/drawings/`, through the native engine: laid out as their
//! `layout.json` says (README rule 10), and drawn as the browser's engine drew them, `goldens/`
//! (rule 9). Set `STAGE_APPLE_SHOTS` to a folder to keep what was drawn and where it differs.

#![cfg(target_vendor = "apple")]

mod common;

use common::*;
use serde_json::Value;

/// Every item's box, parent and paint order, against the fixture's.
#[test]
fn the_six_drawings_lay_out_as_their_fixtures() {
	let mut misses = Vec::new();
	for name in DRAWINGS {
		let Some(engine) = engine_for(name) else { return };
		let want: Value = serde_json::from_str(&std::fs::read_to_string(drawing(name, "layout.json")).unwrap()).unwrap();
		misses.extend(compare_layout(name, &engine.layout(), &want));
	}
	assert!(misses.is_empty(), "{} differences:\n{}", misses.len(), misses.join("\n"));
}

/// Each drawing drawn natively into a texture and read back, held to the browser engine's picture.
#[test]
fn the_six_drawings_draw_as_the_web_engine_does() {
	let mut misses = Vec::new();
	for name in DRAWINGS {
		let Some(mut engine) = engine_for(name) else { return };
		let view = golden_view(name);
		let (rgba, w, h) = engine.pixels(&view).expect("drawn");
		let (want, gw, gh) = read_png(&golden(name));
		assert_eq!((w, h), (gw, gh), "{name}: the picture's size");
		let ours = over_white(&rgba);
		keep(name, &ours, &want, w, h);
		let (far, most) = differ(&ours, &want, DELTA);
		let share = far as f64 / (w * h) as f64;
		eprintln!("{name}: {w}×{h}, {far} pixels more than {DELTA} off ({:.3}%), most {most}", share * 100.0);
		if share > SHARE {
			misses.push(format!("{name}: {far} pixels more than {DELTA} levels off ({:.2}%), the most {most}", share * 100.0));
		}
	}
	assert!(misses.is_empty(), "{}", misses.join("\n"));
}
