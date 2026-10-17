//! The painter: what part of the stage looks like, as a draw list.
//!
//! [`paint_area`] draws every item that meets an area of the stage at a scale, into target pixels
//! whose origin is the area's corner: a tile, or a lifted item's own texture. Items go in the
//! document's order. A frame that clips, or anything with an opacity under one and things inside
//! it, opens a scope (a clip or a layer) that closes after its last child; a frame's outline is
//! drawn when its scope closes, over its children, as pen.dev draws it.
//!
//! Boards (`browser` items) are not drawn here: the page draws their pictures under their pages.
//! Words come at the text step; until then text items draw nothing but their card's paper.

use serde_json::Value;
use stage_scene::layout::NOTE_PAD;
use stage_scene::tree::{Item, MISSING};
use stage_scene::values::{Theme, Vars, parse_color};
use stage_scene::{Rect, Root, Scene, geometry::Mat};
use std::cell::RefCell;
use std::collections::HashSet;

use crate::list::{Affine, Align, Clip, Color, DrawList, GlyphQuad, Op, Paint, Shape};
use crate::mesh;
use stage_text::atlas::{Atlas, COLOR_TEXTURE, MASK_TEXTURE};
use stage_text::{Laid, Span, Text};

pub const NOTE_RADIUS: f32 = 12.0;

/// What the painter is told besides the scene.
pub struct Context<'a> {
	pub scene: &'a Scene,
	pub dark: bool,
	/// Items drawn elsewhere for now (lifted while dragged): their ids, and everything under them.
	pub skip: &'a HashSet<String>,
	/// A picture's texture and size by its address, when it has been loaded.
	pub image: &'a dyn Fn(&str) -> Option<(u32, u32, u32)>,
	/// Pictures asked for that have no texture yet, to load.
	pub wanted: RefCell<Vec<String>>,
	/// Words: set by `text`, drawn from `atlas`. Without them words are not drawn.
	pub text: Option<&'a Text>,
	pub atlas: Option<&'a RefCell<Atlas>>,
}

impl<'a> Context<'a> {
	pub fn new(scene: &'a Scene, skip: &'a HashSet<String>, image: &'a dyn Fn(&str) -> Option<(u32, u32, u32)>) -> Context<'a> {
		Context { scene, dark: scene.dark, skip, image, wanted: RefCell::new(Vec::new()), text: None, atlas: None }
	}

	pub fn with_text(mut self, text: &'a Text, atlas: &'a RefCell<Atlas>) -> Context<'a> {
		self.text = Some(text);
		self.atlas = Some(atlas);
		self
	}
}

struct Scope {
	root: u32,
	item: u32,
	layer: bool,
	clip: bool,
	closing: Vec<Op>,
}

/// Every item meeting `area` (stage units), drawn at `scale` target pixels per stage unit, with the
/// area's corner at the target's origin.
pub fn paint_area(ctx: &Context, area: Rect, scale: f64, clear: Color) -> DrawList {
	let target = Mat([scale, 0.0, 0.0, scale, -area.x * scale, -area.y * scale]);
	let mut list = DrawList::new(clear);
	let mut stack: Vec<Scope> = Vec::new();
	for (r, i) in ctx.scene.query(&area) {
		let root = &ctx.scene.roots[r as usize];
		let item = &root.tree.items[i as usize];
		if item.kind() == "browser" {
			continue;
		}
		let chain = ancestors(root, i);
		if chain.iter().chain([&i]).any(|&a| ctx.skip.contains(&root.tree.items[a as usize].id) || opacity(ctx, root, a) <= 0.0) {
			continue;
		}
		// Close what this item is not inside, then open what it is inside and is not open yet.
		while let Some(top) = stack.last() {
			if top.root == r && chain.contains(&top.item) {
				break;
			}
			close(stack.pop().expect("a scope is open"), &mut list);
		}
		for &a in &chain {
			if !stack.iter().any(|s| s.root == r && s.item == a) {
				open(ctx, root, r, a, &target, false, &mut stack, &mut list);
			}
		}
		if item.children.is_empty() {
			let mut ops = Vec::new();
			let mut closing = Vec::new();
			own_ops(ctx, root, i, &target, 1.0, &mut ops, &mut closing);
			ops.append(&mut closing);
			let alpha = opacity(ctx, root, i);
			if alpha < 1.0 && ops.len() > 1 {
				list.push(Op::PushLayer { opacity: alpha });
				list.ops.extend(ops);
				list.push(Op::PopLayer);
			} else {
				list.ops.extend(ops.into_iter().map(|op| fade(op, alpha)));
			}
		} else {
			open(ctx, root, r, i, &target, true, &mut stack, &mut list);
		}
	}
	while let Some(scope) = stack.pop() {
		close(scope, &mut list);
	}
	list
}

fn ancestors(root: &Root, i: u32) -> Vec<u32> {
	let mut chain = Vec::new();
	let mut at = root.tree.items[i as usize].parent;
	while let Some(p) = at {
		chain.push(p);
		at = root.tree.items[p as usize].parent;
	}
	chain.reverse();
	chain
}

