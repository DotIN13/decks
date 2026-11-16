// A press with the select tool on the drawing, bare canvas or a page, and the selection it changes.
import { mediaOf } from "@decks/pen";
import type { EditorState } from "./model.ts";
import { pickAt, type Picked } from "./pick.ts";
import type { SceneQuery } from "./scene.ts";
import { type Effect, type GestureContext, type PointerInput, type Step, type Tap } from "./gesture.ts";
import { carry, done, isFree } from "./gesture-carry.ts";
import { withSelection } from "./gesture-ground.ts";

/** A press on the drawing or bare canvas, with the select tool. */
export function pressCanvas(state: EditorState, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
	const at = p.at;
	const selected = state.selection.items;
	// What is under the point (`pickAt`, "exact"), unless a double-click already selected a part of what is one thing there.
	const inner = pickAt(scene, at, { deep: true });
	const hit: Picked | undefined = inner && selected.includes(inner.id) ? inner : pickAt(scene, at);
	if (hit) {
		const effects: Effect[] = [{ do: "select-board" }];
		if (p.mods.shift) return done(withSelection(state, { items: selected.includes(hit.id) ? selected.filter((id) => id !== hit.id) : [...selected, hit.id] }), effects);
		const group = selected.includes(hit.id);
		const moving = group ? selected : [hit.id];
		const boards = group ? state.selection.boards : [];
		let next = group ? state : withSelection(state, { items: moving, boards: [] });
		next = { ...next, hover: { ...next.hover, item: undefined } };
		/*
		 * A link in a card: a click that does not move follows it, in a new tab. While browsing,
		 * any click; while editing, where a click is for selecting, one with ⌘ or Ctrl.
		 */
		const href = ctx.linkAt(at);
		const follows = href && (state.mode === "browse" || isFree(p.mods));
		// A film or a sound: a click that does not move plays it, or pauses it.
		const playable = inner && mediaOf(inner.node) ? inner : mediaOf(hit.node) ? hit : undefined;
		const media = playable ? mediaOf(playable.node) : undefined;
		const tap: Tap | undefined = follows ? { do: "open-link", href } : playable && media && !p.mods.shift ? { do: "media", id: playable.id, media } : undefined;
		const started = carry(next, scene, ctx, p, moving, boards, tap);
		return done(started.state, [...effects, started.effect]);
	}
	/*
	 * Bare canvas: a marquee, as in a design tool, picking the items and the boards wholly inside
	 * it as it goes. Shift adds to what is already selected.
	 */
	const adding = p.mods.shift;
	const kept = { items: adding ? selected : [], boards: adding ? state.selection.boards : [] };
	const next = adding ? state : withSelection(state, { items: [], boards: [] });
	return done({ ...next, marquee: { x1: at.x, y1: at.y, x2: at.x, y2: at.y }, gesture: { kind: "marquee", from: at, kept } }, [{ do: "select-board" }]);
}
/** A press on a board: Shift adds it to the picks or takes it out; otherwise it is carried with the selection it is part of, or alone. */
export function pressPage(state: EditorState, path: string, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
	const picks = state.selection.boards;
	if (p.mods.shift) return done(withSelection(state, { boards: picks.includes(path) ? picks.filter((one) => one !== path) : [...picks, path] }));
	const group = picks.includes(path);
	const next = group ? state : withSelection(state, { items: [], boards: [] });
	const started = carry(next, scene, ctx, p, group ? state.selection.items : [], group ? picks : [path]);
	return done(started.state, [{ do: "select-board", path }, started.effect]);
}

/** The boards picked up that are no longer on the canvas, let go. */
export function prunePages(state: EditorState, present: ReadonlySet<string>): EditorState {
	const picks = state.selection.boards;
	return picks.some((path) => !present.has(path)) ? withSelection(state, { boards: picks.filter((path) => present.has(path)) }) : state;
}
