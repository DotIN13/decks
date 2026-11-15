//! Where every item of a tree is, as pen.dev lays it out.
//!
//! pen's layout is a small flexbox:
//!
//! - a `frame` lays its children in a row by default (`layout: "horizontal"`), or a column, or not at
//!   all (`"none"`, where each child sits at its own `x`, `y` from the frame's corner);
//! - `gap`, `padding`, `justifyContent` and `alignItems` mean what they mean in CSS;
//! - a size is a number, `fit_content` (hug the children; a frame's default) or `fill_container`
//!   (the parent's room; only inside a layout), either with a number in brackets: for a hug the
//!   least it is however little it holds, for a fill a fallback;
//! - a child with `layoutPosition: "absolute"` leaves the flow and sits at its `x`, `y`;
//! - a `group` has no size of its own: it is the box around its children;
//! - text sizes itself by `textGrowth`: `auto` is one line, `fixed-width` wraps, `fixed-width-height`
//!   is the box it was given.

use serde_json::Value;
use std::collections::HashMap;
use std::rc::Rc;

use crate::tree::{Item, MISSING, Tree};
use crate::values::{Theme, Vars};
use crate::Rect;

pub const DEFAULT_FONT: &str = "Inter";
pub const DEFAULT_FONT_SIZE: f64 = 14.0;
/// A note's padding and default width: pen.dev draws a note as a card with its text inside.
pub const NOTE_PAD: f64 = 16.0;
pub const NOTE_WIDTH: f64 = 240.0;

#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
	pub family: String,
	pub size: f64,
	pub weight: f64,
	pub italic: bool,
	pub letter_spacing: f64,
	/// A multiple of the size; `None` is the font's own.
	pub line_height: Option<f64>,
}

/// Measures words: one line when `max_width` is `None`, wrapped at it otherwise.
pub trait Measure {
	fn measure(&self, text: &str, style: &TextStyle, max_width: Option<f64>, item: &Item) -> (f64, f64);
}

/// A rough measure for where there is no font: 0.55 em a character, 1 em for wide scripts.
pub struct Estimate;

fn wide(c: char) -> bool {
	matches!(c as u32, 0x1100..=0x115F | 0x2E80..=0xA4CF | 0xAC00..=0xD7A3 | 0xF900..=0xFAFF | 0xFE30..=0xFE4F | 0xFF00..=0xFF60 | 0xFFE0..=0xFFE6)
}

impl Measure for Estimate {
	fn measure(&self, text: &str, style: &TextStyle, max_width: Option<f64>, _: &Item) -> (f64, f64) {
		let em = style.size;
		let char_w = |c: char| (if wide(c) { em } else { em * 0.55 }) + style.letter_spacing;
		let line_h = em * style.line_height.unwrap_or(1.2);
		let mut lines: Vec<f64> = Vec::new();
		for paragraph in text.split('\n') {
			let Some(max) = max_width else {
				lines.push(paragraph.chars().map(char_w).sum());
				continue;
			};
			let mut line = 0.0;
			// Words and the runs of space between them, as the browser breaks them.
			let mut word = String::new();
			let flush = |word: &mut String, line: &mut f64, lines: &mut Vec<f64>| {
				let w: f64 = word.chars().map(char_w).sum();
				if *line > 0.0 && *line + w > max && !word.trim().is_empty() {
					lines.push(*line);
					*line = w;
				} else {
					*line += w;
				}
				word.clear();
			};
			let mut space = false;
			for c in paragraph.chars() {
				if c.is_whitespace() != space && !word.is_empty() {
					flush(&mut word, &mut line, &mut lines);
				}
				space = c.is_whitespace();
				word.push(c);
			}
			if !word.is_empty() {
				flush(&mut word, &mut line, &mut lines);
			}
			lines.push(line);
		}
		let widest = lines.iter().copied().fold(0.0, f64::max);
		let w = max_width.map_or(widest, |m| widest.min(m));
		(w, lines.len().max(1) as f64 * line_h)
	}
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Sizing {
	Fixed(f64),
	Hug(Option<f64>),
	Fill(Option<f64>),
}

/// Each item's place: its box on the stage, whether it is shown, and the theme in force there.
#[derive(Clone, Debug)]
pub struct Placed {
	pub rect: Rect,
	pub visible: bool,
	pub theme: Rc<Theme>,
}

struct Ctx<'a> {
	tree: &'a Tree,
	vars: &'a Vars,
	measure: &'a dyn Measure,
}