fn opacity(ctx: &Context, root: &Root, i: u32) -> f32 {
	let item = &root.tree.items[i as usize];
	ctx.scene.vars.num(item.get("opacity"), &root.placed[i as usize].theme, 1.0).clamp(0.0, 1.0) as f32
}

#[allow(clippy::too_many_arguments)]
fn open(ctx: &Context, root: &Root, r: u32, i: u32, target: &Mat, draw: bool, stack: &mut Vec<Scope>, list: &mut DrawList) {
	let item = &root.tree.items[i as usize];
	let theme = &root.placed[i as usize].theme;
	let alpha = opacity(ctx, root, i);
	let layer = alpha < 1.0;
	if layer {
		list.push(Op::PushLayer { opacity: alpha });
	}
	let mut closing = Vec::new();
	if draw {
		let mut ops = Vec::new();
		own_ops(ctx, root, i, target, 1.0, &mut ops, &mut closing);
		list.ops.extend(ops);
	}
	let clip = item.kind() == "frame" && ctx.scene.vars.bool(item.get("clip"), theme, false);
	if clip {
		let rect = root.placed[i as usize].rect;
		list.push(Op::PushClip(Clip { shape: rrect(&ctx.scene.vars, item, theme, rect.w, rect.h), transform: to_affine(&target.then(&root.world[i as usize])) }));
	}
	stack.push(Scope { root: r, item: i, layer, clip, closing });
}

fn close(scope: Scope, list: &mut DrawList) {
	if scope.clip {
		list.push(Op::PopClip);
	}
	list.ops.extend(scope.closing);
	if scope.layer {
		list.push(Op::PopLayer);
	}
}

fn to_affine(m: &Mat) -> Affine {
	Affine(m.0.map(|v| v as f32))
}

/// An op with an opacity multiplied into its colours.
fn fade(op: Op, alpha: f32) -> Op {
	if alpha >= 1.0 {
		return op;
	}
	let paint = |p: Paint| match p {
		Paint::Solid(c) => Paint::Solid(Color(c.0.map(|v| v * alpha))),
		Paint::Linear { from, to, stops } => Paint::Linear { from, to, stops: stops.into_iter().map(|(at, c)| (at, Color(c.0.map(|v| v * alpha)))).collect() },
		Paint::Radial { center, radius, stops } => Paint::Radial { center, radius, stops: stops.into_iter().map(|(at, c)| (at, Color(c.0.map(|v| v * alpha)))).collect() },
		Paint::Image { texture, opacity, uv } => Paint::Image { texture, opacity: opacity * alpha, uv },
	};
	match op {
		Op::Shape { shape, transform, paint: p, stroke } => Op::Shape { shape, transform, paint: paint(p), stroke },
		Op::Mesh { vertices, indices, transform, paint: p } => Op::Mesh { vertices, indices, transform, paint: paint(p) },
		Op::Shadow { shape, transform, color, blur, spread } => Op::Shadow { shape, transform, color: Color(color.0.map(|v| v * alpha)), blur, spread },
		Op::Glyphs { texture, quads, color, transform, colored } => Op::Glyphs { texture, quads, color: Color(color.0.map(|v| v * alpha)), transform, colored },
		Op::Picture { texture, x, y, w, h, uv, opacity } => Op::Picture { texture, x, y, w, h, uv, opacity: opacity * alpha },
		other => other,
	}
}

fn rrect(vars: &Vars, item: &Item, theme: &Theme, w: f64, h: f64) -> Shape {
	let r = vars.radii(&item.props, theme);
	// No corner rounder than half the shorter side.
	let limit = (w.min(h) / 2.0).max(0.0);
	Shape { w: w as f32, h: h as f32, radii: r.map(|v| v.clamp(0.0, limit) as f32), ellipse: false }
}

fn color(vars: &Vars, value: Option<&Value>, theme: &Theme) -> Option<[f32; 4]> {
	vars.color(value, theme)
}

fn fills_of(value: Option<&Value>) -> Vec<&Value> {
	match value {
		None | Some(Value::Null) => Vec::new(),
		Some(Value::Array(list)) => list.iter().collect(),
		Some(one) => vec![one],
	}
}

