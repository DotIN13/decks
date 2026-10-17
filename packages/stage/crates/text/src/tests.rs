use super::*;
use stage_scene::layout::TextStyle;

/// The fonts fetched into `packages/stage/fonts` (see its README line in `fonts/.gitignore`).
pub fn with_fonts() -> Option<Text> {
	let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fonts");
	let read = |f: &str| std::fs::read(format!("{dir}/{f}")).ok();
	let mut t = Text::new();
	t.add_font("Inter", read("inter_latest_latin-400-normal.ttf")?, false);
	for f in ["inter_latest_latin-700-normal.ttf", "inter_latest_latin-600-normal.ttf", "inter_latest_latin-400-italic.ttf"] {
		t.add_font("Inter", read(f)?, false);
	}
	t.add_font("JetBrains Mono", read("jetbrains-mono_latest_latin-400-normal.ttf")?, false);
	if let Some(sc) = read("noto-sans-sc_latest_chinese-simplified-400-normal.ttf") {
		t.add_font("Noto Sans SC", sc, true);
	}
	Some(t)
}

fn style(size: f64) -> TextStyle {
	TextStyle { family: "Inter".into(), size, weight: 400.0, italic: false, letter_spacing: 0.0, line_height: None }
}

#[test]
fn words_are_measured_and_wrapped() {
	let Some(t) = with_fonts() else { return };
	let item = stage_scene::tree::Item { id: "x".into(), props: Default::default(), parent: None, children: vec![], handle: None };
	let (w, h) = t.measure("Hello, world", &style(14.0), None, &item);
	assert!(w > 60.0 && w < 110.0, "{w}");
	assert!(h > 14.0 && h < 22.0, "{h}");
	let (w2, h2) = t.measure("Hello, world, this wraps onto more than one line", &style(14.0), Some(100.0), &item);
	assert!(w2 <= 100.0 && h2 > h * 2.5, "{w2} {h2}");
	let bold = TextStyle { weight: 700.0, ..style(14.0) };
	assert!(t.measure("Hello, world", &bold, None, &item).0 > w, "bold is wider");
	// Chinese from the fallback file.
	let laid = t.lay(&[Span { text: "你好 hi", style: &style(14.0), brush: 0, underline: false, strike: false }], None, Align::Left);
	assert!(laid.runs.len() >= 2, "{}", laid.runs.len());
}

#[test]
fn glyphs_go_into_the_atlas_once() {
	let Some(t) = with_fonts() else { return };
	let laid = t.lay(&[Span { text: "Hallo", style: &style(20.0), brush: 0, underline: true, strike: false }], None, Align::Left);
	assert_eq!(laid.rules.len(), 1);
	let mut atlas = atlas::Atlas::new();
	let run = &laid.runs[0];
	let mut slots = Vec::new();
	for (g, _, _) in &run.glyphs {
		slots.push(atlas.glyph(run, *g, 20.0, 0.0));
	}
	let uploads = atlas.uploads.len();
	// "l" twice: one upload fewer than glyphs.
	assert_eq!(uploads, 4);
	let again = atlas.glyph(run, run.glyphs[0].0, 20.0, 0.0);
	assert_eq!(again, slots[0]);
	assert_eq!(atlas.uploads.len(), uploads);
	// A different quarter-pixel offset is a different glyph.
	atlas.glyph(run, run.glyphs[0].0, 20.0, 0.5);
	assert_eq!(atlas.uploads.len(), uploads + 1);
}
