//! One top-level item and everything under it, with instances expanded: the tree layout and paint
//! read. It is derived data, rebuilt only when something it was built from changes.
//!
//! pen's instance rules, as pen.dev applies them:
//!
//! - a `ref` becomes a copy of the reusable item it names, `reusable` dropped, with every field the
//!   ref sets itself (`x`, `width`, `fill`, …) laid over the copy's root;
//! - `descendants` changes items inside the copy by id path from its root (`"ok-button/label"`): an
//!   override with a `type` replaces the item, one without merges its fields;
//! - an item inside a copy is known as `"<ref id>/<path>"`, which is the id an agent edits it by;
//! - `"name:id"` is an item in the file imported as `name`; `"frames/<name>"` a saved frame's file;
//! - a ref that names nothing, or itself, is a `missing` placeholder of the ref's own size.

use serde_json::Value;
use stage_doc::{Document, Handle};
use std::collections::HashMap;
use std::rc::Rc;

use crate::values::Props;

pub const MISSING: &str = "missing";

#[derive(Clone, Debug)]
pub struct Item {
	pub id: String,
	pub props: Rc<Props>,
	pub parent: Option<u32>,
	pub children: Vec<u32>,
	/// The document item this is, when it is not a copy made for an instance.
	pub handle: Option<Handle>,
}

impl Item {
	pub fn kind(&self) -> &str {
		self.props.get("type").and_then(Value::as_str).unwrap_or("")
	}
	pub fn get(&self, key: &str) -> Option<&Value> {
		self.props.get(key)
	}
}

/// One top-level item's tree, flattened: the root is item 0, and items are in paint order.
#[derive(Clone, Debug, Default)]
pub struct Tree {
	pub items: Vec<Item>,
	/// Whether any instance was expanded here: such a tree depends on items elsewhere.
	pub has_refs: bool,
}

/// Looks up what refs name: this document's items, and the files it imports.
pub struct Sources<'a> {
	doc: &'a Document,
	imported: HashMap<&'a str, (Option<&'a Value>, HashMap<&'a str, &'a Value>)>,
}

impl<'a> Sources<'a> {
	pub fn new(doc: &'a Document) -> Sources<'a> {
		let mut imported = HashMap::new();
		if let Some(Value::Object(files)) = doc.meta.get("decks.imported") {
			for (name, file) in files {
				let mut index = HashMap::new();
				let kids = file.get("children").and_then(Value::as_array);
				fn walk<'v>(list: &'v [Value], index: &mut HashMap<&'v str, &'v Value>) {
					for item in list {
						if let Some(id) = item.get("id").and_then(Value::as_str) {
							index.insert(id, item);
						}
						if let Some(kids) = item.get("children").and_then(Value::as_array) {
							walk(kids, index);
						}
					}
				}
				if let Some(kids) = kids {
					walk(kids, &mut index);
				}
				imported.insert(name.as_str(), (kids.and_then(|k| k.first()), index));
			}
		}
		Sources { doc, imported }
	}

	/// The item a ref names, and the imported file it is in (`None`: this one).
	fn find(&self, id: &str, scope: Option<&str>) -> Option<(Value, Option<String>)> {
		if !id.contains(':') {
			if let Some((first, _)) = self.imported.get(id) {
				return first.map(|v| ((*v).clone(), Some(id.to_owned())));
			}
		}
		if let Some((name, rest)) = id.split_once(':') {
			if let Some((_, index)) = self.imported.get(name) {
				return index.get(rest).map(|v| ((*v).clone(), Some(name.to_owned())));
			}
		}
		if let Some(scope) = scope {
			if let Some(v) = self.imported.get(scope).and_then(|(_, index)| index.get(id)) {
				return Some(((*v).clone(), Some(scope.to_owned())));
			}
		}
		self.doc.handle(id).map(|h| (self.doc.subtree_json(h), None))
	}

	/// The tree of one top-level item.
	pub fn tree(&self, root: Handle) -> Tree {
		let mut tree = Tree::default();
		self.add_doc_item(&mut tree, root, None);
		tree
	}