/// A fill as a paint over a `w` × `h` box, or `None` when it draws nothing (yet).
fn paint_of(ctx: &Context, fill: &Value, theme: &Theme, w: f64, h: f64) -> Option<Paint> {
	let vars = &ctx.scene.vars;
	if let Some(s) = fill.as_str() {
		return color(vars, Some(fill), theme).map(|c| Paint::Solid(Color::straight(c, 1.0))).or_else(|| parse_color(s).map(|c| Paint::Solid(Color::straight(c, 1.0))));
	}
	let object = fill.as_object()?;
	if !vars.bool(object.get("enabled"), theme, true) {
		return None;
	}
	let kind = object.get("type").and_then(Value::as_str).unwrap_or("");
	let alpha = vars.num(object.get("opacity"), theme, 1.0) as f32;
	match kind {
		"color" | "solid" => color(vars, object.get("color"), theme).map(|c| Paint::Solid(Color::straight(c, 1.0))),
		"gradient" => {
			let mut stops: Vec<(f32, Color)> = object
				.get("colors")
				.and_then(Value::as_array)
				.map(|list| list.iter().filter_map(|s| Some((vars.num(s.get("position"), theme, 0.0) as f32, Color::straight(color(vars, s.get("color"), theme)?, alpha)))).collect())
				.unwrap_or_default();
			stops.sort_by(|a, b| a.0.total_cmp(&b.0));
			if stops.is_empty() {
				return None;
			}
			if stops.len() == 1 {
				stops.push(stops[0]);
			}
			let center = object.get("center");
			let size = object.get("size");
			let cx = w * vars.num(center.and_then(|c| c.get("x")), theme, 0.5);
			let cy = h * vars.num(center.and_then(|c| c.get("y")), theme, 0.5);
			let sw = w * vars.num(size.and_then(|s| s.get("width")), theme, 1.0);
			let sh = h * vars.num(size.and_then(|s| s.get("height")), theme, 1.0);
			match object.get("gradientType").and_then(Value::as_str).unwrap_or("linear") {
				// Angular gradients come with the gradient shaders' next step; radial stands in.
				"radial" | "angular" => Some(Paint::Radial { center: (cx as f32, cy as f32), radius: ((sw / 2.0).max(1.0) as f32, (sh / 2.0).max(1.0) as f32), stops }),
				_ => {
					// 0° points up and angles run counter-clockwise; the length is the size's height.
					let rad = vars.num(object.get("rotation"), theme, 0.0).to_radians();
					let (dx, dy) = (-rad.sin(), -rad.cos());
					let half = sh / 2.0;
					Some(Paint::Linear { from: ((cx - dx * half) as f32, (cy - dy * half) as f32), to: ((cx + dx * half) as f32, (cy + dy * half) as f32), stops })
				}
			}
		}
		"image" => {
			let url = object.get("url").and_then(Value::as_str)?;
			let Some((texture, iw, ih)) = (ctx.image)(url) else {
				ctx.wanted.borrow_mut().push(url.to_owned());
				return None;
			};
			let (iw, ih) = (iw.max(1) as f64, ih.max(1) as f64);
			let (sx, sy) = (w / iw, h / ih);
			let (sx, sy) = match object.get("mode").and_then(Value::as_str) {
				Some("stretch") => (sx, sy),
				Some("fit") => (sx.min(sy), sx.min(sy)),
				_ => (sx.max(sy), sx.max(sy)),
			};
			// The part of the picture across the box, centred.
			let (pw, ph) = (w / sx / iw, h / sy / ih);
			let (u0, v0) = ((1.0 - pw) / 2.0, (1.0 - ph) / 2.0);
			Some(Paint::Image { texture, opacity: alpha, uv: [u0 as f32, v0 as f32, (u0 + pw) as f32, (v0 + ph) as f32] })
		}
		_ => None,
	}
}

/// Outer shadows: `(dx, dy, blur, spread, color)` each.
fn shadows(vars: &Vars, item: &Item, theme: &Theme) -> Vec<(f32, f32, f32, f32, Color)> {
	let mut out = Vec::new();
	for effect in fills_of(item.get("effect")) {
		if effect.get("type").and_then(Value::as_str) != Some("shadow") || effect.get("shadowType").and_then(Value::as_str) == Some("inner") {
			continue;
		}
		if !vars.bool(effect.get("enabled"), theme, true) {
			continue;
		}
		let Some(c) = color(vars, effect.get("color"), theme).or_else(|| parse_color("#00000040")) else { continue };
		let off = effect.get("offset");
		out.push((
			vars.num(off.and_then(|o| o.get("x")), theme, 0.0) as f32,
			vars.num(off.and_then(|o| o.get("y")), theme, 0.0) as f32,
			vars.num(effect.get("blur"), theme, 0.0) as f32,
			vars.num(effect.get("spread"), theme, 0.0) as f32,
			Color::straight(c, 1.0),
		));
	}
	out
}

struct Stroke<'v> {
	fills: Vec<&'v Value>,
	widths: [f32; 4],
	align: Align,
	cap: lyon_tessellation::LineCap,
	join: lyon_tessellation::LineJoin,
}

