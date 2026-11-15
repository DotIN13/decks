//! Changes as JSON, the form they cross between the page, the worker and the server in for now.
//!
//! `[{ "op": "set", "id": "a", "key": "x", "value": 10 }, …]`, with `insert` (`id`, `parent`, `pos`,
//! `props`, `list`), `remove` (`id`), `place` (`id`, `parent`, `pos`) and `meta` (`key`, `value`).
//! A missing `value` deletes the field. A compact binary form can replace this behind the same calls.

use serde_json::{Map, Value, json};
use stage_doc::Change;

fn text(v: &Value, key: &str) -> Result<String, String> {
	v.get(key).and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("a change needs \"{key}\""))
}

fn parent(v: &Value) -> Option<String> {
	v.get("parent").and_then(Value::as_str).map(str::to_owned)
}

pub fn parse(text_in: &str) -> Result<Vec<Change>, String> {
	let list: Vec<Value> = serde_json::from_str(text_in).map_err(|e| format!("changes are not JSON: {e}"))?;
	list.iter()
		.map(|v| {
			Ok(match v.get("op").and_then(Value::as_str).unwrap_or("") {
				"insert" => Change::Insert {
					id: text(v, "id")?,
					parent: parent(v),
					pos: text(v, "pos")?,
					props: v.get("props").and_then(Value::as_object).cloned().unwrap_or_default(),
					list: v.get("list").and_then(Value::as_bool).unwrap_or(false),
				},
				"remove" => Change::Remove { id: text(v, "id")? },
				"set" if v.get("key").and_then(Value::as_str) == Some("children") => Change::List { id: text(v, "id")?, on: v.get("value").is_some() },
				"set" => Change::Set { id: text(v, "id")?, key: text(v, "key")?, value: v.get("value").cloned() },
				"place" => Change::Place { id: text(v, "id")?, parent: parent(v), pos: text(v, "pos")? },
				"meta" => Change::SetMeta { key: text(v, "key")?, value: v.get("value").cloned() },
				other => return Err(format!("no change is called \"{other}\"")),
			})
		})
		.collect()
}

pub fn write(changes: &[Change]) -> String {
	let list: Vec<Value> = changes
		.iter()
		.map(|c| match c {
			Change::Insert { id, parent, pos, props, list } => json!({ "op": "insert", "id": id, "parent": parent, "pos": pos, "props": Value::Object(props.clone()), "list": list }),
			Change::Remove { id } => json!({ "op": "remove", "id": id }),
			Change::List { id, on: true } => json!({ "op": "set", "id": id, "key": "children", "value": [] }),
			Change::List { id, on: false } => json!({ "op": "set", "id": id, "key": "children" }),
			Change::Set { id, key, value } => {
				let mut m = Map::new();
				m.insert("op".into(), "set".into());
				m.insert("id".into(), id.clone().into());
				m.insert("key".into(), key.clone().into());
				if let Some(v) = value {
					m.insert("value".into(), v.clone());
				}
				Value::Object(m)
			}
			Change::Place { id, parent, pos } => json!({ "op": "place", "id": id, "parent": parent, "pos": pos }),
			Change::SetMeta { key, value } => {
				let mut m = Map::new();
				m.insert("op".into(), "meta".into());
				m.insert("key".into(), key.clone().into());
				if let Some(v) = value {
					m.insert("value".into(), v.clone());
				}
				Value::Object(m)
			}
		})
		.collect();
	Value::Array(list).to_string()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn round_trips() {
		let text = r#"[{"op":"set","id":"a","key":"x","value":1},{"op":"set","id":"a","key":"y"},{"op":"remove","id":"b"},{"op":"place","id":"c","parent":null,"pos":"V"},{"op":"insert","id":"d","parent":"c","pos":"k","props":{"type":"text"},"list":false},{"op":"meta","key":"variables","value":{}}]"#;
		let changes = parse(text).unwrap();
		assert_eq!(parse(&write(&changes)).unwrap(), changes);
		assert!(parse(r#"[{"op":"nope"}]"#).is_err());
	}
}
