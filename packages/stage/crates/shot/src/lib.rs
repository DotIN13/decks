//! A picture of part of a stage, drawn here rather than in a browser: what the server's
//! `canvas.screenshot` answers with when it can (`apps/server/src/stage/native-shots.ts`).
//!
//! The drawing is laid out and painted by the same crates as the page's engine (scene, text, paint)
//! and drawn by the same wgpu backend the goldens are (`stage-gpu`, on this machine's own card), in
//! tiles at the picture's own scale, as `fixtures::draw_stage` draws a stage. Each board is drawn as
//! the canvas draws a board with no live page: its paper and its picture, under the drawing, which
//! has a hole for it in its place in the order. The picture lies on the stage's paper.
//!
//! Nothing here fetches anything. What a stage needs that only the app has — font files, a card's
//! markdown read by the app's reader, icons, image fills — the caller is asked for ([`Needs`]) and
//! hands over in a later request; it is kept for every request after. Formulas are not typeset: a
//! box with one in it is answered as `math`, for the caller to picture another way.

use serde_json::{Value, json};
use stage_doc::Document;
use stage_gpu::Gpu;
use stage_paint::list::{Affine, Color, DrawList, Op, Paint, Shape};
use stage_paint::painter::{Context, IconShape, paint_area};
use stage_paint::{Backend, Target, TextureKind, flush_glyphs};
use stage_scene::{Rect, Scene};
use stage_text::Text;
use stage_text::atlas::Atlas;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

/// The texture the picture is drawn into.
const OUT: u32 = 1;
/// The side of a tile of the drawing, in picture pixels.
pub const TILE_PX: u32 = 1024;
/// A board's corner, in stage units (`Page::frame`, `.board` on the canvas).
const BOARD_RADIUS: f64 = 12.0;

/// One font file, as the caller's font list names it (`font-files.ts`).
#[derive(Clone, Debug)]
pub struct Font {
	pub key: String,
	pub family: String,
	pub bytes: Rc<Vec<u8>>,
	pub fallback: bool,
}

/// A card in the box: where it is, and its picture's file (`None`: drawn as its paper).
#[derive(Clone, Debug)]
pub struct Card {
	pub rect: Rect,
	pub picture: Option<String>,
}

/// One picture to take.
#[derive(Clone, Debug)]
pub struct Request {
	/// The `.pen` document's text.
	pub doc: String,
	pub dark: bool,
	/// The stage rectangle pictured.
	pub area: Rect,
	/// Picture pixels a stage unit.
	pub scale: f64,
	pub width: u32,
	pub height: u32,
	/// The stage's paper, straight RGB 0 to 1.
	pub paper: [f32; 3],
	pub cards: Vec<Card>,
	/// Who last wrote the drawing, as its placeholder frames are marked, as on the page; none: the accent, no name.
	pub writer: Option<stage_paint::painter::Writer>,
}

/// What a request could not be drawn without, for the caller to hand over.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Needs {
	/// Card sources the app's reader has not read for this scheme.
	pub cards: Vec<String>,
	/// Image fills' addresses.
	pub pictures: Vec<String>,
	/// Icon keys (`library|name|weight`).
	pub icons: Vec<String>,
	/// Items in the box with a formula in their words.
	pub math: Vec<String>,
}

impl Needs {
	pub fn is_empty(&self) -> bool {
		self.cards.is_empty() && self.pictures.is_empty() && self.icons.is_empty() && self.math.is_empty()
	}

	pub fn to_json(&self) -> Value {
		json!({ "cards": self.cards, "pictures": self.pictures, "icons": self.icons, "math": self.math })
	}
}

/// A picture taken: its pixels, straight RGBA (opaque), rows tight.
pub struct Picture {
	pub width: u32,
	pub height: u32,
	pub rgba: Vec<u8>,
	/// Milliseconds: laying out, painting and drawing, reading back.
	pub times: [f64; 3],
}

/// A stage laid out once, kept while requests are for the same document and scheme.
struct Laid {
	key: (u64, bool),
	doc: Document,
	text: Text,
	scene: Scene,
	/// How many of the shooter's fonts the text has.
	fonts: usize,
	/// The cards generation it was laid out with.
	cards: u64,
	/// The pictures generation it was laid out with (a card's picture sizes its card).
	pictures: u64,
}

