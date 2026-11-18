/**
 * What the person was looking at when they wrote a message, and the line that says so to the agent.
 *
 * The composer talks to the agent of the conversation on screen whichever tab is in front, and an
 * agent has no canvas of its own to take "here" for: its calls name the canvas they work on. So the
 * page says, with each message, which tab was in front (`LookingAt`: its kind and what it is of), and
 * the line is written here, with the other notes a message is sent with (`DeckAgent.notesFor`): by
 * the name a call can use, and with the canvas held behind a card, a document or an app. It is the
 * harness's to write, not the page's: put into the words by the page, it stood in front of a slash
 * command, which every runtime reads as an exact line, and `/compact` reached the model as a sentence.
 */
export type LookingAt = { kind: "canvas" | "card" | "document" | "app"; target: string };

const KINDS = new Set(["canvas", "card", "document", "app"]);

/** What a page said the person was looking at, taken only as what it can be: a kind there is, and a target that is words on one line. */
export function cleanLooking(raw: unknown): LookingAt | undefined {
	const given = raw as { kind?: unknown; target?: unknown } | null | undefined;
	if (!given || typeof given.kind !== "string" || !KINDS.has(given.kind) || typeof given.target !== "string") return undefined;
	const target = given.target.trim();
	if (!target || target.length > 512 || /[\r\n]/.test(target)) return undefined;
	return { kind: given.kind as LookingAt["kind"], target };
}

/** What the line is written from: the names the harness has for what the page named. */
export interface LookingNames {
	/** A canvas's title, when there is such a canvas. */
	canvasTitle(name: string): string | undefined;
	/** A card's title, by its path. */
	cardTitle(path: string): string | undefined;
	/** The canvas the chat's camera is on: what is behind a card, a document or an app in front. */
	behind(): string | undefined;
}

const canvasWords = (name: string, names: LookingNames): string => `the canvas "${names.canvasTitle(name) ?? name}" (--canvas ${name})`;

/** The line a message carries in front of its words: `[The person wrote this while looking at the canvas "Notes" (--canvas notes).]` */
export function lookingLine(at: LookingAt, names: LookingNames): string {
	if (at.kind === "canvas") return `[The person wrote this while looking at ${canvasWords(at.target, names)}.]`;
	const what = at.kind === "card" ? `the card "${names.cardTitle(at.target) ?? at.target}" (@${at.target})` : at.kind === "document" ? `the document @${at.target}` : `the app ${at.target}`;
	const behind = names.behind();
	return `[The person wrote this while looking at ${what}${behind ? `, with ${canvasWords(behind, names)} behind it` : ""}.]`;
}

/** The line, by the names a deck has now: its canvases' titles, its cards' titles, and the canvas the chat's camera is on. */
export function lookingLineIn(at: LookingAt, deck: { board(path: string): { title?: string } | undefined }, pens: { has(name: string): boolean; titleOf(name: string): string } | undefined, behind: string | undefined): string {
	return lookingLine(at, {
		canvasTitle: (name) => (pens?.has(name) ? pens.titleOf(name) : undefined),
		cardTitle: (path) => deck.board(path)?.title || undefined,
		behind: () => behind,
	});
}
