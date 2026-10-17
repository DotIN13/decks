//! A card's markdown set in the app's own hand, as `markdown-layout.ts` sets it: the app's greys,
//! hairlines and accent, light or dark; headings in semibold with no rule under them; a quote behind
//! a hairline bar; code on the app's tint in its monospace face; tables across the whole card with a
//! line under the header and between rows; sizes in units of the card's font size, paragraphs at a
//! line height of 1.5 with one size between blocks. A table wider than the card scrolls sideways.

use crate::markdown::{Block, Run};
use crate::{Align, Laid, Span, Text};
use stage_scene::layout::TextStyle;
use stage_scene::values::parse_color;

pub type Rgba = [f32; 4];

/// A colour for words: their ink, what lies behind them, and the line under or through them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Brush {
	pub ink: Rgba,
	pub back: Option<Rgba>,
}

#[derive(Clone, Debug)]
pub enum CardOp {
	Text { laid: Laid, x: f32, y: f32, brushes: Vec<Brush> },
	Box { x: f32, y: f32, w: f32, h: f32, color: Rgba, r: f32 },
	Check { x: f32, y: f32, size: f32, checked: bool },
	Image { url: String, x: f32, y: f32, w: f32, h: f32 },
	/// A table wider than the card: its ops, cut to `w` and moved by the stage's scroll offset.
	Scroll { index: usize, x: f32, y: f32, w: f32, h: f32, content: f32, ops: Vec<CardOp> },
}

#[derive(Clone, Debug, Default)]
pub struct Card {
	pub height: f32,
	pub ops: Vec<CardOp>,
	/// Every link's box from the card's top-left, and the table it scrolls with, if any.
	pub links: Vec<(f32, f32, f32, f32, String, Option<usize>)>,
	/// Each table too wide for the card: where it shows, and how wide it is.
	pub scrollers: Vec<(f32, f32, f32, f32, f32)>,
}

struct Palette {
	fg: &'static str,
	muted: &'static str,
	faint: &'static str,
	line: &'static str,
	strong: &'static str,
	subtle: &'static str,
	code: &'static str,
	accent: &'static str,
	r#box: &'static str,
}

const LIGHT: Palette = Palette { fg: "#161616", muted: "#5c5c5c", faint: "#808080", line: "#0000001a", strong: "#00000033", subtle: "#f2f2f2", code: "#0000000f", accent: "#3b5cf6", r#box: "#ffffff" };
const DARK: Palette = Palette { fg: "#fafafa", muted: "#aeaeae", faint: "#808080", line: "#ffffff1f", strong: "#ffffff3d", subtle: "#2e2e2e", code: "#ffffff14", accent: "#6f8bff", r#box: "#242424" };

/// The paper a card is drawn on, light and dark.
pub const PAPER: [&str; 2] = ["#ffffff", "#242424"];

fn ink(name: &str, dark: bool) -> Option<&'static str> {
	Some(match (name, dark) {
		("red", false) => "#d92e3c",
		("red", true) => "#f06a74",
		("orange", false) => "#c2410c",
		("orange", true) => "#fb923c",
		("yellow", false) => "#a16207",
		("yellow", true) => "#facc15",
		("green", false) => "#15803d",
		("green", true) => "#4ade80",
		("blue", false) => "#2563eb",
		("blue", true) => "#60a5fa",
		("purple", false) => "#7c3aed",
		("purple", true) => "#c084fc",
		_ => return None,
	})
}

fn mark(name: &str, dark: bool) -> &'static str {
	match (name, dark) {
		("red", false) => "#f8717159",
		("red", true) => "#f871714d",
		("orange", false) => "#fb923c59",
		("orange", true) => "#fb923c4d",
		("green", false) => "#4ade8059",
		("green", true) => "#4ade804d",
		("blue", false) => "#38bdf859",
		("blue", true) => "#38bdf84d",
		("purple", false) => "#c084fc59",
		("purple", true) => "#c084fc4d",
		(_, false) => "#facc1573",
		(_, true) => "#facc1547",
	}
}

