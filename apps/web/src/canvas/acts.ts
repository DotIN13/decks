import type { ServerMessage } from "@decks/protocol";

/**
 * Where an agent's act is drawn on a board: the cursor's point, and the boxes to outline.
 *
 * The server says what an agent is doing to which board and, when it knows, to which root
 * blocks (`agents/acts.ts`). This is the part with rules in it and no DOM of its own: given
 * the act and the blocks' rectangles, where does the cursor go, and what gets a box. The
 * frame reads the rectangles off the board's document (`blockRect`) and draws the answer.
 *
 * The cursor sits just inside the top-left of the block it is on, so it reads as holding it
 * rather than covering it. With no block it stands where the verb happened: a new board's
 * first line, a resize's bottom-right corner, and the top edge for the rest.
 */
export type AgentAct = Extract<ServerMessage, { type: "agent.act" }>;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** How long a finished act stays drawn, so the landing can be seen before the cursor leaves. */
export const DONE_LINGER_MS = 3500;

/** A root block's box in board coordinates, or undefined when the board has no such block. */
export function blockRect(doc: Document | undefined, id: string): Rect | undefined {
	if (!doc) return undefined;
	// Duck-typed, not `instanceof`: the element belongs to the iframe's realm (`annotations.ts`).
	const element = doc.querySelector(`[data-id="${cssEscape(id)}"]`) as HTMLElement | null;
	if (!element || typeof element.offsetLeft !== "number" || typeof element.offsetWidth !== "number") return undefined;
	if (element.offsetWidth === 0 && element.offsetHeight === 0) return undefined;
	return { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight };
}

/** The rectangles an act names, in the order it names them, dropping the ones the board cannot find. */
export function actRects(doc: Document | undefined, act: Pick<AgentAct, "ids">): Rect[] {
	const out: Rect[] = [];
	for (const id of act.ids ?? []) {
		const rect = blockRect(doc, id);
		if (rect) out.push(rect);
	}
	return out;
}

/** Where the cursor stands for this act. */
export function cursorFor(act: Pick<AgentAct, "what" | "phase">, rects: Rect[], board: { w: number; h: number }): { x: number; y: number } {
	const [first] = rects;
	if (first) return { x: first.x + Math.min(14, Math.max(4, first.w / 2)), y: first.y + Math.min(12, Math.max(4, first.h / 2)) };
	switch (act.what) {
		case "new":
			return { x: 28, y: 28 };
		case "resize":
			return { x: Math.max(12, board.w - 14), y: Math.max(12, board.h - 14) };
		default:
			return { x: Math.round(board.w / 2), y: 16 };
	}
}

/** Whether the act is a write in progress: the outline is drawn, on the blocks or on the board. */
export function holding(act: Pick<AgentAct, "phase" | "what">): boolean {
	return act.phase === "start" && act.what === "edit";
}

/** Whether the act just landed content: the sweep and the settle are drawn on its blocks. */
export function landed(act: Pick<AgentAct, "phase" | "what" | "ids">): boolean {
	return act.phase === "done" && act.what === "edit" && (act.ids?.length ?? 0) > 0;
}

function cssEscape(value: string): string {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
	return value.replace(/["\\]/g, "\\$&");
}
