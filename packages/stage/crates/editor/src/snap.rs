//! Snapping, the way a design tool does it (`edit/snap.ts`): a box being moved lines its edges and
//! its middle up with the edges and middles of what is around it, and settles into the gap its
//! neighbours already keep between themselves. The stage draws a guide wherever it snapped.
//!
//! Pure arithmetic on stage boxes. `threshold` is in stage units, which the caller works out from
//! the rules' `snap_px` and the zoom; the reading gap between boards is the rules' `reading_gap`.

use crate::model::{Corners, Guide, GuideKind, Pt, Rect};
use crate::rules::Rules;
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Axis {
	X,
	Y,
}

impl Axis {
	fn cross(self) -> Axis {
		match self {
			Axis::X => Axis::Y,
			Axis::Y => Axis::X,
		}
	}
}

/// How near two lines are to count as the same.
const EPS: f64 = 0.5;

fn lines(b: &Rect, axis: Axis) -> [f64; 3] {
	match axis {
		Axis::X => [b.x, b.x + b.w / 2.0, b.x + b.w],
		Axis::Y => [b.y, b.y + b.h / 2.0, b.y + b.h],
	}
}
fn start(b: &Rect, axis: Axis) -> f64 {
	match axis {
		Axis::X => b.x,
		Axis::Y => b.y,
	}
}
fn end(b: &Rect, axis: Axis) -> f64 {
	match axis {
		Axis::X => b.x + b.w,
		Axis::Y => b.y + b.h,
	}
}
fn size(b: &Rect, axis: Axis) -> f64 {
	match axis {
		Axis::X => b.w,
		Axis::Y => b.h,
	}
}
/// Whether two boxes share some of the other axis: side by side for `X`, one above the other for `Y`.
fn overlaps(a: &Rect, b: &Rect, axis: Axis) -> bool {
	let other = axis.cross();
	start(a, other) < end(b, other) && start(b, other) < end(a, other)
}

/// A line along `axis` at `at`, from `lo` to `hi` on the other axis.
fn line(axis: Axis, at: f64, lo: f64, hi: f64, points: Vec<Pt>) -> Guide {
	let (x1, y1, x2, y2) = match axis {
		Axis::X => (at, lo, at, hi),
		Axis::Y => (lo, at, hi, at),
	};
	Guide { kind: GuideKind::Line, x1, y1, x2, y2, points, label: None }
}

/// A gap drawn across `axis` from `from` to `to`, level with `mid` on the other axis.
fn gap(axis: Axis, from: f64, to: f64, mid: f64) -> Guide {
	let (x1, y1, x2, y2) = match axis {
		Axis::X => (from, mid, to, mid),
		Axis::Y => (mid, from, mid, to),
	};
	Guide { kind: GuideKind::Gap, x1, y1, x2, y2, points: Vec::new(), label: None }
}

/// `Math.round`: a half goes up, not away from zero.
fn js_round(v: f64) -> f64 {
	let r = v.round();
	if v - r == 0.5 {
		r + 1.0
	} else {
		r
	}
}

/// The smallest correction along one axis that lines `moving` up with a target, an equal gap, or the reading gap from a board.
fn best_shift(moving: &Rect, targets: &[Rect], axis: Axis, threshold: f64, reading: &[Rect], reading_gap: f64) -> Option<f64> {
	let mut best: Option<f64> = None;
	let mut offer = |shift: f64| {
		if shift.abs() <= threshold && best.is_none_or(|b| shift.abs() < b.abs()) {
			best = Some(shift);
		}
	};
	for board in reading {
		offer(end(board, axis) + reading_gap - start(moving, axis));
		offer(start(board, axis) - reading_gap - end(moving, axis));
	}
	let mine = lines(moving, axis);
	for target in targets {
		for t in lines(target, axis) {
			for m in mine {
				offer(t - m);
			}
		}
	}
	// Equal gaps: beside a pair keeping a gap, or centred between two.
	let row: Vec<&Rect> = targets.iter().filter(|t| overlaps(t, moving, axis)).collect();
	for (i, a) in row.iter().enumerate() {
		for (j, b) in row.iter().enumerate() {
			if i == j || end(a, axis) > start(b, axis) {
				continue;
			}
			let kept = start(b, axis) - end(a, axis);
			offer(end(b, axis) + kept - start(moving, axis));
			offer(start(a, axis) - kept - end(moving, axis));
			let room = start(b, axis) - end(a, axis) - size(moving, axis);
			if room >= 0.0 {
				offer(end(a, axis) + room / 2.0 - start(moving, axis));
			}
		}
	}
	best
}

