//! Words: set with parley in the app's own font files, measured for layout, and drawn as glyphs
//! cut at the exact pixel size into a glyph texture, so text is crisp at every zoom at rest.
//!
//! The app fetches the font files (`font-files.ts` decides which) and hands each to [`Text::add_font`]
//! under the name its fallback chain uses. A paragraph asks for its family, then the chain: the
//! family's extended-Latin file, Inter, and every fallback in the order the app lists them.

pub mod atlas;
pub mod card;
pub mod markdown;
pub mod math;

use parley::fontique::{Blob, FontInfoOverride};
use parley::{Alignment, AlignmentOptions, FontContext, FontFamily, FontFamilyName, FontStyle, FontWeight, Layout, LayoutContext, LineHeight, PositionedLayoutItem, StyleProperty};
use stage_scene::layout::{Estimate, Measure, TextStyle};
use stage_scene::tree::Item;
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

pub const FALLBACK: &str = "Inter";
const EXT: &str = " Ext";

/// A run of words in one style, the brush naming its colour in the caller's own table.
#[derive(Clone, Debug, PartialEq)]
pub struct Span<'a> {
	pub text: &'a str,
	pub style: &'a TextStyle,
	pub brush: u32,
	pub underline: bool,
	pub strike: bool,
	/// The colour of the line under or through it, when not its words' own.
	pub deco: Option<u32>,
	/// A formula: `text` is its TeX, set as a display formula when true (`math.rs`).
	pub math: Option<bool>,
}

impl<'a> Span<'a> {
	pub fn plain(text: &'a str, style: &'a TextStyle) -> Span<'a> {
		Span { text, style, brush: 0, underline: false, strike: false, deco: None, math: None }
	}
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
	Left,
	Center,
	Right,
	Justify,
}

/// A font as glyphs need it: its file and its index in the file.
#[derive(Clone)]
pub struct Font {
	pub id: u64,
	pub data: Arc<dyn AsRef<[u8]> + Send + Sync>,
	pub index: u32,
}

impl std::fmt::Debug for Font {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		write!(f, "Font({}, {})", self.id, self.index)
	}
}

/// One run of glyphs in one font, size and colour; positions from the paragraph's top-left.
#[derive(Clone, Debug)]
pub struct GlyphRun {
	pub font: Font,
	pub size: f32,
	pub brush: u32,
	pub embolden: bool,
	pub skew: f32,
	pub coords: Vec<i16>,
	pub glyphs: Vec<(u32, f32, f32)>,
	/// Where the run starts and how far it goes, and its line's top and height: for a highlight
	/// behind its words.
	pub x: f32,
	pub w: f32,
	pub line_top: f32,
	pub line_height: f32,
}

/// A line drawn under or through words: `x, y, w, h` from the paragraph's top-left.
#[derive(Clone, Copy, Debug)]
pub struct Rule {
	pub x: f32,
	pub y: f32,
	pub w: f32,
	pub h: f32,
	pub brush: u32,
}

/// A paragraph set and ready to draw.
#[derive(Clone, Debug, Default)]
pub struct Laid {
	pub width: f32,
	pub height: f32,
	pub runs: Vec<GlyphRun>,
	pub rules: Vec<Rule>,
	/// Each line's top, height and baseline, for carets and for cards.
	pub lines: Vec<(f32, f32, f32)>,
	/// The formulas in it, typeset, where they sit.
	pub formulas: Vec<math::PlacedFormula>,
}

struct BlobData(Blob<u8>);

impl AsRef<[u8]> for BlobData {
	fn as_ref(&self) -> &[u8] {
		self.0.as_ref()
	}
}

pub struct Text {
	fcx: RefCell<FontContext>,
	lcx: RefCell<LayoutContext<u32>>,
	/// Fallback names, in the order they were registered.
	fallbacks: Vec<String>,
	families: Vec<String>,
	measured: RefCell<HashMap<(String, u64), (f64, f64)>>,
	/// Cards laid out, by their words, style, width and scheme: measured once, drawn from the same.
	cards: RefCell<HashMap<(String, u64, bool), std::rc::Rc<card::Card>>>,
	/// Reads a card's markdown; the app's reader when it gave one, this crate's otherwise.
	reader: Option<Box<dyn Fn(&str) -> Option<Vec<markdown::Block>>>>,
	/// Pictures' sizes, once they have arrived, so a card can make room for them.
	pub images: RefCell<HashMap<String, (f32, f32)>>,
	/// Typesets a formula's TeX (`math.rs`): the app's MathJax, when it gave it.
	typeset: Option<Box<dyn Fn(&str, bool) -> Option<math::Formula>>>,
	formulas: RefCell<HashMap<(bool, String), Option<std::rc::Rc<math::Formula>>>>,
	/// The scheme cards are set for.
	pub dark: bool,
	/// Bumped when a font arrives: everything measured or drawn before it is stale.
	pub generation: u64,
}

