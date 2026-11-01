//! What a press, a hover or a marquee picks (`edit/core/pick.ts`). The scene says what is under a
//! point; this decides which of it the editor means.

use crate::model::{Corners, PageBox, Pt, Rect};
use crate::pen;
use crate::scene::{Props, Scene};

/// How far up a press climbs from the item it hit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Policy {
	/// What is under the pointer, the deepest item there; only what is one thing made of parts is climbed to.
	#[default]
	Exact,
	/// As `Exact`, and on to the outermost group round it.
	Outermost,
}

#[derive(Clone, Copy, Default)]
pub struct PickOptions<'a> {
	pub policy: Policy,
	/// The item itself, with no climb: a double-click reaching inside a group.
	pub deep: bool,
	/// Items to look through, as if they were not there.
	pub skip: Option<&'a dyn Fn(&str, &Props) -> bool>,
}

/// What a press found: the item and the box it covers.
#[derive(Clone, Debug, PartialEq)]
pub struct Picked {
	pub id: String,
	pub bounds: Rect,
}

fn contains(b: &Rect, p: Pt) -> bool {
	p.x >= b.x && p.x <= b.right() && p.y >= b.y && p.y <= b.bottom()
}

fn skipped(options: &PickOptions, id: &str, node: &Props) -> bool {
	options.skip.is_some_and(|skip| skip(id, node))
}

/// The topmost item a press lands on: never inside an instance, a group itself or a page. A line is
/// hit within the press's reach; anything else only inside what it draws.
fn top_at(scene: &dyn Scene, at: Pt, options: &PickOptions) -> Option<String> {
	for id in scene.under(at) {
		let Some(node) = scene.node(&id) else { continue };
		if pen::in_instance(&id) || pen::kind(node) == "group" || pen::is_page(node) || skipped(options, &id, node) {
			continue;
		}
		if pen::kind(node) == "path" {
			if scene.on_line(&id, at) == Some(false) {
				continue;
			}
		} else if !scene.bounds(&id).is_some_and(|b| contains(&b, at)) {
			continue;
		}
		return Some(id);
	}
	None
}

/// One thing made of parts: a press on a part picks it whole (a card, only from its markdown).
fn is_whole(up: &Props, hit: &Props) -> bool {
	pen::is_shape(up) || pen::is_file(up) || pen::is_live_file(up) || (pen::is_card(up) && pen::is_markdown_text(hit))
}

/// The topmost group drawn over `above` (its paint order) whose box holds the point: a press in its empty space.
fn group_gap_at(scene: &dyn Scene, at: Pt, above: Option<usize>, options: &PickOptions) -> Option<String> {
	let mut top = None;
	for (order, id) in scene.items().into_iter().enumerate() {
		if above.is_some_and(|above| order <= above) {
			continue;
		}
		let Some(node) = scene.node(&id) else { continue };
		if pen::kind(node) != "group" || pen::in_instance(&id) || skipped(options, &id, node) {
			continue;
		}
		if scene.bounds(&id).is_some_and(|b| contains(&b, at)) {
			top = Some(id);
		}
	}
	top
}

/// The item a press at a stage point picks. Boards are not found here.
pub fn pick_at(scene: &dyn Scene, at: Pt, options: PickOptions) -> Option<Picked> {
	let mut best = top_at(scene, at, &options);
	if options.policy == Policy::Exact {
		let order = best.as_ref().and_then(|id| scene.items().iter().position(|one| one == id));
		if let Some(group) = group_gap_at(scene, at, order, &options) {
			best = Some(group);
		}
	}
	let mut best = best?;
	if !options.deep {
		let hit = scene.node(&best).cloned().unwrap_or_default();
		let mut up = scene.parent(&best);
		while let Some(parent) = up {
			if let Some(node) = scene.node(&parent) {
				if (options.policy == Policy::Outermost && pen::kind(node) == "group") || is_whole(node, &hit) {
					best = parent.clone();
				}
			}
			up = scene.parent(&parent);
		}
	}
	let bounds = scene.bounds(&best)?;
	Some(Picked { id: best, bounds })
}