/// The guides that hold for a box already in place: every line it shares and every gap it repeats.
fn guides_for(moving: &Rect, targets: &[Rect], axis: Axis) -> Vec<Guide> {
	let mut out = Vec::new();
	let other = axis.cross();
	for m in lines(moving, axis) {
		let hits: Vec<Rect> = targets.iter().filter(|t| lines(t, axis).iter().any(|v| (v - m).abs() < EPS)).copied().collect();
		if hits.is_empty() {
			continue;
		}
		let lo = hits.iter().map(|t| start(t, other)).fold(start(moving, other), f64::min);
		let hi = hits.iter().map(|t| end(t, other)).fold(end(moving, other), f64::max);
		let mut boxes = vec![*moving];
		boxes.extend(hits);
		out.push(line(axis, m, lo, hi, points_on(m, &boxes, axis)));
	}
	let row: Vec<&Rect> = targets.iter().filter(|t| overlaps(t, moving, axis)).collect();
	let gap_line = |from: f64, to: f64, a: &Rect, b: &Rect| gap(axis, from, to, (start(a, other).max(start(b, other)) + end(a, other).min(end(b, other))) / 2.0);
	// The nearest neighbour before it and after it, the first of equals.
	let mut before: Option<&Rect> = None;
	let mut after: Option<&Rect> = None;
	for &t in &row {
		if end(t, axis) <= start(moving, axis) + EPS && before.is_none_or(|b| end(t, axis) > end(b, axis)) {
			before = Some(t);
		}
		if start(t, axis) >= end(moving, axis) - EPS && after.is_none_or(|a| start(t, axis) < start(a, axis)) {
			after = Some(t);
		}
	}
	let gap_before = before.map(|b| start(moving, axis) - end(b, axis));
	let gap_after = after.map(|a| start(a, axis) - end(moving, axis));
	// Centred between two neighbours.
	if let (Some(b), Some(a), Some(gb), Some(ga)) = (before, after, gap_before, gap_after) {
		if gb > EPS && (gb - ga).abs() < EPS {
			out.push(gap_line(end(b, axis), start(moving, axis), b, moving));
			out.push(gap_line(end(moving, axis), start(a, axis), moving, a));
			return out;
		}
	}
	// Repeating a gap two others keep: the pair's gap and the new one.
	for (near, kept, before_it) in [(before, gap_before, true), (after, gap_after, false)] {
		let (Some(near), Some(kept)) = (near, kept) else { continue };
		if kept <= EPS {
			continue;
		}
		let far = row.iter().copied().find(|t| {
			!std::ptr::eq(*t, near) && if before_it { (start(near, axis) - end(t, axis) - kept).abs() < EPS } else { (start(t, axis) - end(near, axis) - kept).abs() < EPS }
		});
		let Some(far) = far else { continue };
		if before_it {
			out.push(gap_line(end(far, axis), start(near, axis), far, near));
			out.push(gap_line(end(near, axis), start(moving, axis), near, moving));
		} else {
			out.push(gap_line(end(moving, axis), start(near, axis), moving, near));
			out.push(gap_line(end(near, axis), start(far, axis), near, far));
		}
	}
	out
}

/// The points on an alignment at `at` that line up: each box's edges and middle along the line,
/// where the box has an edge or its middle on it. Each is marked with a ✕.
fn points_on(at: f64, boxes: &[Rect], axis: Axis) -> Vec<Pt> {
	let other = axis.cross();
	let mut out = Vec::new();
	let mut seen = HashSet::new();
	for b in boxes {
		if !lines(b, axis).iter().any(|v| (v - at).abs() < EPS) {
			continue;
		}
		for v in lines(b, other) {
			let point = match axis {
				Axis::X => Pt::new(at, v),
				Axis::Y => Pt::new(v, at),
			};
			if seen.insert((js_round(point.x * 100.0) as i64, js_round(point.y * 100.0) as i64)) {
				out.push(point);
			}
		}
	}
	out
}

