//! Formulas in words: TeX between `$…$` (in a line) and `$$…$$` (set as a display formula), read as
//! Obsidian reads them, typeset by the app's MathJax (`math.ts`, handed in as a hook) into outlines
//! the painter fills like any shape. A formula sits in its line as an inline box its own size, on the
//! line's baseline.

use serde::Deserialize;

/// A formula typeset, in ems: its width, how far it rises above the baseline and falls below it,
/// and its outlines, each with its placement in ems (y down) and its colour (alpha below 0: the
/// words' own colour).
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Formula {
	pub width: f32,
	pub ascent: f32,
	pub descent: f32,
	pub paths: Vec<FormulaPath>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct FormulaPath {
	pub m: [f64; 6],
	pub rgba: [f32; 4],
	pub d: String,
}

/// A formula where layout put it: its left end and baseline from the paragraph's top-left, the size
/// of the words round it, and their colour.
#[derive(Clone, Debug)]
pub struct PlacedFormula {
	pub formula: std::rc::Rc<Formula>,
	pub x: f32,
	pub baseline: f32,
	pub size: f32,
	pub brush: u32,
}

/// Words cut into plain stretches and formulas: `(text, None)` for words, `(tex, Some(display))`
/// for a formula. "$5 and $10" stays money: an opening `$` is followed by something other than a
/// space, a closing one follows something other than a space and is not followed by a digit, and
/// `\$` is a dollar sign.
pub fn split(text: &str) -> Vec<(String, Option<bool>)> {
	let mut out: Vec<(String, Option<bool>)> = Vec::new();
	if !text.contains('$') {
		out.push((text.to_owned(), None));
		return out;
	}
	let chars: Vec<char> = text.chars().collect();
	let mut words = String::new();
	let mut i = 0;
	while i < chars.len() {
		let ch = chars[i];
		if ch == '\\' && chars.get(i + 1) == Some(&'$') {
			words.push('$');
			i += 2;
			continue;
		}
		if ch != '$' {
			words.push(ch);
			i += 1;
			continue;
		}
		let mut formula = None;
		if chars.get(i + 1) == Some(&'$') {
			if let Some(end) = find_pair(&chars, i + 2) {
				let tex: String = chars[i + 2..end].iter().collect::<String>().trim().to_owned();
				if !tex.is_empty() {
					formula = Some((tex, true, end + 2));
				}
			}
		} else if let Some(end) = closing(&chars, i + 1) {
			formula = Some((chars[i + 1..end].iter().collect(), false, end + 1));
		}
		match formula {
			Some((tex, display, next)) => {
				if !words.is_empty() {
					out.push((std::mem::take(&mut words), None));
				}
				out.push((tex, Some(display)));
				i = next;
			}
			None => {
				words.push(ch);
				i += 1;
			}
		}
	}
	if !words.is_empty() || out.is_empty() {
		out.push((words, None));
	}
	out
}

fn find_pair(chars: &[char], from: usize) -> Option<usize> {
	(from..chars.len().saturating_sub(1)).find(|&k| chars[k] == '$' && chars[k + 1] == '$')
}

/// Where the `$` closing an inline formula opened just before `from` is.
fn closing(chars: &[char], from: usize) -> Option<usize> {
	if from >= chars.len() || chars[from].is_whitespace() {
		return None;
	}
	let mut k = from + 1;
	while k < chars.len() {
		let c = chars[k];
		if c == '\n' {
			return None;
		}
		if c == '\\' {
			k += 2;
			continue;
		}
		if c == '$' && !chars[k - 1].is_whitespace() && !chars.get(k + 1).is_some_and(|n| n.is_ascii_digit()) {
			return Some(k);
		}
		k += 1;
	}
	None
}

#[cfg(test)]
mod tests {
	use super::split;

	#[test]
	fn reads_formulas_as_obsidian_does() {
		assert_eq!(split("plain"), vec![("plain".into(), None)]);
		assert_eq!(split("$5 and $10"), vec![("$5 and $10".into(), None)]);
		assert_eq!(split("area $\\pi r^2$ here"), vec![("area ".into(), None), ("\\pi r^2".into(), Some(false)), (" here".into(), None)]);
		assert_eq!(split("$$ x^2 $$"), vec![("x^2".into(), Some(true))]);
		assert_eq!(split("a \\$ b"), vec![("a $ b".into(), None)]);
	}
}
