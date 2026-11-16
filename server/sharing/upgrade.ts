import { layout } from "../../protocol/index.ts";
import { readJson, writeJson } from "../kernel/store.ts";
import type { Store } from "../kernel/types.ts";
import type { CanvasState, Link, SyncState } from "./client/link.ts";

// Today's Studio link and sync memory, carried into the feature's store when a deck is opened:
// .decks/studio.json is the link, studio-sync.json the state, sync/<id>.pen each agreed drawing.
// Without the bases the first sync would fetch whole or merge by name, and could undo edits.

type OldCanvas = { id: string; rev: number; pen?: string; files?: CanvasState["files"] };
type OldState = { user?: string; canvases?: Record<string, OldCanvas> };

/** Carry what is not carried yet; what the new store already holds is never overwritten. Says each step. */
export async function upgradeSharing(old: Store, store: Store, say: (line: string) => void = () => {}): Promise<void> {
	const link = await readJson<Partial<Link> | undefined>(old, "studio.json", undefined);
	if (link?.url && link.key && !(await store.get("link"))) {
		await writeJson(store, "link", { url: link.url, key: link.key });
		say(`Studio link kept: ${link.url}`);
	}
	const was = await readJson<OldState | undefined>(old, "studio-sync.json", undefined);
	if (!was || (await store.get("state"))) return;
	const canvases: Record<string, CanvasState> = {};
	for (const [name, c] of Object.entries(was.canvases ?? {})) {
		if (!c?.id || !layout.canvasNameOk(name)) continue;
		canvases[layout.canvasFolder(name)] = { id: c.id, rev: c.rev ?? 0, files: c.files ?? {} };
		await carryBase(old, store, c);
	}
	const state: SyncState = { canvases, said: [], ...(was.user ? { user: was.user } : {}) };
	await writeJson(store, "state", state);
	say(`Studio sync state kept for ${Object.keys(canvases).length} canvases`);
}

/** A canvas's agreed drawing: sync/<id>.pen, or the older copy inside the state itself. */
async function carryBase(old: Store, store: Store, c: OldCanvas): Promise<void> {
	if (await store.get(`base/${c.id}`)) return;
	const bytes = (await old.get(`sync/${c.id}.pen`)) ?? (c.pen ? new TextEncoder().encode(c.pen) : undefined);
	if (bytes) await store.put(`base/${c.id}`, bytes);
}
