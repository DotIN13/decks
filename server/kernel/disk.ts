import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { appendFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type { Stores } from "./store.ts";
import type { Bytes, Store, VersionFile } from "./types.ts";

// The kernel's own things on disk, outside what file calls reach: each feature's
// store in <deck>/.decks/<feature>/, the deck's version record, the machine
// folder, temporary folders.

// File names for store keys. One rule: a key's parts are folders and a file;
// each part keeps its words (any script) and escapes only what a file name
// cannot hold (%, /, \, :, control characters, a leading dot). A part longer than
// 200 bytes becomes a short stem and a hash, its words kept in a hidden
// .<name>.key beside it. Names written before (every part percent-encoded) still read.

const LONG = 200;
const encoder = new TextEncoder();
const UNSAFE = /[%/\\:\u0000-\u001f\u007f]/g;

/** One key part as a name a file may have, and its words when the name had to be shortened. */
function nameOf(part: string): { name: string; long?: string } {
	if (part === "") return { name: "%00" };
	const escaped = part.replace(UNSAFE, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`).replace(/^\./, "%2E");
	if (encoder.encode(escaped).length <= LONG) return { name: escaped };
	let stem = "";
	for (const char of escaped) {
		if (encoder.encode(stem + char).length > 60) break;
		stem += char;
	}
	return { name: `${stem.replace(/%[0-9A-F]{0,1}$/, "")}~${createHash("sha256").update(part).digest("hex").slice(0, 16)}`, long: part };
}

/** A key's file under the store's folder, as named now and as named before. */
function filesOf(dir: string, key: string): { now: string; before: string; longs: { at: string; part: string }[] } {
	const parts = key.split("/");
	let at = dir;
	const longs: { at: string; part: string }[] = [];
	for (const part of parts) {
		const { name, long } = nameOf(part);
		if (long) longs.push({ at: join(at, `.${name}.key`), part: long });
		at = join(at, name);
	}
	return { now: at, before: join(dir, ...parts.map((part) => encodeURIComponent(part) || "%00")), longs };
}

export class FolderStore implements Store {
	constructor(private dir: string) {}

	async get(key: string): Promise<Bytes | undefined> {
		const { now, before } = filesOf(this.dir, key);
		const bytes = await readFile(now).catch(() => readFile(before)).catch(() => undefined);
		return bytes ? new Uint8Array(bytes) : undefined;
	}

	async put(key: string, bytes: Bytes): Promise<void> {
		const { now, before, longs } = filesOf(this.dir, key);
		await mkdir(dirname(now), { recursive: true, mode: 0o700 });
		for (const one of longs) await writeFile(one.at, one.part, { mode: 0o600 });
		await writeFile(now, bytes, { mode: 0o600 });
		if (before !== now) await rm(before, { force: true }).catch(() => undefined);
	}

	async delete(key: string): Promise<void> {
		const { now, before } = filesOf(this.dir, key);
		await rm(now, { force: true });
		await rm(before, { force: true }).catch(() => undefined);
	}

	async keys(prefix = ""): Promise<string[]> {
		const found = new Set<string>();
		await this.walk(this.dir, [], found);
		return [...found].filter((key) => key.startsWith(prefix)).sort();
	}

	/** Every key under a folder: a name's words from its .key when shortened, else the name unescaped. */
	private async walk(dir: string, parts: string[], found: Set<string>): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const long = await readFile(join(dir, `.${entry.name}.key`), "utf8").catch(() => undefined);
			const part = long ?? safeDecode(entry.name);
			if (entry.isDirectory()) await this.walk(join(dir, entry.name), [...parts, part], found);
			else if (entry.isFile()) found.add([...parts, part].join("/"));
		}
	}
}

function safeDecode(name: string): string {
	if (name === "%00") return "";
	try {
		return decodeURIComponent(name);
	} catch {
		return name;
	}
}

/** The stores of a deck folder, one per feature, under .decks/. */
export function folderStores(root: string): Stores {
	const all = new Map<string, Store>();
	return (feature) => {
		if (!all.has(feature)) all.set(feature, new FolderStore(join(root, ".decks", encodeURIComponent(feature))));
		return all.get(feature)!;
	};
}

/** The deck's version record on a folder: <deck>/.decks/migrations.json. */
export function folderVersion(root: string): VersionFile {
	const file = join(root, ".decks", "migrations.json");
	return {
		read: () => readFile(file, "utf8").catch(() => undefined),
		async write(text) {
			await mkdir(dirname(file), { recursive: true, mode: 0o700 });
			await writeFile(file, text);
		},
	};
}

/** The machine's own folder: the given one, else $DECKS_HOME, else ~/.decks; made user-only. */
export async function machineFolder(given?: string): Promise<string> {
	const folder = given ?? process.env.DECKS_HOME ?? join(homedir(), ".decks");
	await mkdir(folder, { recursive: true, mode: 0o700 });
	await chmod(folder, 0o700);
	return folder;
}

/** A fresh temporary folder and a way to remove it; one never removed goes when the process exits. */
export async function tempFolder(name: string): Promise<{ folder: string; remove(): Promise<void> }> {
	const folder = await mkdtemp(join(tmpdir(), `${name}-`));
	const atExit = () => rmSync(folder, { recursive: true, force: true });
	process.once("exit", atExit);
	return { folder, remove: () => (process.off("exit", atExit), rm(folder, { recursive: true, force: true })) };
}

/** A log of the refusals scoped callers meet, one JSON line each, for the browser checks' runner:
 *  the file DECKS_REFUSALS names, or nothing when it is not set. */
export function refusalLog(file = process.env.DECKS_REFUSALS): ((refusal: Record<string, unknown>) => void) | undefined {
	if (!file) return undefined;
	return (refusal) => {
		try {
			appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...refusal })}\n`);
		} catch {
			// A log that cannot be written refuses nothing.
		}
	};
}
