import { CALL_BY_NAME, type Camera } from "@decks/protocol";
import { answerBack, cardCall, isOld } from "@decks/protocol/compat";
import { CallRefused } from "../messages.ts";

/**
 * Where a card's `card.decks` call is answered, in the canvas frame (`card.ts`, `CanvasHost.cardCall`).
 * Old or new is decided per call by its arguments (`@decks/protocol/compat`, `cardCall`): a card written
 * for the old SDK, or by the boards-to-cards migration, keeps working, forever, and gets its old answer
 * back. Only the calls a card may make pass, on the card's own canvas, whichever shape it uses.
 *
 * - **In the frame**: the person's view of this canvas (`view.*` but `goto`), `canvas.here`, `deck.now`.
 * - **By the app's page**: the agent calls and showing another canvas, which need the person's own token;
 *   the page asks the person before a card's message goes to an agent.
 * - **On the frame's socket**: everything else, as the person on this canvas (the pass's) and no other.
 */
const IN_FRAME = new Set(["view.get", "view.move", "view.focus", "view.reload", "view.cursor", "canvas.here", "deck.now"]);
const byThePage = (name: string) => name.startsWith("agent.") || name === "view.goto";

/** What the frame lends its card calls. */
interface CardCallDeps {
	canvas: string;
	camera(): Camera;
	move(camera: Camera, glide?: number): void;
	/** Frame these items or cards, by id or path. */
	focus(targets: string[]): void;
	viewport(): { width: number; height: number };
	reload(path: string): void;
	/** One call on this canvas, on the frame's socket, by its protocol name. */
	harness(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; value?: unknown; error?: string }>;
	/** One of the page's, by its protocol name, as the card that asked. */
	page(name: string, args: Record<string, unknown>, card: string): Promise<unknown>;
}

export function cardCalls(deps: CardCallDeps): (verb: string, args: unknown[], card: string) => Promise<unknown> {
	return async (verb, args, card) => {
		const list = Array.isArray(args) ? args : [];
		// card.decks hands every call over as a list: one object alone in it may be the new shape's arguments.
		const raw = list.length === 1 && CALL_BY_NAME.has(verb) && isObject(list[0]) ? list[0] : list;
		const call = cardCall(verb, raw, deps.canvas, usedOf(verb));
		if ("refusal" in call) throw new CallRefused(call.refusal.message, "not-for-cards");
		// A view answer a card reads keeps the old fields, whichever shape it used (compat's rule 4).
		if (IN_FRAME.has(call.name)) return OLD_ANSWER.has(call.name) ? answerBack(call.name, here(deps, call.name, call.args), call.args) : call.back(here(deps, call.name, call.args));
		if (byThePage(call.name)) return call.back(await deps.page(call.name, call.args, card));
		const answer = await deps.harness(call.name, call.args);
		if (!answer.ok) throw new Error(answer.error ?? `${call.name} failed.`);
		return call.back(answer.value);
	};
}

/** The shape a card's call used, by its name: only the old SDK's or only the new; a name in both is read by its arguments. */
function usedOf(verb: string): "old" | "new" | undefined {
	const isNew = CALL_BY_NAME.has(verb);
	if (isNew === isOld(verb)) return undefined;
	return isNew ? "new" : "old";
}

/** The view calls whose old and new arguments are the same: a card gets the answer compat gives an old one. */
const OLD_ANSWER = new Set(["view.move", "view.focus", "view.reload"]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A call the frame answers itself, by its protocol name: the view of this canvas, here, now. */
function here(deps: CardCallDeps, name: string, args: Record<string, unknown>): unknown {
	const view = () => ({ canvas: deps.canvas, camera: deps.camera(), screen: { w: deps.viewport().width, h: deps.viewport().height } });
	switch (name) {
		case "view.get":
			return view();
		case "view.move": {
			const now = deps.camera();
			const next = { x: typeof args.x === "number" ? args.x : now.x, y: typeof args.y === "number" ? args.y : now.y, zoom: typeof args.zoom === "number" ? args.zoom : now.zoom };
			deps.move(next, args.animate ? 400 : undefined);
			return { ...view(), camera: next, moved: true };
		}
		case "view.focus": {
			const target = args.target;
			deps.focus(Array.isArray(target) ? target.map(String) : [String(target)]);
			return { ...view(), moved: true };
		}
		case "view.reload":
			if (typeof args.card !== "string") throw new CallRefused('view.reload names a card: { card: "<path>" }.', "refused");
			deps.reload(args.card);
			return 1;
		case "view.cursor":
			// A labelled dot is an agent's; a card draws its own pointer.
			return view();
		case "canvas.here":
			return { name: deps.canvas, title: deps.canvas, open: [], cards: 0 };
		case "deck.now": {
			const now = new Date();
			return { iso: now.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, words: now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }), epoch: now.getTime() };
		}
	}
	throw new CallRefused(`${name} is answered nowhere.`, "refused");
}