	fn add_doc_item(&self, tree: &mut Tree, handle: Handle, parent: Option<u32>) {
		let node = self.doc.node(handle).expect("a listed item exists");
		if node.kind() == "ref" {
			tree.has_refs = true;
			let copy = self.instance(&self.doc.subtree_json(handle), &[], None);
			let at = add_json(tree, copy, parent);
			tree.items[at as usize].handle = Some(handle);
			return;
		}
		let at = tree.items.len() as u32;
		tree.items.push(Item { id: node.id.clone(), props: Rc::new(node.props.clone()), parent, children: Vec::new(), handle: Some(handle) });
		if let Some(p) = parent {
			tree.items[p as usize].children.push(at);
		}
		for &child in self.doc.child_list(Some(handle)) {
			self.add_doc_item(tree, child, Some(at));
		}
	}

	fn instance(&self, reference: &Value, stack: &[String], scope: Option<&str>) -> Value {
		let id = reference.get("id").and_then(Value::as_str).unwrap_or("").to_owned();
		let mut copy = self.instance_raw(reference, stack, scope);
		prefix(&mut copy, &id);
		copy
	}

	fn instance_raw(&self, reference: &Value, stack: &[String], scope: Option<&str>) -> Value {
		let named = reference.get("ref").and_then(Value::as_str).unwrap_or("").to_owned();
		let found = if named.is_empty() { None } else { self.find(&named, scope) };
		let Some((target, within)) = found.filter(|_| !stack.contains(&named)) else {
			let mut rest = reference.as_object().cloned().unwrap_or_default();
			rest.shift_remove("ref");
			rest.shift_remove("descendants");
			rest.insert("type".into(), Value::String(MISSING.into()));
			let why = if stack.contains(&named) {
				format!("{named} refers back to itself")
			} else if named.starts_with("frames/") && !named.contains(':') {
				format!("no saved frame {named}.pen")
			} else if named.contains(':') {
				format!("no item \"{named}\" in the imported file")
			} else {
				format!("no item \"{named}\" in this file")
			};
			rest.insert("why".into(), Value::String(why));
			return Value::Object(rest);
		};
		let mut inner = stack.to_vec();
		inner.push(named);
		let mut copy = if target.get("type").and_then(Value::as_str) == Some("ref") {
			self.instance_raw(&target, &inner, within.as_deref())
		} else {
			let mut copy = target;
			if let Some(object) = copy.as_object_mut() {
				object.shift_remove("reusable");
			}
			self.expand_children(&mut copy, &inner, within.as_deref());
			copy
		};
		if let (Some(object), Some(own)) = (copy.as_object_mut(), reference.as_object()) {
			for (key, value) in own {
				if matches!(key.as_str(), "type" | "id" | "ref" | "descendants" | "reusable") {
					continue;
				}
				object.insert(key.clone(), value.clone());
			}
			object.insert("id".into(), reference.get("id").cloned().unwrap_or(Value::Null));
		}
		if let Some(Value::Object(overrides)) = reference.get("descendants") {
			apply_overrides(&mut copy, overrides);
		}
		// What the overrides put in may itself hold refs, named in this file.
		self.expand_children(&mut copy, &inner, scope);
		copy
	}

	fn expand_children(&self, node: &mut Value, stack: &[String], scope: Option<&str>) {
		let Some(Value::Array(kids)) = node.get_mut("children") else { return };
		for child in kids.iter_mut() {
			if child.get("type").and_then(Value::as_str) == Some("ref") {
				*child = self.instance(child, stack, scope);
			} else {
				self.expand_children(child, stack, scope);
			}
		}
	}
}

fn apply_overrides(root: &mut Value, overrides: &serde_json::Map<String, Value>) {
	for (path, value) in overrides {
		let Some(fields) = value.as_object() else { continue };
		let Some(target) = find_relative(root, path) else { continue };
		if fields.get("type").is_some_and(Value::is_string) {
			let mut replacement = value.clone();
			replacement["id"] = Value::String(path.clone());
			*target = replacement;
		} else if let Some(object) = target.as_object_mut() {
			for (k, v) in fields {
				object.insert(k.clone(), v.clone());
			}
		}
	}
}