/// The warm half: a device, and everything handed over so far.
pub struct Shooter {
	pub gpu: Gpu,
	/// Cards are read by this crate's own markdown reader instead of being asked for (tests, a shell).
	pub own_reader: bool,
	fonts: Vec<Font>,
	font_keys: HashSet<String>,
	/// Card blocks as the app's reader gave them (JSON), by scheme (0 light, 1 dark) and source.
	cards: [Rc<RefCell<HashMap<String, String>>>; 2],
	cards_generation: u64,
	/// Sources the laid-out stage's reader was asked for, in order: those the map lacks are needed.
	card_asked: Rc<RefCell<Vec<String>>>,
	/// Image fills by address: texture, width and height; `None` when it could not be had.
	pictures: HashMap<String, Option<(u32, u32, u32)>>,
	pictures_generation: u64,
	/// Boards' pictures by file: texture, width, height; the most recent few.
	card_pictures: Vec<(String, u32, u32, u32)>,
	icons: HashMap<String, Option<IconShape>>,
	laid: Option<Laid>,
	atlas: RefCell<Atlas>,
	next_texture: u32,
}

/// Boards' pictures kept decoded on the card between requests.
const CARD_PICTURES: usize = 48;

impl Shooter {
	/// On this machine's own graphics card; `None` when it has none to give.
	pub fn open() -> Option<Shooter> {
		let gpu = pollster::block_on(stage_gpu::headless())?;
		Some(Shooter::on(gpu))
	}

	pub fn on(gpu: Gpu) -> Shooter {
		Shooter {
			gpu,
			own_reader: false,
			fonts: Vec::new(),
			font_keys: HashSet::new(),
			cards: [Rc::default(), Rc::default()],
			cards_generation: 0,
			card_asked: Rc::default(),
			pictures: HashMap::new(),
			pictures_generation: 0,
			card_pictures: Vec::new(),
			icons: HashMap::new(),
			laid: None,
			atlas: RefCell::new(Atlas::new()),
			next_texture: 16,
		}
	}

	/// A font file, kept from now on (once per key), in the order handed over.
	pub fn add_font(&mut self, font: Font) {
		if self.font_keys.insert(font.key.clone()) {
			self.fonts.push(font);
		}
	}

	/// A card's blocks as the app's reader gave them, for a scheme.
	pub fn add_card(&mut self, dark: bool, source: String, blocks: String) {
		self.cards[dark as usize].borrow_mut().insert(source, blocks);
		self.cards_generation += 1;
	}

	/// An image fill's file, decoded onto the card; `None` (or a file that does not decode) is kept as missing.
	pub fn add_picture(&mut self, url: &str, bytes: Option<&[u8]>) -> Result<(), String> {
		let made = match bytes {
			Some(bytes) => match self.upload(bytes) {
				Ok(made) => Some(made),
				Err(e) => {
					self.pictures.insert(url.to_owned(), None);
					return Err(format!("{url}: {e}"));
				}
			},
			None => None,
		};
		self.pictures.insert(url.to_owned(), made);
		self.pictures_generation += 1;
		Ok(())
	}

	/// An icon's shapes as `parseIcon` gives them (JSON), or missing.
	pub fn add_icon(&mut self, key: &str, json: Option<&str>) {
		let shape = json.and_then(|j| serde_json::from_str::<IconShape>(j).ok());
		self.icons.insert(key.to_owned(), shape);
	}

