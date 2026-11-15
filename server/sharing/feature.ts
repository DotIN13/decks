import { calls, Refused } from "../../protocol/index.ts";
import { defineFeature, handleAll, type Context, type Deck, type Feature, type Kernel, type Store } from "../kernel/types.ts";
import { forget, readLink, writeLink, type Link } from "./client/link.ts";
import { DeckSync, type SyncOptions } from "./client/sync.ts";
import { bundleRoute } from "./bundle/bundle.ts";
import { networkTransport } from "./client/network.ts";
import { StudioError, type Transport } from "./client/transport.ts";

// The sharing feature: studio.status, connect and disconnect, and the sync
// client that runs while a key is kept. Only the person connects.

export type SharingOptions = Pick<SyncOptions, "log" | "inventory" | "issueToken" | "unlinked"> & { transport?: Transport; settleMs?: number };

type Running = { sync?: DeckSync; deck?: Deck; store?: Store; stopWatch?: () => void; timer?: ReturnType<typeof setTimeout> };

export function sharingFeature(given: SharingOptions = {}): Feature {
	const opts = { ...given, transport: given.transport ?? networkTransport() };
	const running: Running = {};
	const begin = async (deck: Deck, store: Store, link: Link) => {
		await end(running);
		const sync = new DeckSync({ ...opts, deck, store, url: link.url, key: link.key });
		Object.assign(running, { sync, deck, store });
		running.stopWatch = deck.watch((change) => {
			if (change.by === sync.by.id || !/^(?:shared\/)?canvases\//.test(change.path)) return;
			clearTimeout(running.timer);
			running.timer = setTimeout(() => void sync.sync().catch((e: Error) => opts.log?.(`Studio sync failed: ${e.message}`)), opts.settleMs ?? 1000);
			running.timer.unref?.();
		});
		await sync.start();
		void sync.sync().catch((e: Error) => opts.log?.(`Studio sync failed: ${e.message}`));
	};
	return defineFeature({
		name: "sharing",
		routes: [bundleRoute],
		calls: handleAll(calls.studio, {
			status: async (ctx) => status(await readLink(ctx.store)),
			connect: async (ctx, { url, key }) => connect(ctx, opts, url, key, begin),
			disconnect: async (ctx) => {
				await end(running);
				await forget(ctx.store);
				return { connected: false };
			},
		}),
		async start(kernel: Kernel) {
			const store = kernel.store("sharing");
			const link = await readLink(store);
			if (link) await begin(kernel.deck, store, link);
			return () => void end(running);
		},
	});
}

const status = (link: Link | undefined) => (link ? { connected: true, url: link.url } : { connected: false });

type Ready = SharingOptions & { transport: Transport };

async function connect(ctx: Context, opts: Ready, url: string, key: string, begin: (deck: Deck, store: Store, link: Link) => Promise<void>) {
	if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Refused("invalid", `${url} is not a Studio address: it starts with https://.`, "studio.connect");
	const link = { url: url.replace(/\/+$/, ""), key };
	try {
		await new DeckSync({ ...opts, deck: ctx.deck, store: ctx.store, ...link }).hello();
	} catch (error) {
		if (error instanceof StudioError && error.status === 401) throw new Refused("refused", "Studio did not take that key: make a new one in Studio.", "studio.connect");
		throw new Refused("unavailable", `Studio did not answer at ${link.url}: ${(error as Error).message}`, "studio.status");
	}
	await writeLink(ctx.store, link);
	await begin(ctx.deck, ctx.store, link);
	return status(link);
}

async function end(running: Running): Promise<void> {
	clearTimeout(running.timer);
	running.stopWatch?.();
	const sync = running.sync;
	Object.assign(running, { sync: undefined, stopWatch: undefined, timer: undefined });
	await sync?.stop();
}