fn alert(name: &str, dark: bool) -> &'static str {
	match (name, dark) {
		("cyan", false) => "#0e8a9e",
		("cyan", true) => "#3cc3d6",
		("green", false) => "#2a9d52",
		("green", true) => "#4cc97a",
		("orange", false) => "#c26a12",
		("orange", true) => "#f0a050",
		("red", false) => "#d92e3c",
		("red", true) => "#f06a74",
		("purple", false) => "#7c4ddb",
		("purple", true) => "#a88bf0",
		("gray", false) => "#6b6b6b",
		("gray", true) => "#a0a0a0",
		(_, false) => "#3b5cf6",
		(_, true) => "#6f8bff",
	}
}

fn hex(s: &str) -> Rgba {
	parse_color(s).unwrap_or([0.0, 0.0, 0.0, 1.0])
}

const HEADING_SIZE: [f32; 6] = [1.6, 1.3, 1.12, 1.0, 0.9, 0.85];
pub const MONO: &str = "JetBrains Mono";
const SERIF: &str = "Source Serif 4";

#[derive(Clone, Copy)]
struct Frame {
	size: f32,
	colour: Rgba,
	weight: f32,
	depth: usize,
}

#[derive(Default)]
struct Opts {
	line_height: Option<f32>,
	align: Option<Align>,
	size: Option<f32>,
	weight: Option<f32>,
}

struct Setter<'a> {
	text: &'a Text,
	style: &'a TextStyle,
	dark: bool,
	p: &'a Palette,
	align: Align,
	/// The size of a picture by its address, once it has arrived.
	image: &'a dyn Fn(&str) -> Option<(f32, f32)>,
	ops: Vec<CardOp>,
	links: Vec<(f32, f32, f32, f32, String, Option<usize>)>,
	scrollers: Vec<(f32, f32, f32, f32, f32)>,
	scroller: Option<usize>,
}

struct Para {
	laid: Laid,
	brushes: Vec<Brush>,
	links: Vec<(usize, usize, String)>,
}

