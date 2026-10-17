//! What a field means once its variables are resolved.
//!
//! A `.pen` value may be `$name`, bound to a document variable whose value can differ by theme. The
//! theme in force is the nearest `theme` on the item or its ancestors, over the stage's own (light or
//! dark), over the first value of each axis. A variable missing here is looked up in the files this
//! one imports, so a component from another file keeps its colours.

use serde_json::{Map, Value};
use std::rc::Rc;

pub type Props = Map<String, Value>;

/// The theme in force: axis → value, few enough that a sorted list beats a map.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Theme(pub Vec<(String, String)>);

impl Theme {
	pub fn get(&self, axis: &str) -> Option<&str> {
		self.0.iter().find(|(a, _)| a == axis).map(|(_, v)| v.as_str())
	}

	/// This theme with an item's own `theme` laid over it, shared when the item sets none.
	pub fn with(self: &Rc<Theme>, props: &Props) -> Rc<Theme> {
		match props.get("theme") {
			Some(Value::Object(own)) if !own.is_empty() => {
				let mut next = (**self).clone();
				for (axis, value) in own {
					let Some(value) = value.as_str() else { continue };
					match next.0.iter_mut().find(|(a, _)| a == axis) {
						Some(slot) => slot.1 = value.to_owned(),
						None => next.0.push((axis.clone(), value.to_owned())),
					}
				}
				Rc::new(next)
			}
			_ => self.clone(),
		}
	}
}

/// The document's fields that values read: its variables and themes, and its imports' variables.
#[derive(Clone, Debug, Default)]
pub struct Vars {
	pub variables: Props,
	pub themes: Props,
	pub imported: Vec<Props>,
}

impl Vars {
	pub fn from_meta(meta: &Props) -> Vars {
		let object = |key: &str| meta.get(key).and_then(Value::as_object).cloned().unwrap_or_default();
		let imported = meta
			.get("decks.imported")
			.and_then(Value::as_object)
			.map(|files| files.values().filter_map(|f| f.get("variables").and_then(Value::as_object).cloned()).collect())
			.unwrap_or_default();
		Vars { variables: object("variables"), themes: object("themes"), imported }
	}

	/// The starting theme for a stage shown light or dark: each axis whose values name the mode takes it.
	pub fn base_theme(&self, dark: bool) -> Theme {
		let mode = if dark { "dark" } else { "light" };
		let mut out = Vec::new();
		for (axis, values) in &self.themes {
			let Some(values) = values.as_array() else { continue };
			let names: Vec<&str> = values.iter().filter_map(Value::as_str).collect();
			if let Some(pick) = names.iter().find(|v| v.eq_ignore_ascii_case(mode)).or(names.first()) {
				out.push((axis.clone(), (*pick).to_owned()));
			}
		}
		Theme(out)
	}

