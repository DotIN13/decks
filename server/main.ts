import { pathToFileURL } from "node:url";
import { canvasFeature } from "./canvas/feature.ts";
import { cards, type CardsOptions } from "./cards/feature.ts";
import { documents, type DocumentsOptions } from "./documents/feature.ts";
import { startServer, type Feature } from "./kernel/index.ts";
import { peopleFeature } from "./people/feature.ts";
import { sharingFeature } from "./sharing/feature.ts";

// Decks-local's entry: the only place a feature is named. features() is the
// list a server runs, also for tests that need every feature at once.
// Run: node --import tsx server/main.ts --deck <folder> [--port 4620] [--host 127.0.0.1]
// Not yet here (wave 2 and later): apps, pictures, tab, upgrade, compat.

export type FeatureOptions = { lib?: CardsOptions["lib"]; google?: DocumentsOptions["google"]; clock?: () => number };

export function features(options: FeatureOptions = {}): Feature[] {
	return [
		canvasFeature(options.clock ? { clock: options.clock } : {}),
		cards(options.lib ? { lib: options.lib } : {}),
		documents(options.google ? { google: options.google } : {}),
		peopleFeature(),
		sharingFeature(),
	];
}

function argsOf(argv: string[]): { deck: string; port: number; host: string } {
	const value = (name: string) => {
		const at = argv.indexOf(`--${name}`);
		return at >= 0 ? argv[at + 1] : undefined;
	};
	const deck = value("deck") ?? process.env.DECKS_DECK;
	if (!deck) throw new Error("Name the deck folder: --deck <folder>.");
	return { deck, port: Number(value("port") ?? 4620), host: value("host") ?? "127.0.0.1" };
}

async function main(): Promise<void> {
	const args = argsOf(process.argv.slice(2));
	const running = await startServer({ ...args, features: features() });
	console.log(`Decks-local serves ${args.deck} at ${running.url}`);
	const stop = () => void running.close().then(() => process.exit(0));
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error: Error) => {
		console.error(error.message);
		process.exit(1);
	});
}
