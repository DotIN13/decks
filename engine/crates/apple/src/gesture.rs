//! A gesture in progress, as the web page shows one: the items it moves or resizes are lifted out of
//! the worker's tiles and drawn by the page at each step, moved and reshaped there only, with the
//! arrows joined to them bent. Nothing is saved, nothing goes into undo, no tile is painted again.
//! At the end the host takes the preview back, applies the final change once, and puts them down.

use crate::engine::Engine;
use serde_json::Value;
use stage_web::engine::Preview;
use std::collections::BTreeSet;

impl Engine {
	/// One step of a gesture: `[[id, { dx, dy, w?, h?, radius?, set? }], …]` (the web's
	/// `setPreview`), or `null` to take the preview back. Returns the ids lifted so far.
	pub fn preview(&mut self, json: &str) -> Result<Vec<String>, String> {
		let moving = parse_previews(json)?;
		let fresh = self.page.preview(moving)?;
		self.worker.lift(&fresh);
		self.lifted.extend(fresh);
		Ok(self.lifted.iter().cloned().collect())
	}

	/// Cards a drag carries (their paths), and how far, until the next call (`[]` ends it).
	pub fn carry(&mut self, json: &str, dx: f64, dy: f64) -> Result<(), String> {
		let paths: Vec<String> = serde_json::from_str(json).map_err(|e| format!("paths are not JSON: {e}"))?;
		self.page.carry = (paths.into_iter().collect(), dx, dy);
		Ok(())
	}

	/// Put down everything lifted: the worker paints them back into its tiles, and the page stops
	/// drawing them itself once those tiles have come (`land`, at each paint).
	pub fn put_down(&mut self) {
		let ids: Vec<String> = std::mem::take(&mut self.lifted).into_iter().collect();
		if !ids.is_empty() {
			self.worker.drop_items(&ids);
		}
	}

	/// Items whose tiles have come back since they were put down: no longer drawn by the page.
	pub(crate) fn land(&mut self) {
		let landed = self.worker.landed();
		if !landed.is_empty() {
			self.page.landed(&landed);
		}
	}
}

/// The web binding's preview list, read the same way (`stage-web`'s `bind.rs`, `previews`).
fn parse_previews(json: &str) -> Result<Option<Vec<(String, Preview)>>, String> {
	let value: Value = serde_json::from_str(json).map_err(|e| format!("the preview is not JSON: {e}"))?;
	if value.is_null() {
		return Ok(None);
	}
	let list: Vec<(String, Value)> = serde_json::from_value(value).map_err(|_| "a preview is [[id, { dx, dy, … }], …]")?;
	Ok(Some(list.into_iter().map(|(id, p)| (id, preview_of(&p))).collect()))
}

fn preview_of(p: &Value) -> Preview {
	let n = |k: &str| p.get(k).and_then(Value::as_f64);
	let mut set: Vec<(String, Option<Value>)> = Vec::new();
	if let Some(w) = n("w") {
		set.push(("width".into(), Some(w.into())));
	}
	if let Some(h) = n("h") {
		set.push(("height".into(), Some(h.into())));
	}
	match p.get("radius") {
		Some(Value::Null) => set.push(("cornerRadius".into(), None)),
		Some(r) if r.is_number() => set.push(("cornerRadius".into(), Some(r.clone()))),
		_ => {}
	}
	if let Some(Value::Object(fields)) = p.get("set") {
		for (k, v) in fields {
			set.push((k.clone(), if v.is_null() { None } else { Some(v.clone()) }));
		}
	}
	Preview { dx: n("dx").unwrap_or(0.0), dy: n("dy").unwrap_or(0.0), set }
}

/// The ids a gesture has lifted, in a steady order.
pub type Lifted = BTreeSet<String>;
