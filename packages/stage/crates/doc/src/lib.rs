//! The stage's document, held as Figma holds its own: a flat map from each item's id to its
//! properties, where an item's parent and its place among its siblings are two more properties.
//!
//! Every edit is a [`Change`] to one property or one item, so the same small messages serve the
//! UI, the agents, the render worker and, later, other people's sessions. [`Document::apply`]
//! applies a batch together or not at all and hands back the batch that undoes it.
//!
//! The saved form is still pen.dev's `.pen` JSON. [`Document::parse`] reads it into the map and
//! [`Document::to_json`] writes it back as it was: every field kept, in its order, unknown ones too.

pub mod frac;

use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fmt;

pub type Props = Map<String, Value>;

/// An item's handle inside one [`Document`]: an index, cheaper than its id to keep and compare.
/// A handle is reused after its item is removed, so derived data keyed by handle is dropped with it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Handle(pub u32);

#[derive(Clone, Debug)]
pub struct Node {
	pub id: String,
	/// Every field of the item except `children`, in the order the file had them.
	pub props: Props,
	/// Where `children` sat among the fields, so it is written back there.
	children_slot: Option<usize>,
	pub parent: Option<Handle>,
	/// The item's place among its siblings: a fractional index (`frac`).
	pub pos: String,
}

impl Node {
	pub fn kind(&self) -> &str {
		self.props.get("type").and_then(Value::as_str).unwrap_or("")
	}
	pub fn get(&self, key: &str) -> Option<&Value> {
		self.props.get(key)
	}
}

/// One edit. Item ids are the file's own strings, so a change means the same thing in every session.
#[derive(Clone, Debug, PartialEq)]
pub enum Change {
	/// A new item, with its fields (`type` among them), under `parent` (`None`: the top) at `pos`.
	/// `list` gives it an empty `children` list, which a frame or group has even with nothing in it.
	Insert { id: String, parent: Option<String>, pos: String, props: Props, list: bool },
	/// An item and everything under it.
	Remove { id: String },
	/// One field; `None` deletes it. `id` and `children` are not fields that can be set.
	Set { id: String, key: String, value: Option<Value> },
	/// A new parent or a new place among the siblings.
	Place { id: String, parent: Option<String>, pos: String },
	/// One of the document's own fields (`version`, `variables`, `themes`, …).
	SetMeta { key: String, value: Option<Value> },
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocError(pub String);

impl fmt::Display for DocError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(&self.0)
	}
}

impl std::error::Error for DocError {}

fn fail<T>(message: impl Into<String>) -> Result<T, DocError> {
	Err(DocError(message.into()))
}

/// What a batch did: the batch that undoes it, and what derived data has to be worked out again.
#[derive(Debug, Default, Clone)]
pub struct Applied {
	pub undo: Vec<Change>,
	/// Items whose own fields changed.
	pub touched: Vec<Handle>,
	/// Items added, removed or moved: the tree's shape changed.
	pub reshaped: bool,
	/// The parents whose lists of children changed (`None`: the top level), before and after.
	pub parents: Vec<Option<Handle>>,
	/// The document's own fields changed (variables, themes): anything may look different.
	pub meta: bool,
	/// The document's generation after the batch.
	pub generation: u64,
}

#[derive(Clone, Debug, Default)]
pub struct Document {
	/// The document's fields other than `children`, in the file's order.
	pub meta: Props,
	meta_children_slot: Option<usize>,
	nodes: Vec<Option<Node>>,
	free: Vec<u32>,
	by_id: HashMap<String, Handle>,
	/// Children of each parent (`None`: the top), in `pos` order. An item with an entry has a
	/// `children` list in the file, even when it is empty.
	children: HashMap<Option<Handle>, Vec<Handle>>,
	/// Counts every applied batch: the number derived data and the render worker key on.
	pub generation: u64,
}

impl Document {
	pub fn new() -> Document {
		let mut doc = Document::default();
		doc.meta.insert("version".into(), Value::String("2.14".into()));
		doc.children.insert(None, Vec::new());
		doc
	}

	/// Read a `.pen` file's text.
	pub fn parse(text: &str) -> Result<Document, DocError> {
		let value: Value = serde_json::from_str(text).map_err(|e| DocError(format!("Not JSON: {e}")))?;
		Document::from_json(value)
	}