/// The item an item sits in that the editor can select: not a page, not inside an instance.
pub fn parent_of(scene: &dyn Scene, id: &str) -> Option<String> {
	let up = scene.parent(id)?;
	let node = scene.node(&up)?;
	(!pen::is_page(node) && !pen::in_instance(&up)).then_some(up)
}

/// What a group or a frame holds that the editor can select one by one; nothing for what is one thing.
pub fn children_of(scene: &dyn Scene, id: &str) -> Vec<String> {
	let Some(node) = scene.node(id) else { return Vec::new() };
	if pen::in_instance(id) || pen::is_page(node) || pen::is_shape(node) || pen::is_file(node) || pen::is_live_file(node) || pen::is_card(node) {
		return Vec::new();
	}
	if !matches!(pen::kind(node), "group" | "frame") {
		return Vec::new();
	}
	scene.children(id).into_iter().filter(|child| !pen::in_instance(child) && scene.node(child).is_some()).collect()
}

/// The text block of a card at a point: the one under it, or in the card's margin the one level with it (4 px either side).
pub fn block_at(scene: &dyn Scene, at: Pt, typing: Option<&str>) -> Option<String> {
	let deep = pick_at(scene, at, PickOptions { deep: true, ..Default::default() })?;
	let node = scene.node(&deep.id)?;
	let card = if pen::is_card(node) { Some(deep.id.clone()) } else { scene.parent(&deep.id).filter(|up| scene.node(up).is_some_and(pen::is_card)) }?;
	if typing == Some(card.as_str()) {
		return None;
	}
	if deep.id != card {
		return pen::is_markdown_text(node).then_some(deep.id);
	}
	scene.children(&card).into_iter().find(|child| {
		scene.node(child).is_some_and(pen::is_markdown_text) && scene.bounds(child).is_some_and(|b| at.y >= b.y - 4.0 && at.y <= b.bottom() + 4.0)
	})
}

/// The board whose picture is under a point and has no node of its own to take the press (not in `rendered`); the last in file order.
pub fn picture_at(boards: &[PageBox], at: Pt, rendered: &dyn Fn(&str) -> bool) -> Option<String> {
	boards.iter().filter(|b| !rendered(&b.path) && contains(&b.rect(), at)).next_back().map(|b| b.path.clone())
}

pub fn marquee_rect(m: &Corners) -> Rect {
	m.rect()
}

fn wholly(b: &Rect, r: &Rect) -> bool {
	b.x >= r.x && b.y >= r.y && b.right() <= r.right() && b.bottom() <= r.bottom()
}