/// The stroke an item draws, from either spelling pen.dev has used.
fn stroke_of<'v>(vars: &Vars, item: &'v Item, theme: &Theme) -> Option<Stroke<'v>> {
	use lyon_tessellation::{LineCap, LineJoin};
	let raw = item.get("stroke");
	let legacy = raw.and_then(Value::as_object).filter(|o| !o.contains_key("type") && (o.contains_key("thickness") || o.contains_key("align") || o.contains_key("fill")));
	let fills = match legacy {
		Some(l) => fills_of(l.get("fill")),
		None => fills_of(raw),
	};
	if fills.is_empty() {
		return None;
	}
	let width = if legacy.is_some() { legacy.and_then(|l| l.get("thickness")) } else { item.get("strokeWidth") };
	let widths = match width {
		Some(Value::Object(sides)) => ["top", "right", "bottom", "left"].map(|k| vars.num(sides.get(k), theme, 0.0) as f32),
		other => [vars.num(other, theme, 1.0) as f32; 4],
	};
	if widths.iter().all(|w| *w <= 0.0) {
		return None;
	}
	let legacy_align = legacy.and_then(|l| l.get("align")).and_then(Value::as_str).map(|a| match a {
		"inside" => "inner",
		"outside" => "outer",
		_ => "center",
	});
	let align = match item.get("strokeAlignment").and_then(Value::as_str).or(legacy_align).unwrap_or("center") {
		"inner" => Align::Inside,
		"outer" => Align::Outside,
		_ => Align::Center,
	};
	let text = |key: &str, old: &str| item.get(key).and_then(Value::as_str).or_else(|| legacy.and_then(|l| l.get(old)).and_then(Value::as_str));
	let cap = match text("strokeLinecap", "cap") {
		Some("round") => LineCap::Round,
		Some("square") => LineCap::Square,
		_ => LineCap::Butt,
	};
	let join = match text("strokeLinejoin", "join") {
		Some("round") => LineJoin::Round,
		Some("bevel") => LineJoin::Bevel,
		_ => LineJoin::Miter,
	};
	Some(Stroke { fills, widths, align, cap, join })
}

fn dash_of(item: &Item, width: f32) -> Option<Vec<f64>> {
	let w = width.max(1.0) as f64;
	match item.get("strokeDash").and_then(Value::as_str) {
		Some("dashed") => Some(vec![w * 4.0, w * 3.0]),
		Some("dotted") => Some(vec![0.01, w * 2.5]),
		_ => None,
	}
}

const ARROW: &str = "decks.arrow";
const CARD: &str = "decks.card";
const MARKDOWN: &str = "decks.markdown";
const MEDIA: &str = "decks.media";

fn meta_type(item: &Item) -> Option<&str> {
	item.get("metadata").and_then(|m| m.get("type")).and_then(Value::as_str)
}

