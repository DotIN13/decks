import { dirname, resolve } from "node:path";
import { loadConfig } from "../config.ts";
import { describe, migrated, migrateStandalone } from "./2026-10-20-standalone-canvases.ts";

/**
 * The migrations by hand, before a harness starts on a deck: `npm run migrate -- --dry-run [deck]`
 * prints every move and changes nothing; without `--dry-run` it backs the deck up and migrates it,
 * as a harness's start would (`migrations/index.ts`). The deck is the one `DECKS_DATA_DIR` names
 * when none is given.
 */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const named = args.find((one) => !one.startsWith("--"));
const deck = named ? resolve(named) : loadConfig().deck;
if (!dryRun && migrated(deck)) {
	console.log(`${deck} is migrated already: nothing to do.`);
	process.exit(0);
}
const { plan, ran, backup } = migrateStandalone(deck, { dryRun, dataDir: dirname(deck), log: (line) => console.log(line) });
if (ran) {
	console.log(describe(plan).at(-1));
	if (backup) console.log(`the deck as it was is in ${backup}`);
} else if (dryRun) console.log("dry run: nothing was changed.");