	/// Decode a picture file and put it on the card, premultiplied, no bigger than the card keeps one.
	fn upload(&mut self, bytes: &[u8]) -> Result<(u32, u32, u32), String> {
		let decoded = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
		let (w, h) = (decoded.width(), decoded.height());
		let max = self.gpu.limits().max_picture();
		let decoded = if w.max(h) > max {
			let fit = max as f64 / w.max(h) as f64;
			decoded.resize(((w as f64 * fit).floor() as u32).max(1), ((h as f64 * fit).floor() as u32).max(1), image::imageops::FilterType::Triangle)
		} else {
			decoded
		};
		let mut rgba = decoded.into_rgba8();
		for px in rgba.chunks_exact_mut(4) {
			let a = px[3] as u32;
			if a < 255 {
				for c in &mut px[..3] {
					*c = ((*c as u32 * a + 127) / 255) as u8;
				}
			}
		}
		let id = self.texture_id();
		self.gpu.texture(id, TextureKind::Color, rgba.width(), rgba.height(), Some(rgba.as_raw()));
		// The size it is laid out at is the file's own, as the page's (`engine.ts`, `picture`).
		Ok((id, w, h))
	}

	fn texture_id(&mut self) -> u32 {
		self.next_texture += 1;
		self.next_texture
	}

	/// A card's picture by file, from the card when it was decoded before.
	fn card_picture(&mut self, file: &str) -> Result<(u32, u32, u32), String> {
		if let Some(at) = self.card_pictures.iter().position(|(f, ..)| f == file) {
			let hit = self.card_pictures.remove(at);
			self.card_pictures.push(hit.clone());
			return Ok((hit.1, hit.2, hit.3));
		}
		let bytes = std::fs::read(file).map_err(|e| format!("{file}: {e}"))?;
		let made = self.upload(&bytes).map_err(|e| format!("{file}: {e}"))?;
		self.card_pictures.push((file.to_owned(), made.0, made.1, made.2));
		if self.card_pictures.len() > CARD_PICTURES {
			let (_, t, ..) = self.card_pictures.remove(0);
			self.gpu.forget(t);
		}
		Ok(made)
	}

	/// The document laid out with every font, card and picture size handed over so far.
	fn lay_out(&mut self, request: &Request) -> Result<(), String> {
		use std::hash::{Hash, Hasher};
		let mut hasher = std::collections::hash_map::DefaultHasher::new();
		request.doc.hash(&mut hasher);
		let key = (hasher.finish(), request.dark);
		let stale = self.laid.as_ref().is_none_or(|l| l.key != key);
		if stale {
			self.card_asked.borrow_mut().clear();
			let doc = Document::parse(&request.doc).map_err(|e| e.0)?;
			let mut text = Text::new();
			text.dark = request.dark;
			for font in &self.fonts {
				text.add_font(&font.family, font.bytes.as_ref().clone(), font.fallback);
			}
			self.set_reader(&mut text, request.dark);
			self.size_pictures(&text);
			let scene = Scene::new(&doc, request.dark, &text);
			self.laid = Some(Laid { key, doc, text, scene, fonts: self.fonts.len(), cards: self.cards_generation, pictures: self.pictures_generation });
			return Ok(());
		}
		let fonts = self.fonts.clone();
		let (cards, pictures) = (self.cards_generation, self.pictures_generation);
		let laid = self.laid.as_mut().expect("laid out");
		let mut again = false;
		for font in &fonts[laid.fonts..] {
			laid.text.add_font(&font.family, font.bytes.as_ref().clone(), font.fallback);
			again = true;
		}
		laid.fonts = fonts.len();
		if laid.cards != cards || laid.pictures != pictures {
			laid.cards = cards;
			laid.pictures = pictures;
			again = true;
		}
		if again {
			let held: Vec<(String, (u32, u32, u32))> = self.pictures.iter().filter_map(|(u, p)| p.map(|p| (u.clone(), p))).collect();
			let laid = self.laid.as_mut().expect("laid out");
			for (url, (_, w, h)) in held {
				laid.text.images.borrow_mut().insert(url, (w as f32, h as f32));
			}
			laid.text.forget();
			laid.scene.update(&laid.doc, None, &laid.text);
		}
		Ok(())
	}

	fn set_reader(&self, text: &mut Text, dark: bool) {
		let cards = self.cards[dark as usize].clone();
		let asked = self.card_asked.clone();
		text.set_reader(Box::new(move |source: &str| {
			asked.borrow_mut().push(source.to_owned());
			cards.borrow().get(source).and_then(|json| stage_text::markdown::from_json(json).ok())
		}));
	}