/// The ops an item draws of its own (its children are drawn after): `ops` now, `closing` after its
/// children, when it has any.
fn own_ops(ctx: &Context, root: &Root, i: u32, target: &Mat, _alpha: f32, ops: &mut Vec<Op>, closing: &mut Vec<Op>) {
	let vars = &ctx.scene.vars;
	let item = &root.tree.items[i as usize];
	let placed = &root.placed[i as usize];
	let theme = &placed.theme;
	let (w, h) = (placed.rect.w, placed.rect.h);
	let m = target.then(&root.world[i as usize]);
	let transform = to_affine(&m);
	// How many target pixels a unit of the item's own space is: what curves are flattened to.
	let pixels = transform.scale_factor().max(1e-3);
	match item.kind() {
		"frame" | "rectangle" => {
			let shape = rrect(vars, item, theme, w, h);
			let media = meta_type(item) == Some(MEDIA);
			let sound = media && item.get("metadata").and_then(|m| m.get("kind")).and_then(Value::as_str) == Some("audio");
			let paper = (meta_type(item) == Some(CARD) && fills_of(item.get("fill")).is_empty()) || sound;
			if paper {
				card_paper(ctx.dark, shape, transform, ops);
			}
			for (dx, dy, blur, spread, c) in shadows(vars, item, theme) {
				ops.push(Op::Shadow { shape, transform: transform.then(&Affine::translate(dx, dy)), color: c, blur, spread });
			}
			if !sound {
				for fill in fills_of(item.get("fill")) {
					if let Some(paint) = paint_of(ctx, fill, theme, w, h) {
						ops.push(Op::Shape { shape, transform, paint, stroke: None });
					}
				}
			}
			let after = if item.children.is_empty() { &mut *ops } else { &mut *closing };
			shape_stroke(ctx, item, theme, shape, transform, after);
			if paper {
				card_edge(ctx.dark, shape, transform, after);
			}
		}
		"ellipse" => {
			let inner = vars.num(item.get("innerRadius"), theme, 0.0).clamp(0.0, 1.0);
			let sweep = vars.num(item.get("sweepAngle"), theme, 360.0).clamp(-360.0, 360.0);
			if inner > 0.0 || sweep.abs() < 360.0 {
				// An arc or a ring: a path.
				let start = vars.num(item.get("startAngle"), theme, 0.0);
				let path = mesh::arc_path(w, h, inner, start, sweep);
				path_ops(ctx, item, theme, &path, w, h, transform, pixels, true, ops);
				return;
			}
			let shape = Shape { w: w as f32, h: h as f32, radii: [0.0; 4], ellipse: true };
			for (dx, dy, blur, spread, c) in shadows(vars, item, theme) {
				ops.push(Op::Shadow { shape, transform: transform.then(&Affine::translate(dx, dy)), color: c, blur, spread });
			}
			for fill in fills_of(item.get("fill")) {
				if let Some(paint) = paint_of(ctx, fill, theme, w, h) {
					ops.push(Op::Shape { shape, transform, paint, stroke: None });
				}
			}
			shape_stroke(ctx, item, theme, shape, transform, ops);
		}
		"polygon" => {
			let sides = vars.num(item.get("polygonCount"), theme, 3.0).round().max(3.0) as usize;
			let radius = vars.radii(&item.props, theme)[0];
			let path = mesh::polygon_path(w, h, sides, radius);
			path_ops(ctx, item, theme, &path, w, h, transform, pixels, true, ops);
		}
		"path" => {
			let Some(path) = mesh::geometry_path(item, w, h) else { return };
			path_ops(ctx, item, theme, &path, w, h, transform, pixels, false, ops);
		}
		"note" | "prompt" | "context" => {
			let markdown = meta_type(item) == Some(MARKDOWN);
			let paper = if markdown {
				if ctx.dark { "#242424" } else { "#ffffff" }
			} else {
				match item.kind() {
					"prompt" => "#ddd6fe",
					"context" => "#bfdbfe",
					_ => "#fde68a",
				}
			};
			let shape = Shape { w: w as f32, h: h as f32, radii: [NOTE_RADIUS; 4], ellipse: false };
			card_paper_colour(ctx.dark, shape, transform, parse_color(paper).unwrap_or([1.0; 4]), ops);
			card_edge(ctx.dark, shape, transform, ops);
			if markdown {
				card_words(ctx, item, theme, w, NOTE_PAD, &m, ops);
			} else {
				let ink = parse_color("#1f2328").unwrap_or([0.0, 0.0, 0.0, 1.0]);
				words(ctx, item, theme, w, h, NOTE_PAD, ink, &m, ops);
			}
			// A prompt names the model it is for: small, in the top padding's right corner.
			if item.kind() == "prompt" {
				if let Some(model) = item.get("model").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
					let style = stage_scene::layout::TextStyle { family: "Inter".into(), size: 11.0, weight: 500.0, italic: false, letter_spacing: 0.0, line_height: None };
					label(ctx, model, &style, (NOTE_PAD, 2.0), (w - NOTE_PAD * 2.0).max(20.0), stage_text::Align::Right, [0.25, 0.2, 0.45, 0.75], &m, ops);
				}
			}
		}
		"text" if stage_text::is_markdown(item) => {
			// One block of a card, drawn as the card draws it, with no paper of its own.
			card_words(ctx, item, theme, w, 0.0, &m, ops);
		}
		"text" => {
			let ink = text_ink(ctx, item, theme);
			words(ctx, item, theme, w, h, 0.0, ink, &m, ops);
		}
		// Icons and films come with their own steps.
		"icon" | "icon_font" | "browser" => {}
		kind => {
			// Anything this build cannot draw, and broken refs, as a dashed outline that says so.
			let missing = kind == MISSING;
			let c = if missing { [0.86, 0.2, 0.2, 0.9] } else { [0.5, 0.5, 0.55, 0.8] };
			let rect = mesh::rounded_rect_path(w, h, 6.0);
			if let Some(mesh) = mesh::stroke(&rect, 1.5, lyon_tessellation::LineCap::Butt, lyon_tessellation::LineJoin::Miter, Some(&[6.0, 4.0]), pixels) {
				ops.push(Op::Mesh { vertices: mesh.0, indices: mesh.1, transform, paint: Paint::Solid(Color::straight(c, 1.0)) });
			}
			let said = if missing { format!("missing: {}", item.get("why").and_then(Value::as_str).unwrap_or(&item.id)) } else { kind.to_owned() };
			let style = stage_scene::layout::TextStyle { family: "Inter".into(), size: 13.0, weight: 400.0, italic: false, letter_spacing: 0.0, line_height: None };
			let grey = if ctx.dark { [0.75, 0.75, 0.78, 1.0] } else { [0.4, 0.4, 0.45, 1.0] };
			label(ctx, &said, &style, (8.0, 8.0), (w - 16.0).max(20.0), stage_text::Align::Left, grey, &m, ops);
		}
	}
}

/// A shape's outline: uniform as one op, per side as bars cut to the shape.
fn shape_stroke(ctx: &Context, item: &Item, theme: &Theme, shape: Shape, transform: Affine, ops: &mut Vec<Op>) {
	let vars = &ctx.scene.vars;
	let Some(stroke) = stroke_of(vars, item, theme) else { return };
	let Some(paint) = stroke.fills.iter().find_map(|f| paint_of(ctx, f, theme, shape.w as f64, shape.h as f64)) else { return };
	let [top, right, bottom, left] = stroke.widths;
	if top == right && right == bottom && bottom == left {
		if let Some(dash) = dash_of(item, top) {
			let path = if shape.ellipse { mesh::ellipse_path(shape.w as f64, shape.h as f64) } else { mesh::rounded_rect_path(shape.w as f64, shape.h as f64, shape.radii[0] as f64) };
			if let Some(m) = mesh::stroke(&path, top, stroke.cap, stroke.join, Some(&dash), transform.scale_factor()) {
				ops.push(Op::Mesh { vertices: m.0, indices: m.1, transform, paint });
			}
			return;
		}
		ops.push(Op::Shape { shape, transform, paint, stroke: Some((top, stroke.align)) });
		return;
	}
	ops.push(Op::PushClip(Clip { shape, transform }));
	let (w, h) = (shape.w, shape.h);
	let bar = |x: f32, y: f32, bw: f32, bh: f32| Op::Shape {
		shape: Shape { w: bw, h: bh, radii: [0.0; 4], ellipse: false },
		transform: transform.then(&Affine::translate(x, y)),
		paint: paint.clone(),
		stroke: None,
	};
	if top > 0.0 {
		ops.push(bar(0.0, 0.0, w, top));
	}
	if bottom > 0.0 {
		ops.push(bar(0.0, h - bottom, w, bottom));
	}
	if left > 0.0 {
		ops.push(bar(0.0, 0.0, left, h));
	}
	if right > 0.0 {
		ops.push(bar(w - right, 0.0, right, h));
	}
	ops.push(Op::PopClip);
}

