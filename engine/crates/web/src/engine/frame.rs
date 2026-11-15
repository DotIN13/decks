//! The page's frame: the worker's tiles laid on the screen with the cards' pictures, papers,
//! titles and app windows, and the lifted items and ink drawn fresh over them.

use super::*;

/// A card as the app places it (`SceneCard`).
#[derive(Clone, Debug, Default)]
pub struct CardPlace {
	pub path: String,
	/// The id of its item on the drawing: what a glide's offset is kept under (`offsets`).
	pub id: String,
	/// The address its picture is held under (`card:<path>`), made once with the place.
	pub picture: String,
	pub x: f64,
	pub y: f64,
	pub w: f64,
	pub h: f64,
	/// Its page is showing: nothing is drawn for it here.
	pub live: bool,
	/// The writer's colour when the board is news, and whether to draw its outline here.
	pub news: Option<[f32; 4]>,
	pub glow: bool,
	/// Its title and kind ("card", "app", "document", "board"), painted on its paper while it has no picture.
	pub title: String,
	pub kind: String,
	/// An app's status ("running", "asleep", "stopped", …), for the dot on its window's bar.
	pub status: String,
	/// Its item's own corners in stage units, top-left clockwise, as the page read them off the
	/// drawing (`Page.corners`); none, the scene's or 12 (`card_radii`).
	pub corners: Option<[f32; 4]>,
}

/// An app's window bar, in stage units: the page's iframe sits below it (`items/item-surfaces.tsx`, `APP_BAR`).
pub const APP_BAR: f64 = 44.0;

/// An app's window as `frame` found it, on the screen: its bar, lights, name and status are painted
/// over whatever its body is (the page's iframe, its picture, its placeholder).
pub(crate) struct Window {
	pub(crate) x: f32,
	pub(crate) y: f32,
	pub(crate) w: f32,
	pub(crate) h: f32,
	pub(crate) title: String,
	pub(crate) status: String,
}

/// A card with no picture yet, as `frame` found it: its paper on the screen, to paint its title and kind on.
pub(crate) struct Placeholder {
	pub(crate) x: f32,
	pub(crate) y: f32,
	pub(crate) w: f32,
	pub(crate) h: f32,
	pub(crate) title: String,
	pub(crate) kind: String,
	/// Its corners on the screen, as its picture's would be.
	pub(crate) radii: [f32; 4],
}

