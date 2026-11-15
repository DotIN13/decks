//! Fractional indexes: an item's place among its siblings, as a string that sorts.
//!
//! A child's place is one of its own properties rather than its slot in the parent's list, as in
//! Figma's document: inserting between two siblings makes a key between theirs and renumbers no
//! one, so two people inserting at once never fight over indexes. The server's order settles ties.
//!
//! A key is a run of base-62 digits read as a fraction after the point (`"V"` is 31/62), never
//! ending in the zero digit, so plain byte order is numeric order. Keys only live in memory and in
//! change messages: the saved `.pen` keeps children as an array, in key order.

const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE: usize = 62;

fn digit(byte: u8) -> usize {
	match byte {
		b'0'..=b'9' => (byte - b'0') as usize,
		b'A'..=b'Z' => (byte - b'A') as usize + 10,
		b'a'..=b'z' => (byte - b'a') as usize + 36,
		_ => 0,
	}
}

/// Whether `key` is a valid key: base-62 digits, not empty, not ending in `0`.
pub fn valid(key: &str) -> bool {
	!key.is_empty() && key.bytes().all(|b| b.is_ascii_alphanumeric()) && !key.ends_with('0')
}

/// A key strictly between `a` and `b`: `None` for `a` is the start, `None` for `b` the end.
///
/// Panics when `a >= b`, which is a caller's bug: siblings never share a key.
pub fn between(a: Option<&str>, b: Option<&str>) -> String {
	let a = a.unwrap_or("");
	if let Some(b) = b {
		assert!(a < b, "fractional index: {a:?} is not before {b:?}");
	}
	let mut out = Vec::new();
	midpoint(a.as_bytes(), b.map(str::as_bytes), &mut out);
	String::from_utf8(out).expect("digits are ASCII")
}

fn midpoint(a: &[u8], b: Option<&[u8]>, out: &mut Vec<u8>) {
	if let Some(b) = b {
		// The common prefix stays; the midpoint is found after it.
		let mut n = 0;
		while n < b.len() && a.get(n).copied().unwrap_or(b'0') == b[n] {
			n += 1;
		}
		if n > 0 {
			out.extend_from_slice(&b[..n]);
			let rest_a = if n < a.len() { &a[n..] } else { &[] };
			return midpoint(rest_a, Some(&b[n..]), out);
		}
	}
	let da = a.first().map_or(0, |&c| digit(c));
	let db = b.and_then(|b| b.first()).map_or(BASE, |&c| digit(c));
	if db - da > 1 {
		out.push(DIGITS[(da + db) / 2]);
	} else if let Some(b) = b.filter(|b| b.len() > 1) {
		// `b` goes on past its first digit, so that digit alone sorts before it and after `a`.
		out.push(b[0]);
	} else {
		out.push(DIGITS[da]);
		midpoint(if a.len() > 1 { &a[1..] } else { &[] }, None, out);
	}
}

/// `n` keys in order, evenly spread and as short as they can be: for a list read from a file.
pub fn spread(n: usize) -> Vec<String> {
	if n == 0 {
		return Vec::new();
	}
	let mut width = 1;
	let mut room = BASE as u128;
	while room <= n as u128 {
		width += 1;
		room *= BASE as u128;
	}
	(0..n)
		.map(|i| {
			let mut value = (i as u128 + 1) * room / (n as u128 + 1);
			let mut digits = vec![b'0'; width];
			for slot in digits.iter_mut().rev() {
				*slot = DIGITS[(value % BASE as u128) as usize];
				value /= BASE as u128;
			}
			while digits.last() == Some(&b'0') {
				digits.pop();
			}
			String::from_utf8(digits).expect("digits are ASCII")
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn between_sorts() {
		let first = between(None, None);
		let after = between(Some(&first), None);
		let before = between(None, Some(&first));
		let middle = between(Some(&first), Some(&after));
		assert!(before < first && first < middle && middle < after);
		for key in [&first, &after, &before, &middle] {
			assert!(valid(key), "{key}");
		}
	}

	#[test]
	fn adjacent_keys_grow_a_digit() {
		let key = between(Some("a"), Some("b"));
		assert!("a" < key.as_str() && key.as_str() < "b");
		let key = between(Some("a1"), Some("a2"));
		assert!("a1" < key.as_str() && key.as_str() < "a2", "{key}");
	}

	#[test]
	fn many_inserts_stay_ordered() {
		// Always inserting just after the first item is the worst case for length.
		let mut keys = vec![between(None, None)];
		let mut last = between(Some(&keys[0]), None);
		for _ in 0..500 {
			let key = between(Some(&keys[0]), Some(&last));
			assert!(valid(&key));
			assert!(keys[0] < key && key < last);
			last = key.clone();
			keys.push(key);
		}
		// Each insert halves the gap: about one digit per six inserts, which is the nature of the scheme.
		assert!(last.len() <= 110, "{}", last.len());
	}

	#[test]
	fn spread_is_ordered_and_valid() {
		for n in [1, 2, 61, 62, 63, 1000, 5000] {
			let keys = spread(n);
			assert_eq!(keys.len(), n);
			assert!(keys.windows(2).all(|w| w[0] < w[1]), "n={n}");
			assert!(keys.iter().all(|k| valid(k)), "n={n}");
		}
	}
}
