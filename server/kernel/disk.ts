import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type { Stores } from "./store.ts";
import type { Bytes, Store, VersionFile } from "./types.ts";

// The kernel's own things on disk, outside what file calls reach: each feature's
// store in <deck>/.decks/<feature>/ (one file per key, encoded so none climbs
// out), the deck's version record, the machine folder, temporary folders.

const encode = (key: string) => key.split("/").map((part) => encodeURIComponent(part) || "%00").join(sep);

export class FolderStore implements Store {
	constructor(private dir: string) {}

	async get(key: string): Promise<Bytes | undefined> {
		return readFile(join(this.dir, encode(key))).then((buf) => new Uint8Array(buf), () => undefined);
	}

	async put(key: string, bytes: Bytes): Promise<void> {
		const file = join(this.dir, encode(key));
		await mkdir(dirname(file), { recursive: true, mode: 0o700 });
		await writeFile(file, bytes, { mode: 0o600 });
	}

	async delete(key: string): Promise<void> {
		await rm(join(this.dir, encode(key)), { force: true });
	}

	async keys(prefix = ""): Promise<string[]> {
		const entries = await readdir(this.dir, { recursive: true, withFileTypes: true }).catch(() => []);
		const keys = entries
			.filter((one) => one.isFile())
			.map((one) => relative(this.dir, join(one.parentPath, one.name)).split(sep).map(decodeURIComponent).join("/"));
		return keys.filter((key) => key.startsWith(prefix)).sort();
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