	/// A variable's value in this theme, following `$a` → `$b` chains.
	pub fn variable<'a>(&'a self, name: &str, theme: &Theme, depth: u32) -> Option<&'a Value> {
		let key = name.strip_prefix('$').unwrap_or(name);
		let def = self.variables.get(key).or_else(|| self.imported.iter().find_map(|v| v.get(key)))?;
		if depth > 8 {
			return None;
		}
		let value = match def.get("value") {
			Some(Value::Array(entries)) => {
				let fits = |entry: &Value| match entry.get("theme").and_then(Value::as_object) {
					None => true,
					Some(want) => want.iter().all(|(axis, v)| v.as_str().is_some_and(|v| theme.get(axis) == Some(v))),
				};
				// The most specific entry that fits: a themed match beats the plain default.
				let themed = entries.iter().filter(|e| e.get("theme").is_some() && fits(e)).last();
				let plain = entries.iter().find(|e| e.get("theme").is_none());
				themed.or(plain).or(entries.first()).and_then(|e| e.get("value"))?
			}
			Some(v) => v,
			None => return None,
		};
		match value.as_str() {
			Some(s) if is_variable(s) => self.variable(s, theme, depth + 1),
			_ => Some(value),
		}
	}

	pub fn resolve<'a>(&'a self, value: Option<&'a Value>, theme: &Theme) -> Option<&'a Value> {
		match value {
			Some(Value::String(s)) if is_variable(s) => self.variable(s, theme, 0),
			other => other,
		}
	}

	pub fn num(&self, value: Option<&Value>, theme: &Theme, fallback: f64) -> f64 {
		match self.resolve(value, theme) {
			Some(Value::Number(n)) => n.as_f64().filter(|f| f.is_finite()).unwrap_or(fallback),
			Some(Value::String(s)) => s.trim().parse::<f64>().ok().filter(|f| f.is_finite()).unwrap_or(fallback),
			_ => fallback,
		}
	}

	pub fn bool(&self, value: Option<&Value>, theme: &Theme, fallback: bool) -> bool {
		self.resolve(value, theme).and_then(Value::as_bool).unwrap_or(fallback)
	}

	pub fn str<'a>(&'a self, value: Option<&'a Value>, theme: &Theme) -> Option<&'a str> {
		self.resolve(value, theme).and_then(Value::as_str)
	}

	pub fn color(&self, value: Option<&Value>, theme: &Theme) -> Option<Rgba> {
		self.str(value, theme).and_then(parse_color)
	}

	/// Padding as top, right, bottom, left, from any of pen's three forms.
	pub fn padding(&self, props: &Props, theme: &Theme) -> [f64; 4] {
		match props.get("padding") {
			Some(Value::Array(list)) => {
				let v: Vec<f64> = list.iter().map(|x| self.num(Some(x), theme, 0.0)).collect();
				let at = |i: usize| v.get(i).copied().unwrap_or(0.0);
				if v.len() == 2 { [at(0), at(1), at(0), at(1)] } else { [at(0), at(1), at(2), at(3)] }
			}
			other => [self.num(other, theme, 0.0); 4],
		}
	}

	/// Corner radii: top-left, top-right, bottom-right, bottom-left.
	pub fn radii(&self, props: &Props, theme: &Theme) -> [f64; 4] {
		match props.get("cornerRadius") {
			Some(Value::Array(list)) => {
				let at = |i: usize| list.get(i).map_or(0.0, |x| self.num(Some(x), theme, 0.0));
				[at(0), at(1), at(2), at(3)]
			}
			other => [self.num(other, theme, 0.0); 4],
		}
	}

	pub fn font_weight(&self, props: &Props, theme: &Theme) -> f64 {
		match self.resolve(props.get("fontWeight"), theme) {
			Some(Value::Number(n)) => n.as_f64().unwrap_or(400.0),
			Some(Value::String(s)) => match s.to_ascii_lowercase().as_str() {
				"thin" => 100.0,
				"extralight" => 200.0,
				"light" => 300.0,
				"normal" | "regular" => 400.0,
				"medium" => 500.0,
				"semibold" => 600.0,
				"bold" => 700.0,
				"extrabold" => 800.0,
				"black" => 900.0,
				other => other.parse().unwrap_or(400.0),
			},
			_ => 400.0,
		}
	}
}

pub fn is_variable(s: &str) -> bool {
	s.len() > 1 && s.starts_with('$')
}

/// Red, green, blue, alpha, each 0 to 1, not premultiplied.
pub type Rgba = [f32; 4];

/// A colour in any notation a person or an agent is likely to write: hex, a CSS name, `rgb()`,
/// `rgba()`, `hsl()`, `hsla()` or `transparent`.
pub fn parse_color(text: &str) -> Option<Rgba> {
	let value = text.trim().to_ascii_lowercase();
	if value.is_empty() {
		return None;
	}
	if value == "transparent" {
		return Some([0.0; 4]);
	}
	let hex = named(&value).unwrap_or_else(|| value.trim_start_matches('#'));
	if !hex.is_empty() && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
		let expanded: String = if hex.len() <= 4 { hex.chars().flat_map(|c| [c, c]).collect() } else { hex.to_owned() };
		if expanded.len() != 6 && expanded.len() != 8 {
			return None;
		}
		let at = |i: usize| u8::from_str_radix(&expanded[i..i + 2], 16).map(|v| v as f32 / 255.0).ok();
		return Some([at(0)?, at(2)?, at(4)?, if expanded.len() == 8 { at(6)? } else { 1.0 }]);
	}
	let open = value.find('(')?;
	if !value.ends_with(')') {
		return None;
	}
	let name = &value[..open];
	let parts: Vec<&str> = value[open + 1..value.len() - 1].split([' ', ',', '/']).filter(|s| !s.is_empty()).collect();
	if parts.len() < 3 {
		return None;
	}
	let n = |i: usize, of: f32| -> Option<f32> {
		let part = parts[i];
		let v: f32 = part.trim_end_matches('%').parse().ok()?;
		Some(if part.ends_with('%') { v / 100.0 * of } else { v })
	};
	let alpha = if parts.len() > 3 { n(3, 1.0)? } else { 1.0 };
	let clamp = |v: f32| v.clamp(0.0, 1.0);
	match name {
		"rgb" | "rgba" => Some([clamp(n(0, 255.0)? / 255.0), clamp(n(1, 255.0)? / 255.0), clamp(n(2, 255.0)? / 255.0), clamp(alpha)]),
		"hsl" | "hsla" => {
			let plain = |i: usize| parts[i].trim_end_matches('%').parse::<f32>().ok();
			let (h, s, l) = (plain(0)?, clamp(plain(1)? / 100.0), clamp(plain(2)? / 100.0));
			let turn = h.rem_euclid(360.0);
			let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
			let x = c * (1.0 - ((turn / 60.0) % 2.0 - 1.0).abs());
			let m = l - c / 2.0;
			let (r, g, b) = match turn {
				t if t < 60.0 => (c, x, 0.0),
				t if t < 120.0 => (x, c, 0.0),
				t if t < 180.0 => (0.0, c, x),
				t if t < 240.0 => (0.0, x, c),
				t if t < 300.0 => (x, 0.0, c),
				_ => (c, 0.0, x),
			};
			Some([clamp(r + m), clamp(g + m), clamp(b + m), clamp(alpha)])
		}
		_ => None,
	}
}