/// A placeholder's words: the kind small and faint at the top-left, the title under it, cut to the paper.
///
/// Laid in the paper's own units, so the layout is the same at every zoom: kept in `titles` by kind, title
/// and the width it was laid to (`ph:` keys), as the titles are. Laying it fresh each frame cost a zoom over
/// 100 pictureless cards a fifth of its main-thread time, nearly all of it text shaping and the allocation under it.
/// `scale` is the screen's (zoom times the device's pixels), `p` the paper in screen pixels.
pub(crate) fn paint_placeholder(ctx: &Context, titles: &RefCell<HashMap<String, Laid>>, p: &Placeholder, scale: f64, dark: bool, ops: &mut Vec<Op>) {
	let Some(text) = ctx.text else { return };
	// In the paper's own units (stage units at zoom 1), inset from its corner; nothing on a paper too small for a word.
	let (w, h) = (p.w as f64 / scale, p.h as f64 / scale);
	let pad = 40.0_f64.min(w / 8.0).min(h / 8.0);
	if w - pad * 2.0 < 60.0 || h - pad * 2.0 < 40.0 {
		return;
	}
	let ink = if dark { [0.93, 0.93, 0.94, 1.0] } else { [0.11, 0.11, 0.12, 1.0] };
	let faint = if dark { [0.62, 0.62, 0.66, 1.0] } else { [0.50, 0.50, 0.54, 1.0] };
	let m = Mat([scale, 0.0, 0.0, scale, p.x as f64, p.y as f64]);
	// A hairline round the paper: on a dark canvas the paper is nearly the ground's colour, and the words alone would float.
	ops.push(Op::Shape { shape: stage_paint::list::Shape { w: p.w, h: p.h, radii: p.radii, ellipse: false }, transform: stage_paint::list::Affine::translate(p.x, p.y), paint: stage_paint::list::Paint::Solid(Color::straight([faint[0], faint[1], faint[2], 0.35], 1.0)), stroke: Some((1.0, stage_paint::list::Align::Inside)) });
	let kind = match p.kind.as_str() {
		"app" => "App",
		"document" => "Document",
		"board" => "Board",
		// A card its host has no copy of and nothing to send it from (`items/missing.ts`): said, so it is not taken for one still loading; why is under the title.
		"missing" => "Card · missing",
		_ => "Card",
	};
	let small = stage_scene::layout::TextStyle { family: "Inter".into(), size: 13.0, weight: 600.0, italic: false, letter_spacing: 0.6, line_height: None };
	let big = stage_scene::layout::TextStyle { family: "Inter".into(), size: 26.0, weight: 600.0, italic: false, letter_spacing: 0.0, line_height: None };
	// The width the words are laid to, to the unit: the paper's edges are snapped to the screen's pixels, so its width in paper units wavers by a fraction with the zoom.
	let room = (w - pad * 2.0).round() as f32;
	let mut titles = titles.borrow_mut();
	let kind_height = {
		let kind_laid = titles.entry(format!("ph-kind:{kind}:{room}")).or_insert_with(|| text.lay_words(kind, &small, Some(room), stage_text::Align::Left, false, false));
		stage_paint::painter::draw_laid(ctx, kind_laid, (pad, pad), &[Color::straight(faint, 1.0)], &m, ops);
		kind_laid.height as f64
	};
	let title_top = pad + kind_height + 8.0;
	if h - title_top - pad < 20.0 {
		return;
	}
	let title = titles.entry(format!("ph:{kind}:{room}:{}", p.title)).or_insert_with(|| text.lay_words(&p.title, &big, Some(room), stage_text::Align::Left, false, false));
	let title_height = title.height as f64;
	// Cut at the paper's foot: a long title on a short paper shows its first lines.
	ops.push(Op::PushClip(stage_paint::list::Clip { shape: stage_paint::list::Shape { w: p.w, h: p.h, radii: [0.0; 4], ellipse: false }, transform: stage_paint::list::Affine::translate(p.x, p.y) }));
	stage_paint::painter::draw_laid(ctx, title, (pad, title_top), &[Color::straight(ink, 1.0)], &m, ops);
	// A missing card says why under its title, as large as reads from a little way off: nothing is coming until a source has it.
	if p.kind == "missing" {
		let note = stage_scene::layout::TextStyle { family: "Inter".into(), size: 20.0, weight: 500.0, italic: false, letter_spacing: 0.0, line_height: None };
		let why = "Studio has no copy of this card yet, and no harness of yours with it is in reach.";
		let laid = titles.entry(format!("ph-missing:{room}")).or_insert_with(|| text.lay_words(why, &note, Some(room), stage_text::Align::Left, false, false));
		stage_paint::painter::draw_laid(ctx, laid, (pad, title_top + title_height + 14.0), &[Color::straight(faint, 1.0)], &m, ops);
	}
	ops.push(Op::PopClip);
}

/// A sleeping item's title, 12 px in the stage's units above its picture, as the bar over an awake
/// item reads it: one line, cut at the item's width. Laid once per title and kept (`titles`).
pub(crate) fn paint_title(ctx: &Context, titles: &RefCell<HashMap<String, Laid>>, p: &Placeholder, scale: f64, dark: bool, ops: &mut Vec<Op>) {
	let Some(text) = ctx.text else { return };
	let muted = if dark { [0.62, 0.62, 0.66, 1.0] } else { [0.50, 0.50, 0.54, 1.0] };
	let style = stage_scene::layout::TextStyle { family: "Inter".into(), size: 12.0, weight: 500.0, italic: false, letter_spacing: 0.0, line_height: None };
	let mut titles = titles.borrow_mut();
	let laid = titles.entry(p.title.clone()).or_insert_with(|| text.lay_words(&p.title, &style, None, stage_text::Align::Left, false, false));
	let height = laid.height as f64;
	// Above the item, its foot 4 units over the item's top, as the bar sits; cut at the item's width.
	let top = p.y as f64 - (height + 4.0) * scale;
	let m = Mat([scale, 0.0, 0.0, scale, p.x as f64, top]);
	ops.push(Op::PushClip(stage_paint::list::Clip { shape: stage_paint::list::Shape { w: p.w, h: (height * scale) as f32 + 1.0, radii: [0.0; 4], ellipse: false }, transform: stage_paint::list::Affine::translate(p.x, top as f32) }));
	stage_paint::painter::draw_laid(ctx, laid, (2.0, 0.0), &[Color::straight(muted, 1.0)], &m, ops);
	ops.push(Op::PopClip);
}

