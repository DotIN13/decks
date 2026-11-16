//! A session's own editing: the ids it makes for new items, and the undo and redo of its own
//! batches only.

use crate::{Applied, Change, Document};

/// Ids made in this session: its own prefix and a counter, so two sessions never make the same id
/// and nothing waits on the server for one.
#[derive(Clone, Debug)]
pub struct Ids {
	prefix: String,
	next: u64,
}

impl Ids {
	/// `session` should be unique per session: the server hands one out, or a random word.
	pub fn new(session: &str) -> Ids {
		Ids { prefix: session.chars().filter(char::is_ascii_alphanumeric).collect(), next: 1 }
	}

	pub fn next(&mut self, doc: &Document) -> String {
		loop {
			let id = format!("{}{}", self.prefix, base36(self.next));
			self.next += 1;
			if doc.handle(&id).is_none() {
				return id;
			}
		}
	}
}

fn base36(mut n: u64) -> String {
	const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
	let mut out = Vec::new();
	loop {
		out.push(D[(n % 36) as usize]);
		n /= 36;
		if n == 0 {
			break;
		}
	}
	out.reverse();
	String::from_utf8(out).expect("digits are ASCII")
}

/// Undo and redo of this session's own batches only, as Figma does: undoing never takes back
/// what someone else did, and a batch whose items are gone is skipped rather than half applied.
#[derive(Clone, Debug, Default)]
pub struct History {
	undo: Vec<Vec<Change>>,
	redo: Vec<Vec<Change>>,
}

impl History {
	/// Record what undoes a batch this session applied.
	pub fn record(&mut self, applied: &Applied) {
		if !applied.undo.is_empty() {
			self.undo.push(applied.undo.clone());
			self.redo.clear();
		}
	}

	pub fn can_undo(&self) -> bool {
		!self.undo.is_empty()
	}

	pub fn can_redo(&self) -> bool {
		!self.redo.is_empty()
	}

	/// Undo this session's last batch that still applies: the changes applied, and what they did.
	pub fn undo(&mut self, doc: &mut Document) -> Option<(Vec<Change>, Applied)> {
		while let Some(batch) = self.undo.pop() {
			if let Ok(applied) = doc.apply(&batch) {
				self.redo.push(applied.undo.clone());
				return Some((batch, applied));
			}
		}
		None
	}

	pub fn redo(&mut self, doc: &mut Document) -> Option<(Vec<Change>, Applied)> {
		while let Some(batch) = self.redo.pop() {
			if let Ok(applied) = doc.apply(&batch) {
				self.undo.push(applied.undo.clone());
				return Some((batch, applied));
			}
		}
		None
	}
}