	fn size_pictures(&self, text: &Text) {
		for (url, p) in &self.pictures {
			if let Some((_, w, h)) = p {
				text.images.borrow_mut().insert(url.clone(), (*w as f32, *h as f32));
			}
		}
	}

	/// The words on the stage and the faces they are set in, as the page's engine lists them
	/// (`Page::font_needs`): `[{ family, weight, italic, text }]`, for the caller's font list.
	pub fn font_needs(&mut self, request: &Request) -> Result<Value, String> {
		self.lay_out(request)?;
		let laid = self.laid.as_ref().expect("laid out");
		let vars = &laid.scene.vars;
		let mut out = Vec::new();
		for root in &laid.scene.roots {
			for (item, place) in root.tree.items.iter().zip(&root.placed) {
				if !matches!(item.kind(), "text" | "note" | "prompt" | "context") {
					continue;
				}
				let text = match vars.resolve(item.get("content"), &place.theme) {
					Some(Value::String(s)) => s.clone(),
					_ => continue,
				};
				let style = stage_scene::layout::text_style(item, vars, &place.theme);
				out.push(json!({ "family": style.family, "weight": style.weight, "italic": style.italic, "text": text }));
				if stage_text::is_markdown(item) {
					for (weight, italic) in [(600.0, false), (700.0, false), (400.0, true)] {
						out.push(json!({ "family": style.family, "weight": weight, "italic": italic, "text": text }));
					}
					out.push(json!({ "family": stage_text::card::MONO, "weight": 400, "italic": false, "text": text }));
				}
			}
		}
		Ok(Value::Array(out))
	}

	/// What the box needs before it can be drawn: cards not read yet, and items with a formula in it.
	pub fn needs(&mut self, request: &Request) -> Result<Needs, String> {
		self.lay_out(request)?;
		let laid = self.laid.as_ref().expect("laid out");
		let mut needs = Needs::default();
		let mut seen = HashSet::new();
		if !self.own_reader {
			let have = self.cards[request.dark as usize].borrow();
			needs.cards = self.card_asked.borrow().iter().filter(|s| !have.contains_key(*s) && seen.insert((*s).clone())).cloned().collect();
		}
		for (r, i) in laid.scene.query(&request.area) {
			let item = &laid.scene.roots[r as usize].tree.items[i as usize];
			if let Some(Value::String(words)) = item.get("content")
				&& words.contains('$')
				&& stage_text::math::split(words).iter().any(|(_, m)| m.is_some())
			{
				needs.math.push(item.id.clone());
			}
		}
		Ok(needs)
	}

