import { toDeckPath, type Deck, type Store } from "../kernel/index.ts";
import { LOG_LINES } from "./logs.ts";

// Today's apps state carried into the feature's store when a deck is opened (rule 18): the
// forwarded ports (.decks/ports.json) and the log of each app still here. Nothing kept
// already is overwritten; the old files are left where they are.

/** Carry what is not carried yet, saying each step. */
export async function upgradeApps(deck: Deck, old: Store, store: Store, say: (line: string) => void = () => {}): Promise<void> {
	const ports = await old.get("ports.json");
	if (ports && !(await store.get("ports.json"))) {
		await store.put("ports.json", ports);
		say("forwarded ports kept");
	}
	let logs = 0;
	for (const key of await old.keys("apps/")) {
		const name = /^apps\/([a-z0-9][a-z0-9-]{0,47})\.log$/.exec(key)?.[1];
		if (!name || (await store.get(`log/${name}`))) continue;
		// A log belongs to its app: one whose app is gone is not carried.
		if (!(await deck.read(toDeckPath(`apps/${name}/app.json`)).then(() => true, () => false))) continue;
		const text = new TextDecoder().decode((await old.get(key)) ?? new Uint8Array());
		const lines = text.split("\n").filter(Boolean).slice(-LOG_LINES);
		await store.put(`log/${name}`, new TextEncoder().encode(`${lines.join("\n")}\n`));
		logs += 1;
	}
	if (logs) say(`${logs} app logs kept`);
}