impl Default for Text {
	fn default() -> Self {
		Text::new()
	}
}

impl Text {
	pub fn new() -> Text {
		let collection = parley::fontique::Collection::new(parley::fontique::CollectionOptions { shared: false, system_fonts: false });
		let fcx = FontContext { collection, source_cache: Default::default() };
		Text {
			fcx: RefCell::new(fcx),
			lcx: RefCell::new(LayoutContext::new()),
			fallbacks: Vec::new(),
			families: Vec::new(),
			measured: RefCell::new(HashMap::new()),
			cards: RefCell::new(HashMap::new()),
			reader: None,
			typeset: None,
			formulas: RefCell::new(HashMap::new()),
			images: RefCell::new(HashMap::new()),
			dark: false,
			generation: 0,
		}
	}

	/// Register a font file under `name`, the name the app's chains use. `fallback` files are tried,
	/// in the order they arrive, for characters the family and Inter do not have.
	pub fn add_font(&mut self, name: &str, bytes: Vec<u8>, fallback: bool) {
		let blob = Blob::new(Arc::new(bytes));
		self.fcx.borrow_mut().collection.register_fonts(blob, Some(FontInfoOverride { family_name: Some(name), ..Default::default() }));
		let list = if fallback { &mut self.fallbacks } else { &mut self.families };
		if !list.iter().any(|n| n == name) {
			list.push(name.to_owned());
		}
		self.forget();
	}

	/// Everything measured is stale: a font, a picture or the scheme changed.
	pub fn forget(&mut self) {
		self.measured.borrow_mut().clear();
		self.cards.borrow_mut().clear();
		self.generation += 1;
	}

	/// The app's markdown reader: source in, blocks out.
	pub fn set_reader(&mut self, reader: Box<dyn Fn(&str) -> Option<Vec<markdown::Block>>>) {
		self.reader = Some(reader);
		self.forget();
	}

	/// The app's typesetter for formulas: TeX in, outlines out. Words carrying `$…$` are laid out
	/// with each formula in its place from then on.
	pub fn set_math(&mut self, typeset: Box<dyn Fn(&str, bool) -> Option<math::Formula>>) {
		self.typeset = Some(typeset);
		self.formulas.borrow_mut().clear();
		self.forget();
	}

	/// A formula typeset, once; none without a typesetter or for TeX it cannot read.
	pub fn formula(&self, tex: &str, display: bool) -> Option<std::rc::Rc<math::Formula>> {
		let key = (display, tex.to_owned());
		if let Some(hit) = self.formulas.borrow().get(&key) {
			return hit.clone();
		}
		let made = self.typeset.as_ref().and_then(|t| t(tex, display)).filter(|f| f.width > 0.0).map(std::rc::Rc::new);
		self.formulas.borrow_mut().insert(key, made.clone());
		made
	}

	/// A text's words in one style, with any formulas in them in their places.
	pub fn lay_words(&self, words: &str, style: &TextStyle, max_width: Option<f32>, align: Align, underline: bool, strike: bool) -> Laid {
		let parts = if self.typeset.is_some() { math::split(words) } else { vec![(words.to_owned(), None)] };
		let spans: Vec<Span> = parts.iter().map(|(text, math)| Span { underline, strike, math: *math, ..Span::plain(text, style) }).collect();
		self.lay(&spans, max_width, align)
	}