impl Setter<'_> {
	/// Runs set as one paragraph `w` wide.
	fn para(&self, runs: &[Run], f: Frame, w: f32, o: Opts) -> Para {
		let size = o.size.unwrap_or(f.size);
		let weight = o.weight.unwrap_or(f.weight);
		let line_height = self.style.line_height.map(|l| l as f32).or(o.line_height).unwrap_or(1.5);
		let blank = [Run { text: " ".into(), ..Default::default() }];
		let runs: &[Run] = if runs.is_empty() { &blank } else { runs };
		let mut styles: Vec<TextStyle> = Vec::with_capacity(runs.len());
		let mut texts: Vec<String> = Vec::with_capacity(runs.len());
		let mut brushes: Vec<Brush> = vec![Brush { ink: f.colour, back: None }];
		let mut meta: Vec<(u32, bool, bool, Option<u32>)> = Vec::new();
		let mut maths: Vec<Option<bool>> = Vec::with_capacity(runs.len());
		let mut links = Vec::new();
		let mut at = 0;
		for (i, run) in runs.iter().enumerate() {
			// A suggestion's reason is a 💬 after it; the words are in the card's markdown.
			// A formula's run is its TeX, typeset in its place when there is a typesetter (`math.rs`).
			let math = run.math.as_ref().filter(|m| self.text.formula(&m.tex, m.display).is_some()).map(|m| m.display);
			let text = match &run.image {
				_ if math.is_some() => run.math.as_ref().map(|m| m.tex.clone()).unwrap_or_default(),
				Some(img) => format!("🖼 {}", if img.alt.is_empty() { "image" } else { &img.alt }),
				None => {
					let reason_ends = run.reason.is_some() && runs.get(i + 1).and_then(|r| r.reason.as_ref()) != run.reason.as_ref();
					format!("{}{}", run.text, if reason_ends { " 💬" } else { "" })
				}
			};
			let added = if self.dark { "#7aa2ff" } else { "#2563eb" };
			let removed = if self.dark { "#f06a74" } else { "#c0262d" };
			let ink_hex = if run.added {
				Some(added)
			} else if run.removed {
				Some(removed)
			} else if run.link.is_some() || run.wiki.is_some() || run.sup {
				Some(self.p.accent)
			} else if run.image.is_some() {
				Some(self.p.muted)
			} else {
				run.colour.as_deref().and_then(|c| ink(c, self.dark))
			};
			let ink_c = ink_hex.map(hex).unwrap_or(f.colour);
			let back = if run.added {
				Some(hex(if self.dark { "#7aa2ff26" } else { "#2563eb1f" }))
			} else if let Some(m) = &run.mark {
				Some(hex(mark(m, self.dark)))
			} else if run.code {
				Some(hex(self.p.code))
			} else {
				None
			};
			let scale = match run.size.as_deref() {
				Some("small") => 0.85,
				Some("large") => 1.25,
				Some("huge") => 1.6,
				_ => 1.0,
			};
			let face = if run.code {
				MONO.to_owned()
			} else {
				match run.face.as_deref() {
					Some("serif") => SERIF.to_owned(),
					Some("mono") => MONO.to_owned(),
					Some(f) => f.to_owned(),
					None => self.style.family.clone(),
				}
			};
			styles.push(TextStyle {
				family: face,
				size: ((if run.sup { size * 0.75 } else if run.code { size * 0.88 } else { size }) * scale) as f64,
				weight: if run.bold { (weight + 200.0).max(600.0) as f64 } else { weight as f64 },
				italic: run.italic,
				letter_spacing: self.style.letter_spacing,
				line_height: Some(line_height as f64),
			});
			brushes.push(Brush { ink: ink_c, back });
			let brush = (brushes.len() - 1) as u32;
			let link = run.link.is_some() || run.wiki.is_some();
			let underline = link || run.added || run.underline;
			let strike = run.strike || run.removed;
			let deco = if link {
				let mut c = hex(self.p.accent);
				c[3] = 0.4;
				brushes.push(Brush { ink: c, back: None });
				Some((brushes.len() - 1) as u32)
			} else if run.removed {
				brushes.push(Brush { ink: hex(removed), back: None });
				Some((brushes.len() - 1) as u32)
			} else {
				None
			};
			meta.push((brush, underline, strike, deco));
			if let Some(l) = &run.link {
				links.push((at, at + text.len(), l.clone()));
			}
			// A typeset formula is no words in the paragraph's text, so it moves no link after it.
			if math.is_none() {
				at += text.len();
			}
			maths.push(math);
			texts.push(text);
		}
		let spans: Vec<Span> = texts
			.iter()
			.zip(&styles)
			.zip(&meta)
			.zip(&maths)
			.map(|(((t, s), (brush, underline, strike, deco)), math)| Span { text: t, style: s, brush: *brush, underline: *underline, strike: *strike, deco: *deco, math: *math })
			.collect();
		let laid = self.text.lay(&spans, Some(w.max(1.0)), o.align.unwrap_or(self.align));
		Para { laid, brushes, links }
	}

	fn place(&mut self, para: Para, x: f32, y: f32) -> f32 {
		let h = para.laid.height;
		// Links: the whole lines their words are on, which is close enough for a press.
		if !para.links.is_empty() {
			for (_, _, href) in &para.links {
				let w = para.laid.width;
				self.links.push((x, y, w, h, href.clone(), self.scroller));
			}
		}
		self.ops.push(CardOp::Text { laid: para.laid, x, y, brushes: para.brushes });
		h
	}

	fn stack(&mut self, list: &[Block], x: f32, mut y: f32, w: f32, f: Frame, gap: f32) -> f32 {
		for (i, block) in list.iter().enumerate() {
			if i > 0 {
				y += if matches!(block, Block::Heading { .. }) { gap.max(f.size * 1.25) } else { gap };
			}
			y = self.one(block, x, y, w, f);
		}
		y
	}

	fn one(&mut self, block: &Block, x: f32, y: f32, w: f32, f: Frame) -> f32 {
		let p = self.p;
		match block {
			Block::Heading { level, runs } => {
				let size = f.size * HEADING_SIZE[(*level as usize).clamp(1, 6) - 1];
				let colour = if *level >= 5 { hex(p.muted) } else { f.colour };
				let para = self.para(runs, Frame { colour, ..f }, w, Opts { size: Some(size), weight: Some(600.0), line_height: Some(1.3), ..Default::default() });
				y + self.place(para, x, y)
			}
			Block::Paragraph { runs } => {
				let para = self.para(runs, f, w, Opts::default());
				y + self.place(para, x, y)
			}
			Block::Image { url, alt, width } => {
				if let Some((iw0, ih0)) = (self.image)(url).filter(|(w, _)| *w > 0.0) {
					let iw = w.min(width.map(|v| v as f32).unwrap_or(iw0));
					let ih = iw * ih0 / iw0;
					self.ops.push(CardOp::Image { url: url.clone(), x, y, w: iw, h: ih });
					return y + ih;
				}
				// Not here yet: its words, where it will be.
				let h = f.size * 3.0;
				self.ops.push(CardOp::Box { x, y, w, h, color: hex(p.subtle), r: 8.0 });
				let words = [Run { text: format!("🖼 {}", if alt.is_empty() { url } else { alt }), ..Default::default() }];
				let para = self.para(&words, Frame { colour: hex(p.muted), ..f }, w - f.size * 2.0, Opts { align: Some(Align::Center), size: Some(f.size * 0.875), ..Default::default() });
				let ph = para.laid.height;
				self.place(para, x + f.size, y + (h - ph) / 2.0);
				y + h
			}
			Block::Embed { target } => {
				let pad = f.size * 0.75;
				let words = [Run { text: format!("📄 {target}"), ..Default::default() }];
				let para = self.para(&words, f, w - pad * 2.0, Opts { size: Some(f.size * 0.94), ..Default::default() });
				let h = para.laid.height + pad * 2.0;
				self.ops.push(CardOp::Box { x, y, w, h, color: hex(p.subtle), r: 8.0 });
				self.place(para, x + pad, y + pad);
				y + h
			}
			Block::List { ordered, start, loose, items } => {
				let indent = f.size * 1.6;
				let mut y = y;
				for (i, item) in items.iter().enumerate() {
					if i > 0 {
						y += if *loose { f.size } else { f.size * 0.2 };
					}
					let top = y;
					if let Some(checked) = item.checked {
						let size = f.size * 0.85;
						self.ops.push(CardOp::Check { x: x + indent - size - f.size * 0.45, y: top + (f.size * 1.5 - size) / 2.0, size, checked });
					} else {
						let words = [Run { text: marker(*ordered, start + i as u32, f.depth), ..Default::default() }];
						let para = self.para(&words, Frame { colour: hex(p.muted), ..f }, indent - f.size * 0.4, Opts { align: Some(Align::Right), ..Default::default() });
						self.place(para, x, top);
					}
					y = self.stack(&item.blocks, x + indent, y, w - indent, Frame { depth: f.depth + 1, ..f }, if *loose { f.size } else { 0.0 });
				}
				y
			}
			Block::Quote { alert: kind, title, blocks } => {
				let bar = 2.0;
				let accent = kind.as_deref().map(|k| hex(alert(k, self.dark)));
				let pad = if accent.is_some() { f.size * 0.4 } else { 0.0 };
				let inset = bar + f.size * 0.9;
				let top = y;
				let mut y = y + pad;
				if let Some(a) = accent {
					let words = [Run { text: title.clone().unwrap_or_else(|| "Note".into()), ..Default::default() }];
					let para = self.para(&words, Frame { colour: a, ..f }, w - inset, Opts { weight: Some(600.0), ..Default::default() });
					y += self.place(para, x + inset, y);
					if !blocks.is_empty() {
						y += f.size * 0.3;
					}
				}
				let colour = if accent.is_some() { f.colour } else { hex(p.muted) };
				y = self.stack(blocks, x + inset, y, w - inset, Frame { colour, ..f }, f.size);
				y += pad;
				self.ops.push(CardOp::Box { x, y: top, w: bar, h: (y - top).max(1.0), color: accent.unwrap_or(hex(p.strong)), r: 1.0 });
				y
			}
			Block::Code { text, runs, .. } => {
				let pad = f.size * 0.85;
				let size = f.size * 0.88;
				let source = text.strip_suffix('\n').unwrap_or(text);
				let base = TextStyle { family: MONO.into(), size: size as f64, weight: 400.0, italic: false, letter_spacing: 0.0, line_height: Some(1.5) };
				let coloured: Vec<(String, TextStyle, Rgba)> = match runs {
					Some(rs) if !rs.is_empty() => rs
						.iter()
						.map(|r| (r.text.clone(), TextStyle { weight: if r.bold { 700.0 } else { 400.0 }, italic: r.italic, ..base.clone() }, r.colour.as_deref().map(hex).unwrap_or(hex(p.fg))))
						.collect(),
					_ => vec![(if source.is_empty() { " ".into() } else { source.to_owned() }, base.clone(), hex(p.fg))],
				};
				let mut brushes = vec![Brush { ink: hex(p.fg), back: None }];
				let spans: Vec<Span> = coloured
					.iter()
					.map(|(t, s, c)| {
						brushes.push(Brush { ink: *c, back: None });
						Span { brush: (brushes.len() - 1) as u32, ..Span::plain(t, s) }
					})
					.collect();
				let laid = self.text.lay(&spans, Some((w - pad * 2.0).max(1.0)), Align::Left);
				let h = laid.height + pad * 2.0;
				self.ops.push(CardOp::Box { x, y, w, h, color: hex(p.subtle), r: 8.0 });
				self.ops.push(CardOp::Text { laid, x: x + pad, y: y + pad, brushes });
				y + h
			}
			Block::Table { align, header, rows } => self.table(align, header, rows, x, y, w, f),
			Block::Rule => {
				self.ops.push(CardOp::Box { x, y: y + f.size * 0.5, w, h: 1.0, color: hex(p.line), r: 0.0 });
				y + f.size + 1.0
			}
			Block::Math { tex } => {
				// A display formula on a line of its own, in the middle; its TeX as written with no typesetter.
				let words = if self.text.formula(tex, true).is_some() {
					[Run { text: tex.clone(), math: Some(crate::markdown::RunMath { tex: tex.clone(), display: true }), ..Default::default() }]
				} else {
					[Run { text: format!("$${tex}$$"), ..Default::default() }]
				};
				let para = self.para(&words, f, w, Opts { align: Some(Align::Center), ..Default::default() });
				y + self.place(para, x, y)
			}
			Block::Footnotes { items } => {
				self.ops.push(CardOp::Box { x, y, w, h: 1.0, color: hex(p.line), r: 0.0 });
				let mut y = y + f.size * 0.75;
				let small = Frame { size: f.size * 0.875, colour: hex(p.muted), ..f };
				let indent = small.size * 1.6;
				for (i, item) in items.iter().enumerate() {
					if i > 0 {
						y += small.size * 0.2;
					}
					let words = [Run { text: format!("{}.", item.number), ..Default::default() }];
					let para = self.para(&words, small, indent - small.size * 0.4, Opts { align: Some(Align::Right), ..Default::default() });
					self.place(para, x, y);
					y = self.stack(&item.blocks, x + indent, y, w - indent, small, 0.0);
				}
				y
			}
		}
	}

	#[allow(clippy::too_many_arguments)]
	fn table(&mut self, align: &[Option<String>], header: &[Vec<Run>], rows: &[Vec<Vec<Run>>], x: f32, y: f32, w: f32, f: Frame) -> f32 {
		let p = self.p;
		let pad_x = f.size * 0.75;
		let pad_y = f.size * 0.45;
		let header_row: Vec<Vec<Run>> = header.to_vec();
		let all: Vec<&Vec<Vec<Run>>> = std::iter::once(&header_row).chain(rows.iter()).collect();
		let columns = all.iter().map(|r| r.len()).max().unwrap_or(0).max(1);
		let left = |c: usize| if c == 0 { 0.0 } else { pad_x };
		let pads = |c: usize| left(c) + if c == columns - 1 { 0.0 } else { pad_x };
		let head = Frame { colour: hex(p.muted), ..f };
		let opts = |r: usize, c: usize| Opts {
			weight: Some(if r == 0 { 600.0 } else { f.weight }),
			size: Some(if r == 0 { f.size * 0.9 } else { f.size }),
			align: Some(match align.get(c).cloned().flatten().as_deref() {
				Some("center") => Align::Center,
				Some("right") => Align::Right,
				_ => Align::Left,
			}),
			line_height: None,
		};
		let empty: Vec<Run> = Vec::new();
		let natural: Vec<f32> = (0..columns)
			.map(|c| {
				let mut widest = f.size * 2.0 + pads(c);
				for (r, row) in all.iter().enumerate() {
					let probe = self.para(row.get(c).unwrap_or(&empty), if r == 0 { head } else { f }, 1e5, opts(r, c));
					// A long cell wraps rather than make its column wider than about two thirds of a card.
					let width = (probe.laid.width.ceil() + 1.0).min((f.size * 16.0).max(w * 0.66)) + pads(c);
					widest = widest.max(width);
				}
				widest
			})
			.collect();
		let total: f32 = natural.iter().sum();
		let widths: Vec<f32> = if total < w { natural.iter().map(|v| v * w / total).collect() } else { natural };
		let content = w.max(widths.iter().sum());
		let scrolls = content > w + 0.5;
		let outer = std::mem::take(&mut self.ops);
		let index = self.scrollers.len();
		if scrolls {
			self.scroller = Some(index);
		}
		let top = y;
		let mut y = y;
		for (r, row) in all.iter().enumerate() {
			let cells: Vec<Para> = widths.iter().enumerate().map(|(c, cw)| self.para(row.get(c).unwrap_or(&empty), if r == 0 { head } else { f }, cw - pads(c), opts(r, c))).collect();
			let h = cells.iter().map(|c| c.laid.height).fold(0.0, f32::max) + pad_y * 2.0;
			let mut cx = x;
			for (c, cell) in cells.into_iter().enumerate() {
				self.place(cell, cx + left(c), y + pad_y);
				cx += widths[c];
			}
			y += h;
			if r < all.len() - 1 {
				self.ops.push(CardOp::Box { x, y: y - 0.5, w: content, h: 1.0, color: hex(if r == 0 { p.strong } else { p.line }), r: 0.0 });
			}
		}
		let own = std::mem::replace(&mut self.ops, outer);
		if scrolls {
			self.scroller = None;
			let bar = f.size * 0.6;
			self.scrollers.push((x, top, w, y - top + bar, content));
			self.ops.push(CardOp::Scroll { index, x, y: top, w, h: y - top + bar, content, ops: own });
			y += bar;
		} else {
			self.ops.extend(own);
		}
		y
	}
}

