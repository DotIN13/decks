import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appsFeature } from "./apps/feature.ts";
import { canvasFeature } from "./canvas/feature.ts";
import { cards, type CardsOptions } from "./cards/feature.ts";
import { compatFeature } from "./compat/feature.ts";
import { documents, type DocumentsOptions } from "./documents/feature.ts";
import { frameFeature } from "./frame/feature.ts";
import { FolderDeck, startServer, type Feature } from "./kernel/index.ts";
import { peopleFeature } from "./people/feature.ts";
import { picturesFeature } from "./pictures/feature.ts";
import { sharingFeature } from "./sharing/feature.ts";
import { tabFeature } from "./tab/feature.ts";
import { upgradeFeature } from "./upgrade/feature.ts";

// Decks-local's entry: the only place a feature is named. features() is the
// list a server runs, also for tests that need every feature at once.
// Run: node --import tsx server/main.ts --deck <folder> [--port 4620] [--host 127.0.0.1]
// upgrade comes first: upgrade hooks run in feature order, before any start.

export type FeatureOptions = { lib?: CardsOptions["lib"]; google?: DocumentsOptions["google"]; clock?: () => number; appRun?: string };

export function features(options: FeatureOptions = {}): Feature[] {
	return [
		upgradeFeature(),
		canvasFeature(options.clock ? { clock: options.clock } : {}),
		cards(options.lib ? { lib: options.lib } : {}),
		documents(options.google ? { google: options.google } : {}),
		peopleFeature(),
		sharingFeature(),
		appsFeature({ ...(options.appRun ? { workdir: options.appRun } : {}), ...(options.clock ? { clock: options.clock } : {}) }),
		tabFeature(),
		picturesFeature(),
		compatFeature(),
		frameFeature(),
	];
}

async function main(): Promise<void> {
	const args = argsOf(process.argv.slice(2));
	const lib = cardLib();
	const running = await startServer({ ...args, features: features(lib ? { lib } : {}) });
	console.log(`Decks-local serves ${args.deck} at ${running.url}`);
	const stop = () => {
		setTimeout(() => process.exit(0), 3000).unref();
		void running.close().then(() => process.exit(0));
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
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

/** The card runtime cards copy into a deck's lib/: today's card-host, until it moves at the switch-over. */
function cardLib(): FeatureOptions["lib"] {
	const folder = fileURLToPath(new URL("../canvas/cards/runtime/lib", import.meta.url));
	return existsSync(folder) ? new FolderDeck(folder) : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error: Error) => {
		console.error(error.message);
		process.exit(1);
	});
}
