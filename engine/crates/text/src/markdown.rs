//! A card's markdown as blocks and styled runs: the shape the app's reader (`markdown.ts`) gives,
//! as JSON, and the shape this file's own reader gives when there is no app to ask (tests, the demo).
//!
//! The app's reader is the source of truth: Obsidian's markdown plus Decks' coloured words, sizes,
//! faces and an agent's suggestions. This reader does CommonMark and GitHub's tables, task lists and
//! strikethrough, which is what most cards hold.

use pulldown_cmark::{Alignment as MdAlign, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::Deserialize;

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Run {
	pub text: String,
	#[serde(default)]
	pub bold: bool,
	#[serde(default)]
	pub italic: bool,
	#[serde(default)]
	pub strike: bool,
	#[serde(default)]
	pub code: bool,
	pub link: Option<String>,
	#[serde(default)]
	pub sup: bool,
	pub image: Option<RunImage>,
	pub mark: Option<String>,
	pub colour: Option<String>,
	pub size: Option<String>,
	pub face: Option<String>,
	#[serde(default)]
	pub underline: bool,
	pub wiki: Option<String>,
	#[serde(default)]
	pub added: bool,
	#[serde(default)]
	pub removed: bool,
	pub reason: Option<String>,
	pub math: Option<RunMath>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct RunImage {
	pub url: String,
	pub alt: String,
	pub width: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct RunMath {
	pub tex: String,
	#[serde(default)]
	pub display: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Item {
	pub checked: Option<bool>,
	pub blocks: Vec<Block>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Footnote {
	pub number: u32,
	pub blocks: Vec<Block>,
}

/// A run of a code block, coloured by the app's highlighter when it has one.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct CodeRun {
	pub text: String,
	pub colour: Option<String>,
	#[serde(default)]
	pub bold: bool,
	#[serde(default)]
	pub italic: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Block {
	Heading { level: u8, runs: Vec<Run> },
	Paragraph { runs: Vec<Run> },
	Image { url: String, alt: String, width: Option<f64> },
	Embed { target: String },
	List { ordered: bool, start: u32, loose: bool, items: Vec<Item> },
	Quote { alert: Option<String>, title: Option<String>, blocks: Vec<Block> },
	Code { lang: String, text: String, #[serde(default)] runs: Option<Vec<CodeRun>> },
	Table { align: Vec<Option<String>>, header: Vec<Vec<Run>>, rows: Vec<Vec<Vec<Run>>> },
	Rule,
	Footnotes { items: Vec<Footnote> },
	Math { tex: String },
}

/// Blocks from the app's reader, as JSON.
pub fn from_json(text: &str) -> Result<Vec<Block>, String> {
	serde_json::from_str(text).map_err(|e| e.to_string())
}

#[derive(Default, Clone)]
struct Style {
	bold: bool,
	italic: bool,
	strike: bool,
	link: Option<String>,
}

/// CommonMark and GitHub's extensions, read here.
pub fn parse(source: &str) -> Vec<Block> {
	let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
	let events: Vec<Event> = Parser::new_ext(source, options).collect();
	let mut at = 0;
	blocks(&events, &mut at, None)
}

fn blocks(events: &[Event], at: &mut usize, until: Option<TagEnd>) -> Vec<Block> {
	let mut out = Vec::new();
	while *at < events.len() {
		let event = &events[*at];
		*at += 1;
		match event {
			Event::End(end) if Some(*end) == until => return out,
			Event::Start(Tag::Heading { level, .. }) => {
				let level = match level {
					HeadingLevel::H1 => 1,
					HeadingLevel::H2 => 2,
					HeadingLevel::H3 => 3,
					HeadingLevel::H4 => 4,
					HeadingLevel::H5 => 5,
					HeadingLevel::H6 => 6,
				};
				out.push(Block::Heading { level, runs: runs(events, at, TagEnd::Heading(match level {
					1 => HeadingLevel::H1,
					2 => HeadingLevel::H2,
					3 => HeadingLevel::H3,
					4 => HeadingLevel::H4,
					5 => HeadingLevel::H5,
					_ => HeadingLevel::H6,
				})) });
			}
			Event::Start(Tag::Paragraph) => {
				let rs = runs(events, at, TagEnd::Paragraph);
				// A picture alone on its line is a picture block.
				if rs.len() == 1 && rs[0].image.is_some() {
					let image = rs[0].image.clone().expect("checked");
					out.push(Block::Image { url: image.url, alt: image.alt, width: image.width });
				} else {
					out.push(Block::Paragraph { runs: rs });
				}
			}
			Event::Start(Tag::BlockQuote(_)) => {
				let inner = blocks(events, at, Some(TagEnd::BlockQuote(None)));
				out.push(Block::Quote { alert: None, title: None, blocks: inner });
			}
			Event::Start(Tag::CodeBlock(kind)) => {
				let lang = match kind {
					CodeBlockKind::Fenced(l) => l.to_string(),
					CodeBlockKind::Indented => String::new(),
				};
				let mut text = String::new();
				while *at < events.len() {
					let e = &events[*at];
					*at += 1;
					match e {
						Event::Text(t) => text.push_str(t),
						Event::End(TagEnd::CodeBlock) => break,
						_ => {}
					}
				}
				out.push(Block::Code { lang, text, runs: None });
			}
			Event::Start(Tag::List(start)) => {
				let ordered = start.is_some();
				let mut items = Vec::new();
				let mut loose = false;
				while *at < events.len() {
					match &events[*at] {
						Event::End(TagEnd::List(_)) => {
							*at += 1;
							break;
						}
						Event::Start(Tag::Item) => {
							*at += 1;
							let mut checked = None;
							if let Some(Event::TaskListMarker(c)) = events.get(*at) {
								checked = Some(*c);
								*at += 1;
							} else if let (Some(Event::Start(Tag::Paragraph)), Some(Event::TaskListMarker(c))) = (events.get(*at), events.get(*at + 1)) {
								// In a loose list the box comes inside the item's first paragraph.
								checked = Some(*c);
							}
							let first = *at;
							let inner = blocks(events, at, Some(TagEnd::Item));
							// A loose list's items hold paragraphs; a tight one's hold bare words.
							if matches!(events.get(first), Some(Event::Start(Tag::Paragraph))) {
								loose = true;
							}
							items.push(Item { checked, blocks: inner });
						}
						_ => *at += 1,
					}
				}
				out.push(Block::List { ordered, start: start.unwrap_or(1) as u32, loose, items });
			}
			Event::Start(Tag::Table(aligns)) => {
				let align = aligns
					.iter()
					.map(|a| match a {
						MdAlign::Left => Some("left".to_owned()),
						MdAlign::Center => Some("center".to_owned()),
						MdAlign::Right => Some("right".to_owned()),
						MdAlign::None => None,
					})
					.collect();
				let mut header = Vec::new();
				let mut rows: Vec<Vec<Vec<Run>>> = Vec::new();
				let mut in_head = false;
				while *at < events.len() {
					let e = &events[*at];
					*at += 1;
					match e {
						Event::End(TagEnd::Table) => break,
						Event::Start(Tag::TableHead) => in_head = true,
						Event::End(TagEnd::TableHead) => in_head = false,
						Event::Start(Tag::TableRow) => rows.push(Vec::new()),
						Event::Start(Tag::TableCell) => {
							let cell = runs(events, at, TagEnd::TableCell);
							if in_head {
								header.push(cell);
							} else if let Some(row) = rows.last_mut() {
								row.push(cell);
							}
						}
						_ => {}
					}
				}
				out.push(Block::Table { align, header, rows });
			}
			Event::Rule => out.push(Block::Rule),
			// Text outside a paragraph (a tight list item's words).
			Event::Text(_) | Event::Code(_) | Event::Start(Tag::Emphasis) | Event::Start(Tag::Strong) | Event::Start(Tag::Link { .. }) => {
				*at -= 1;
				let rs = loose_runs(events, at);
				out.push(Block::Paragraph { runs: rs });
			}
			_ => {}
		}
	}
	out
}

/// Inline words up to the end of their container (a tight item's words end at a nested block).
fn loose_runs(events: &[Event], at: &mut usize) -> Vec<Run> {
	let mut out = Vec::new();
	let mut style = vec![Style::default()];
	while *at < events.len() {
		match &events[*at] {
			Event::End(TagEnd::Item) | Event::Start(Tag::List(_)) | Event::Start(Tag::Paragraph) | Event::Start(Tag::CodeBlock(_)) | Event::Start(Tag::BlockQuote(_)) => break,
			e => {
				if !inline(e, &mut style, &mut out) {
					break;
				}
				*at += 1;
			}
		}
	}
	out
}

fn runs(events: &[Event], at: &mut usize, end: TagEnd) -> Vec<Run> {
	let mut out = Vec::new();
	let mut style = vec![Style::default()];
	while *at < events.len() {
		let e = &events[*at];
		*at += 1;
		if matches!(e, Event::End(x) if *x == end) {
			break;
		}
		inline(e, &mut style, &mut out);
	}
	out
}

/// One inline event: false when it is not inline at all.
fn inline(e: &Event, style: &mut Vec<Style>, out: &mut Vec<Run>) -> bool {
	let top = style.last().cloned().unwrap_or_default();
	let run = |text: &str, s: &Style| Run { text: text.to_owned(), bold: s.bold, italic: s.italic, strike: s.strike, link: s.link.clone(), ..Default::default() };
	match e {
		Event::Text(t) => out.push(run(t, &top)),
		Event::Code(t) => out.push(Run { code: true, ..run(t, &top) }),
		Event::SoftBreak => out.push(run(" ", &top)),
		Event::HardBreak => out.push(run("\n", &top)),
		Event::Start(Tag::Emphasis) => style.push(Style { italic: true, ..top }),
		Event::Start(Tag::Strong) => style.push(Style { bold: true, ..top }),
		Event::Start(Tag::Strikethrough) => style.push(Style { strike: true, ..top }),
		Event::Start(Tag::Link { dest_url, .. }) => style.push(Style { link: Some(dest_url.to_string()), ..top }),
		Event::Start(Tag::Image { dest_url, .. }) => {
			out.push(Run { image: Some(RunImage { url: dest_url.to_string(), alt: String::new(), width: None }), ..Default::default() });
			style.push(Style { link: Some("\u{0}image".into()), ..top });
		}
		Event::End(TagEnd::Image) => {
			style.pop();
		}
		Event::End(TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link) => {
			style.pop();
		}
		Event::Html(t) | Event::InlineHtml(t) => {
			if t.trim().eq_ignore_ascii_case("<br>") || t.trim().eq_ignore_ascii_case("<br/>") {
				out.push(run("\n", &top));
			}
		}
		_ => return false,
	}
	// An image's alt words arrive as text inside it: they belong to the image.
	if let Some(Style { link: Some(l), .. }) = style.last() {
		if l == "\u{0}image" {
			if let Some(last) = out.pop() {
				if last.image.is_some() {
					out.push(last);
				} else if let Some(img) = out.iter_mut().rev().find_map(|r| r.image.as_mut()) {
					img.alt.push_str(&last.text);
				}
			}
		}
	}
	true
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_cards() {
		let b = parse("# Title\n\nSome **bold** and *italic* and `code`, a [link](https://x).\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n- [x] done\n- [ ] not\n\n> quoted\n\n```rust\nfn x() {}\n```\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n---\n\n![alt words](pic.png)\n");
		let kinds: Vec<&str> = b
			.iter()
			.map(|b| match b {
				Block::Heading { .. } => "h",
				Block::Paragraph { .. } => "p",
				Block::List { .. } => "list",
				Block::Quote { .. } => "quote",
				Block::Code { .. } => "code",
				Block::Table { .. } => "table",
				Block::Rule => "rule",
				Block::Image { .. } => "image",
				_ => "?",
			})
			.collect();
		assert_eq!(kinds, vec!["h", "p", "list", "list", "list", "quote", "code", "table", "rule", "image"]);
		let Block::Paragraph { runs } = &b[1] else { panic!() };
		assert!(runs.iter().any(|r| r.bold && r.text == "bold"));
		assert!(runs.iter().any(|r| r.code && r.text == "code"));
		assert!(runs.iter().any(|r| r.link.as_deref() == Some("https://x")));
		let Block::List { items, .. } = &b[2] else { panic!() };
		assert_eq!(items.len(), 2);
		assert!(items[1].blocks.iter().any(|b| matches!(b, Block::List { .. })), "{:?}", items[1].blocks);
		let Block::List { items, .. } = &b[4] else { panic!() };
		assert_eq!(items[0].checked, Some(true));
		let Block::Image { alt, .. } = &b[9] else { panic!() };
		assert_eq!(alt, "alt words");
	}

	#[test]
	fn reads_the_apps_json() {
		let json = r#"[{"kind":"heading","level":2,"runs":[{"text":"Hi","bold":true}]},{"kind":"rule"},{"kind":"quote","alert":"blue","title":"Note","blocks":[{"kind":"paragraph","runs":[{"text":"x","colour":"red","mark":"default"}]}]}]"#;
		let b = from_json(json).unwrap();
		assert_eq!(b.len(), 3);
	}
}
