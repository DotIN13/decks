//! Measuring words for JavaScript, with no stage: the page's text editors ask how big words set in
//! the app's fonts will be, as the engine lays them out.

use super::*;

/// Words measured as the page lays them out, for the server: the same text crate, fonts and
/// markdown reader, so a box an agent reads back from an edit is the box the page draws.
#[wasm_bindgen]
pub struct TextMeasure {
	text: stage_text::Text,
}

#[wasm_bindgen]
impl TextMeasure {
	#[wasm_bindgen(constructor)]
	pub fn new() -> TextMeasure {
		TextMeasure { text: stage_text::Text::new() }
	}

	#[wasm_bindgen(js_name = addFont)]
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		self.text.add_font(name, bytes, fallback);
	}

	#[wasm_bindgen(js_name = setMarkdownReader)]
	pub fn set_markdown_reader(&mut self, read: js_sys::Function) {
		self.text.set_reader(reader(read));
	}

	#[wasm_bindgen(js_name = setMath)]
	pub fn set_math(&mut self, typeset: js_sys::Function) {
		self.text.set_math(typesetter(typeset));
	}

	/// `[w, h]` of words in a style (`{ fontFamily, fontSize, fontWeight, fontStyle, letterSpacing,
	/// lineHeight }`), wrapped at `max_width` when it is not negative. A card's markdown (`markdown`)
	/// is laid out at that width, aligned by `align`, and its height is the card's.
	pub fn measure(&self, text: &str, style: &str, max_width: f64, markdown: bool, align: &str) -> Vec<f64> {
		measure_words(&self.text, text, style, max_width, markdown, align)
	}
}

impl Default for TextMeasure {
	fn default() -> Self {
		Self::new()
	}
}

/// `[w, h]` of words with a text system's fonts and readers: `TextMeasure`'s, or the page engine's own.
pub(crate) fn measure_words(words: &stage_text::Text, text: &str, style: &str, max_width: f64, markdown: bool, align: &str) -> Vec<f64> {
	let v: serde_json::Value = serde_json::from_str(style).unwrap_or_default();
	let num = |k: &str| v.get(k).and_then(serde_json::Value::as_f64);
	let style = stage_scene::layout::TextStyle {
		family: v.get("fontFamily").and_then(serde_json::Value::as_str).unwrap_or("Inter").to_owned(),
		size: num("fontSize").unwrap_or(16.0),
		weight: num("fontWeight").unwrap_or(400.0),
		italic: v.get("fontStyle").and_then(serde_json::Value::as_str) == Some("italic"),
		letter_spacing: num("letterSpacing").unwrap_or(0.0),
		line_height: num("lineHeight"),
	};
	let max = (max_width >= 0.0).then_some(max_width);
	if markdown {
		let width = max.unwrap_or(240.0).max(1.0) as f32;
		let align = match align {
			"center" => stage_text::Align::Center,
			"right" => stage_text::Align::Right,
			"justify" => stage_text::Align::Justify,
			_ => stage_text::Align::Left,
		};
		return vec![width as f64, words.card(text, &style, width, align).height as f64];
	}
	let item = stage_scene::tree::Item { id: String::new(), props: Default::default(), parent: None, children: Vec::new(), handle: None };
	let (w, h) = stage_scene::layout::Measure::measure(words, text, &style, max, &item);
	vec![w, h]
}
