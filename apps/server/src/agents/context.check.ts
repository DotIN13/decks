/**
 * A quick look at what the agent is actually told.
 *
 *     npm run context --workspace @decks/server            # the committed demo
 *     npm run context --workspace @decks/server -- ~/x/decks
 */
import { Deck } from "../deck/loader.ts";
import { deckContext } from "./context.ts";

const deck = Deck.open(process.argv[2] ?? "../../example/decks");
const text = deckContext(deck);
console.log(`length: ${text.length} chars, ~${Math.round(text.length / 4)} tokens`);
for (const needle of ["delegate(", "stage.show", "board-debug", "data-id", "interface Stage", "{{"]) {
	console.log(`${needle.padEnd(18)} ${text.includes(needle) ? "present" : "MISSING"}`);
}
console.log("--- boards ---");
console.log(text.split("\n").filter((line) => line.startsWith("- `boards/")).join("\n"));
