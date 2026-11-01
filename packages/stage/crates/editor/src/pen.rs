//! What the editor asks of a pen item's fields: which kind of thing it is (`@decks/pen`'s
//! `isArrow`, `isCard`, `isShape`, `mediaOf`, and the canvas's file kinds).

use crate::scene::Props;
use serde_json::Value;

pub const ARROW: &str = "decks.arrow";
pub const CARD: &str = "decks.markdown-card";
pub const OLD_CARD: &str = "decks.card";
pub const MARKDOWN: &str = "decks.markdown";
pub const SHAPE: &str = "decks.shape";
pub const MEDIA: &str = "decks.media";
pub const FILE: &str = "decks.file";
pub const LIVE_FILE: &str = "decks.live-file";
/// The `browser` items that are a page on the canvas: a board, a card, a document, an app.
pub const PAGES: [&str; 4] = ["decks.board", "decks.card", "decks.document", "decks.app"];

pub fn kind(node: &Props) -> &str {
	node.get("type").and_then(Value::as_str).unwrap_or("")
}

/// `metadata.type`, when there is one.
pub fn tag(node: &Props) -> &str {
	node.get("metadata").and_then(|m| m.get("type")).and_then(Value::as_str).unwrap_or("")
}

pub fn metadata(node: &Props) -> Option<&serde_json::Map<String, Value>> {
	node.get("metadata").and_then(Value::as_object)
}

pub fn is_arrow(node: &Props) -> bool {
	kind(node) == "path" && tag(node) == ARROW
}
pub fn is_card(node: &Props) -> bool {
	kind(node) == "frame" && (tag(node) == CARD || tag(node) == OLD_CARD)
}
pub fn is_shape(node: &Props) -> bool {
	kind(node) == "frame" && tag(node) == SHAPE
}
pub fn is_markdown_text(node: &Props) -> bool {
	kind(node) == "text" && tag(node) == MARKDOWN
}
pub fn is_file(node: &Props) -> bool {
	kind(node) == "frame" && tag(node) == FILE
}
pub fn is_live_file(node: &Props) -> bool {
	tag(node) == LIVE_FILE
}
/// A board, a card, a document or an app placed on the canvas: not the editor's to pick.
pub fn is_page(node: &Props) -> bool {
	kind(node) == "browser" && PAGES.contains(&tag(node))
}

/// A film or a sound: its kind and its file.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Media {
	pub kind: &'static str,
	pub file: String,
}

pub fn media_of(node: &Props) -> Option<Media> {
	if tag(node) != MEDIA {
		return None;
	}
	let data = metadata(node)?;
	let file = data.get("file").and_then(Value::as_str).unwrap_or("");
	if file.is_empty() {
		return None;
	}
	Some(Media { kind: if data.get("kind").and_then(Value::as_str) == Some("audio") { "audio" } else { "video" }, file: file.into() })
}

/// An id made inside an instance (`ref/child`): never the editor's to pick or move.
pub fn in_instance(id: &str) -> bool {
	id.contains('/')
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	fn props(v: Value) -> Props {
		v.as_object().unwrap().clone()
	}

	#[test]
	fn kinds_are_told_by_type_and_metadata() {
		assert!(is_arrow(&props(json!({ "type": "path", "metadata": { "type": "decks.arrow" } }))));
		assert!(!is_arrow(&props(json!({ "type": "path" }))));
		assert!(is_card(&props(json!({ "type": "frame", "metadata": { "type": "decks.markdown-card" } }))));
		assert!(is_card(&props(json!({ "type": "frame", "metadata": { "type": "decks.card" } }))));
		assert!(!is_card(&props(json!({ "type": "browser", "metadata": { "type": "decks.card" } }))), "a browser decks.card is an HTML card page");
		assert!(is_page(&props(json!({ "type": "browser", "metadata": { "type": "decks.card" } }))));
		assert_eq!(media_of(&props(json!({ "type": "rectangle", "metadata": { "type": "decks.media", "kind": "audio", "file": "a.mp3" } }))).map(|m| m.kind), Some("audio"));
		assert_eq!(media_of(&props(json!({ "type": "rectangle", "metadata": { "type": "decks.media", "file": "" } }))), None);
	}
}