/// The reading gaps a board in place keeps: `reading_gap` from another board beside it, above it or
/// below it, drawn across the gap with its size. Level with the middle of what the two share, or with
/// the moving board's middle when they share nothing.
fn reading_guides(moving: &Rect, boards: &[Rect], reading_gap: f64) -> Vec<Guide> {
	let mut out = Vec::new();
	for board in boards {
		for axis in [Axis::X, Axis::Y] {
			let other = axis.cross();
			let after = (start(moving, axis) - end(board, axis) - reading_gap).abs() < EPS;
			let before = (start(board, axis) - end(moving, axis) - reading_gap).abs() < EPS;
			if !after && !before {
				continue;
			}
			let (from, to) = if after { (end(board, axis), start(moving, axis)) } else { (end(moving, axis), start(board, axis)) };
			let mid = if overlaps(moving, board, axis) {
				(start(moving, other).max(start(board, other)) + end(moving, other).min(end(board, other))) / 2.0
			} else {
				start(moving, other) + size(moving, other) / 2.0
			};
			let mut drawn = gap(axis, from, to, mid);
			drawn.label = Some(format!("{reading_gap}"));
			out.push(drawn);
		}
	}
	out
}

/// A move snapped: the correction to add to it, and the guides to draw where it lands.
#[derive(Clone, Debug, PartialEq)]
pub struct Snapped {
	pub dx: f64,
	pub dy: f64,
	pub guides: Vec<Guide>,
}

/// Snap a moved box: the correction to add to the move, and the guides to draw where it lands.
/// `reading` are boards the box keeps the rules' reading gap from (a board being dragged: the other boards).
pub fn snap_move(moving: &Rect, targets: &[Rect], threshold: f64, reading: &[Rect], rules: &Rules) -> Snapped {
	let dx = best_shift(moving, targets, Axis::X, threshold, reading, rules.reading_gap).unwrap_or(0.0);
	let dy = best_shift(moving, targets, Axis::Y, threshold, reading, rules.reading_gap).unwrap_or(0.0);
	let placed = Rect { x: moving.x + dx, y: moving.y + dy, ..*moving };
	let mut guides = guides_for(&placed, targets, Axis::X);
	guides.extend(guides_for(&placed, targets, Axis::Y));
	guides.extend(reading_guides(&placed, reading, rules.reading_gap));
	Snapped { dx, dy, guides }
}

/// An edge of a box a resize moves: `X1` left, `X2` right, `Y1` top, `Y2` bottom.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
	X1,
	X2,
	Y1,
	Y2,
}

impl Edge {
	fn axis(self) -> Axis {
		match self {
			Edge::X1 | Edge::X2 => Axis::X,
			Edge::Y1 | Edge::Y2 => Axis::Y,
		}
	}
	/// Where the edge is, in a box given by its corners.
	pub fn of(self, c: &Corners) -> f64 {
		match self {
			Edge::X1 => c.x1,
			Edge::X2 => c.x2,
			Edge::Y1 => c.y1,
			Edge::Y2 => c.y2,
		}
	}
	/// Move the edge, in a box given by its corners.
	pub fn put(self, c: &mut Corners, v: f64) {
		match self {
			Edge::X1 => c.x1 = v,
			Edge::X2 => c.x2 = v,
			Edge::Y1 => c.y1 = v,
			Edge::Y2 => c.y2 = v,
		}
	}
}

/// A resize's edges snapped: the box with them moved, and a guide for every edge that snapped.
#[derive(Clone, Debug, PartialEq)]
pub struct SnappedEdges {
	pub area: Corners,
	pub guides: Vec<Guide>,
}