const TEXTY: [&str; 4] = ["text", "note", "prompt", "context"];

impl Ctx<'_> {
	fn item(&self, i: u32) -> &Item {
		&self.tree.items[i as usize]
	}

	fn visible(&self, i: u32, theme: &Rc<Theme>) -> bool {
		let item = self.item(i);
		self.vars.bool(item.get("enabled"), &theme.with(&item.props), true)
	}

	fn sizing(&self, value: Option<&Value>, theme: &Theme, missing: Sizing) -> Sizing {
		match value {
			None | Some(Value::Null) => missing,
			Some(Value::Number(n)) => Sizing::Fixed(n.as_f64().unwrap_or(0.0)),
			Some(v) => {
				let text = v.as_str().map(str::trim).unwrap_or("");
				for (word, fill) in [("fit_content", false), ("hug_content", false), ("fill_container", true)] {
					if let Some(rest) = text.strip_prefix(word) {
						let fallback = rest.strip_prefix('(').and_then(|r| r.strip_suffix(')')).and_then(|n| n.trim().parse::<f64>().ok());
						if rest.is_empty() || fallback.is_some() {
							return if fill { Sizing::Fill(fallback) } else { Sizing::Hug(fallback) };
						}
					}
				}
				Sizing::Fixed(self.vars.num(Some(v), theme, 0.0))
			}
		}
	}

	fn default_sizing(&self, item: &Item) -> Sizing {
		match item.kind() {
			"frame" | "group" => Sizing::Hug(None),
			k if TEXTY.contains(&k) => Sizing::Hug(None),
			"icon" | "icon_font" => Sizing::Fixed(24.0),
			_ => Sizing::Fixed(100.0),
		}
	}

	fn text_style(&self, item: &Item, theme: &Theme) -> TextStyle {
		let family = self.vars.str(item.get("fontFamily"), theme).filter(|s| !s.is_empty()).unwrap_or(DEFAULT_FONT);
		let italic = self.vars.str(item.get("fontStyle"), theme).is_some_and(|s| s.eq_ignore_ascii_case("italic"));
		TextStyle {
			family: family.to_owned(),
			size: self.vars.num(item.get("fontSize"), theme, DEFAULT_FONT_SIZE),
			weight: self.vars.font_weight(&item.props, theme),
			italic,
			letter_spacing: self.vars.num(item.get("letterSpacing"), theme, 0.0),
			line_height: item.get("lineHeight").map(|v| self.vars.num(Some(v), theme, 1.2)),
		}
	}

	fn x_y(&self, item: &Item) -> (f64, f64) {
		let n = |k: &str| item.get(k).and_then(Value::as_f64).unwrap_or(0.0);
		(n("x"), n("y"))
	}

	/// An item's own size, given what its parent decided for any filling dimension.
	fn size_of(&self, i: u32, theme: &Rc<Theme>, forced_w: Option<f64>, forced_h: Option<f64>) -> (f64, f64) {
		let item = self.item(i);
		let t = theme.with(&item.props);
		let kind = item.kind();
		if kind == "group" {
			let (mut w, mut h) = (0.0f64, 0.0f64);
			for &child in &item.children {
				if !self.visible(child, &t) {
					continue;
				}
				let (cw, ch) = self.size_of(child, &t, None, None);
				let (x, y) = self.x_y(self.item(child));
				w = w.max(x + cw);
				h = h.max(y + ch);
			}
			return (w, h);
		}
		if TEXTY.contains(&kind) {
			return self.text_size(item, &t, forced_w, forced_h);
		}
		if kind == "path" {
			let bounds = item
				.get("viewBox")
				.and_then(Value::as_array)
				.and_then(|vb| Some((vb.get(2)?.as_f64()?, vb.get(3)?.as_f64()?)))
				.or_else(|| crate::geometry::path_bounds(item.get("geometry").and_then(Value::as_str)?).map(|r| (r.w, r.h)));
			let (bw, bh) = bounds.unwrap_or((0.0, 0.0));
			let ws = self.sizing(item.get("width"), &t, Sizing::Fixed(bw));
			let hs = self.sizing(item.get("height"), &t, Sizing::Fixed(bh));
			return (forced_w.unwrap_or(fixed_or(ws, bw)), forced_h.unwrap_or(fixed_or(hs, bh)));
		}
		if kind == "frame" {
			let ws = self.sizing(item.get("width"), &t, Sizing::Hug(None));
			let hs = self.sizing(item.get("height"), &t, Sizing::Hug(None));
			let known = |s: Sizing, forced: Option<f64>| if let Sizing::Fixed(v) = s { Some(v) } else { forced };
			let inner = self.frame_content(i, &t, known(ws, forced_w), known(hs, forced_h));
			let pick = |s: Sizing, hug: f64| match s {
				Sizing::Fixed(v) => v,
				// A hug's number is its floor, as in pen's layout.ts: as big as what it holds, never smaller.
				Sizing::Hug(floor) => match floor { None => hug, Some(f) if inner.count == 0 => f, Some(f) => f.max(hug) },
				Sizing::Fill(fallback) => fallback.unwrap_or(hug),
			};
			return (forced_w.unwrap_or_else(|| pick(ws, inner.w)), forced_h.unwrap_or_else(|| pick(hs, inner.h)));
		}
		// Rectangles, ellipses, polygons, browsers, icons, scripts, placeholders: the box they state.
		let fallback = if kind == MISSING { 120.0 } else if kind == "icon" || kind == "icon_font" { 24.0 } else { 100.0 };
		let ws = self.sizing(item.get("width"), &t, Sizing::Fixed(fallback));
		let hs = self.sizing(item.get("height"), &t, Sizing::Fixed(fallback));
		(forced_w.unwrap_or(fixed_or(ws, fallback)), forced_h.unwrap_or(fixed_or(hs, fallback)))
	}

	fn text_size(&self, item: &Item, t: &Theme, forced_w: Option<f64>, forced_h: Option<f64>) -> (f64, f64) {
		let style = self.text_style(item, t);
		let content = match self.vars.resolve(item.get("content"), t) {
			Some(Value::String(s)) => s.clone(),
			Some(Value::Null) | None => String::new(),
			Some(other) => other.to_string(),
		};
		if item.kind() != "text" {
			// A note, prompt or context is a card: its width, and a height that holds its words.
			let ws = self.sizing(item.get("width"), t, Sizing::Fixed(NOTE_WIDTH));
			let w = forced_w.unwrap_or(fixed_or(ws, NOTE_WIDTH));
			let hs = self.sizing(item.get("height"), t, Sizing::Hug(None));
			let h = forced_h.unwrap_or_else(|| match hs {
				Sizing::Fixed(v) => v,
				_ => self.measure.measure(&content, &style, Some((w - NOTE_PAD * 2.0).max(1.0)), item).1 + NOTE_PAD * 2.0,
			});
			return (w, h);
		}
		match item.get("textGrowth").and_then(Value::as_str).unwrap_or("auto") {
			"fixed-width-height" => {
				let ws = self.sizing(item.get("width"), t, Sizing::Fixed(100.0));
				let hs = self.sizing(item.get("height"), t, Sizing::Fixed(20.0));
				(forced_w.unwrap_or(fixed_or(ws, 100.0)), forced_h.unwrap_or(fixed_or(hs, 20.0)))
			}
			"fixed-width" => {
				let ws = self.sizing(item.get("width"), t, Sizing::Fixed(100.0));
				let w = forced_w.unwrap_or(fixed_or(ws, 100.0));
				(w, forced_h.unwrap_or_else(|| self.measure.measure(&content, &style, Some(w), item).1))
			}
			_ => {
				let (w, h) = self.measure.measure(&content, &style, None, item);
				(forced_w.unwrap_or(w), forced_h.unwrap_or(h))
			}
		}
	}

	/// The content a frame's children need and where each goes, relative to the frame. `w`/`h` are
	/// the frame's own size when known; the result's `w`/`h` are what it would hug to.
	fn frame_content(&self, i: u32, t: &Rc<Theme>, w: Option<f64>, h: Option<f64>) -> Content {
		let item = self.item(i);
		let kids: Vec<u32> = item.children.iter().copied().filter(|&c| self.visible(c, t)).collect();
		let mode = match item.get("layout").and_then(Value::as_str) {
			Some(m @ ("none" | "vertical" | "horizontal")) => m,
			_ if item.kind() == "frame" => "horizontal",
			_ => "none",
		};
		let mut locals = HashMap::new();
		if mode == "none" {
			let (mut right, mut bottom) = (0.0f64, 0.0f64);
			for &child in &kids {
				let (cw, ch) = self.size_of(child, t, None, None);
				let (x, y) = self.x_y(self.item(child));
				locals.insert(child, Rect { x, y, w: cw, h: ch });
				right = right.max(x + cw);
				bottom = bottom.max(y + ch);
			}
			return Content { w: right, h: bottom, count: kids.len(), locals };
		}
		let [pt, pr, pb, pl] = self.vars.padding(&item.props, t);
		let gap = self.vars.num(item.get("gap"), t, 0.0);
		let row = mode == "horizontal";
		let absolute = |c: u32| self.item(c).get("layoutPosition").and_then(Value::as_str) == Some("absolute");
		let flow: Vec<u32> = kids.iter().copied().filter(|&c| !absolute(c)).collect();
		let floating: Vec<u32> = kids.iter().copied().filter(|&c| absolute(c)).collect();
		let inner_main = if row { w.map(|w| w - pl - pr) } else { h.map(|h| h - pt - pb) };
		let inner_cross = if row { h.map(|h| h - pt - pb) } else { w.map(|w| w - pl - pr) };
		let axis = |c: u32, main: bool| {
			let child = self.item(c);
			let key = if row == main { "width" } else { "height" };
			self.sizing(child.get(key), &t.with(&child.props), self.default_sizing(child))
		};
		let forced_cross = |c: u32| match (axis(c, false), inner_cross) {
			(Sizing::Fill(_), Some(cross)) => Some(cross.max(0.0)),
			_ => None,
		};
		let mut sizes: HashMap<u32, (f64, f64)> = HashMap::new();
		let mut used = 0.0;
		let mut fillers = Vec::new();
		for &child in &flow {
			if matches!(axis(child, true), Sizing::Fill(_)) && inner_main.is_some() {
				fillers.push(child);
				continue;
			}
			let fc = forced_cross(child);
			let size = if row { self.size_of(child, t, None, fc) } else { self.size_of(child, t, fc, None) };
			sizes.insert(child, size);
			used += if row { size.0 } else { size.1 };
		}
		let gaps = flow.len().saturating_sub(1) as f64 * gap;
		if let (false, Some(main)) = (fillers.is_empty(), inner_main) {
			let share = ((main - used - gaps) / fillers.len() as f64).max(0.0);
			for &child in &fillers {
				let fc = forced_cross(child);
				let size = if row { self.size_of(child, t, Some(share), fc) } else { self.size_of(child, t, fc, Some(share)) };
				sizes.insert(child, size);
				used += if row { size.0 } else { size.1 };
			}
		}
		let content_main = used + gaps;
		let content_cross = flow.iter().map(|c| if row { sizes[c].1 } else { sizes[c].0 }).fold(0.0, f64::max);
		let main_box = inner_main.unwrap_or(content_main);
		let cross_box = inner_cross.unwrap_or(content_cross);
		let free = (main_box - content_main).max(0.0);
		let n = flow.len() as f64;
		let (mut cursor, between) = match item.get("justifyContent").and_then(Value::as_str).unwrap_or("start") {
			"center" => (free / 2.0, gap),
			"end" => (free, gap),
			"space_between" if flow.len() > 1 => (0.0, gap + free / (n - 1.0)),
			"space_around" if !flow.is_empty() => (free / n / 2.0, gap + free / n),
			_ => (0.0, gap),
		};
		let align = item.get("alignItems").and_then(Value::as_str).unwrap_or("start");
		for &child in &flow {
			let (cw, ch) = sizes[&child];
			let (child_main, child_cross) = if row { (cw, ch) } else { (ch, cw) };
			let cross_at = match align {
				"center" => (cross_box - child_cross) / 2.0,
				"end" => cross_box - child_cross,
				_ => 0.0,
			};
			let rect = if row { Rect { x: pl + cursor, y: pt + cross_at, w: cw, h: ch } } else { Rect { x: pl + cross_at, y: pt + cursor, w: cw, h: ch } };
			locals.insert(child, rect);
			cursor += child_main + between;
		}
		for &child in &floating {
			let (cw, ch) = self.size_of(child, t, None, None);
			let (x, y) = self.x_y(self.item(child));
			locals.insert(child, Rect { x, y, w: cw, h: ch });
		}
		let (hug_w, hug_h) = if row {
			(content_main + pl + pr, content_cross + pt + pb)
		} else {
			(content_cross + pl + pr, content_main + pt + pb)
		};
		Content { w: hug_w, h: hug_h, count: flow.len(), locals }
	}

	fn place(&self, i: u32, at: (f64, f64), size: (f64, f64), theme: &Rc<Theme>, out: &mut [Placed]) {
		let item = self.item(i);
		let t = theme.with(&item.props);
		out[i as usize] = Placed { rect: Rect { x: at.0, y: at.1, w: size.0, h: size.1 }, visible: true, theme: t.clone() };
		if item.children.is_empty() {
			return;
		}
		if item.kind() == "group" {
			let mut bounds: Option<Rect> = None;
			for &child in &item.children {
				if !self.visible(child, &t) {
					continue;
				}
				let size = self.size_of(child, &t, None, None);
				let (x, y) = self.x_y(self.item(child));
				self.place(child, (at.0 + x, at.1 + y), size, &t, out);
				let r = out[child as usize].rect;
				bounds = Some(bounds.map_or(r, |b| b.union(&r)));
			}
			// A group is the box round what is in it, wherever that starts.
			if let Some(b) = bounds {
				out[i as usize].rect = b;
			}
			return;
		}
		let content = self.frame_content(i, &t, Some(size.0), Some(size.1));
		for &child in &item.children {
			if let Some(local) = content.locals.get(&child) {
				self.place(child, (at.0 + local.x, at.1 + local.y), (local.w, local.h), &t, out);
			}
		}
	}
}

