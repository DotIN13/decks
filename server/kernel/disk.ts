import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Stores } from "./store.ts";
import type { Bytes, Store, VersionFile } from "./types.ts";

// A feature's private store on a folder: <deck>/.decks/<feature>/, one file
// per key, each part of the key encoded, so no key can climb out. Hidden from
// file calls because toDeckPath refuses .decks.

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