/// Snap the edges a resize is moving. Each of `edges` is pulled to the nearest line of a target on its
/// own, within `threshold`. Returns the box with the edges moved, and a guide for every edge that snapped.
pub fn snap_edges(area: &Corners, edges: &[Edge], targets: &[Rect], threshold: f64) -> SnappedEdges {
	let mut out = *area;
	let mut guides = Vec::new();
	for &edge in edges {
		let axis = edge.axis();
		let now = edge.of(&out);
		let mut best: Option<(f64, &Rect)> = None;
		for target in targets {
			for t in lines(target, axis) {
				let d = (t - now).abs();
				if d <= threshold && best.is_none_or(|(v, _)| d < (v - now).abs()) {
					best = Some((t, target));
				}
			}
		}
		let Some((value, target)) = best else { continue };
		edge.put(&mut out, value);
		let edged = out.rect();
		let other = axis.cross();
		let lo = start(&edged, other).min(start(target, other));
		let hi = end(&edged, other).max(end(target, other));
		guides.push(line(axis, value, lo, hi, points_on(value, &[edged, *target], axis)));
	}
	SnappedEdges { area: out, guides }
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::rules::Form;

	fn r(x: f64, y: f64, w: f64, h: f64) -> Rect {
		Rect { x, y, w, h }
	}
	fn desk() -> Rules {
		Rules::desk()
	}
	fn gaps(got: &Snapped) -> Vec<(f64, f64)> {
		got.guides.iter().filter(|g| g.kind == GuideKind::Gap).map(|g| (g.x1, g.x2)).collect()
	}

	#[test]
	fn a_box_three_px_off_a_neighbours_left_edge_snaps_onto_it_and_draws_the_line_down_both() {
		let got = snap_move(&r(3.0, 200.0, 80.0, 40.0), &[r(0.0, 0.0, 100.0, 50.0)], 6.0, &[], &desk());
		assert_eq!((got.dx, got.dy), (-3.0, 0.0));
		assert!(got.guides.iter().any(|g| g.kind == GuideKind::Line && g.x1 == 0.0 && g.x2 == 0.0 && g.y1 == 0.0 && g.y2 == 240.0));
	}

	#[test]
	fn nothing_within_the_threshold_is_no_snap_and_no_guide() {
		let got = snap_move(&r(30.0, 200.0, 80.0, 40.0), &[r(0.0, 0.0, 100.0, 50.0)], 6.0, &[], &desk());
		assert_eq!((got.dx, got.dy, got.guides.len()), (0.0, 0.0, 0));
	}

	#[test]
	fn the_nearest_line_wins_when_two_are_within_reach() {
		// Its left edge is 4 from one box's right edge, and 2 from the other's left.
		let got = snap_move(&r(104.0, 300.0, 40.0, 40.0), &[r(0.0, 0.0, 100.0, 50.0), r(102.0, 100.0, 40.0, 10.0)], 6.0, &[], &desk());
		assert_eq!(got.dx, -2.0);
	}

	#[test]
	fn a_box_settles_after_a_pair_at_the_gap_they_keep_with_both_gaps_drawn() {
		let (a, b) = (r(0.0, 0.0, 100.0, 50.0), r(140.0, 0.0, 100.0, 50.0));
		let got = snap_move(&r(284.0, 10.0, 60.0, 30.0), &[a, b], 6.0, &[], &desk());
		assert_eq!(got.dx, -4.0);
		assert_eq!(gaps(&got), vec![(100.0, 140.0), (240.0, 280.0)]);
	}

	#[test]
	fn a_box_settles_before_a_pair_at_the_gap_they_keep() {
		let (a, b) = (r(200.0, 0.0, 100.0, 50.0), r(340.0, 0.0, 100.0, 50.0));
		// A 60-wide box ending 40 before a: at 100.
		let got = snap_move(&r(102.0, 10.0, 60.0, 30.0), &[a, b], 6.0, &[], &desk());
		assert_eq!(got.dx, -2.0);
		assert_eq!(gaps(&got), vec![(160.0, 200.0), (300.0, 340.0)]);
	}

	#[test]
	fn a_box_centres_between_two_neighbours_and_both_halves_are_drawn_level_with_what_they_share() {
		let (a, c) = (r(0.0, 0.0, 100.0, 50.0), r(300.0, 0.0, 100.0, 50.0));
		let got = snap_move(&r(173.0, 10.0, 60.0, 30.0), &[a, c], 6.0, &[], &desk());
		assert_eq!(got.dx, -3.0);
		assert_eq!(gaps(&got), vec![(100.0, 170.0), (230.0, 300.0)]);
		assert!(got.guides.iter().filter(|g| g.kind == GuideKind::Gap).all(|g| g.y1 == 25.0));
	}

	#[test]
	fn an_alignment_marks_each_boxs_corners_and_middle_on_the_line_once() {
		let got = snap_move(&r(3.0, 200.0, 80.0, 40.0), &[r(0.0, 0.0, 100.0, 50.0)], 5.0, &[], &desk());
		let left = got.guides.iter().find(|g| g.kind == GuideKind::Line && g.x1 == 0.0 && g.x2 == 0.0).unwrap();
		assert_eq!(left.points.iter().map(|p| p.y).collect::<Vec<_>>(), vec![200.0, 220.0, 240.0, 0.0, 25.0, 50.0]);
		assert!(left.points.iter().all(|p| p.x == 0.0));
	}

	#[test]
	fn a_board_three_short_of_the_reading_gap_beside_another_settles_at_it_with_its_size_written() {
		let board = r(0.0, 0.0, 400.0, 300.0);
		let got = snap_move(&r(557.0, 40.0, 400.0, 300.0), &[], 5.0, &[board], &desk());
		assert_eq!(got.dx, 3.0);
		assert_eq!(got.guides, vec![Guide { kind: GuideKind::Gap, x1: 400.0, y1: 170.0, x2: 560.0, y2: 170.0, points: vec![], label: Some("160".into()) }]);
	}

	#[test]
	fn a_board_four_past_the_reading_gap_above_another_settles_with_its_bottom_that_far_over_its_top() {
		let board = r(0.0, 0.0, 400.0, 300.0);
		let got = snap_move(&r(0.0, -464.0, 400.0, 300.0), &[], 5.0, &[board], &desk());
		assert_eq!(got.dy, 4.0);
		let label = got.guides.iter().find(|g| g.label.is_some()).unwrap();
		assert_eq!((label.x1, label.y1, label.x2, label.y2), (200.0, -160.0, 200.0, 0.0));
	}

	#[test]
	fn a_board_further_than_the_threshold_from_the_reading_gap_keeps_where_it_is() {
		let got = snap_move(&r(570.0, 40.0, 400.0, 300.0), &[], 5.0, &[r(0.0, 0.0, 400.0, 300.0)], &desk());
		assert_eq!((got.dx, got.guides.len()), (0.0, 0));
	}

	#[test]
	fn the_reading_gap_and_the_snap_reach_are_the_rules_on_every_form() {
		let board = r(0.0, 0.0, 400.0, 300.0);
		for form in Form::ALL {
			let rules = Rules::for_form(form);
			let (gap, reach) = (rules.reading_gap, rules.snap_px);
			let near = snap_move(&r(400.0 + gap - reach, 40.0, 400.0, 300.0), &[], reach, &[board], &rules);
			assert_eq!(near.dx, reach, "{form:?}");
			assert_eq!(near.guides[0].label.as_deref(), Some(format!("{gap}").as_str()), "{form:?}");
			let far = snap_move(&r(400.0 + gap - reach - 1.0, 40.0, 400.0, 300.0), &[], reach, &[board], &rules);
			assert_eq!(far.dx, 0.0, "{form:?}");
		}
	}

	#[test]
	fn a_resize_pulls_only_the_edges_it_moves() {
		let got = snap_edges(&Corners { x1: 10.0, y1: 10.0, x2: 97.0, y2: 60.0 }, &[Edge::X2], &[r(0.0, 200.0, 100.0, 50.0)], 6.0);
		assert_eq!(got.area, Corners { x1: 10.0, y1: 10.0, x2: 100.0, y2: 60.0 });
		assert_eq!(got.guides.len(), 1);
		assert_eq!((got.guides[0].x1, got.guides[0].y1, got.guides[0].x2, got.guides[0].y2), (100.0, 10.0, 100.0, 250.0));
	}

	#[test]
	fn an_edge_out_of_reach_of_every_line_stays_and_draws_nothing() {
		let got = snap_edges(&Corners { x1: 10.0, y1: 10.0, x2: 90.0, y2: 60.0 }, &[Edge::X2, Edge::Y2], &[r(0.0, 200.0, 100.0, 50.0)], 6.0);
		assert_eq!(got.area, Corners { x1: 10.0, y1: 10.0, x2: 90.0, y2: 60.0 });
		assert!(got.guides.is_empty());
	}
}