struct Content {
	w: f64,
	h: f64,
	count: usize,
	locals: HashMap<u32, Rect>,
}

fn fixed_or(s: Sizing, fallback: f64) -> f64 {
	match s {
		Sizing::Fixed(v) => v,
		Sizing::Hug(f) | Sizing::Fill(f) => f.unwrap_or(fallback),
	}
}

/// Lay out one tree: a [`Placed`] per item, hidden items (and everything under them) not visible.
pub fn layout(tree: &Tree, vars: &Vars, theme: &Rc<Theme>, measure: &dyn Measure) -> Vec<Placed> {
	let hidden = Placed { rect: Rect::default(), visible: false, theme: theme.clone() };
	let mut out = vec![hidden; tree.items.len()];
	if tree.items.is_empty() {
		return out;
	}
	let ctx = Ctx { tree, vars, measure };
	if !ctx.visible(0, theme) {
		return out;
	}
	let size = ctx.size_of(0, theme, None, None);
	ctx.place(0, ctx.x_y(&tree.items[0]), size, theme, &mut out);
	out
}

/// The text style an item draws its words in.
pub fn text_style(item: &Item, vars: &Vars, theme: &Theme) -> TextStyle {
	let tree = Tree::default();
	Ctx { tree: &tree, vars, measure: &Estimate }.text_style(item, theme)
}