fn roman(mut n: u32) -> String {
	let mut out = String::new();
	for (v, l) in [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")] {
		while n >= v {
			out.push_str(l);
			n -= v;
		}
	}
	out
}

fn marker(ordered: bool, n: u32, depth: usize) -> String {
	if !ordered {
		return ["•", "◦", "▪"][depth.min(2)].into();
	}
	match depth {
		0 => format!("{n}."),
		1 => format!("{}.", roman(n)),
		_ => format!("{}.", char::from(96 + (((n.max(1) - 1) % 26) + 1) as u8)),
	}
}

/// Lay out a card's blocks `width` wide in `style`, light or dark.
pub fn layout(text: &Text, blocks: &[Block], style: &TextStyle, width: f32, align: Align, dark: bool, image: &dyn Fn(&str) -> Option<(f32, f32)>) -> Card {
	let p = if dark { &DARK } else { &LIGHT };
	let mut s = Setter { text, style, dark, p, align, image, ops: Vec::new(), links: Vec::new(), scrollers: Vec::new(), scroller: None };
	let f = Frame { size: style.size as f32, colour: hex(p.fg), weight: style.weight as f32, depth: 0 };
	let height = s.stack(blocks, 0.0, 0.0, width, f, style.size as f32);
	Card { height, ops: s.ops, links: s.links, scrollers: s.scrollers }
}

/// The accent and the check box's colours, for the painter.
pub fn check_colours(dark: bool) -> (Rgba, Rgba, Rgba) {
	let p = if dark { &DARK } else { &LIGHT };
	(hex(p.accent), hex(p.r#box), hex(p.strong))
}

/// The scroll bar's track and thumb colours.
pub fn bar_colours(dark: bool) -> (Rgba, Rgba) {
	let p = if dark { &DARK } else { &LIGHT };
	(hex(p.line), hex(p.faint))
}
