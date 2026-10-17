//! The edits the server sends (`@decks/pen` `diff`, `stage.pen.delta`): the same as [`Change`]s but
//! with a place said as "after this sibling", so no copy shares another's place keys. Each is turned
//! into a change against the document as the edits before it left it.

use crate::{Applied, Change, DocError, Document, Props, frac};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub enum Edit {
	Insert { id: String, parent: Option<String>, after: Option<String>, props: Props, list: bool },
	Remove { id: String },
	Set { id: String, key: String, value: Option<Value> },
	Place { id: String, parent: Option<String>, after: Option<String> },
	Meta { key: String, value: Option<Value> },
}

impl Edit {
	/// From the JSON the server sends: `{ op, id, parent, after, props, list, key, value }`.
	pub fn from_json(v: &Value) -> Result<Edit, String> {
		let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("an edit needs \"{k}\""));
		let opt = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
		Ok(match v.get("op").and_then(Value::as_str).unwrap_or("") {
			"insert" => Edit::Insert {
				id: text("id")?,
				parent: opt("parent"),
				after: opt("after"),
				props: v.get("props").and_then(Value::as_object).cloned().unwrap_or_default(),
				list: v.get("list").and_then(Value::as_bool).unwrap_or(false),
			},
			"remove" => Edit::Remove { id: text("id")? },
			"set" => Edit::Set { id: text("id")?, key: text("key")?, value: v.get("value").cloned() },
			"place" => Edit::Place { id: text("id")?, parent: opt("parent"), after: opt("after") },
			"meta" => Edit::Meta { key: text("key")?, value: v.get("value").cloned() },
			other => return Err(format!("no edit is called \"{other}\"")),
		})
	}
}

/// The place key right after `after` under `parent` (first when `None`), leaving `moving` out of the
/// siblings it is placed among.
fn place(doc: &Document, parent: Option<&str>, after: Option<&str>, moving: Option<&str>) -> Result<String, DocError> {
	let parent_handle = match parent {
		None => None,
		Some(id) => Some(doc.handle(id).ok_or_else(|| DocError(format!("no item \"{id}\"")))?),
	};
	let siblings: Vec<&str> = doc
		.child_list(parent_handle)
		.iter()
		.filter_map(|&h| doc.node(h))
		.filter(|n| Some(n.id.as_str()) != moving)
		.map(|n| n.id.as_str())
		.collect();
	let key = |id: &str| doc.get(id).map(|n| n.pos.as_str());
	let at = match after {
		None => 0,
		Some(a) => siblings.iter().position(|s| *s == a).map(|i| i + 1).ok_or_else(|| DocError(format!("no sibling \"{a}\"")))?,
	};
	let lo = if at > 0 { key(siblings[at - 1]) } else { None };
	let hi = siblings.get(at).and_then(|s| key(s));
	Ok(frac::between(lo, hi))
}

