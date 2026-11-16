// Old decks brought up to date when the server opens them, before any feature starts.
import { defineFeature, MemoryStore, memoryStores, type Deck, type Feature, type UpgradeParts } from "../kernel/index.ts";
import { FLOOR, holdsADeck, LATEST, MIGRATIONS, oldShapes, type Migration } from "./migrations.ts";
import { compareSemver, parseSemver, readRecord, writeVersion, type Semver, type VersionFile } from "./version.ts";

export function upgradeFeature(): Feature {
	return defineFeature({
		name: "upgrade",
		calls: [],
		async upgrade(deck, file, parts) {
			for (const line of await upgradeDeck(deck, file, MIGRATIONS, LATEST, parts)) console.log(`[upgrade] ${line}`);
		},
	});
}

/** Bring a deck up to date; the lines say what changed. Throws naming a migration that failed. */
export async function upgradeDeck(deck: Deck, file: VersionFile, migrations: readonly Migration[] = MIGRATIONS, latest: Semver = LATEST, parts: UpgradeParts = { stores: memoryStores(), old: new MemoryStore() }): Promise<string[]> {
	if (!(await holdsADeck(deck))) return void (await writeVersion(file, latest)), [];
	const record = await readRecord(file);
	let from = parseSemver(record.version) ? (record.version as Semver) : undefined;
	if (!from || compareSemver(from, FLOOR) < 0) {
		const old = await oldShapes(deck);
		if (old.length) throw new Error(`This deck is older than ${FLOOR}: ${old.join("; ")}. Open it once with today's Decks, which upgrades it to ${FLOOR}.`);
		from = FLOOR;
	}
	const said: string[] = [];
	for (const one of migrations.filter((m) => compareSemver(m.version, from!) > 0)) {
		try {
			await one.run(deck, (line) => said.push(line), parts);
		} catch (error) {
			throw new Error(`The migration ${one.id} failed: ${(error as Error).message}. The deck stays at ${from}.`);
		}
		await writeVersion(file, one.version, { [one.id]: new Date().toISOString() });
		from = one.version;
	}
	if (record.version !== from) await writeVersion(file, from);
	return said;
}
