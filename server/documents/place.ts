import { layout, Refused } from "../../protocol/index.ts";
import type { Caller } from "../../protocol/index.ts";
import type { Deck, DeckPath, Item, ItemKind } from "../kernel/types.ts";
import { documentKind } from "./item.ts";
import { fence } from "./path.ts";

// Rule 12: a document item names its file from the deck's root. A name given
// from the canvas's folder is taken for the file it means, with a note. A file
// named nowhere is refused for the person, and made empty for anyone else.

type At = { canvas: string; caller: Caller; note?: (text: string) => void; deck?: Deck };

async function exists(deck: Deck, path: DeckPath): Promise<boolean> {
	const parent = path.includes("/") ? (path.slice(0, path.lastIndexOf("/")) as DeckPath) : "";
	return (await deck.list(parent).catch(() => [])).some((e) => e.path === path && e.kind === "file");
}

/** The deck path a document item means, and a note when it differs from what was given. */
export async function documentPath(deck: Deck, given: string, at: At): Promise<{ path: DeckPath; note?: string }> {
	const asked = fence(given);
	if (await exists(deck, asked)) return { path: asked };
	const folder = layout.canvasFolder(at.canvas);
	const name = asked.split("/").pop()!;
	const tries = asked.startsWith("canvases/") || asked.startsWith("shared/") ? [] : [`${folder}/${asked}`, `${folder}/files/${name}`];
	for (const one of tries) {
		const path = fence(one);
		if (await exists(deck, path)) return { path, note: `${given} was taken as ${path}: a document names its file from the deck's root.` };
	}
	if (at.caller.kind === "person") throw new Refused("not_found", `There is no file ${given} in the deck to open as a document.`, "file.find");
	const made = asked.startsWith("canvases/") || asked.startsWith("docs/") ? asked : fence(`${folder}/files/${name}`);
	await deck.write(made, new Uint8Array(), at.caller);
	const note = made === asked ? `There was no file ${given}, so it was made empty for the document to open.` : `There was no file ${given}, so ${made} was made empty for the document to open: a document names its file from the deck's root, as ${folder}/files/<name>.md.`;
	return { path: made, note };
}

/** The document kind, able to prepare once the feature has its deck. */
export function documentKindWith(deck: () => Deck | undefined): ItemKind {
	return {
		...documentKind,
		async prepare(item: Item, at: At) {
			const given = at.deck ?? deck();
			if (!given) throw new Refused("unavailable", "Documents have not started yet.", "file.read");
			if (typeof item.path !== "string" || !item.path) throw new Refused("invalid", "A document item names its file: { type: document, path }.", "file.list");
			const { path, note } = await documentPath(given, item.path, at);
			if (note) at.note?.(note);
			const meta = (item.metadata ?? {}) as Record<string, unknown>;
			return { ...item, path, ...(item.metadata ? { metadata: { ...meta, path } } : {}) };
		},
	};
}
