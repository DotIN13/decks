import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { PROTOCOL_VERSION } from "../../protocol/index.ts";
import { LOCAL_PERSON } from "./callers.ts";
import { FolderDeck } from "./deck.ts";
import { folderStores, folderVersion } from "./disk.ts";
import { listen, type Served } from "./doors/http.ts";
import { buildKernel, type Built } from "./kernel.ts";
import { checkLock, takeLock } from "./lockfile.ts";
import type { Stores } from "./store.ts";
import type { Deck, Feature, VersionFile } from "./types.ts";

// Starts Decks-local on a deck folder: the kernel with the features it is
// given, the doors on a port, and the lock file with a fresh token for the
// person on this machine. A deck already served, or a port in use, fails
// with a sentence before anything is left half started.

export type ServerOptions = { deck: string; port: number; host?: string; features: Feature[]; clock?: () => number };

export type Running = { url: string; port: number; token: string; built: Built; close(): Promise<void> };

export type KernelServerOptions = { deck: Deck; stores: Stores; version?: VersionFile; features: Feature[]; port: number; host?: string; clock?: () => number };

export async function startServer(options: ServerOptions): Promise<Running> {
	const root = resolve(options.deck);
	if (!(await stat(root).then((s) => s.isDirectory(), () => false))) throw new Error(`${root} is not a folder.`);
	await checkLock(root);
	const deck = new FolderDeck(root, options.clock);
	const built = await buildKernel({ deck, stores: folderStores(root), version: folderVersion(root), features: options.features, ...(options.clock ? { clock: options.clock } : {}) });
	let served: Served;
	try {
		served = await listen(built, options.port, options.host);
	} catch (error) {
		await built.stop();
		deck.close();
		throw error;
	}
	built.callers.revoke(LOCAL_PERSON.id);
	const token = built.callers.issue(LOCAL_PERSON, "lock file");
	const release = await takeLock(root, { url: served.url, pid: process.pid, protocol: PROTOCOL_VERSION, started: Date.now(), token });
	const close = async () => {
		await served.close();
		await release();
		await built.stop();
		deck.close();
	};
	return { url: served.url, port: served.port, token, built, close };
}

/** The kernel and its doors on a deck and stores a host brings (Studio): no folder, no lock file. */
export async function startKernel(options: KernelServerOptions): Promise<{ url: string; port: number; built: Built; close(): Promise<void> }> {
	const { deck, stores, features, version, clock } = options;
	const built = await buildKernel({ deck, stores, features, ...(version ? { version } : {}), ...(clock ? { clock } : {}) });
	const served = await listen(built, options.port, options.host).catch(async (error: Error) => {
		await built.stop();
		throw error;
	});
	return { url: served.url, port: served.port, built, close: async () => (await served.close(), await built.stop()) };
}
