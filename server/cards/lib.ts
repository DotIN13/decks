import { Refused, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Deck, type DeckPath, type Entry } from "../kernel/types.ts";

// Rule 15: the card runtime in a deck's lib/ is this build's. A file is written
// only when its bytes differ; one this build no longer ships is removed.

/** Where this build's runtime is read from: a folder, as the kernel hands it. */
export type LibSource = Pick<Deck, "list" | "read">;
export type LibSync = { written: string[]; removed: string[]; same: number };

const LIB = "lib";
const SYSTEM: Caller = { kind: "person", id: "decks", name: "Decks" };

async function files(from: Pick<Deck, "list">, dir: DeckPath | ""): Promise<Entry[]> {
	let entries: Entry[];
	try {
		entries = await from.list(dir);
	} catch (error) {
		if (error instanceof Refused && error.code === "not_found") return [];
		throw error;
	}
	const out: Entry[] = [];
	for (const entry of entries) out.push(...(entry.kind === "dir" ? await files(from, entry.path) : [entry]));
	return out;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Bring the deck's lib/ up to the source. An empty source changes nothing: a broken install never wipes a deck. */
export async function syncLib(source: LibSource, deck: Deck, by: Caller = SYSTEM): Promise<LibSync> {
	const result: LibSync = { written: [], removed: [], same: 0 };
	const shipped = await files(source, "");
	if (shipped.length === 0) return result;
	const names = new Set<string>(shipped.map((e) => e.path));
	for (const entry of shipped) {
		const target = toDeckPath(`${LIB}/${entry.path}`);
		const bytes = await source.read(entry.path);
		const now = await deck.read(target).catch(() => undefined);
		if (now && same(now, bytes)) {
			result.same++;
			continue;
		}
		await deck.write(target, bytes, by);
		result.written.push(target);
	}
	for (const entry of await files(deck, toDeckPath(LIB))) {
		if (names.has(entry.path.slice(LIB.length + 1))) continue;
		await deck.remove(entry.path, by);
		result.removed.push(entry.path);
	}
	return result;
}
