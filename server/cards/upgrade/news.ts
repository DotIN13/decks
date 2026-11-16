import { layout } from "../../../protocol/index.ts";
import { readJson, writeJson } from "../../kernel/store.ts";
import type { Deck, DeckPath, UpgradeParts } from "../../kernel/types.ts";
import { CLAIMS, SEEN } from "../news.ts";

// Rule 20: a deck from today keeps its cards' news. Today's .decks/authors.json (card → { who, at })
// becomes each card's claim, and .decks/seen.json (card → time) its last read, once per deck.

/** Set in the cards store once today's records are moved, so a later open reads nothing old. */
const MOVED = "upgraded/news";

/** Today's bylines and read times moved into the cards store, under the card each now names. */
export async function upgradeNews(deck: Deck, parts: UpgradeParts): Promise<void> {
	const store = parts.stores("cards");
	if (await store.get(MOVED)) return;
	const authors = await readJson<Record<string, { who?: unknown; at?: unknown }>>(parts.old, "authors.json", {});
	for (const [old, entry] of Object.entries(authors)) {
		const path = await cardNow(deck, old);
		if (!path || typeof entry?.who !== "string" || (await store.get(CLAIMS + path))) continue;
		const rev = (await deck.revisions?.(path))?.at(-1)?.rev ?? 0;
		await writeJson(store, CLAIMS + path, { by: entry.who, rev, ...(typeof entry.at === "number" ? { at: entry.at } : {}) });
	}
	const seen = await readJson<Record<string, unknown>>(parts.old, "seen.json", {});
	for (const [old, at] of Object.entries(seen)) {
		const path = await cardNow(deck, old);
		if (path && typeof at === "number" && !(await store.get(SEEN + path))) await writeJson(store, SEEN + path, at);
	}
	await writeJson(store, MOVED, Date.now());
}

/**
 * The card a record of today's names, when it is in the deck: a card's index.html as it is, and a
 * board (canvases/<c>/boards/<name>.html) as the card today's Decks made of it, cards/<name>/.
 */
async function cardNow(deck: Deck, old: string): Promise<DeckPath | undefined> {
	const board = /^(.*\/)boards\/([^/]+)\.html$/.exec(old);
	const path = board ? `${board[1]}cards/${board[2]}/index.html` : old;
	if (!layout.isCardPath(path)) return undefined;
	return deck.read(path as DeckPath).then(() => path as DeckPath, () => undefined);
}