/// Every item and board wholly inside a stage rectangle: a marquee. An item whose parent is picked too is left to its parent.
pub fn marquee_pick(scene: &dyn Scene, r: &Rect) -> (Vec<String>, Vec<String>) {
	let mut inside = Vec::new();
	for id in scene.items() {
		let Some(node) = scene.node(&id) else { continue };
		if pen::in_instance(&id) || pen::is_page(node) {
			continue;
		}
		if scene.parent(&id).and_then(|up| scene.node(&up).map(pen::is_shape)).unwrap_or(false) {
			continue;
		}
		if scene.bounds(&id).is_some_and(|b| wholly(&b, r)) {
			inside.push(id);
		}
	}
	let items = inside
		.iter()
		.filter(|id| {
			let mut up = scene.parent(id);
			while let Some(parent) = up {
				if inside.contains(&parent) {
					return false;
				}
				up = scene.parent(&parent);
			}
			true
		})
		.cloned()
		.collect();
	let boards = scene.boards().into_iter().filter(|b| wholly(&b.rect(), r)).map(|b| b.path).collect();
	(items, boards)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::scene::{Fake, FakeItem};
	use serde_json::json;

	fn scene() -> Fake {
		Fake::new(vec![
			FakeItem::rect("a", 0.0, 0.0, 100.0, 100.0),
			FakeItem::rect("b", 50.0, 50.0, 100.0, 100.0),
			FakeItem::rect("group", 300.0, 0.0, 300.0, 100.0).kind("group"),
			FakeItem::rect("g1", 300.0, 0.0, 80.0, 80.0).inside("group"),
			FakeItem::rect("g2", 500.0, 0.0, 80.0, 80.0).inside("group"),
			FakeItem::rect("card", 0.0, 400.0, 300.0, 200.0).kind("frame").set("metadata", json!({ "type": "decks.markdown-card" })),
			FakeItem::rect("block", 18.0, 418.0, 264.0, 40.0).kind("text").set("metadata", json!({ "type": "decks.markdown" })).inside("card"),
			FakeItem::rect("page", 700.0, 0.0, 300.0, 300.0).kind("browser").set("metadata", json!({ "type": "decks.card" })),
		])
	}

	#[test]
	fn a_press_picks_the_topmost_item_under_it_and_never_a_page() {
		let s = scene();
		assert_eq!(pick_at(&s, Pt::new(75.0, 75.0), Default::default()).map(|p| p.id), Some("b".into()));
		assert_eq!(pick_at(&s, Pt::new(10.0, 10.0), Default::default()).map(|p| p.id), Some("a".into()));
		assert_eq!(pick_at(&s, Pt::new(800.0, 100.0), Default::default()), None);
	}

	#[test]
	fn a_press_in_a_group_picks_the_item_itself_and_its_empty_space_the_group_or_the_outermost_group() {
		let s = scene();
		assert_eq!(pick_at(&s, Pt::new(310.0, 10.0), Default::default()).map(|p| p.id), Some("g1".into()));
		assert_eq!(pick_at(&s, Pt::new(450.0, 50.0), Default::default()).map(|p| p.id), Some("group".into()));
		assert_eq!(pick_at(&s, Pt::new(310.0, 10.0), PickOptions { policy: Policy::Outermost, ..Default::default() }).map(|p| p.id), Some("group".into()));
	}

	#[test]
	fn a_card_is_picked_whole_from_its_markdown_and_a_block_by_its_grip() {
		let s = scene();
		assert_eq!(pick_at(&s, Pt::new(30.0, 430.0), Default::default()).map(|p| p.id), Some("card".into()));
		assert_eq!(pick_at(&s, Pt::new(30.0, 430.0), PickOptions { deep: true, ..Default::default() }).map(|p| p.id), Some("block".into()));
		assert_eq!(block_at(&s, Pt::new(30.0, 430.0), None), Some("block".into()));
		assert_eq!(block_at(&s, Pt::new(30.0, 430.0), Some("card")), None, "not in the card open for typing");
	}

	#[test]
	fn a_marquee_picks_what_is_wholly_inside_and_leaves_children_to_their_picked_parent() {
		let s = scene().with_boards(vec![PageBox { path: "b.html".into(), x: 0.0, y: 700.0, w: 50.0, h: 50.0, least: None }]);
		let (items, boards) = marquee_pick(&s, &Rect { x: -10.0, y: -10.0, w: 700.0, h: 800.0 });
		assert!(items.contains(&"group".to_string()) && !items.contains(&"g1".to_string()));
		assert!(items.contains(&"card".to_string()) && !items.contains(&"block".to_string()));
		assert!(!items.contains(&"page".to_string()));
		assert_eq!(boards, vec!["b.html".to_string()]);
	}

	#[test]
	fn a_groups_children_are_selectable_one_by_one_and_a_cards_are_not() {
		let s = scene();
		assert_eq!(children_of(&s, "group"), vec!["g1".to_string(), "g2".to_string()]);
		assert!(children_of(&s, "card").is_empty());
		assert_eq!(parent_of(&s, "g1"), Some("group".into()));
	}
}