	/// Draw the picture, or say what it needs first: image fills and icons it met that were not handed over.
	pub fn shoot(&mut self, request: &Request) -> Result<Result<Picture, Needs>, String> {
		let started = std::time::Instant::now();
		let needs = self.needs(request)?;
		if !needs.is_empty() {
			return Ok(Err(needs));
		}
		let laid_ms = started.elapsed().as_secs_f64() * 1000.0;
		let s = request.scale;
		let (w, h) = (request.width.max(1), request.height.max(1));
		let max = self.gpu.limits().max_texture;
		if w > max || h > max {
			return Err(format!("a picture {w}×{h} is bigger than this card draws ({max})"));
		}
		let area = request.area;
		let paper = Color::straight([request.paper[0], request.paper[1], request.paper[2], 1.0], 1.0);
		let mut laid_out = DrawList::new(paper);

		// Under the drawing: each board's paper and its picture, as the canvas draws a board with no live page.
		let board_paper = if request.dark { [0.118, 0.118, 0.125, 1.0] } else { [1.0, 1.0, 1.0, 1.0] };
		let snap = |r: &Rect| {
			let x0 = ((r.x - area.x) * s).round();
			let y0 = ((r.y - area.y) * s).round();
			let x1 = ((r.right() - area.x) * s).round();
			let y1 = ((r.bottom() - area.y) * s).round();
			(x0 as f32, y0 as f32, (x1 - x0) as f32, (y1 - y0) as f32)
		};
		let radius = (BOARD_RADIUS * s) as f32;
		let shape = |w: f32, h: f32| Shape { w, h, radii: [radius; 4], ellipse: false };
		for board in &request.cards {
			if !board.rect.meets(&area) {
				continue;
			}
			let (x, y, bw, bh) = snap(&board.rect);
			laid_out.push(Op::Shape { shape: shape(bw, bh), transform: Affine::translate(x, y), paint: Paint::Solid(Color(board_paper)), stroke: None });
			if let Some(file) = &board.picture {
				let (texture, pw, ph) = self.card_picture(file)?;
				// At the box's width, from its top, as the stage draws it (`web/src/engine.rs`): cut at its foot if taller, its last row drawn on to the box's foot if shorter.
				let tall = (ph as f32 / pw.max(1) as f32 * bw).round();
				let image = |uv: [f32; 4]| Paint::Image { texture, opacity: 1.0, uv };
				if tall >= bh {
					laid_out.push(Op::Shape { shape: shape(bw, bh), transform: Affine::translate(x, y), paint: image([0.0, 0.0, 1.0, bh / tall]), stroke: None });
				} else {
					let last = (ph as f32 - 0.5) / ph.max(1) as f32;
					let part = |h: f32, radii: [f32; 4]| Shape { w: bw, h, radii, ellipse: false };
					laid_out.push(Op::Shape { shape: part(tall, [radius, radius, 0.0, 0.0]), transform: Affine::translate(x, y), paint: image([0.0, 0.0, 1.0, 1.0]), stroke: None });
					laid_out.push(Op::Shape { shape: part(bh - tall, [0.0, 0.0, radius, radius]), transform: Affine::translate(x, y + tall), paint: image([0.0, last, 1.0, last]), stroke: None });
				}
			}
		}

		// Over them: the drawing, in tiles at the picture's own scale, each with the boards' holes.
		let laid = self.laid.as_ref().expect("laid out");
		let pictures = &self.pictures;
		let image = |url: &str| pictures.get(url).copied().flatten();
		let skip = HashSet::new();
		let icons: HashMap<String, IconShape> = self.icons.iter().filter_map(|(k, v)| v.clone().map(|v| (k.clone(), v))).collect();
		let mut ctx = Context::new(&laid.scene, &skip, &image).with_text(&laid.text, &self.atlas);
		ctx.icons = Some(&icons);
		ctx.writer = request.writer.as_ref();
		let mut tiles = Vec::new();
		let mut wanted: Vec<String> = Vec::new();
		let mut painted_ms = 0.0;
		for ty in (0..h).step_by(TILE_PX as usize) {
			for tx in (0..w).step_by(TILE_PX as usize) {
				let tile_area = Rect { x: area.x + tx as f64 / s, y: area.y + ty as f64 / s, w: TILE_PX as f64 / s, h: TILE_PX as f64 / s };
				let at = std::time::Instant::now();
				let mut list = DrawList::new(Color::TRANSPARENT);
				for _ in 0..3 {
					self.atlas.borrow_mut().begin();
					list = paint_area(&ctx, tile_area, s, Color::TRANSPARENT);
					if !self.atlas.borrow_mut().take_overflow() {
						break;
					}
				}
				painted_ms += at.elapsed().as_secs_f64() * 1000.0;
				wanted.extend(ctx.wanted.borrow_mut().drain(..));
				if list.ops.is_empty() {
					continue;
				}
				self.next_texture += 1;
				let texture = self.next_texture;
				self.gpu.texture(texture, TextureKind::Color, TILE_PX, TILE_PX, None);
				flush_glyphs(&mut self.atlas.borrow_mut(), &mut self.gpu);
				self.gpu.draw(Target::Texture(texture), &list);
				tiles.push(texture);
				laid_out.push(Op::Picture { texture, x: tx as f32, y: ty as f32, w: TILE_PX as f32, h: TILE_PX as f32, uv: [0.0, 0.0, 1.0, 1.0], opacity: 1.0 });
			}
		}
		// Image fills and icons met that were never handed over: asked for, and drawn once they are.
		let mut needs = Needs::default();
		let mut seen = HashSet::new();
		for url in wanted {
			if !seen.insert(url.clone()) {
				continue;
			}
			if let Some(key) = url.strip_prefix("icon:") {
				if !self.icons.contains_key(key) {
					needs.icons.push(key.to_owned());
				}
			} else if !self.pictures.contains_key(&url) {
				needs.pictures.push(url);
			}
		}
		if !needs.is_empty() {
			for t in tiles {
				self.gpu.forget(t);
			}
			return Ok(Err(needs));
		}
		let at = std::time::Instant::now();
		self.gpu.texture(OUT, TextureKind::Color, w, h, None);
		self.gpu.draw(Target::Texture(OUT), &laid_out);
		for t in tiles {
			self.gpu.forget(t);
		}
		let rgba = self.gpu.read(OUT).ok_or("the picture could not be read back")?;
		self.gpu.forget(OUT);
		let read_ms = at.elapsed().as_secs_f64() * 1000.0;
		Ok(Ok(Picture { width: w, height: h, rgba: unpremultiply(rgba), times: [laid_ms, painted_ms, read_ms] }))
	}
}