fn find_relative<'v>(node: &'v mut Value, path: &str) -> Option<&'v mut Value> {
	let kids = node.get_mut("children")?.as_array_mut()?;
	let at = kids.iter().position(|c| c.get("id").and_then(Value::as_str) == Some(path));
	match at {
		Some(i) => kids.get_mut(i),
		None => kids.iter_mut().find_map(|c| find_relative(c, path)),
	}
}

/// Give every item inside a copy its id path under the instance: `"card-1/label"`.
fn prefix(root: &mut Value, id: &str) {
	fn walk(node: &mut Value, id: &str) {
		let Some(Value::Array(kids)) = node.get_mut("children") else { return };
		for child in kids {
			let own = child.get("id").and_then(Value::as_str).unwrap_or("").to_owned();
			child["id"] = Value::String(format!("{id}/{own}"));
			child["instanceOf"] = Value::Bool(true);
			walk(child, id);
		}
	}
	walk(root, id);
}

fn add_json(tree: &mut Tree, value: Value, parent: Option<u32>) -> u32 {
	let Value::Object(mut props) = value else {
		// Not an item: an empty placeholder keeps the tree whole.
		let mut props = Props::new();
		props.insert("type".into(), Value::String(MISSING.into()));
		return add_json(tree, Value::Object(props), parent);
	};
	let kids = props.shift_remove("children");
	let id = props.get("id").and_then(Value::as_str).unwrap_or("").to_owned();
	let at = tree.items.len() as u32;
	tree.items.push(Item { id, props: Rc::new(props), parent, children: Vec::new(), handle: None });
	if let Some(p) = parent {
		tree.items[p as usize].children.push(at);
	}
	if let Some(Value::Array(kids)) = kids {
		for kid in kids {
			add_json(tree, kid, Some(at));
		}
	}
	at
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	fn tree_of(doc: &Document, id: &str) -> Tree {
		Sources::new(doc).tree(doc.handle(id).unwrap())
	}

	#[test]
	fn an_instance_is_a_copy_with_paths() {
		let doc = Document::from_json(json!({"children":[
			{"type":"frame","id":"btn","reusable":true,"fill":"#000","children":[{"type":"text","id":"label","content":"OK"}]},
			{"type":"ref","id":"b1","ref":"btn","x":50,"descendants":{"label":{"content":"Go"}}}
		]}))
		.unwrap();
		let t = tree_of(&doc, "b1");
		assert!(t.has_refs);
		assert_eq!(t.items[0].id, "b1");
		assert_eq!(t.items[0].kind(), "frame");
		assert_eq!(t.items[0].get("x"), Some(&json!(50)));
		assert_eq!(t.items[0].get("reusable"), None);
		assert_eq!(t.items[1].id, "b1/label");
		assert_eq!(t.items[1].get("content"), Some(&json!("Go")));
		assert_eq!(t.items[0].handle, doc.handle("b1"));
		assert_eq!(t.items[1].handle, None);
	}

	#[test]
	fn missing_and_cyclic_refs_are_placeholders() {
		let doc = Document::from_json(json!({"children":[
			{"type":"ref","id":"a","ref":"nope","width":10},
			{"type":"ref","id":"loop","ref":"loop"}
		]}))
		.unwrap();
		let t = tree_of(&doc, "a");
		assert_eq!(t.items[0].kind(), MISSING);
		assert_eq!(t.items[0].get("width"), Some(&json!(10)));
		assert_eq!(tree_of(&doc, "loop").items[0].kind(), MISSING);
	}

	#[test]
	fn nested_instances_and_replacements() {
		let doc = Document::from_json(json!({"children":[
			{"type":"text","id":"t","reusable":true,"content":"x"},
			{"type":"frame","id":"card","reusable":true,"children":[{"type":"ref","id":"title","ref":"t"},{"type":"rectangle","id":"r"}]},
			{"type":"ref","id":"c1","ref":"card","descendants":{"title":{"content":"Hello"},"r":{"type":"ellipse","width":3}}}
		]}))
		.unwrap();
		let t = tree_of(&doc, "c1");
		let ids: Vec<_> = t.items.iter().map(|i| (i.id.as_str(), i.kind())).collect();
		assert_eq!(ids, vec![("c1", "frame"), ("c1/title", "text"), ("c1/r", "ellipse")]);
		assert_eq!(t.items[1].get("content"), Some(&json!("Hello")));
	}
}
