import { applyEdits, diff, parse, serialize, type PenDocument, type PenEdit } from "@decks/pen";
import type { Caller } from "../../../protocol/index.ts";
import type { Deck, Store } from "../../kernel/types.ts";
import { readText, writeText } from "./folders.ts";
import { empty, readBase, writeBase, type CanvasState } from "./link.ts";
import type { StudioApi } from "./transport.ts";

// One canvas's drawing in step with Studio: ours goes up as edits from the
// base both sides agreed on, theirs comes down as edits since our revision.

export type Pass = { api: StudioApi; deck: Deck; store: Store; by: Caller; log: (line: string) => void };

/** Push our edits (when we may) and take Studio's answer; else take what changed there. */
export async function syncDrawing(p: Pass, folder: string, s: CanvasState, editable: boolean): Promise<void> {
	const local = await localDoc(p, folder);
	const base = await readBase(p.store, s.id);
	const edits = editable && local ? diff(base ?? empty(), local) : [];
	if (edits.length) {
		const answer = await p.api.call("POST", `/sync/v1/canvases/${encodeURIComponent(s.id)}/edits`, { base: s.rev, edits });
		return keep(p, folder, s, answer.pen as PenDocument, answer.rev as number, local);
	}
	const got = await p.api.call("GET", `/sync/v1/canvases/${encodeURIComponent(s.id)}/changes?since=${s.rev}`);
	if (got.tooOld || !base || !local) return whole(p, folder, s, local);
	const lists = got.changes as PenEdit[][];
	if (!lists.length) return;
	await keep(p, folder, s, lists.reduce(loosely, base), got.rev as number, local);
}

async function localDoc(p: Pass, folder: string): Promise<PenDocument | undefined> {
	const got = await readText(p.deck, `${folder}/canvas.pen`);
	try {
		return got === undefined ? undefined : parse(got);
	} catch {
		return undefined;
	}
}

async function keep(p: Pass, folder: string, s: CanvasState, doc: PenDocument, rev: number, local?: PenDocument): Promise<void> {
	const text = serialize(doc);
	if (!local || serialize(local) !== text) await writeText(p.deck, `${folder}/canvas.pen`, text, p.by);
	await writeBase(p.store, s.id, doc);
	s.rev = rev;
}

/** The whole drawing from Studio: when the log no longer reaches, or we have no base. */
export async function whole(p: Pass, folder: string, s: CanvasState, local?: PenDocument): Promise<void> {
	const got = await p.api.call("GET", `/sync/v1/canvases/${encodeURIComponent(s.id)}`);
	await keep(p, folder, s, got.pen as PenDocument, got.rev as number, local);
}

/** Our whole drawing merged into a canvas we met by name: Studio keeps both sides' items. */
export async function mergeInto(p: Pass, folder: string, s: CanvasState): Promise<void> {
	const local = await localDoc(p, folder);
	const edits = local ? diff(empty(), local) : [];
	if (!edits.length) return whole(p, folder, s, local);
	const answer = await p.api.call("POST", `/sync/v1/canvases/${encodeURIComponent(s.id)}/edits`, { base: s.rev, edits });
	await keep(p, folder, s, answer.pen as PenDocument, answer.rev as number, local);
}

/** Edits applied as far as they fit: one to an item gone is left out. */
export function loosely(doc: PenDocument, edits: readonly PenEdit[]): PenDocument {
	try {
		return applyEdits(doc, edits);
	} catch {
		let out = doc;
		for (const edit of edits) {
			try {
				out = applyEdits(out, [edit]);
			} catch {
				// An item gone, or one already there.
			}
		}
		return out;
	}
}
