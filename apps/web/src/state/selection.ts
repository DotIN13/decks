import { createSignal } from "solid-js";
import type { Mark } from "../canvas/annotations.ts";
import type { CanvasMode, Tool } from "../canvas/Editor.ts";

/**
 * What is selected, what tool is in hand, and which mode the canvas is in.
 *
 * Layer 0 of the state split: this module imports nothing from the others, and several of
 * them import it. It is the smallest of the three at the bottom of the graph, which is why
 * it goes first — the pattern it sets is the one the other twelve follow.
 *
 * **A factory and a singleton, not a bare singleton.** `createSelection()` is what a test
 * calls to get its own; `selection` is the one the app uses. That is the shape opencode uses
 * for `createServerSession`, and the reason that store has a test file at all — module state
 * that can only exist once is module state no test can set up.
 *
 * Nothing here needs an owner: signals work at module scope, and only `onMount`,
 * `onCleanup` and `createEffect` require a component to hang from. Those stay in `App.tsx`,
 * where they belong.
 */
function createSelection() {
	/** The selected board, by path. */
	const [selected, setSelected] = createSignal<string | undefined>(undefined);

	const [tool, setTool] = createSignal<Tool>("select");

	/**
	 * Browse or edit, and **browse is where every session starts**.
	 *
	 * A deck is read far more often than it is drawn, and the failure modes are not
	 * symmetrical: browsing when you meant to edit costs one press, while editing when you
	 * meant to browse means a component has moved and been written to disk before you noticed.
	 *
	 * Not persisted, deliberately. A mode that enables dragging and is remembered across a
	 * reload is a mode you can be in without having chosen it this session — which is exactly
	 * the state the default is protecting against. The cost is one press after a refresh.
	 */
	const [mode, setMode] = createSignal<CanvasMode>("browse");

	/**
	 * Agents pointing at components: bubbles with arrows, on the canvas.
	 *
	 * One flat list rather than a map, because the two things done with it are "draw the ones
	 * on this board" and "clear the ones this agent put there", and both are a filter.
	 *
	 * Cleared when the agent it belongs to **starts a new turn** — that is the lifetime
	 * `boards/方案①` asks for, read the useful way round: the marks survive the turn that made
	 * them, so they are still there when the agent stops and you come to read them, and they
	 * go when you say something next. Also cleared by the × on each bubble, and by the agent
	 * calling `annotate(path, null)`.
	 */
	const [marks, setMarks] = createSignal<Mark[]>([]);

	/** The selected component within a board, if one is selected. */
	const [component, setComponent] = createSignal<{ path: string; id: string } | undefined>(undefined);

	/**
	 * Clear one agent's annotations, wherever they are.
	 *
	 * Called when that agent is prompted again: the marks survive the turn that made them —
	 * so they are still there when the agent stops and you come to read them — and go when
	 * you say something next. `boards/方案①` asks for "until the end of the next turn"; this is
	 * that, read the way that is actually useful.
	 */
	const clearMarks = (agentId: string) => setMarks((was) => was.filter((mark) => mark.agentId !== agentId));

	return { selected, setSelected, tool, setTool, mode, setMode, marks, setMarks, component, setComponent, clearMarks };
}

export type Selection = ReturnType<typeof createSelection>;

/** The app's one selection. Tests build their own with `createSelection()`. */
export const selection = createSelection();

export const { selected, setSelected, tool, setTool, mode, setMode, marks, setMarks, component, setComponent, clearMarks } = selection;