#[allow(clippy::too_many_arguments)]
fn path_ops(ctx: &Context, item: &Item, theme: &Theme, path: &kurbo::BezPath, w: f64, h: f64, transform: Affine, pixels: f32, closed_shape: bool, ops: &mut Vec<Op>) {
	let vars = &ctx.scene.vars;
	let even_odd = item.get("fillRule").and_then(Value::as_str) == Some("evenodd") || (item.kind() == "ellipse" && vars.num(item.get("innerRadius"), theme, 0.0) > 0.0);
	let fills: Vec<Paint> = fills_of(item.get("fill")).into_iter().filter_map(|f| paint_of(ctx, f, theme, w, h)).collect();
	if !fills.is_empty() {
		if let Some((vertices, indices)) = mesh::fill(path, even_odd, pixels) {
			for paint in fills {
				ops.push(Op::Mesh { vertices: vertices.clone(), indices: indices.clone(), transform, paint });
			}
		}
	}
	let Some(stroke) = stroke_of(vars, item, theme) else { return };
	let Some(paint) = stroke.fills.iter().find_map(|f| paint_of(ctx, f, theme, w, h)) else { return };
	let width = stroke.widths[0];
	let arrow = meta_type(item) == Some(ARROW);
	// Paths stroke on their line: an arrow's head would be cut away by an inner stroke.
	let _ = closed_shape;
	let dash = if arrow { None } else { dash_of(item, width) };
	if let Some((vertices, indices)) = mesh::stroke(path, width, stroke.cap, stroke.join, dash.as_deref(), pixels) {
		ops.push(Op::Mesh { vertices, indices, transform, paint });
	}
}

/// A card's paper: the app's two-layer shadow for the scheme, then the paper.
fn card_paper(dark: bool, shape: Shape, transform: Affine, ops: &mut Vec<Op>) {
	let paper = if dark { [0.141, 0.141, 0.141, 1.0] } else { [1.0, 1.0, 1.0, 1.0] };
	card_paper_colour(dark, shape, transform, paper, ops);
}

fn card_paper_colour(dark: bool, shape: Shape, transform: Affine, paper: [f32; 4], ops: &mut Vec<Op>) {
	let layers: [(f32, f32, f32); 2] = if dark { [(1.0, 2.0, 0.4), (6.0, 18.0, 0.3)] } else { [(1.0, 2.0, 0.06), (4.0, 12.0, 0.05)] };
	for (y, blur, a) in layers {
		ops.push(Op::Shadow { shape, transform: transform.then(&Affine::translate(0.0, y)), color: Color::straight([0.0, 0.0, 0.0, a], 1.0), blur, spread: 0.0 });
	}
	ops.push(Op::Shape { shape, transform, paint: Paint::Solid(Color::straight(paper, 1.0)), stroke: None });
}

/// A card's hairline edge, outside its box as a CSS outline is.
fn card_edge(dark: bool, shape: Shape, transform: Affine, ops: &mut Vec<Op>) {
	let edge = if dark { [1.0, 1.0, 1.0, 0.12] } else { [0.0, 0.0, 0.0, 0.1] };
	ops.push(Op::Shape { shape, transform, paint: Paint::Solid(Color::straight(edge, 1.0)), stroke: Some((1.0, Align::Outside)) });
}

/// A text item's colour: its fill, or the scheme's ink.
fn text_ink(ctx: &Context, item: &Item, theme: &Theme) -> [f32; 4] {
	let vars = &ctx.scene.vars;
	let own = fills_of(item.get("fill")).into_iter().find_map(|f| {
		if f.is_string() {
			color(vars, Some(f), theme)
		} else if f.get("type").and_then(Value::as_str) == Some("color") {
			color(vars, f.get("color"), theme)
		} else {
			None
		}
	});
	own.unwrap_or(if ctx.dark { [0.902, 0.902, 0.902, 1.0] } else { [0.122, 0.137, 0.157, 1.0] })
}

