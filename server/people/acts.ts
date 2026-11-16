import { idsOf, layout, type shapes } from "../../protocol/index.ts";

// What an agent's call touched, for its glow and cursor (agent.acted): the cards it
// changed, by path, and the items, by id. Only a change an agent made that worked counts.

export type Done = { name: string; effect: string; args: Record<string, unknown>; who: string; ok: boolean; value?: unknown };
export type Act = { what: string; canvas?: string; ids: string[] };

/** The act a finished call makes, or undefined when it touched nothing an agent shows. */
export function actOf(done: Done, here?: string): Act | undefined {
	if (done.who !== "agent" || done.effect !== "change" || !done.ok) return undefined;
	const cards = new Set<string>();
	const items = new Set<string>();
	cardsIn(done.args, cards);
	if (done.name.startsWith("card.") || done.name.startsWith("item.")) itemsIn(done.value, cards, items);
	if (done.name.startsWith("item.")) idsIn(done.args, items);
	if (!cards.size && !items.size) return undefined;
	const canvas = typeof done.args.canvas === "string" ? done.args.canvas : canvasOf(cards) ?? here;
	return { what: done.name.slice(done.name.indexOf(".") + 1), ...(canvas ? { canvas } : {}), ids: [...cards, ...items] };
}

/** The cards some paths name: a card's own path, or the card a file of it belongs to. */
export function cardsOf(paths: readonly string[]): string[] {
	return [...new Set(paths.map((path) => (layout.isCardPath(path) ? path : layout.cardOf(path))).filter((card): card is string => !!card))];
}

/** A card named by the call's arguments, or the card a file it wrote belongs to. */
function cardsIn(args: Record<string, unknown>, cards: Set<string>): void {
	const paths = ["card", "path", "to", "from"].map((key) => args[key]).filter((path): path is string => typeof path === "string");
	for (const card of cardsOf(paths)) cards.add(card);
}

/** What the call answered: a card, an item, or a list of either. */
function itemsIn(value: unknown, cards: Set<string>, items: Set<string>): void {
	for (const one of Array.isArray(value) ? value : [value]) {
		const got = one as Partial<shapes.Item> & { path?: unknown } | undefined;
		if (!got || typeof got !== "object") continue;
		if (typeof got.card === "string") cards.add(got.card);
		else if (typeof got.path === "string" && layout.isCardPath(got.path)) cards.add(got.path);
		else if (typeof got.id === "string") items.add(got.id);
	}
}

/** The items an item call names: its id, or the ids its ops touch. */
function idsIn(args: Record<string, unknown>, items: Set<string>): void {
	if (typeof args.id === "string") items.add(args.id);
	if (Array.isArray(args.ops)) for (const op of args.ops as shapes.ItemOp[]) for (const id of idsOf(op)) items.add(id);
}

/** The canvas the first of some cards is on. */
export function canvasOf(cards: Iterable<string>): string | undefined {
	for (const card of cards) {
		const at = layout.canvasOfPath(card);
		if (at) return at.name;
	}
	return undefined;
}