/// An app's window: a bar `APP_BAR` tall at the top of its box with three lights, its name in the
/// middle and a status dot at the right, and a hairline round the whole box; the same in every state,
/// as today's macOS draws a window. The name is laid once per name (`titles`).
pub(crate) fn paint_window(ctx: &Context, titles: &RefCell<HashMap<String, Laid>>, win: &Window, scale: f64, dark: bool, ops: &mut Vec<Op>) {
	use stage_paint::list::{Affine, Paint, Shape};
	let r = 12.0 * scale as f32;
	let bar_h = (APP_BAR * scale).round() as f32;
	if bar_h < 2.0 || win.w < 8.0 {
		return;
	}
	let bar_fill = if dark { [0.16, 0.16, 0.17, 1.0] } else { [0.965, 0.965, 0.97, 1.0] };
	let edge = if dark { [1.0, 1.0, 1.0, 0.12] } else { [0.0, 0.0, 0.0, 0.10] };
	let ink = if dark { [0.93, 0.93, 0.94, 1.0] } else { [0.11, 0.11, 0.12, 1.0] };
	// The bar: the top of the box, its top corners round, cut to the box.
	ops.push(Op::PushClip(stage_paint::list::Clip { shape: Shape { w: win.w, h: win.h, radii: [r; 4], ellipse: false }, transform: Affine::translate(win.x, win.y) }));
	ops.push(Op::Shape { shape: Shape { w: win.w, h: bar_h, radii: [0.0; 4], ellipse: false }, transform: Affine::translate(win.x, win.y), paint: Paint::Solid(Color::straight(bar_fill, 1.0)), stroke: None });
	ops.push(Op::Shape { shape: Shape { w: win.w, h: 1.0_f32.max(scale as f32 * 0.5), radii: [0.0; 4], ellipse: false }, transform: Affine::translate(win.x, win.y + bar_h - 1.0), paint: Paint::Solid(Color::straight(edge, 1.0)), stroke: None });
	// The three lights.
	let d = (12.0 * scale) as f32;
	let cy = win.y + (bar_h - d) / 2.0;
	for (i, colour) in [[1.0, 0.373, 0.341, 1.0], [0.996, 0.737, 0.18, 1.0], [0.157, 0.784, 0.251, 1.0]].iter().enumerate() {
		let cx = win.x + (14.0 * scale) as f32 + i as f32 * (20.0 * scale) as f32;
		ops.push(Op::Shape { shape: Shape { w: d, h: d, radii: [d / 2.0; 4], ellipse: true }, transform: Affine::translate(cx, cy), paint: Paint::Solid(Color::straight(*colour, 1.0)), stroke: None });
	}
	// The status dot at the right: green while it runs, grey asleep or on its way, nothing stopped.
	let dot = match win.status.as_str() {
		"running" => Some([0.157, 0.784, 0.251, 1.0]),
		"asleep" | "starting" | "building" | "installing" => Some([0.6, 0.6, 0.64, 1.0]),
		_ => None,
	};
	if let Some(colour) = dot {
		let dd = (8.0 * scale) as f32;
		ops.push(Op::Shape { shape: Shape { w: dd, h: dd, radii: [dd / 2.0; 4], ellipse: true }, transform: Affine::translate(win.x + win.w - (16.0 * scale) as f32 - dd, win.y + (bar_h - dd) / 2.0), paint: Paint::Solid(Color::straight(colour, 1.0)), stroke: None });
	}
	ops.push(Op::PopClip);
	// The hairline round the window.
	ops.push(Op::Shape { shape: Shape { w: win.w, h: win.h, radii: [r; 4], ellipse: false }, transform: Affine::translate(win.x, win.y), paint: Paint::Solid(Color::straight(edge, 1.0)), stroke: Some((1.0, stage_paint::list::Align::Inside)) });
	// The name in the middle, where a 13 px line is more than a smudge.
	if scale * 13.0 < 5.0 || win.title.is_empty() {
		return;
	}
	let Some(text) = ctx.text else { return };
	let style = stage_scene::layout::TextStyle { family: "Inter".into(), size: 13.0, weight: 600.0, italic: false, letter_spacing: 0.0, line_height: None };
	let mut titles = titles.borrow_mut();
	let laid = titles.entry(format!("app:{}", win.title)).or_insert_with(|| text.lay_words(&win.title, &style, None, stage_text::Align::Left, false, false));
	let room = (win.w as f64 / scale) - 160.0;
	if room < 20.0 {
		return;
	}
	let left = ((win.w as f64 / scale) - (laid.width as f64).min(room)) / 2.0;
	let top = (APP_BAR - laid.height as f64) / 2.0;
	let m = Mat([scale, 0.0, 0.0, scale, win.x as f64, win.y as f64]);
	ops.push(Op::PushClip(stage_paint::list::Clip { shape: Shape { w: (room * scale) as f32, h: bar_h, radii: [0.0; 4], ellipse: false }, transform: Affine::translate(win.x + (80.0 * scale) as f32, win.y) }));
	stage_paint::painter::draw_laid(ctx, laid, (left, top), &[Color::straight(ink, 1.0)], &m, ops);
	ops.push(Op::PopClip);
}