impl Document {
	/// Apply the server's edits: all of them, or none.
	pub fn apply_edits(&mut self, edits: &[Edit]) -> Result<Applied, DocError> {
		self.apply_each(edits.len(), |doc, i| {
			Ok(match &edits[i] {
				Edit::Insert { id, parent, after, props, list } => Change::Insert { id: id.clone(), parent: parent.clone(), pos: place(doc, parent.as_deref(), after.as_deref(), None)?, props: props.clone(), list: *list },
				Edit::Remove { id } => Change::Remove { id: id.clone() },
				Edit::Set { id, key, value } if key == "children" => Change::List { id: id.clone(), on: value.is_some() },
				Edit::Set { id, key, value } => Change::Set { id: id.clone(), key: key.clone(), value: value.clone() },
				Edit::Place { id, parent, after } => Change::Place { id: id.clone(), parent: parent.clone(), pos: place(doc, parent.as_deref(), after.as_deref(), Some(id))? },
				Edit::Meta { key, value } => Change::SetMeta { key: key.clone(), value: value.clone() },
			})
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	fn edits(v: Value) -> Vec<Edit> {
		v.as_array().unwrap().iter().map(|e| Edit::from_json(e).unwrap()).collect()
	}

	/// The edits `@decks/pen`'s diff makes for a change, applied here, give the same file.
	#[test]
	fn the_servers_edits_apply() {
		let mut d = Document::from_json(json!({"version":"2.14","children":[
			{"type":"frame","id":"f","children":[{"type":"text","id":"t","content":"x"},{"type":"rectangle","id":"r"}]},
			{"type":"ellipse","id":"e"},{"type":"rectangle","id":"gone","children":[{"type":"text","id":"under"}]}
		]}))
		.unwrap();
		// What diff(a, b) gives in diff.test.ts's first case.
		let list = edits(json!([
			{"op":"meta","key":"variables","value":{}},
			{"op":"place","id":"e","parent":null,"after":null},
			{"op":"set","id":"e","key":"fill","value":"#f00"},
			{"op":"insert","id":"new","parent":"f","after":"r","props":{"type":"group","id":"new"},"list":true},
			{"op":"place","id":"t","parent":"new","after":null},
			{"op":"set","id":"t","key":"content","value":"y"},
			{"op":"insert","id":"n","parent":null,"after":"f","props":{"type":"note","id":"n"},"list":false},
			{"op":"remove","id":"gone"}
		]));
		let applied = d.apply_edits(&list).unwrap();
		let want = json!({"version":"2.14","children":[
			{"type":"ellipse","id":"e","fill":"#f00"},
			{"type":"frame","id":"f","children":[{"type":"rectangle","id":"r"},{"type":"group","id":"new","children":[{"type":"text","id":"t","content":"y"}]}]},
			{"type":"note","id":"n"}
		],"variables":{}});
		let canon = |v: Value| serde_json::to_string(&sort(v)).unwrap();
		assert_eq!(canon(d.to_json()), canon(want));
		// And undo puts the first version back.
		d.apply(&applied.undo).unwrap();
		assert_eq!(d.get("gone").map(|n| n.kind()), Some("rectangle"));
		assert_eq!(d.to_json()["children"][0]["id"], "f");
	}

	fn sort(v: Value) -> Value {
		match v {
			Value::Object(m) => {
				let mut keys: Vec<_> = m.into_iter().collect();
				keys.sort_by(|a, b| a.0.cmp(&b.0));
				Value::Object(keys.into_iter().map(|(k, v)| (k, sort(v))).collect())
			}
			Value::Array(a) => Value::Array(a.into_iter().map(sort).collect()),
			other => other,
		}
	}
}

/// TypeScript's diff, applied here: set `EDIT_PAIRS` to a JSON list of `{ a, b, edits }`.
#[cfg(test)]
#[test]
fn typescript_diffs_apply_here() {
	let Ok(path) = std::env::var("EDIT_PAIRS") else { return };
	let pairs: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
	fn sort(v: Value) -> Value {
		match v {
			Value::Object(m) => {
				let mut keys: Vec<_> = m.into_iter().collect();
				keys.sort_by(|a, b| a.0.cmp(&b.0));
				Value::Object(keys.into_iter().map(|(k, v)| (k, sort(v))).collect())
			}
			Value::Array(a) => Value::Array(a.into_iter().map(sort).collect()),
			other => other,
		}
	}
	for (i, pair) in pairs.iter().enumerate() {
		let mut d = Document::from_json(pair["a"].clone()).unwrap();
		let list: Vec<Edit> = pair["edits"].as_array().unwrap().iter().map(|e| Edit::from_json(e).unwrap()).collect();
		d.apply_edits(&list).unwrap_or_else(|e| panic!("pair {i}: {e}"));
		assert_eq!(sort(d.to_json()), sort(pair["b"].clone()), "pair {i}");
	}
	eprintln!("{} pairs applied", pairs.len());
}
