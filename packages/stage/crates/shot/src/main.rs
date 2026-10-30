//! `stage-shot`: the native stage picture, kept running by the server (`native-shots.ts`).
//!
//! One JSON request a line on stdin, one JSON answer a line on stdout, in order:
//!
//! ```text
//! { "id": 1, "doc": "<.pen text>", "dark": false, "box": [x1, y1, x2, y2], "scale": 1, "width": 800,
//!   "height": 600, "paper": [0.945, 0.945, 0.953], "cards": [{ "x", "y", "w", "h", "picture": "/abs.webp" }],
//!   "out": "/abs/out.png", "format": "png" | "jpeg", "quality": 90, "fontNeeds": true,
//!   "fonts": [{ "key", "family", "path", "fallback" }], "cards": [{ "dark", "source", "blocks" }],
//!   "pictures": [{ "url", "path" | null }], "icons": [{ "key", "shape" | null }] }
//! → { "id": 1, "ok": true, "fontNeeds": [...] }                       (when asked for them)
//! → { "id": 1, "ok": true, "needs": { cards, pictures, icons, math } } (hand these over and ask again)
//! → { "id": 1, "ok": true, "file": "/abs/out.png", "width", "height", "ms": { "layout", "paint", "read", "encode", "all" } }
//! → { "id": 1, "ok": false, "error": "…" }
//! ```
//!
//! Fonts, cards, pictures and icons are kept for every later request. The first line out is
//! `{ "ready": true }`, or `{ "ready": false, "error" }` when there is no graphics card to draw on.

use serde_json::{Value, json};
use stage_shot::{Font, Shooter, encode, request_of};
use std::io::{BufRead, Write};
use std::rc::Rc;

fn main() {
	let stdin = std::io::stdin();
	let mut stdout = std::io::stdout().lock();
	let Some(mut shooter) = Shooter::open() else {
		let _ = writeln!(stdout, "{}", json!({ "ready": false, "error": "no graphics card to draw on" }));
		return;
	};
	let _ = writeln!(stdout, "{}", json!({ "ready": true }));
	let _ = stdout.flush();
	for line in stdin.lock().lines() {
		let Ok(line) = line else { break };
		if line.trim().is_empty() {
			continue;
		}
		let answer = match serde_json::from_str::<Value>(&line) {
			Ok(v) => {
				let id = v.get("id").cloned().unwrap_or(Value::Null);
				let mut out = match handle(&mut shooter, &v) {
					Ok(value) => value,
					Err(error) => json!({ "ok": false, "error": error }),
				};
				out["id"] = id;
				out
			}
			Err(e) => json!({ "ok": false, "error": format!("not JSON: {e}") }),
		};
		if writeln!(stdout, "{answer}").is_err() || stdout.flush().is_err() {
			break;
		}
	}
}

fn handle(shooter: &mut Shooter, v: &Value) -> Result<Value, String> {
	let started = std::time::Instant::now();
	if v.get("op").and_then(Value::as_str) == Some("ping") {
		return Ok(json!({ "ok": true }));
	}
	let list = |k: &str| v.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
	for f in list("fonts") {
		let s = |k: &str| f.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
		let path = s("path");
		let bytes = std::fs::read(&path).map_err(|e| format!("font {path}: {e}"))?;
		shooter.add_font(Font { key: s("key"), family: s("family"), bytes: Rc::new(bytes), fallback: f.get("fallback").and_then(Value::as_bool).unwrap_or(false) });
	}
	for c in list("cards") {
		let dark = c.get("dark").and_then(Value::as_bool).unwrap_or(false);
		if let (Some(source), Some(blocks)) = (c.get("source").and_then(Value::as_str), c.get("blocks").and_then(Value::as_str)) {
			shooter.add_card(dark, source.to_owned(), blocks.to_owned());
		}
	}
	let mut problems = Vec::new();
	for p in list("pictures") {
		let url = p.get("url").and_then(Value::as_str).unwrap_or("");
		match p.get("path").and_then(Value::as_str).map(std::fs::read).transpose() {
			Ok(bytes) => {
				if let Err(e) = shooter.add_picture(url, bytes.as_deref()) {
					problems.push(e);
				}
			}
			Err(e) => {
				let _ = shooter.add_picture(url, None);
				problems.push(format!("{url}: {e}"));
			}
		}
	}
	for i in list("icons") {
		if let Some(key) = i.get("key").and_then(Value::as_str) {
			shooter.add_icon(key, i.get("shape").and_then(Value::as_str));
		}
	}
	let request = request_of(v)?;
	let mut answer = json!({ "ok": true });
	if !problems.is_empty() {
		answer["problems"] = json!(problems);
	}
	if v.get("fontNeeds").and_then(Value::as_bool) == Some(true) {
		answer["fontNeeds"] = shooter.font_needs(&request)?;
		return Ok(answer);
	}
	match shooter.shoot(&request)? {
		Err(needs) => answer["needs"] = needs.to_json(),
		Ok(picture) => {
			let at = std::time::Instant::now();
			let format = v.get("format").and_then(Value::as_str).unwrap_or("png");
			let quality = v.get("quality").and_then(Value::as_u64).unwrap_or(90).min(100) as u8;
			let bytes = encode(&picture, format, quality)?;
			let out = v.get("out").and_then(Value::as_str).ok_or("out is missing")?;
			std::fs::write(out, &bytes).map_err(|e| format!("{out}: {e}"))?;
			let [layout, paint, read] = picture.times;
			answer["file"] = json!(out);
			answer["width"] = json!(picture.width);
			answer["height"] = json!(picture.height);
			answer["ms"] = json!({ "layout": layout, "paint": paint, "read": read, "encode": at.elapsed().as_secs_f64() * 1000.0, "all": started.elapsed().as_secs_f64() * 1000.0 });
		}
	}
	Ok(answer)
}