impl Page {
	/// Draw `place` from the tiles of scale `sc`, cut to it, if they cover it whole: one coarser tile,
	/// two or four where it straddles them, or the sharper ones that lie in it. False, and nothing
	/// drawn, if any is missing; unless not `whole`, when those held are drawn, and false only if none is.
	pub(crate) fn draw_at(&mut self, place: &Rect, sc: u32, whole: bool, snap: &dyn Fn(&Rect) -> (f32, f32, f32, f32), over: &mut DrawList) -> bool {
		let side = TILE as f64 / f32::from_bits(sc) as f64;
		// The place's edges lie on another grid: a hair of overlap is not a tile it needs.
		let eps = side * 1e-6;
		let (x0, y0) = (((place.x + eps) / side).floor(), ((place.y + eps) / side).floor());
		let (x1, y1) = (((place.right() - eps) / side).ceil(), ((place.bottom() - eps) / side).ceil());
		let count = (x1 - x0) * (y1 - y0);
		if count.is_nan() || count > 256.0 {
			return false;
		}
		let keys = || (y0 as i32..y1 as i32).flat_map(move |y| (x0 as i32..x1 as i32).map(move |x| Key { scale: sc, x, y }));
		if if whole { !keys().all(|k| self.tiles.contains_key(&k)) } else { !keys().any(|k| self.tiles.contains_key(&k)) } {
			return false;
		}
		for k in keys() {
			let Some((texture, used)) = self.tiles.get_mut(&k) else { continue };
			*used = self.frame;
			let a = k.area();
			let cx = a.x.max(place.x);
			let cy = a.y.max(place.y);
			let cut = Rect { x: cx, y: cy, w: a.right().min(place.right()) - cx, h: a.bottom().min(place.bottom()) - cy };
			if cut.w <= 0.0 || cut.h <= 0.0 {
				continue;
			}
			let uv = [((cut.x - a.x) / a.w) as f32, ((cut.y - a.y) / a.h) as f32, ((cut.right() - a.x) / a.w) as f32, ((cut.bottom() - a.y) / a.h) as f32];
			let (px, py, pw, ph) = snap(&cut);
			over.push(Op::Picture { texture: *texture, x: px, y: py, w: pw, h: ph, uv, opacity: 1.0 });
		}
		true
	}

	/// The scale shown, as an `f32`'s bits (0 before the first frame): a tile of another one that
	/// arrives is held unseen until its level covers the window.
	pub fn shown_scale(&self) -> u32 {
		self.shown.unwrap_or(0)
	}

	/// Show the level wanted at the next frame whether or not it covers the window: its tiles have
	/// stopped coming (the page's timer), so waiting longer would show nothing new.
	pub fn show_wanted(&mut self) {
		self.show_wanted = true;
	}

	/// A tile's picture arrived: the texture to put it in (the caller copies the picture there).
	pub fn tile_texture(&mut self, key: Key) -> u32 {
		if let Some((t, _)) = self.tiles.get(&key) {
			return *t;
		}
		self.next_texture += 1;
		let t = self.next_texture;
		self.tiles.insert(key, (t, self.frame));
		self.scales = None;
		t
	}

