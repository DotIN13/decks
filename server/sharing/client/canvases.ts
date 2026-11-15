import { parse, serialize } from "@decks/pen";
import { layout, sync } from "../../../protocol/index.ts";
import type { SyncCanvas } from "../hub/store.ts";
import { mergeInto, type Pass } from "./drawing.ts";
import { markStudio, ownFolders, readJson, readText, writeText } from "./folders.ts";
import { empty, writeBase, type CanvasState, type SyncState } from "./link.ts";

// Which folder is which canvas. A canvas is its Studio id, kept in canvas.json:
// a rename keeps it, a copy gets its own, a folder with none meets a canvas of
// mine by name or becomes a new one.

export type Pair = { folder: string; name: string; remote: SyncCanvas; s: CanvasState; fresh: boolean };
type Add = (folder: string, c: SyncCanvas, fresh: boolean) => Pair;

const nameOf = (folder: string) => folder.slice(folder.lastIndexOf("/") + 1);

/** Every pair of folder and canvas for this pass, making canvases and folders as needed. */
export async function pairs(p: Pass, state: SyncState, list: SyncCanvas[], user: string): Promise<Pair[]> {
	const remote = new Map(list.map((c) => [c.id, c]));
	const folders = await ownFolders(p.deck);
	const claimed = await claims(p, state, folders, remote);
	const taken = new Set(claimed.values());
	const out: Pair[] = [];
	const add = (folder: string, c: SyncCanvas, fresh: boolean): Pair => {
		const was = state.canvases[folder];
		const s = was && was.id === c.id ? was : { id: c.id, rev: c.rev, files: {} };
		const pair = { folder, name: nameOf(folder), remote: c, s, fresh };
		out.push(pair);
		return pair;
	};
	for (const folder of folders) {
		const id = claimed.get(folder);
		if (id) add(folder, remote.get(id)!, !state.canvases[folder] || state.canvases[folder]!.id !== id);
		else await unclaimed(p, folder, list, taken, user, add);
	}
	for (const c of list) if (!taken.has(c.id)) await arrive(p, c, user, folders, add);
	return out;
}

/** Each folder's claim: the state's when it names the folder, else canvas.json's. One claim per id. */
async function claims(p: Pass, state: SyncState, folders: string[], remote: Map<string, SyncCanvas>): Promise<Map<string, string>> {
	const byId = new Map<string, string>();
	const fromJson: [string, string][] = [];
	for (const folder of folders) {
		const id = state.canvases[folder]?.id;
		if (id && remote.has(id) && !byId.has(id)) byId.set(id, folder);
		else fromJson.push([folder, (await readJson(p.deck, folder)).studio ?? ""]);
	}
	for (const [folder, id] of fromJson) if (id && remote.has(id) && !byId.has(id)) byId.set(id, folder);
	return new Map([...byId].map(([id, folder]) => [folder, id]));
}

async function unclaimed(p: Pass, folder: string, list: SyncCanvas[], taken: Set<string>, user: string, add: Add): Promise<void> {
	const name = nameOf(folder);
	const mine = list.find((c) => c.owner === user && c.name === name && !taken.has(c.id));
	if (mine) {
		taken.add(mine.id);
		await markStudio(p.deck, folder, mine.id, p.by, mine.title);
		return mergeInto(p, folder, add(folder, mine, true).s);
	}
	if (!sync.safeCanvasName(name)) return void p.log(`Studio did not upload canvas ${name}: its name is not one plain folder name.`);
	const title = (await readJson(p.deck, folder)).title ?? name;
	const pen = await readText(p.deck, `${folder}/canvas.pen`);
	const made = await p.api.call("POST", "/sync/v1/canvases", { name, title, ...(pen ? { pen: JSON.parse(pen) } : {}) });
	const c = made.canvas as SyncCanvas;
	taken.add(c.id);
	if (pen) await writeBase(p.store, c.id, parse(pen));
	await markStudio(p.deck, folder, c.id, p.by);
	add(folder, c, true);
}

/** A canvas with no folder here: mine lands in canvases/, a friend's in shared/canvases/<owner>/. */
async function arrive(p: Pass, c: SyncCanvas, user: string, folders: string[], add: Add): Promise<void> {
	if (!sync.safeCanvasName(c.name)) return;
	const folder = c.owner === user ? freeFolder(`${layout.CANVASES}/${c.name}`, folders) : `${layout.SHARED_CANVASES}/${layout.ownerFolderBase(c.ownerName ?? c.owner)}/${c.name}`;
	if ((await readText(p.deck, `${folder}/canvas.pen`)) === undefined) await writeText(p.deck, `${folder}/canvas.pen`, serialize(empty()), p.by);
	await markStudio(p.deck, folder, c.id, p.by, c.title);
	add(folder, c, true);
}

function freeFolder(want: string, folders: string[]): string {
	for (let n = 1; ; n++) {
		const name = n === 1 ? want : `${want}-${n}`;
		if (!folders.includes(name)) return name;
	}
}
