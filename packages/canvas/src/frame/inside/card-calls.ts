import type { Camera } from "@decks/protocol";
import { cardCalls as cardCallsTo } from "@decks/api";
import { CallRefused } from "../protocol.ts";

/**
 * Where a card's `card.decks` call is answered, in the canvas frame (`card.ts`, `CanvasHost.cardCall`):
 * the verb table's `card` column (`@decks/api`, `Verb.card`), which the harness and the app's page
 * read too.
 *
 * - **In the frame** (`frame`): the person's view of this canvas (`view.*` but `goto`), `here` and
 *   `now`. No round trip, nothing to ask.
 * - **By the harness** (`canvas`), on the frame's canvas token: the canvas's own calls (reading and
 *   changing it, its cards, frames and files, undo), made as the person on this canvas and no other.
 *   The harness refuses the token anything else (`verbs/router.ts`, `CANVAS_FRAME_VERBS`).
 * - **By the app's page** (`page`): the agent calls and showing another canvas, the only ones that
 *   need the person's own token. The page asks the person before a card's message goes to an agent.
 * - **Nowhere**: everything that reaches past the canvas (apps, the shared Chrome tab, pairing, ports,
 *   changing who an agent is, other canvases).
 */
export const IN_FRAME = cardCallsTo("frame");
export const ON_CANVAS = cardCallsTo("canvas");
/** The page's, with your token: the agents, and moving your screen to another canvas. */
export const BY_THE_PAGE = cardCallsTo("page");

/** What the frame lends its card calls. */
export interface CardCallDeps {
	canvas: string;
	camera(): Camera;
	move(camera: Camera, glide?: number): void;
	/** Frame these items, cards or boards, by id or path. */
	focus(targets: string[]): void;
	viewport(): { width: number; height: number };
	reload(path: string): void;
	/** One call on this canvas, to the harness on the canvas token. */
	harness(verb: string, args: unknown[]): Promise<{ ok: boolean; value?: unknown; error?: string }>;
	/** One of the page's, as the card that asked. */
	page(verb: string, args: unknown[], card: string): Promise<unknown>;
}

export function cardCalls(deps: CardCallDeps): (verb: string, args: unknown[], card: string) => Promise<unknown> {
	const here = (verb: string, args: unknown[]): unknown => {
		switch (verb) {
			case "view.camera":
				return deps.camera();
			case "view.viewport":
				return deps.viewport();
			case "view.move": {
				const asked = (args[0] ?? {}) as Partial<Camera> & { animate?: boolean };
				const now = deps.camera();
				const next = { x: asked.x ?? now.x, y: asked.y ?? now.y, zoom: asked.zoom ?? now.zoom };
				deps.move(next, asked.animate ? 400 : undefined);
				return next;
			}
			case "view.focus": {
				const target = args[0];
				deps.focus(Array.isArray(target) ? target.map(String) : [String(target)]);
				return { canvas: deps.canvas, target };
			}
			case "view.reload": {
				// `board` is `card`'s old name, taken until 2026-11-30.
				const asked = (args[0] ?? {}) as { card?: unknown; board?: unknown };
				const card = asked.card ?? asked.board;
				if (typeof card !== "string") throw new CallRefused('view.reload names a card: { card: "<path>" }.', "refused");
				deps.reload(card);
				return { reloaded: 1 };
			}
			case "view.cursor":
				// A labelled dot is an agent's; a card draws its own pointer.
				return undefined;
			case "here":
				return { name: deps.canvas, title: deps.canvas, open: [], cards: 0, boards: 0 };
			case "now": {
				const now = new Date();
				return { iso: now.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, words: now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }), epoch: now.getTime() };
			}
		}
		throw new CallRefused(`${verb} is answered nowhere.`, "refused");
	};
	return async (verb, args, card) => {
		const list = Array.isArray(args) ? args : [];
		if (IN_FRAME.has(verb)) return here(verb, list);
		if (ON_CANVAS.has(verb)) {
			const answer = await deps.harness(verb, list);
			if (!answer.ok) throw new Error(answer.error ?? `${verb} failed.`);
			return answer.value;
		}
		if (BY_THE_PAGE.has(verb)) return deps.page(verb, list, card);
		throw new CallRefused(`${verb} is not a card's to call: it reaches past this canvas.`, "not-for-cards");
	};
}
