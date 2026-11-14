import { layout, Refused, type Caller } from "../../protocol/index.ts";
import type * as S from "./shapes.ts";
import type { Deck, DeckPath, Store } from "../kernel/types.ts";
import { fence } from "./fence.ts";
import { stat } from "./files.ts";

// Cards: rules 9 to 11 of the README.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CLAIMS = "claims/";

/** A card named by its folder or its index.html, as its index.html. Rule 9. */
export function cardPath(raw: unknown): DeckPath {
	const path = fence(raw, "card");
	const index = /\/index\.html$/i.test(path) ? path : `${path}/index.html`;
	if (!layout.isCardPath(index)) throw new Refused("invalid", `${String(raw)} is not a card: a card is canvases/<canvas>/cards/<name>/index.html.`, "card.list");
	return fence(index);
}

/** The canvas a card is on. */
export const canvasOf = (card: string): string => layout.canvasOfPath(card)?.name ?? "";

/** A card's title: its <title>, else its first <h1>, else its folder's name. Rule 10. */
export function titleOf(path: string, html: string): string {
	const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
	const text = tag?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
	return text ? unescape(text) : (path.split("/").at(-2) ?? path);
}

const unescape = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The folder name a title makes: plain letters and dashes, 40 at most. Rule 11. */
export function slug(title: string): string {
	const plain = title.normalize("NFKD").toLowerCase().replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
	let cut = plain.slice(0, 40);
	if (plain.length > 40 && plain[40] !== "-" && cut.includes("-")) cut = cut.slice(0, cut.lastIndexOf("-"));
	return cut.replace(/-+$/, "") || "card";
}

/** A blank card's index.html: its title, its width, one block, and a module handed the card. */
export function cardShell(title: string, size: { w: number; h?: number }): string {
	return `<title>${escape(title)}</title>
<meta name="card" content='${JSON.stringify(size)}' />
<style>
	.doc { padding: clamp(20px, 5cqi, 48px); font-size: 17px; line-height: 1.5 }
	.doc img, .doc video { max-width: 100%; height: auto }
</style>
<div class="doc" data-id="doc">
	<h1>${escape(title)}</h1>
</div>
<script type="module">
	// Runs each time the card wakes; return a function to stop what it started.
	export default function (card) {
		// card.root is what document is to a page: card.root.querySelector("h1").
	}
</script>
`;
}

/** Write a blank card in a canvas's cards/, in a folder no card has yet. */
export async function createCard(deck: Deck, canvas: string, title: string, size: { w: number; h?: number }, by: Caller): Promise<DeckPath> {
	if (!title.trim()) throw new Refused("invalid", "A card needs a title: the finding, as a sentence.", "card.create");
	const folder = layout.canvasFolder(canvas);
	if (!(await stat(deck, fence(folder)))) throw new Refused("not_found", `There is no canvas ${canvas}.`, "canvas.list");
	const base = slug(title);
	for (let n = 1; n < 1000; n++) {
		const path = fence(`${folder}/cards/${n === 1 ? base : `${base}-${n}`}/index.html`);
		if (await stat(deck, fence(path.slice(0, -"/index.html".length)))) continue;
		await deck.write(path, encoder.encode(cardShell(title.trim(), size)), by);
		return path;
	}
	throw new Refused("conflict", `Too many cards are named ${base}.`, "card.list");
}

/** Every card in the deck: canvases and friends' canvases, placed or not. */
export async function listCards(deck: Deck): Promise<DeckPath[]> {
	const out: DeckPath[] = [];
	const folders = [...(await names(deck, "canvases")).map((n) => `canvases/${n}`)];
	for (const owner of await names(deck, "shared/canvases")) for (const n of await names(deck, `shared/canvases/${owner}`)) folders.push(`shared/canvases/${owner}/${n}`);
	for (const folder of folders) {
		for (const name of await names(deck, `${folder}/cards`)) {
			const index = fence(`${folder}/cards/${name}/index.html`);
			if ((await stat(deck, index))?.kind === "file") out.push(index);
		}
	}
	return out.sort();
}

async function names(deck: Deck, dir: string): Promise<string[]> {
	try {
		return (await deck.list(fence(dir))).filter((e) => e.kind === "dir").map((e) => e.path.split("/").pop()!);
	} catch (error) {
		if (error instanceof Refused) return [];
		throw error;
	}
}

/** A card as a call answers it: path, title, writer. */
export async function describe(deck: Deck, store: Store, path: DeckPath): Promise<S.Card> {
	if (!(await stat(deck, path))) throw new Refused("not_found", `There is no card at ${path}.`, "card.list");
	const by = await writerOf(deck, store, path);
	return { path, title: titleOf(path, decoder.decode(await deck.read(path))), ...(by ? { by } : {}) };
}

/** Who last wrote a card's index.html, or claimed it since. */
async function writerOf(deck: Deck, store: Store, path: DeckPath): Promise<string | undefined> {
	const wrote = (await deck.revisions?.(path))?.at(-1);
	const kept = await store.get(CLAIMS + path);
	const claimed = kept ? (JSON.parse(decoder.decode(kept)) as { by: string; rev: number }) : undefined;
	if (claimed && (!wrote || claimed.rev >= wrote.rev)) return claimed.by;
	return wrote?.by;
}

/** A claim holds until the card's index.html is written again. */
export async function claim(store: Store, path: DeckPath, by: Caller, rev: number): Promise<void> {
	await store.put(CLAIMS + path, encoder.encode(JSON.stringify({ by: by.id, rev })));
}