	/// A card's markdown laid out `width` wide: cached, so measuring and drawing share one layout.
	pub fn card(&self, source: &str, style: &TextStyle, width: f32, align: Align) -> std::rc::Rc<card::Card> {
		let key = (format!("{}|{:?}", style_key(source, style), align), (width as f64).to_bits(), self.dark);
		if let Some(hit) = self.cards.borrow().get(&key) {
			return hit.clone();
		}
		let blocks = self.reader.as_ref().and_then(|r| r(source)).unwrap_or_else(|| markdown::parse(source));
		let images = self.images.borrow();
		let size = |url: &str| images.get(url).copied();
		let laid = std::rc::Rc::new(card::layout(self, &blocks, style, width, align, self.dark, &size));
		drop(images);
		self.cards.borrow_mut().insert(key, laid.clone());
		laid
	}

	pub fn has_fonts(&self) -> bool {
		!self.families.is_empty() || !self.fallbacks.is_empty()
	}

	/// The families a paragraph asks for, in order.
	fn chain(&self, family: &str) -> Vec<FontFamilyName<'static>> {
		let mut names: Vec<String> = vec![family.to_owned(), format!("{family}{EXT}"), FALLBACK.to_owned(), format!("{FALLBACK}{EXT}")];
		names.extend(self.fallbacks.iter().cloned());
		let mut seen = std::collections::HashSet::new();
		names.into_iter().filter(|n| seen.insert(n.clone())).map(|n| FontFamilyName::Named(Cow::Owned(n))).collect()
	}

	/// Set spans of words in a box `max_width` wide (`None`: one line per paragraph).
	pub fn lay(&self, spans: &[Span], max_width: Option<f32>, align: Align) -> Laid {
		// A formula is not words: it is left out of the text and stands in its place as a box its size.
		let typeset: Vec<Option<std::rc::Rc<math::Formula>>> = spans.iter().map(|s| s.math.and_then(|display| self.formula(s.text, display))).collect();
		let text: String = spans.iter().zip(&typeset).map(|(s, f)| if f.is_some() { "" } else { s.text }).collect();
		let mut fcx = self.fcx.borrow_mut();
		let mut lcx = self.lcx.borrow_mut();
		let mut builder = lcx.ranged_builder(&mut fcx, &text, 1.0, false);
		if let Some(style) = spans.first().map(|s| s.style) {
			builder.push_default(StyleProperty::LineHeight(match style.line_height {
				Some(m) => LineHeight::FontSizeRelative(m as f32),
				None => LineHeight::MetricsRelative(1.0),
			}));
		}
		let mut at = 0;
		let mut boxes: Vec<(std::rc::Rc<math::Formula>, f32, u32)> = Vec::new();
		for (span, formula) in spans.iter().zip(&typeset) {
			if let Some(f) = formula {
				let size = span.style.size as f32;
				builder.push_inline_box(parley::InlineBox {
					id: boxes.len() as u64,
					kind: parley::InlineBoxKind::InFlow,
					index: at,
					width: f.width * size,
					height: (f.ascent + f.descent) * size,
					baseline: Some(f.ascent * size),
					vertical_align: parley::style::VerticalAlign::BASELINE,
				});
				boxes.push((f.clone(), size, span.brush));
				continue;
			}
			let range = at..at + span.text.len();
			at = range.end;
			let s = span.style;
			builder.push(StyleProperty::FontFamily(FontFamily::List(Cow::Owned(self.chain(&s.family)))), range.clone());
			builder.push(StyleProperty::FontSize(s.size as f32), range.clone());
			builder.push(StyleProperty::FontWeight(FontWeight::new(s.weight as f32)), range.clone());
			builder.push(StyleProperty::FontStyle(if s.italic { FontStyle::Italic } else { FontStyle::Normal }), range.clone());
			builder.push(StyleProperty::LetterSpacing(s.letter_spacing as f32), range.clone());
			builder.push(StyleProperty::Brush(span.brush), range.clone());
			if span.underline {
				builder.push(StyleProperty::Underline(true), range.clone());
				if let Some(d) = span.deco {
					builder.push(StyleProperty::UnderlineBrush(Some(d)), range.clone());
				}
			}
			if span.strike {
				builder.push(StyleProperty::Strikethrough(true), range.clone());
				if let Some(d) = span.deco {
					builder.push(StyleProperty::StrikethroughBrush(Some(d)), range.clone());
				}
			}
		}
		let mut layout: Layout<u32> = builder.build(&text);
		drop(lcx);
		drop(fcx);
		layout.break_all_lines(max_width);
		let a = match align {
			Align::Left => Alignment::Left,
			Align::Center => Alignment::Center,
			Align::Right => Alignment::Right,
			Align::Justify => Alignment::Justify,
		};
		layout.align(a, AlignmentOptions::default());
		let mut laid = Laid { width: layout.width(), height: layout.height(), ..Default::default() };
		for line in layout.lines() {
			let m = line.metrics();
			laid.lines.push((m.block_min_coord, m.line_height, m.baseline));
			for item in line.items() {
				let run = match item {
					PositionedLayoutItem::GlyphRun(run) => run,
					PositionedLayoutItem::InlineBox(b) => {
						if let Some((formula, size, brush)) = boxes.get(b.id as usize) {
							let baseline = b.y + b.baseline.unwrap_or(b.height);
							laid.formulas.push(math::PlacedFormula { formula: formula.clone(), x: b.x, baseline, size: *size, brush: *brush });
						}
						continue;
					}
				};
				let style = run.style();
				let r = run.run();
				let fd = r.font();
				let synth = r.synthesis();
				let glyphs: Vec<(u32, f32, f32)> = run.positioned_glyphs().map(|g| (g.id, g.x, g.y)).collect();
				let metrics = r.font_metrics();
				let x0 = run.offset();
				let w = run.advance();
				let baseline = run.baseline();
				if let Some(u) = &style.underline {
					let size = u.size.unwrap_or(metrics.underline_size).max(1.0);
					laid.rules.push(Rule { x: x0, y: baseline - u.offset.unwrap_or(metrics.underline_offset), w, h: size, brush: u.brush });
				}
				if let Some(s) = &style.strikethrough {
					let size = s.size.unwrap_or(metrics.strikethrough_size).max(1.0);
					laid.rules.push(Rule { x: x0, y: baseline - s.offset.unwrap_or(metrics.strikethrough_offset), w, h: size, brush: s.brush });
				}
				laid.runs.push(GlyphRun {
					font: Font { id: fd.data.id(), data: Arc::new(BlobData(fd.data.clone())), index: fd.index },
					size: r.font_size(),
					brush: style.brush,
					embolden: synth.embolden(),
					skew: synth.skew().unwrap_or(0.0),
					coords: r.normalized_coords().iter().map(|c| c.to_bits()).collect(),
					glyphs,
					x: x0,
					w,
					line_top: m.block_min_coord,
					line_height: m.line_height,
				});
			}
		}
		laid
	}
}