/// Straight colour from premultiplied (the picture lies on opaque paper, so this is only a guard).
fn unpremultiply(mut rgba: Vec<u8>) -> Vec<u8> {
	for px in rgba.chunks_exact_mut(4) {
		let a = px[3] as u32;
		if a > 0 && a < 255 {
			for c in &mut px[..3] {
				*c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
			}
		}
	}
	rgba
}

/// The picture as a PNG or JPEG file's bytes.
pub fn encode(picture: &Picture, format: &str, quality: u8) -> Result<Vec<u8>, String> {
	let mut out = Vec::new();
	if format == "jpeg" {
		let rgb: Vec<u8> = picture.rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
		let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
		image::ImageEncoder::write_image(encoder, &rgb, picture.width, picture.height, image::ExtendedColorType::Rgb8).map_err(|e| e.to_string())?;
	} else {
		let encoder = image::codecs::png::PngEncoder::new_with_quality(&mut out, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Adaptive);
		image::ImageEncoder::write_image(encoder, &picture.rgba, picture.width, picture.height, image::ExtendedColorType::Rgba8).map_err(|e| e.to_string())?;
	}
	Ok(out)
}

/// A request from its JSON (`{ doc, dark, box: [x1, y1, x2, y2], scale, width, height, paper, cards }`).
pub fn request_of(v: &Value) -> Result<Request, String> {
	let n = |k: &str| v.get(k).and_then(Value::as_f64).ok_or_else(|| format!("{k} is missing"));
	let b: Vec<f64> = v.get("box").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
	if b.len() != 4 || b[2] <= b[0] || b[3] <= b[1] {
		return Err("box is [x1, y1, x2, y2]".into());
	}
	let paper: Vec<f32> = v.get("paper").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_f64).map(|c| c as f32).collect()).unwrap_or_default();
	let cards = v
		.get("cards")
		.and_then(Value::as_array)
		.map(|list| {
			list.iter()
				.map(|b| {
					let n = |k: &str| b.get(k).and_then(Value::as_f64).unwrap_or(0.0);
					Card { rect: Rect { x: n("x"), y: n("y"), w: n("w"), h: n("h") }, picture: b.get("picture").and_then(Value::as_str).map(str::to_owned) }
				})
				.collect()
		})
		.unwrap_or_default();
	Ok(Request {
		doc: v.get("doc").and_then(Value::as_str).ok_or("doc is missing")?.to_owned(),
		dark: v.get("dark").and_then(Value::as_bool).unwrap_or(false),
		area: Rect { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] },
		scale: n("scale")?,
		width: n("width")? as u32,
		height: n("height")? as u32,
		paper: if paper.len() >= 3 { [paper[0], paper[1], paper[2]] } else { [0.945, 0.945, 0.953] },
		cards,
		writer: v.get("writer").and_then(|w| {
			let color = w.get("color").and_then(Value::as_str).and_then(stage_scene::values::parse_color)?;
			let name = w.get("name").and_then(Value::as_str).map(str::to_owned).filter(|n| !n.trim().is_empty());
			Some(stage_paint::painter::Writer { name, color })
		}),
	})
}

#[cfg(test)]
mod tests;