	pub fn from_json(value: Value) -> Result<Document, DocError> {
		let Value::Object(mut object) = value else {
			return fail("A .pen document is a JSON object with a children array.");
		};
		let slot = object.keys().position(|k| k == "children");
		let Some(Value::Array(children)) = object.shift_remove("children") else {
			return fail("A .pen document needs a children array.");
		};
		let mut doc = Document { meta: object, meta_children_slot: slot, ..Default::default() };
		if !doc.meta.get("version").is_some_and(Value::is_string) {
			doc.meta.insert("version".into(), Value::String("2.14".into()));
		}
		doc.children.insert(None, Vec::new());
		doc.read_children(children, None, "children")?;
		Ok(doc)
	}

	fn read_children(&mut self, list: Vec<Value>, parent: Option<Handle>, place: &str) -> Result<(), DocError> {
		let keys = frac::spread(list.len());
		for (index, (item, pos)) in list.into_iter().zip(keys).enumerate() {
			let here = format!("{place}[{index}]");
			let Value::Object(mut props) = item else {
				return fail(format!("{here} is not an object."));
			};
			if !props.get("type").and_then(Value::as_str).is_some_and(|t| !t.is_empty()) {
				return fail(format!("{here} has no type."));
			}
			let Some(id) = props.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned) else {
				return fail(format!("{here} has no id."));
			};
			if id.contains('/') {
				return fail(format!("The id \"{id}\" contains \"/\", which separates the steps of an id path."));
			}
			if self.by_id.contains_key(&id) {
				return fail(format!("The id \"{id}\" is used twice."));
			}
			let slot = props.keys().position(|k| k == "children");
			let kids = match props.shift_remove("children") {
				None => None,
				Some(Value::Array(kids)) => Some(kids),
				Some(_) => return fail(format!("{id}.children is not an array.")),
			};
			let handle = self.alloc(Node { id: id.clone(), props, children_slot: slot, parent, pos });
			self.children.entry(parent).or_default().push(handle);
			if let Some(kids) = kids {
				self.children.insert(Some(handle), Vec::new());
				self.read_children(kids, Some(handle), &id)?;
			}
		}
		Ok(())
	}

	fn alloc(&mut self, node: Node) -> Handle {
		let id = node.id.clone();
		let handle = match self.free.pop() {
			Some(slot) => {
				self.nodes[slot as usize] = Some(node);
				Handle(slot)
			}
			None => {
				self.nodes.push(Some(node));
				Handle(self.nodes.len() as u32 - 1)
			}
		};
		self.by_id.insert(id, handle);
		handle
	}

	/// The document as `.pen` JSON, as it was read plus every change since.
	pub fn to_json(&self) -> Value {
		let mut out = self.meta.clone();
		let kids = Value::Array(self.child_list(None).iter().map(|&h| self.node_json(h)).collect());
		insert_at(&mut out, self.meta_children_slot, kids);
		Value::Object(out)
	}

	/// The text pen.dev saves: two-space indents and a closing newline.
	pub fn to_text(&self) -> String {
		let mut text = serde_json::to_string_pretty(&self.to_json()).expect("a document is JSON");
		text.push('\n');
		text
	}

	/// One item and everything under it, as `.pen` JSON.
	pub fn subtree_json(&self, handle: Handle) -> Value {
		self.node_json(handle)
	}

	fn node_json(&self, handle: Handle) -> Value {
		let node = self.node(handle).expect("a listed child exists");
		let mut out = node.props.clone();
		if let Some(kids) = self.children.get(&Some(handle)) {
			let list = Value::Array(kids.iter().map(|&h| self.node_json(h)).collect());
			insert_at(&mut out, node.children_slot, list);
		}
		Value::Object(out)
	}

	pub fn len(&self) -> usize {
		self.by_id.len()
	}

	pub fn is_empty(&self) -> bool {
		self.by_id.is_empty()
	}

	/// One more than the largest handle in use: the size of a table indexed by handle.
	pub fn capacity(&self) -> usize {
		self.nodes.len()
	}

	pub fn handle(&self, id: &str) -> Option<Handle> {
		self.by_id.get(id).copied()
	}

	pub fn node(&self, handle: Handle) -> Option<&Node> {
		self.nodes.get(handle.0 as usize).and_then(Option::as_ref)
	}

	/// The top-level item an item is under, or the item itself at the top.
	pub fn root_of(&self, mut handle: Handle) -> Option<Handle> {
		loop {
			match self.node(handle)?.parent {
				Some(p) => handle = p,
				None => return Some(handle),
			}
		}
	}

	pub fn get(&self, id: &str) -> Option<&Node> {
		self.handle(id).and_then(|h| self.node(h))
	}

	/// The children of `parent` (`None`: the top level), in order.
	pub fn child_list(&self, parent: Option<Handle>) -> &[Handle] {
		self.children.get(&parent).map_or(&[], Vec::as_slice)
	}

	/// Whether the item has a `children` list at all, even an empty one.
	pub fn has_children(&self, handle: Handle) -> bool {
		self.children.contains_key(&Some(handle))
	}

	/// Every item, parents before children: paint order.
	pub fn walk(&self) -> Vec<Handle> {
		let mut out = Vec::with_capacity(self.len());
		let mut stack: Vec<Handle> = self.child_list(None).iter().rev().copied().collect();
		while let Some(h) = stack.pop() {
			out.push(h);
			stack.extend(self.child_list(Some(h)).iter().rev());
		}
		out
	}

	/// A key placing a new last child under `parent`.
	pub fn pos_last(&self, parent: Option<Handle>) -> String {
		let last = self.child_list(parent).last().and_then(|&h| self.node(h)).map(|n| n.pos.as_str());
		frac::between(last, None)
	}

	/// A key placing a child right before or after `sibling`.
	pub fn pos_next_to(&self, sibling: Handle, after: bool) -> String {
		let node = self.node(sibling).expect("sibling exists");
		let list = self.child_list(node.parent);
		let at = list.iter().position(|&h| h == sibling).expect("sibling is listed");
		let key = |i: usize| self.node(list[i]).map(|n| n.pos.as_str());
		if after {
			frac::between(Some(&node.pos), if at + 1 < list.len() { key(at + 1) } else { None })
		} else {
			frac::between(if at > 0 { key(at - 1) } else { None }, Some(&node.pos))
		}
	}

	/// Apply a batch: all of it or, at the first change that cannot apply, none of it.
	pub fn apply(&mut self, changes: &[Change]) -> Result<Applied, DocError> {
		let mut applied = Applied::default();
		for (index, change) in changes.iter().enumerate() {
			if let Err(e) = self.apply_one(change, &mut applied) {
				let undo = std::mem::take(&mut applied.undo);
				for back in undo.iter().rev() {
					self.apply_one(back, &mut Applied::default()).expect("an undo applies");
				}
				return fail(format!("change {index}: {e}"));
			}
		}
		applied.undo.reverse();
		applied.touched.sort();
		applied.touched.dedup();
		applied.parents.sort();
		applied.parents.dedup();
		self.generation += 1;
		applied.generation = self.generation;
		Ok(applied)
	}

	fn parent_handle(&self, parent: &Option<String>) -> Result<Option<Handle>, DocError> {
		match parent {
			None => Ok(None),
			Some(id) => self.handle(id).map(Some).ok_or_else(|| DocError(format!("no item \"{id}\""))),
		}
	}

	fn find(&self, id: &str) -> Result<Handle, DocError> {
		self.handle(id).ok_or_else(|| DocError(format!("no item \"{id}\"")))
	}

	/// Where `pos` would go among `parent`'s children, or an error when a sibling has it.
	fn slot_for(&self, parent: Option<Handle>, pos: &str, except: Option<Handle>) -> Result<usize, DocError> {
		let list = self.child_list(parent);
		let pos_of = |h: &Handle| self.node(*h).expect("a child is live").pos.as_str();
		match list.binary_search_by(|h| pos_of(h).cmp(pos)) {
			Ok(at) if Some(list[at]) != except => fail(format!("the place \"{pos}\" is taken")),
			Ok(at) => Ok(at),
			Err(at) => Ok(at),
		}
	}

	fn apply_one(&mut self, change: &Change, applied: &mut Applied) -> Result<(), DocError> {
		match change {
			Change::Insert { id, parent, pos, props, list } => {
				if id.is_empty() || id.contains('/') {
					return fail(format!("\"{id}\" is not an id"));
				}
				if self.by_id.contains_key(id) {
					return fail(format!("the id \"{id}\" is used"));
				}
				if !frac::valid(pos) {
					return fail(format!("\"{pos}\" is not a place"));
				}
				if !props.get("type").and_then(Value::as_str).is_some_and(|t| !t.is_empty()) {
					return fail(format!("\"{id}\" has no type"));
				}
				let parent = self.parent_handle(parent)?;
				let at = self.slot_for(parent, pos, None)?;
				let mut props = props.clone();
				let slot = props.keys().position(|k| k == "children");
				props.shift_remove("children");
				props.insert("id".into(), Value::String(id.clone()));
				let handle = self.alloc(Node { id: id.clone(), props, children_slot: slot, parent, pos: pos.clone() });
				self.children.entry(parent).or_default().insert(at, handle);
				applied.parents.push(parent);
				if *list {
					self.children.insert(Some(handle), Vec::new());
				}
				applied.reshaped = true;
				applied.undo.push(Change::Remove { id: id.clone() });
			}
			Change::Remove { id } => {
				let handle = self.find(id)?;
				// The undo puts the whole subtree back, parents first.
				let mut back = Vec::new();
				self.subtree_inserts(handle, &mut back);
				applied.parents.push(self.node(handle).and_then(|n| n.parent));
				self.remove_subtree(handle);
				applied.reshaped = true;
				applied.undo.extend(back.into_iter().rev());
			}
			Change::Set { id, key, value } => {
				if key == "id" || key == "children" {
					return fail(format!("\"{key}\" is not a field that can be set"));
				}
				if key == "type" && !value.as_ref().and_then(Value::as_str).is_some_and(|t| !t.is_empty()) {
					return fail("an item's type is a word");
				}
				let handle = self.find(id)?;
				let node = self.nodes[handle.0 as usize].as_mut().expect("handle is live");
				let old = match value {
					Some(v) => node.props.insert(key.clone(), v.clone()),
					None => node.props.shift_remove(key),
				};
				applied.touched.push(handle);
				applied.undo.push(Change::Set { id: id.clone(), key: key.clone(), value: old });
			}
			Change::Place { id, parent, pos } => {
				let handle = self.find(id)?;
				if !frac::valid(pos) {
					return fail(format!("\"{pos}\" is not a place"));
				}
				let new_parent = self.parent_handle(parent)?;
				let mut up = new_parent;
				while let Some(p) = up {
					if p == handle {
						return fail(format!("\"{id}\" cannot go inside itself"));
					}
					up = self.node(p).and_then(|n| n.parent);
				}
				self.slot_for(new_parent, pos, Some(handle))?;
				let node = self.node(handle).expect("handle is live");
				let old_parent = node.parent;
				let undo = Change::Place { id: id.clone(), parent: old_parent.and_then(|p| self.node(p)).map(|n| n.id.clone()), pos: node.pos.clone() };
				self.detach(old_parent, handle);
				applied.parents.push(old_parent);
				applied.parents.push(new_parent);
				let node = self.nodes[handle.0 as usize].as_mut().expect("handle is live");
				node.parent = new_parent;
				node.pos = pos.clone();
				let at = self.slot_for(new_parent, pos, None).expect("the place was checked");
				self.children.entry(new_parent).or_default().insert(at, handle);
				applied.reshaped = true;
				applied.undo.push(undo);
			}
			Change::SetMeta { key, value } => {
				if key == "children" {
					return fail("\"children\" is not a field that can be set");
				}
				let old = match value {
					Some(v) => self.meta.insert(key.clone(), v.clone()),
					None => self.meta.shift_remove(key),
				};
				applied.meta = true;
				applied.undo.push(Change::SetMeta { key: key.clone(), value: old });
			}
		}
		Ok(())
	}

	fn detach(&mut self, parent: Option<Handle>, handle: Handle) {
		if let Some(list) = self.children.get_mut(&parent) {
			list.retain(|&h| h != handle);
		}
	}

	/// The inserts that rebuild an item and everything under it, parents first.
	fn subtree_inserts(&self, handle: Handle, out: &mut Vec<Change>) {
		let node = self.node(handle).expect("handle is live");
		let mut props = node.props.clone();
		// Keep `children` where the file had it: a placeholder the insert takes the slot from.
		if let Some(slot) = node.children_slot.filter(|_| self.has_children(handle)) {
			insert_at(&mut props, Some(slot), Value::Array(Vec::new()));
		}
		out.push(Change::Insert {
			id: node.id.clone(),
			parent: node.parent.and_then(|p| self.node(p)).map(|n| n.id.clone()),
			pos: node.pos.clone(),
			props,
			list: self.has_children(handle),
		});
		for &child in self.child_list(Some(handle)) {
			self.subtree_inserts(child, out);
		}
	}

	fn remove_subtree(&mut self, handle: Handle) {
		for child in self.child_list(Some(handle)).to_vec() {
			self.remove_subtree(child);
		}
		self.children.remove(&Some(handle));
		let node = self.nodes[handle.0 as usize].take().expect("handle is live");
		self.detach(node.parent, handle);
		self.by_id.remove(&node.id);
		self.free.push(handle.0);
	}
}

fn insert_at(object: &mut Props, slot: Option<usize>, value: Value) {
	match slot {
		Some(at) if at <= object.len() => {
			object.shift_insert(at, "children".into(), value);
		}
		_ => {
			object.insert("children".into(), value);
		}
	}
}

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

#[cfg(test)]
mod tests;