fn named(name: &str) -> Option<&'static str> {
	// The 148 colour names CSS knows: people and agents write "lightblue" sooner than "#add8e6".
	const NAMES: &[(&str, &str)] = &[
		("aliceblue", "f0f8ff"), ("antiquewhite", "faebd7"), ("aqua", "00ffff"), ("aquamarine", "7fffd4"), ("azure", "f0ffff"), ("beige", "f5f5dc"),
		("bisque", "ffe4c4"), ("black", "000000"), ("blanchedalmond", "ffebcd"), ("blue", "0000ff"), ("blueviolet", "8a2be2"), ("brown", "a52a2a"),
		("burlywood", "deb887"), ("cadetblue", "5f9ea0"), ("chartreuse", "7fff00"), ("chocolate", "d2691e"), ("coral", "ff7f50"),
		("cornflowerblue", "6495ed"), ("cornsilk", "fff8dc"), ("crimson", "dc143c"), ("cyan", "00ffff"), ("darkblue", "00008b"),
		("darkcyan", "008b8b"), ("darkgoldenrod", "b8860b"), ("darkgray", "a9a9a9"), ("darkgreen", "006400"), ("darkgrey", "a9a9a9"),
		("darkkhaki", "bdb76b"), ("darkmagenta", "8b008b"), ("darkolivegreen", "556b2f"), ("darkorange", "ff8c00"), ("darkorchid", "9932cc"),
		("darkred", "8b0000"), ("darksalmon", "e9967a"), ("darkseagreen", "8fbc8f"), ("darkslateblue", "483d8b"), ("darkslategray", "2f4f4f"),
		("darkslategrey", "2f4f4f"), ("darkturquoise", "00ced1"), ("darkviolet", "9400d3"), ("deeppink", "ff1493"), ("deepskyblue", "00bfff"),
		("dimgray", "696969"), ("dimgrey", "696969"), ("dodgerblue", "1e90ff"), ("firebrick", "b22222"), ("floralwhite", "fffaf0"),
		("forestgreen", "228b22"), ("fuchsia", "ff00ff"), ("gainsboro", "dcdcdc"), ("ghostwhite", "f8f8ff"), ("gold", "ffd700"),
		("goldenrod", "daa520"), ("gray", "808080"), ("green", "008000"), ("greenyellow", "adff2f"), ("grey", "808080"), ("honeydew", "f0fff0"),
		("hotpink", "ff69b4"), ("indianred", "cd5c5c"), ("indigo", "4b0082"), ("ivory", "fffff0"), ("khaki", "f0e68c"), ("lavender", "e6e6fa"),
		("lavenderblush", "fff0f5"), ("lawngreen", "7cfc00"), ("lemonchiffon", "fffacd"), ("lightblue", "add8e6"), ("lightcoral", "f08080"),
		("lightcyan", "e0ffff"), ("lightgoldenrodyellow", "fafad2"), ("lightgray", "d3d3d3"), ("lightgreen", "90ee90"), ("lightgrey", "d3d3d3"),
		("lightpink", "ffb6c1"), ("lightsalmon", "ffa07a"), ("lightseagreen", "20b2aa"), ("lightskyblue", "87cefa"), ("lightslategray", "778899"),
		("lightslategrey", "778899"), ("lightsteelblue", "b0c4de"), ("lightyellow", "ffffe0"), ("lime", "00ff00"), ("limegreen", "32cd32"),
		("linen", "faf0e6"), ("magenta", "ff00ff"), ("maroon", "800000"), ("mediumaquamarine", "66cdaa"), ("mediumblue", "0000cd"),
		("mediumorchid", "ba55d3"), ("mediumpurple", "9370db"), ("mediumseagreen", "3cb371"), ("mediumslateblue", "7b68ee"),
		("mediumspringgreen", "00fa9a"), ("mediumturquoise", "48d1cc"), ("mediumvioletred", "c71585"), ("midnightblue", "191970"),
		("mintcream", "f5fffa"), ("mistyrose", "ffe4e1"), ("moccasin", "ffe4b5"), ("navajowhite", "ffdead"), ("navy", "000080"),
		("oldlace", "fdf5e6"), ("olive", "808000"), ("olivedrab", "6b8e23"), ("orange", "ffa500"), ("orangered", "ff4500"), ("orchid", "da70d6"),
		("palegoldenrod", "eee8aa"), ("palegreen", "98fb98"), ("paleturquoise", "afeeee"), ("palevioletred", "db7093"), ("papayawhip", "ffefd5"),
		("peachpuff", "ffdab9"), ("peru", "cd853f"), ("pink", "ffc0cb"), ("plum", "dda0dd"), ("powderblue", "b0e0e6"), ("purple", "800080"),
		("rebeccapurple", "663399"), ("red", "ff0000"), ("rosybrown", "bc8f8f"), ("royalblue", "4169e1"), ("saddlebrown", "8b4513"),
		("salmon", "fa8072"), ("sandybrown", "f4a460"), ("seagreen", "2e8b57"), ("seashell", "fff5ee"), ("sienna", "a0522d"), ("silver", "c0c0c0"),
		("skyblue", "87ceeb"), ("slateblue", "6a5acd"), ("slategray", "708090"), ("slategrey", "708090"), ("snow", "fffafa"),
		("springgreen", "00ff7f"), ("steelblue", "4682b4"), ("tan", "d2b48c"), ("teal", "008080"), ("thistle", "d8bfd8"), ("tomato", "ff6347"),
		("turquoise", "40e0d0"), ("violet", "ee82ee"), ("wheat", "f5deb3"), ("white", "ffffff"), ("whitesmoke", "f5f5f5"), ("yellow", "ffff00"),
		("yellowgreen", "9acd32"),
	];
	NAMES.iter().find(|(n, _)| *n == name).map(|(_, hex)| *hex)
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn colours() {
		assert_eq!(parse_color("#fff"), Some([1.0, 1.0, 1.0, 1.0]));
		assert_eq!(parse_color("#00000080").map(|c| (c[3] * 255.0).round()), Some(128.0));
		assert_eq!(parse_color("lightblue"), parse_color("#add8e6"));
		assert_eq!(parse_color("rgb(255, 0, 0)"), Some([1.0, 0.0, 0.0, 1.0]));
		assert_eq!(parse_color("rgba(0 0 255 / 50%)"), Some([0.0, 0.0, 1.0, 0.5]));
		assert_eq!(parse_color("hsl(120, 100%, 50%)"), Some([0.0, 1.0, 0.0, 1.0]));
		assert_eq!(parse_color("nonsense"), None);
	}

	#[test]
	fn themed_variables() {
		let meta: Props = serde_json::from_value(json!({
			"themes": {"Mode": ["Light", "Dark"]},
			"variables": {
				"card": {"type": "color", "value": [{"value": "#fff"}, {"value": "#111", "theme": {"Mode": "Dark"}}]},
				"alias": {"type": "color", "value": "$card"}
			}
		}))
		.unwrap();
		let vars = Vars::from_meta(&meta);
		let light = vars.base_theme(false);
		let dark = vars.base_theme(true);
		assert_eq!(vars.str(Some(&json!("$alias")), &light), Some("#fff"));
		assert_eq!(vars.str(Some(&json!("$alias")), &dark), Some("#111"));
	}
}
