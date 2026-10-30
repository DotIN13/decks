import { dirname, resolve } from "node:path";
import { loadConfig } from "../config.ts";
import { deckVersion, DryRun, LATEST, runAtOpen } from "./index.ts";

/**
 * The migrations by hand, before a harness starts on a deck: `npm run migrate -- --dry-run [deck]`
 * prints every move the migrations after the deck's version would make and changes nothing; without
 * `--dry-run` it runs them, as a harness's start would (`migrations/index.ts`). The deck is the one
 * `DECKS_DATA_DIR` names when none is given.
 */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const named = args.find((one) => !one.startsWith("--"));
const deck = named ? resolve(named) : loadConfig().deck;
try {
	const said = runAtOpen(deck, { dryRun, dataDir: dirname(deck) });
	for (const line of said) console.log(line);
	console.log(`${deck} is at version ${deckVersion(deck)} of ${LATEST}.`);
} catch (error) {
	if (!(error instanceof DryRun)) throw error;
	for (const line of error.lines) console.log(line);
	console.log("dry run: nothing was changed.");
}