	/// What the screen shows over the board pages for a camera, in one frame with them:
	///
	/// - each board that has no live page: its picture, or its paper until the picture comes. Over
	///   the pages, so a page still loading or asleep under it never shows through;
	/// - the worker's tiles, which leave a hole for every board, so the pictures show through them
	///   and what is drawn over a board stays over it;
	/// - the lifted items and the stroke under the pen, drawn fresh.
	///
	/// A board going live loses its picture in the frame that shows its page; no tile is painted
	/// again for it. Tiles and pictures lie on whole device pixels.
	pub fn frame(&mut self, camera: Camera, dpr: f64, width: f64, height: f64, want: u32) -> DrawList {
		self.frame += 1;
		// Room for three windows of tiles at this screen's size, with the ring round them, and never
		// under the floor: a 2x screen needs far more than a 1x one.
		let across = (width * dpr / TILE as f64).ceil() as usize + 2;
		let down = (height * dpr / TILE as f64).ceil() as usize + 2;
		self.budget = (3 * across * down).max(MIN_TILES);
		let view = Rect { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
		let s = camera.zoom * dpr;
		let snap = |r: &Rect| {
			let x0 = ((r.x - camera.x) * s).round();
			let y0 = ((r.y - camera.y) * s).round();
			let x1 = ((r.right() - camera.x) * s).round();
			let y1 = ((r.bottom() - camera.y) * s).round();
			(x0 as f32, y0 as f32, (x1 - x0) as f32, (y1 - y0) as f32)
		};
		// The boards with no live page (and those a drag carries): picture, or paper until it comes.
		let mut over = DrawList::new(Color::TRANSPARENT);
		let paper = if self.scene.dark { [0.118, 0.118, 0.125, 1.0] } else { [1.0, 1.0, 1.0, 1.0] };
		let mut placeholders: Vec<Placeholder> = Vec::new();
		let mut titled: Vec<Placeholder> = Vec::new();
		let mut windows: Vec<Window> = Vec::new();
		let mut pictured = Vec::new();
		let mut carrying = Vec::new();
		// A drag's ghost is the lifted items alone: no boards.
		let cards: &[CardPlace] = if self.only_lifted { &[] } else { &self.cards };
		for board in cards {
			let carried = self.carry.0.contains(&board.path);
			let picture = self.pictures.get(&board.picture);
			let app = board.kind == "app";
			// Carried by a drag, or gliding to where a change put it (`offsets`, kept under its item's id).
			let (dx, dy) = if carried { (self.carry.1, self.carry.2) } else { self.offsets.get(&board.id).copied().unwrap_or((0.0, 0.0)) };
			let place = Rect { x: board.x + dx, y: board.y + dy, w: board.w, h: board.h };
			if !place.meets(&view) {
				continue;
			}
			let (x, y, w, h) = snap(&place);
			// An app's window is painted in every state, live too: the page holds only its body below the bar.
			if app {
				windows.push(Window { x, y, w, h, title: board.title.clone(), status: board.status.clone() });
			}
			// Its title above it, in every state, live too, as the bar over it read: only where a 12 px line is more than a smudge; an app's name is on its window.
			if !app && !board.title.is_empty() && s * 12.0 >= 5.0 {
				titled.push(Placeholder { x, y, w, h, title: board.title.clone(), kind: board.kind.clone(), radii: [0.0; 4] });
			}
			// A live item is drawn here only while a drag carries it: as its picture, or as its paper and title until it has one.
			if board.live && !carried {
				continue;
			}
			// Its corners are its item's `cornerRadius`, 12 when it has none, as the hole the drawing leaves for it is.
			let limit = (board.w.min(board.h) / 2.0).max(0.0) as f32;
			let radii = if app { [12.0 * s as f32; 4] } else { board.corners.map_or_else(|| self.card_radii(&board.id, board.w, board.h), |c| c.map(|r| r.min(limit))).map(|r| r * s as f32) };
			let shape = |w: f32, h: f32| stage_paint::list::Shape { w, h, radii, ellipse: false };
			// Carried, its own frame goes with it: its shadow under its picture here, its outline over it (the tiles have left it out).
			let frame = if carried && !app { self.carried_frame(&board.id, x, y, s) } else { None };
			if let Some((under, _)) = &frame {
				over.ops.extend(under.iter().cloned());
			}
			over.push(Op::Shape { shape: shape(w, h), transform: stage_paint::list::Affine::translate(x, y), paint: stage_paint::list::Paint::Solid(Color(paper)), stroke: None });
			// An app's body is below its bar: its picture and its placeholder go there.
			let bar = if app { (APP_BAR * s).round() as f32 } else { 0.0 };
			let (y, h) = (y + bar, (h - bar).max(0.0));
			if let Some((texture, pw, ph)) = picture {
				/*
				 * At the box's width, from its top. A picture taller than the box is cut at its foot, as the
				 * page itself is. One shorter (a page shorter than its box, or one pictured before the board
				 * grew) has its last row drawn on down to the box's foot, as the page's own background goes
				 * on below its content: never stretched, and never bare paper under it.
				 */
				let paint_picture = |over: &mut DrawList, texture: u32, pw: u32, ph: u32, opacity: f32| {
					let tall = (ph as f32 / pw.max(1) as f32 * w).round();
					let image = |uv: [f32; 4]| stage_paint::list::Paint::Image { texture, opacity, uv };
					if tall >= h {
						over.push(Op::Shape { shape: shape(w, h), transform: stage_paint::list::Affine::translate(x, y), paint: image([0.0, 0.0, 1.0, h / tall]), stroke: None });
					} else {
						// Both parts cut to the box's corners, not each rounded: a last strip shorter than a corner would lose its curve.
						let last = (ph as f32 - 0.5) / ph.max(1) as f32;
						let part = |h: f32| stage_paint::list::Shape { w, h, radii: [0.0; 4], ellipse: false };
						over.push(Op::PushClip(stage_paint::list::Clip { shape: shape(w, h), transform: stage_paint::list::Affine::translate(x, y) }));
						over.push(Op::Shape { shape: part(tall), transform: stage_paint::list::Affine::translate(x, y), paint: image([0.0, 0.0, 1.0, 1.0]), stroke: None });
						over.push(Op::Shape { shape: part(h - tall), transform: stage_paint::list::Affine::translate(x, y + tall), paint: image([0.0, last, 1.0, last]), stroke: None });
						over.push(Op::PopClip);
					}
				};
				// The picture this one replaced stays under it while it fades in (`picture_unlaid`, `fade_pictures`).
				match self.pictures.fading.get(&board.picture) {
					Some(&(old, ow, oh, alpha)) => {
						paint_picture(&mut over, old, ow, oh, 1.0);
						paint_picture(&mut over, texture, pw, ph, alpha);
					}
					None => paint_picture(&mut over, texture, pw, ph, 1.0),
				}
			} else if !board.title.is_empty() {
				placeholders.push(Placeholder { x, y, w, h, title: board.title.clone(), kind: board.kind.clone(), radii });
			}
			if let Some((_, outline)) = frame {
				over.ops.extend(outline);
			}
			// Drawn here, so its node stays unseen: carried, or asleep as its picture or its placeholder.
			if board.live {
				carrying.push(board.path.clone());
			} else {
				pictured.push(board.path.clone());
			}
			if let Some(colour) = board.news.filter(|_| board.glow) {
				over.push(Op::Shape { shape: shape(w, h), transform: stage_paint::list::Affine::translate(x, y), paint: stage_paint::list::Paint::Solid(Color::straight([colour[0], colour[1], colour[2], 0.6], 1.0)), stroke: Some((1.5, stage_paint::list::Align::Center)) });
			}
		}
		if !self.only_lifted && (pictured != self.pictured || carrying != self.carrying) {
			self.pictured = pictured;
			self.carrying = carrying;
			self.marks = self.marks.wrapping_add(1);
		}
		/*
		 * A card, an app or a document with no picture yet: its kind and its title on its paper, in the
		 * scheme's ink, so it is never a bare rectangle; the same for every kind. Set at the screen's
		 * scale, as the lifted items' words are, so the glyph texture holds what they need.
		 */
		if !placeholders.is_empty() || !titled.is_empty() || !windows.is_empty() {
			let skip = HashSet::new();
			let pictures = &self.pictures;
			let image = |url: &str| pictures.get(url);
			let ctx = Context::new(&self.scene, &skip, &image).with_text(&self.text, &self.atlas);
			let dark = self.scene.dark;
			let mut labels: Vec<Op> = Vec::new();
			for _ in 0..3 {
				self.atlas.borrow_mut().begin();
				labels.clear();
				for p in &placeholders {
					paint_placeholder(&ctx, &self.titles, p, s, dark, &mut labels);
				}
				for p in &titled {
					paint_title(&ctx, &self.titles, p, s, dark, &mut labels);
				}
				for win in &windows {
					paint_window(&ctx, &self.titles, win, s, dark, &mut labels);
				}
				if !self.atlas.borrow_mut().take_overflow() {
					break;
				}
			}
			over.ops.extend(labels);
		}
		/*
		 * Over: the tiles, one per place of the window's grid at the scale wanted. The level shown is
		 * the one whose tiles cover the window: tiles of a new level (a zoom's) are held unseen until
		 * every place of the window has one, then shown in one frame, as the old engine swapped its
		 * levels; until then the level shown before is drawn stretched, never a patchwork of the two.
		 * The other levels are kept, unseen, until the budget lets them go (`evict`): a zoom back
		 * paints none of them again. A place the level shown does not cover (a pan's new
		 * edge, the far side of a zoom out) shows the nearest other level that covers it whole, the
		 * overview's at worst. Never two scales layered in a place: tiles are clear where nothing is
		 * drawn, so a stale one under a fresh one would show through.
		 */
		let want = if want != 0 { f32::from_bits(want) } else { scale_for(camera.zoom * dpr, false) };
		let wanted = want.to_bits();
		// A ghost of what a drag carries is the lifted items alone, with no tiles under them.
		let places = if self.only_lifted { Vec::new() } else { Grid::covering(&view, want, 0) };
		if !self.only_lifted && self.shown != Some(wanted) {
			let whole = self.shown.is_none() || self.show_wanted || places.iter().all(|k| self.tiles.contains_key(k));
			if whole {
				self.shown = Some(wanted);
			}
		}
		self.show_wanted = false;
		let shown = self.shown.unwrap_or(wanted);
		let scales = match self.scales.take() {
			Some((at, scales)) if at == (wanted, shown) => scales,
			_ => {
				// The other levels held, the one waiting to be shown left out: nearest the scale wanted
				// first, sharper before blurrier at the same distance.
				let mut scales: Vec<u32> = self.tiles.keys().map(|k| k.scale).filter(|&sc| sc != shown && sc != wanted).collect::<HashSet<_>>().into_iter().collect();
				scales.sort_by(|a, b| {
					let d = |s: u32| ((f32::from_bits(s) as f64).ln() - (want as f64).ln()).abs();
					d(*a).total_cmp(&d(*b)).then(f32::from_bits(*b).total_cmp(&f32::from_bits(*a)))
				});
				scales
			}
		};
		for key in places {
			let place = key.area();
			if self.draw_at(&place, shown, true, &snap, &mut over) || scales.iter().any(|&sc| self.draw_at(&place, sc, true, &snap, &mut over)) {
				continue;
			}
			// Nothing covers it whole (a zoom out before the overview is in): what there is of the
			// level shown, or failing that of the nearest level with any of it.
			let _ = self.draw_at(&place, shown, false, &snap, &mut over) || scales.iter().any(|&sc| self.draw_at(&place, sc, false, &snap, &mut over));
		}
		self.scales = Some(((wanted, shown), scales));
		// The lifted items, drawn fresh, and the stroke under the pen.
		if !self.lifted.is_empty() && !self.hide_lifted {
			let skip = HashSet::new();
			let pictures = &self.pictures;
			let image = |url: &str| pictures.get(url);
			let mut ctx = Context::new(&self.scene, &skip, &image).with_text(&self.text, &self.atlas);
			ctx.only = Some(&self.lifted);
			ctx.icons = Some(&self.icons);
			ctx.offsets = Some(&self.offsets);
			self.view.apply(&mut ctx);
			// Built again if the glyph texture had to push out glyphs this frame uses (`Atlas::begin`).
			let mut lifted = DrawList::new(Color::TRANSPARENT);
			for _ in 0..3 {
				self.atlas.borrow_mut().begin();
				lifted = paint_area(&ctx, view, s, Color::TRANSPARENT);
				if !self.atlas.borrow_mut().take_overflow() {
					break;
				}
			}
			self.pictures.wanted.borrow_mut().extend(ctx.wanted.borrow_mut().drain(..));
			over.ops.extend(lifted.ops);
		}
		if !self.ink.is_empty() {
			let target = Mat([s, 0.0, 0.0, s, -camera.x * s, -camera.y * s]);
			paint_ink(&self.ink, &target, &mut over.ops);
		}
		// The editor's outlines, handles and guides, over everything and in the same frame (not on a ghost's frame).
		if !self.only_lifted {
			if let Some(overlay) = &self.overlay {
				stage_paint::overlay::paint_overlay(overlay, camera.x, camera.y, s, dpr, &mut over.ops);
			}
		}
		over
	}
}