/// An item's own words inside `pad`, aligned as it says, in `ink`.
#[allow(clippy::too_many_arguments)]
fn words(ctx: &Context, item: &Item, theme: &Theme, w: f64, h: f64, pad: f64, ink: [f32; 4], m: &Mat, ops: &mut Vec<Op>) {
	let Some(text) = ctx.text else { return };
	let vars = &ctx.scene.vars;
	let content = match vars.resolve(item.get("content"), theme) {
		Some(Value::String(s)) => s.clone(),
		Some(Value::Null) | None => return,
		Some(other) => other.to_string(),
	};
	if content.is_empty() {
		return;
	}
	let style = stage_scene::layout::text_style(item, vars, theme);
	let align = match item.get("textAlign").and_then(Value::as_str) {
		Some("center") => stage_text::Align::Center,
		Some("right") => stage_text::Align::Right,
		Some("justify") => stage_text::Align::Justify,
		_ => stage_text::Align::Left,
	};
	let width = (w - pad * 2.0).max(1.0);
	let auto = item.kind() == "text" && item.get("textGrowth").and_then(Value::as_str).unwrap_or("auto") == "auto";
	// One more pixel than measured, so a line measured to fit does not wrap on rounding.
	let max = if auto { width + 1.0 } else { width };
	let span = Span { underline: vars.bool(item.get("underline"), theme, false), strike: vars.bool(item.get("strikethrough"), theme, false), ..Span::plain(&content, &style) };
	let laid = text.lay(&[span], Some(max as f32), align);
	let inner = h - pad * 2.0;
	let offset = match item.get("textAlignVertical").and_then(Value::as_str) {
		Some("middle") => (inner - laid.height as f64) / 2.0,
		Some("bottom") => inner - laid.height as f64,
		_ => 0.0,
	};
	draw_laid(ctx, &laid, (pad, pad + offset.max(0.0)), &[Color::straight(ink, 1.0)], m, ops);
}

/// A line of the app's own words (a label), not an item's.
#[allow(clippy::too_many_arguments)]
fn label(ctx: &Context, words: &str, style: &stage_scene::layout::TextStyle, at: (f64, f64), width: f64, align: stage_text::Align, ink: [f32; 4], m: &Mat, ops: &mut Vec<Op>) {
	let Some(text) = ctx.text else { return };
	let laid = text.lay(&[Span::plain(words, style)], Some(width as f32), align);
	draw_laid(ctx, &laid, at, &[Color::straight(ink, 1.0)], m, ops);
}

/// Glyphs bigger than this are drawn at this size and stretched: a glyph texture holds only so much.
const MAX_GLYPH_PX: f64 = 192.0;

/// A set paragraph's glyphs and rules, its top-left at `origin` in the item's own space. `brushes`
/// are the colours its spans name.
pub fn draw_laid(ctx: &Context, laid: &Laid, origin: (f64, f64), brushes: &[Color], m: &Mat, ops: &mut Vec<Op>) {
	let Some(atlas) = ctx.atlas else { return };
	let mut atlas = atlas.borrow_mut();
	let [a, b, c, d, e, f] = m.0;
	let upright = b == 0.0 && c == 0.0 && a > 0.0 && (a - d).abs() < 1e-9;
	let scale = if upright { a } else { (a * a + b * b).sqrt() };
	let biggest = laid.runs.iter().map(|r| r.size as f64).fold(0.0, f64::max);
	// The scale glyphs are cut at; when it is not the target's own, a transform takes them there.
	let raster = if biggest * scale > MAX_GLYPH_PX { MAX_GLYPH_PX / biggest.max(1.0) } else { scale };
	let direct = upright && raster == scale;
	let (ox, oy, transform) = if direct {
		(e + a * origin.0, f + d * origin.1, Affine::IDENTITY)
	} else {
		let back = Mat([1.0 / raster, 0.0, 0.0, 1.0 / raster, 0.0, 0.0]);
		(origin.0 * raster, origin.1 * raster, Affine(m.then(&back).0.map(|v| v as f32)))
	};
	let mut groups: Vec<((u32, u32), Vec<GlyphQuad>)> = Vec::new();
	for run in &laid.runs {
		let px = (run.size as f64 * raster) as f32;
		for &(g, gx, gy) in &run.glyphs {
			let x = ox + raster * gx as f64;
			let y = oy + raster * gy as f64;
			let fl = x.floor();
			let Some((slot, carry)) = atlas.glyph(run, g, px, (x - fl) as f32) else { continue };
			let quad = GlyphQuad { x: (fl + carry as f64) as f32 + slot.left as f32, y: y.round() as f32 - slot.top as f32, w: slot.w as f32, h: slot.h as f32, u: slot.u as f32, v: slot.v as f32 };
			let texture = if slot.color { COLOR_TEXTURE } else { MASK_TEXTURE };
			let key = (texture, run.brush);
			match groups.iter_mut().find(|(k, _)| *k == key) {
				Some((_, quads)) => quads.push(quad),
				None => groups.push((key, vec![quad])),
			}
		}
	}
	let brush = |i: u32| brushes.get(i as usize).or(brushes.first()).copied().unwrap_or(Color([0.0, 0.0, 0.0, 1.0]));
	for ((texture, b), quads) in groups {
		let colored = texture == COLOR_TEXTURE;
		ops.push(Op::Glyphs { texture, quads, color: brush(b), transform, colored });
	}
	let local = Affine(m.0.map(|v| v as f32));
	for rule in &laid.rules {
		let shape = Shape { w: rule.w, h: rule.h, radii: [0.0; 4], ellipse: false };
		ops.push(Op::Shape { shape, transform: local.then(&Affine::translate(origin.0 as f32 + rule.x, origin.1 as f32 + rule.y)), paint: Paint::Solid(brush(rule.brush)), stroke: None });
	}
}

