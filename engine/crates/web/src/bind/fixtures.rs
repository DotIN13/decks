//! The engine's fixture pictures for JavaScript: the browser checks draw them under each backend and
//! hold them to the native goldens (`stage-backends`).

use super::*;

/// The pictures every backend must draw alike (`stage_paint::fixtures`), for
/// `apps/web/scripts/stage-backends.ts` to hold to the native goldens (`crates/gpu/goldens/`) under
/// WebGPU and WebGL 2. Not used by the app.
#[wasm_bindgen]
pub struct Fixtures {
	words: stage_text::Text,
}

#[wasm_bindgen]
impl Fixtures {
	#[wasm_bindgen(constructor)]
	#[allow(clippy::new_without_default)]
	pub fn new() -> Fixtures {
		Fixtures { words: stage_text::Text::new() }
	}

	/// What there is to draw, as JSON: `{"fonts": [[family, file, fallback]], "names": [..],
	/// "stages": [..]}` (fonts from `packages/stage/fonts/`, stages from `crates/gpu/fixtures/`).
	pub fn list() -> String {
		use stage_paint::fixtures::{FONTS, NAMES, STAGES};
		serde_json::json!({ "fonts": FONTS, "names": NAMES, "stages": STAGES }).to_string()
	}

	/// One of the fonts `list` names, under its family.
	#[wasm_bindgen(js_name = addFont)]
	pub fn add_font(&mut self, family: &str, bytes: Vec<u8>, fallback: bool) {
		self.words.add_font(family, bytes, fallback);
	}

	/// Draw fixture `name` (with `pen`, a `.pen` file's text: that stage, the way the worker tiles
	/// it) and lay it on the handle's canvas pixel for pixel, over white. Size the canvas to the
	/// picture first: its golden's size. Its `[width, height]`.
	pub fn show(&self, handle: &mut GpuHandle, name: &str, pen: Option<String>) -> Result<Vec<u32>, JsError> {
		use stage_paint::fixtures;
		let gpu = &mut handle.gpu;
		let size = match pen {
			Some(pen) => fixtures::draw_stage(gpu, &pen, &self.words),
			None => fixtures::draw(gpu, name, &self.words),
		};
		let (w, h) = size.ok_or_else(|| err(format!("no fixture {name:?} (or no fonts for it)")))?;
		gpu.resize(w, h);
		let mut list = stage_paint::DrawList::new(stage_paint::Color([1.0, 1.0, 1.0, 1.0]));
		list.push(stage_paint::Op::Picture { texture: fixtures::OUT, x: 0.0, y: 0.0, w: w as f32, h: h as f32, uv: [0.0, 0.0, 1.0, 1.0], opacity: 1.0 });
		gpu.draw(Target::Screen, &list);
		Ok(vec![w, h])
	}
}
