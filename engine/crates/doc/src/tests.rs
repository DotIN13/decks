use super::*;
use serde_json::json;

fn doc(value: Value) -> Document {
	Document::from_json(value).expect("a valid document")
}

fn props(value: Value) -> Props {
	match value {
		Value::Object(map) => map,
		_ => panic!("props are an object"),
	}
}

#[test]
fn round_trip_keeps_order_and_unknown_fields() {
	let text = r#"{
  "version": "2.14",
  "children": [
    {
      "type": "frame",
      "id": "a",
      "children": [
        {
          "type": "text",
          "id": "b",
          "content": "hi",
          "made-up": {
            "z": 1,
            "a": [
              2
            ]
          }
        }
      ],
      "x": 10
    },
    {
      "type": "group",
      "id": "c",
      "children": []
    }
  ],
  "variables": {}
}
"#;
	let d = Document::parse(text).unwrap();
	assert_eq!(d.to_text(), text);
	assert_eq!(d.len(), 3);
}

#[test]
fn rejects_bad_files() {
	assert!(Document::parse("[]").is_err());
	assert!(Document::parse(r#"{"children":[{"id":"a"}]}"#).is_err());
	assert!(Document::parse(r#"{"children":[{"type":"x","id":"a"},{"type":"x","id":"a"}]}"#).is_err());
	assert!(Document::parse(r#"{"children":[{"type":"x","id":"a/b"}]}"#).is_err());
}

#[test]
fn changes_apply_and_undo() {
	let mut d = doc(json!({"version":"2.14","children":[{"type":"frame","id":"f","children":[]},{"type":"rectangle","id":"r","x":1}]}));
	let before = d.to_text();
	let f = d.handle("f").unwrap();
	let pos = d.pos_last(Some(f));
	let applied = d
		.apply(&[
			Change::Set { id: "r".into(), key: "x".into(), value: Some(json!(5)) },
			Change::Insert { id: "n".into(), parent: Some("f".into()), pos, props: props(json!({"type":"ellipse","width":4})), list: false },
			Change::Place { id: "r".into(), parent: Some("f".into()), pos: d.pos_last(Some(f)) + "V" },
			Change::SetMeta { key: "themes".into(), value: Some(json!({"Mode":["Light","Dark"]})) },
		])
		.unwrap();
	assert!(applied.reshaped && applied.meta);
	assert_eq!(d.generation, 1);
	let after = d.to_json();
	assert_eq!(after["children"][0]["children"][0]["id"], "n");
	assert_eq!(after["children"][0]["children"][1]["x"], 5);
	d.apply(&applied.undo).unwrap();
	assert_eq!(d.to_text(), before);
}

#[test]
fn a_failing_batch_changes_nothing() {
	let mut d = doc(json!({"children":[{"type":"frame","id":"f","children":[{"type":"text","id":"t"}]}]}));
	let before = d.to_text();
	let result = d.apply(&[Change::Set { id: "t".into(), key: "content".into(), value: Some(json!("x")) }, Change::Remove { id: "nope".into() }]);
	assert!(result.is_err());
	assert_eq!(d.to_text(), before);
	assert_eq!(d.generation, 0);
}

#[test]
fn an_item_cannot_go_inside_itself() {
	let mut d = doc(json!({"children":[{"type":"frame","id":"f","children":[{"type":"frame","id":"g","children":[]}]}]}));
	let g = d.handle("g").unwrap();
	let pos = d.pos_last(Some(g));
	assert!(d.apply(&[Change::Place { id: "f".into(), parent: Some("g".into()), pos }]).is_err());
}

#[test]
fn remove_undoes_the_whole_subtree() {
	let text = serde_json::to_string_pretty(&json!({"version":"2.14","children":[{"type":"frame","id":"f","children":[{"type":"frame","id":"g","children":[{"type":"text","id":"t","content":"x"}]},{"type":"rectangle","id":"r"}]}]})).unwrap() + "\n";
	let mut d = Document::parse(&text).unwrap();
	let applied = d.apply(&[Change::Remove { id: "f".into() }]).unwrap();
	assert!(d.is_empty());
	d.apply(&applied.undo).unwrap();
	assert_eq!(d.to_text(), text);
}

#[test]
fn history_undoes_only_its_own_batches() {
	let mut d = doc(json!({"children":[{"type":"rectangle","id":"r","x":0}]}));
	let mut mine = History::default();
	let a = d.apply(&[Change::Set { id: "r".into(), key: "x".into(), value: Some(json!(1)) }]).unwrap();
	mine.record(&a);
	// Someone else's change, not recorded here.
	d.apply(&[Change::Set { id: "r".into(), key: "y".into(), value: Some(json!(9)) }]).unwrap();
	mine.undo(&mut d).unwrap();
	assert_eq!(d.get("r").unwrap().get("x"), Some(&json!(0)));
	assert_eq!(d.get("r").unwrap().get("y"), Some(&json!(9)));
	mine.redo(&mut d).unwrap();
	assert_eq!(d.get("r").unwrap().get("x"), Some(&json!(1)));
}

#[test]
fn ids_are_fresh() {
	let d = doc(json!({"children":[{"type":"rectangle","id":"s1"}]}));
	let mut ids = Ids::new("s");
	assert_eq!(ids.next(&d), "s2");
}

/// Every stage saved in the decks on this machine reads and writes back byte for byte.
#[test]
fn real_stages_round_trip() {
	let Ok(root) = std::env::var("STAGE_FIXTURES") else {
		return;
	};
	let mut count = 0;
	for entry in walk_files(std::path::Path::new(&root)) {
		if entry.extension().is_none_or(|e| e != "pen") {
			continue;
		}
		let text = std::fs::read_to_string(&entry).unwrap();
		let Ok(d) = Document::parse(&text) else {
			continue;
		};
		// JSON.stringify writes whole numbers without a point; files are compared as values.
		let original: Value = serde_json::from_str(&text).unwrap();
		assert_eq!(d.to_json(), original, "{}", entry.display());
		count += 1;
	}
	eprintln!("{count} stages round-tripped");
}

fn walk_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
	let mut out = Vec::new();
	if let Ok(read) = std::fs::read_dir(dir) {
		for entry in read.flatten() {
			let path = entry.path();
			if path.is_dir() {
				out.extend(walk_files(&path));
			} else {
				out.push(path);
			}
		}
	}
	out
}
