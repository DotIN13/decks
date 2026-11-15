import { toDeckPath } from "../../kernel/types.ts";
import { hashOf, type SyncFile } from "../hub/store.ts";
import type { Pass } from "./drawing.ts";
import { bundleFiles, conflictName, readBytes } from "./folders.ts";
import type { CanvasState, SyncState } from "./link.ts";
import { StudioError } from "./transport.ts";

// One canvas's bundle files in step with Studio. A file both sides changed
// is kept twice. A pause Studio asks for stops uploads until it is over.

export type FilePass = Pass & { state: SyncState; conflicts: string[]; pause: { until: number; onPause: (seconds: number) => void } };
type Here = { folder: string; name: string; s: CanvasState; editable: boolean; base: string };

/** What to do with one path, from our bytes, Studio's file and what both last agreed. */
type Plan = "same" | "upload" | "download" | "remove-here" | "remove-there" | "conflict" | "forget";

export async function syncFiles(p: FilePass, folder: string, name: string, s: CanvasState, editable: boolean): Promise<void> {
	const base = `/sync/v1/canvases/${encodeURIComponent(s.id)}/files`;
	const here: Here = { folder, name, s, editable, base };
	const remote = new Map(((await p.api.call("GET", base)).files as SyncFile[]).map((f) => [f.path, f]));
	const local = new Map<string, Uint8Array>();
	for (const path of await bundleFiles(p.deck, folder)) {
		const bytes = await readBytes(p.deck, `${folder}/${path}`);
		if (bytes) local.set(path, bytes);
	}
	const paths = [...new Set([...local.keys(), ...remote.keys(), ...Object.keys(s.files)])].sort();
	for (const path of paths) {
		const bytes = local.get(path);
		await act(p, here, path, bytes, remote.get(path), plan(bytes && hashOf(bytes), remote.get(path), s.files[path]));
	}
}

function plan(mine: string | undefined, theirs: SyncFile | undefined, known: { version: number; hash: string } | undefined): Plan {
	if (mine && !theirs) return known && known.hash === mine ? "remove-here" : "upload";
	if (!mine && theirs) return known && known.version === theirs.version ? "remove-there" : "download";
	if (!mine || !theirs) return "forget";
	if (mine === theirs.hash) return "same";
	if (known && known.hash === mine) return "download";
	if (known && known.version === theirs.version) return "upload";
	return "conflict";
}

async function act(p: FilePass, h: Here, path: string, bytes: Uint8Array | undefined, theirs: SyncFile | undefined, what: Plan): Promise<void> {
	const full = `${h.folder}/${path}`;
	if (what === "same") h.s.files[path] = { version: theirs!.version, hash: theirs!.hash };
	else if (what === "forget") delete h.s.files[path];
	else if (what === "download") await download(p, h, path, theirs!);
	else if (what === "remove-here") {
		await p.deck.remove(toDeckPath(full), p.by);
		delete h.s.files[path];
	} else if (!h.editable) return;
	else if (what === "upload") await upload(p, h, path, bytes!, theirs?.version);
	else if (what === "remove-there") {
		await p.api.call("DELETE", `${h.base}?path=${encodeURIComponent(path)}&base=${theirs!.version}`).catch(() => undefined);
		delete h.s.files[path];
	} else if (what === "conflict") await conflict(p, h, path, bytes!, theirs!);
}

async function download(p: FilePass, h: Here, path: string, f: SyncFile): Promise<void> {
	const bytes = await p.api.bytes(`/sync/v1/blobs/${f.hash}`);
	await p.deck.write(toDeckPath(`${h.folder}/${path}`), bytes, p.by);
	h.s.files[path] = { version: f.version, hash: f.hash };
}

/** Ours beside theirs as a conflicted copy, which goes up too; theirs at the path. */
async function conflict(p: FilePass, h: Here, path: string, mine: Uint8Array, theirs: SyncFile): Promise<void> {
	const copy = conflictName(path);
	await p.deck.write(toDeckPath(`${h.folder}/${copy}`), mine, p.by);
	await download(p, h, path, theirs);
	p.conflicts.push(`${h.name}:${path}`);
	await upload(p, h, copy, mine, undefined);
}

async function upload(p: FilePass, h: Here, path: string, bytes: Uint8Array, base: number | undefined): Promise<void> {
	const hash = hashOf(bytes);
	const said = `${h.s.id}:${path}:${hash}`;
	if (p.pause.until > Date.now() || p.state.said.includes(said)) return;
	try {
		const put = await p.api.put(`${h.base}?path=${encodeURIComponent(path)}${base === undefined ? "" : `&base=${base}`}`, bytes);
		if (put.current) h.s.files[path] = { version: put.version as number, hash };
	} catch (error) {
		if (!(error instanceof StudioError)) throw error;
		if (error.status === 429) return pause(p, error.retryAfter ?? 60);
		p.state.said.push(said);
		p.log(`Studio did not upload ${path}: ${error.message}`);
	}
}

function pause(p: FilePass, seconds: number): void {
	p.pause.until = Date.now() + seconds * 1000;
	p.log(`Studio asked for no more files for ${seconds} s; the rest go up after.`);
	p.pause.onPause(seconds);
}
