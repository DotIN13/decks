import type { Caller } from "../../../protocol/index.ts";
import { sync } from "../../../protocol/index.ts";
import { toDeckPath, type Deck } from "../../kernel/types.ts";

// The deck as the client sees it: canvas folders, their canvas.json, and the
// files of each canvas's bundle. Every read and write goes through Deck.

export const BUNDLE = ["cards", "frames", "files"] as const;
export type CanvasJson = { title?: string; studio?: string; [key: string]: unknown };

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

export async function readText(deck: Deck, path: string): Promise<string | undefined> {
	try {
		return decode(await deck.read(toDeckPath(path)));
	} catch {
		return undefined;
	}
}

export async function readBytes(deck: Deck, path: string): Promise<Uint8Array | undefined> {
	try {
		return await deck.read(toDeckPath(path));
	} catch {
		return undefined;
	}
}

export const writeText = (deck: Deck, path: string, text: string, by: Caller) => deck.write(toDeckPath(path), new TextEncoder().encode(text), by);

async function dirs(deck: Deck, dir: string): Promise<string[]> {
	try {
		return (await deck.list(toDeckPath(dir))).filter((e) => e.kind === "dir").map((e) => e.path);
	} catch {
		return [];
	}
}

/** My own canvas folders that hold a drawing: canvases/<name>. */
export async function ownFolders(deck: Deck): Promise<string[]> {
	const out: string[] = [];
	for (const dir of await dirs(deck, "canvases")) if ((await readBytes(deck, `${dir}/canvas.pen`)) !== undefined) out.push(dir);
	return out.sort();
}

export async function readJson(deck: Deck, folder: string): Promise<CanvasJson> {
	const got = await readText(deck, `${folder}/canvas.json`);
	try {
		return got ? (JSON.parse(got) as CanvasJson) : {};
	} catch {
		return {};
	}
}

export async function markStudio(deck: Deck, folder: string, id: string, by: Caller, title?: string): Promise<void> {
	const was = await readJson(deck, folder);
	if (was.studio === id && (title === undefined || was.title !== undefined)) return;
	await writeText(deck, `${folder}/canvas.json`, `${JSON.stringify({ ...was, ...(was.title || !title ? {} : { title }), studio: id }, null, 2)}\n`, by);
}

/** Every file of a canvas's bundle, by its path in the folder; secrets left out. */
export async function bundleFiles(deck: Deck, folder: string): Promise<string[]> {
	const out: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		let entries;
		try {
			entries = await deck.list(toDeckPath(dir));
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.kind === "dir") await walk(e.path);
			else out.push(e.path.slice(folder.length + 1));
		}
	};
	for (const part of BUNDLE) await walk(`${folder}/${part}`);
	return out.filter((p) => sync.safeSyncPath(p) && !sync.secretLooking(p)).sort();
}

/** A copy's name beside the file: notes.conflict-20261103-0012.txt. */
export function conflictName(path: string, now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
	const slash = path.lastIndexOf("/");
	const name = path.slice(slash + 1);
	const dot = name.lastIndexOf(".");
	const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	return `${path.slice(0, slash + 1)}${stem}.conflict-${stamp}${ext}`;
}