fn style_key(text: &str, style: &TextStyle) -> String {
	format!("{}|{}|{}|{}|{}|{:?}|{}", style.family, style.size, style.weight, style.italic, style.letter_spacing, style.line_height, text)
}

impl Measure for Text {
	fn measure(&self, text: &str, style: &TextStyle, max_width: Option<f64>, item: &Item) -> (f64, f64) {
		if !self.has_fonts() {
			return Estimate.measure(text, style, max_width, item);
		}
		// A card's words are markdown: its height is the card's.
		if is_markdown(item) {
			let width = max_width.unwrap_or(f64::from(u16::MAX)) as f32;
			let card = self.card(text, style, width, Align::Left);
			return (width as f64, card.height as f64);
		}
		let key = (style_key(text, style), max_width.map_or(u64::MAX, f64::to_bits));
		if let Some(hit) = self.measured.borrow().get(&key) {
			return *hit;
		}
		// Half a pixel more than measured, so words measured to fit do not wrap on rounding.
		let laid = self.lay_words(text, style, max_width.map(|w| w as f32 + 0.5), Align::Left, false, false);
		let mut h = laid.height as f64;
		if (text.is_empty() || laid.lines.is_empty()) && laid.formulas.is_empty() {
			h = style.size * style.line_height.unwrap_or(1.2);
		}
		let w = laid.width as f64;
		let out = (max_width.map_or(w, |m| w.min(m)).ceil(), h);
		self.measured.borrow_mut().insert(key, out);
		out
	}
}

#[cfg(test)]
mod tests;

/// Whether an item's words are a card's markdown (`decks.markdown`), a note's or one block's.
pub fn is_markdown(item: &Item) -> bool {
	item.get("metadata").and_then(|m| m.get("type")).and_then(|t| t.as_str()) == Some("decks.markdown")
}
