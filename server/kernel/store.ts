import type { Bytes, Store, VersionFile } from "./types.ts";

// A feature's private state. MemoryStore keeps it in a Map, for tests; the
// folder's store is in disk.ts. A key is any string; prefix filters keys().

export class MemoryStore implements Store {
	private kept = new Map<string, Bytes>();

	async get(key: string): Promise<Bytes | undefined> {
		return this.kept.get(key)?.slice();
	}

	async put(key: string, bytes: Bytes): Promise<void> {
		this.kept.set(key, bytes.slice());
	}

	async delete(key: string): Promise<void> {
		this.kept.delete(key);
	}

	async keys(prefix = ""): Promise<string[]> {
		return [...this.kept.keys()].filter((key) => key.startsWith(prefix)).sort();
	}
}

/** Every feature's store, made once per name. */
export type Stores = (feature: string) => Store;

export function memoryStores(): Stores {
	const all = new Map<string, Store>();
	return (feature) => {
		if (!all.has(feature)) all.set(feature, new MemoryStore());
		return all.get(feature)!;
	};
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function readJson<T>(store: Store, key: string, fallback: T): Promise<T> {
	const bytes = await store.get(key);
	return bytes ? (JSON.parse(decoder.decode(bytes)) as T) : fallback;
}

export function writeJson(store: Store, key: string, value: unknown): Promise<void> {
	return store.put(key, encoder.encode(JSON.stringify(value)));
}

/** A version record kept in memory, for tests. */
export function memoryVersion(text?: string): VersionFile {
	const kept = { text };
	return { read: async () => kept.text, write: async (next) => void (kept.text = next) };
}