/// A card's markdown, laid out as it was measured, inside `pad`.
fn card_words(ctx: &Context, item: &Item, theme: &Theme, w: f64, pad: f64, m: &Mat, ops: &mut Vec<Op>) {
	let Some(text) = ctx.text else { return };
	let vars = &ctx.scene.vars;
	let Some(Value::String(content)) = vars.resolve(item.get("content"), theme) else { return };
	if content.is_empty() {
		return;
	}
	let style = stage_scene::layout::text_style(item, vars, theme);
	let align = match item.get("textAlign").and_then(Value::as_str) {
		Some("center") => stage_text::Align::Center,
		Some("right") => stage_text::Align::Right,
		_ => stage_text::Align::Left,
	};
	let card = text.card(content, &style, (w - pad * 2.0).max(1.0) as f32, align);
	draw_card(ctx, &card.ops, (pad, pad), m, ops);
}

fn draw_card(ctx: &Context, card_ops: &[stage_text::card::CardOp], origin: (f64, f64), m: &Mat, ops: &mut Vec<Op>) {
	use stage_text::card::CardOp;
	let local = |x: f32, y: f32| Affine(m.0.map(|v| v as f32)).then(&Affine::translate(origin.0 as f32 + x, origin.1 as f32 + y));
	let rect = |w: f32, h: f32, r: f32| Shape { w, h, radii: [r; 4], ellipse: false };
	for op in card_ops {
		match op {
			CardOp::Text { laid, x, y, brushes } => {
				// What lies behind words (a highlight, code's tint) goes under them.
				for run in &laid.runs {
					if let Some(back) = brushes.get(run.brush as usize).and_then(|b| b.back) {
						ops.push(Op::Shape { shape: rect(run.w, run.line_height, 3.0), transform: local(x + run.x, y + run.line_top), paint: Paint::Solid(Color::straight(back, 1.0)), stroke: None });
					}
				}
				let colours: Vec<Color> = brushes.iter().map(|b| Color::straight(b.ink, 1.0)).collect();
				draw_laid(ctx, laid, (origin.0 + *x as f64, origin.1 + *y as f64), &colours, m, ops);
			}
			CardOp::Box { x, y, w, h, color, r } => {
				ops.push(Op::Shape { shape: rect(*w, *h, *r), transform: local(*x, *y), paint: Paint::Solid(Color::straight(*color, 1.0)), stroke: None });
			}
			CardOp::Check { x, y, size, checked } => {
				let (accent, paper, edge) = stage_text::card::check_colours(ctx.dark);
				let shape = rect(*size, *size, size * 0.25);
				ops.push(Op::Shape { shape, transform: local(*x, *y), paint: Paint::Solid(Color::straight(if *checked { accent } else { paper }, 1.0)), stroke: None });
				if *checked {
					let s = *size as f64;
					let mut tick = kurbo::BezPath::new();
					tick.move_to((s * 0.26, s * 0.52));
					tick.line_to((s * 0.43, s * 0.69));
					tick.line_to((s * 0.75, s * 0.33));
					if let Some((vertices, indices)) = mesh::stroke(&tick, size * 0.14, lyon_tessellation::LineCap::Round, lyon_tessellation::LineJoin::Round, None, local(0.0, 0.0).scale_factor()) {
						ops.push(Op::Mesh { vertices, indices, transform: local(*x, *y), paint: Paint::Solid(Color([1.0; 4])) });
					}
				} else {
					ops.push(Op::Shape { shape, transform: local(*x, *y), paint: Paint::Solid(Color::straight(edge, 1.0)), stroke: Some((1.0, Align::Inside)) });
				}
			}
			CardOp::Image { url, x, y, w, h } => {
				if let Some((texture, _, _)) = (ctx.image)(url) {
					ops.push(Op::Shape { shape: rect(*w, *h, 0.0), transform: local(*x, *y), paint: Paint::Image { texture, opacity: 1.0, uv: [0.0, 0.0, 1.0, 1.0] }, stroke: None });
				} else {
					ctx.wanted.borrow_mut().push(url.clone());
				}
			}
			CardOp::Scroll { x, y, w, h, content, ops: inner, .. } => {
				// Wide tables show from their start; scrolling them comes with the page's input.
				ops.push(Op::PushClip(Clip { shape: rect(*w, *h, 0.0), transform: local(*x, *y) }));
				draw_card(ctx, inner, origin, m, ops);
				ops.push(Op::PopClip);
				let (track, thumb) = stage_text::card::bar_colours(ctx.dark);
				ops.push(Op::Shape { shape: rect(*w, 3.0, 1.5), transform: local(*x, y + h - 3.0), paint: Paint::Solid(Color::straight(track, 1.0)), stroke: None });
				let tw = (w / content * w).max(24.0);
				ops.push(Op::Shape { shape: rect(tw, 3.0, 1.5), transform: local(*x, y + h - 3.0), paint: Paint::Solid(Color::straight(thumb, 1.0)), stroke: None });
			}
		}
	}
}
