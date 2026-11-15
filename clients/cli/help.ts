import { existsSync, readFileSync } from "node:fs";
import { CALLS, PROTOCOL_VERSION, type AnyCall } from "../../protocol/index.ts";

// decks help, from the help the generators wrote (dist-gen/cli/help.txt).
// When it is missing, a short list from the protocol's own summaries.

const GENERATED = new URL("../../dist-gen/cli/help.txt", import.meta.url);

const EXTRA = [
	"decks events [event...]      every event as it happens, one JSON line each",
	"decks login [code]           sign this terminal in: a code from decks deck pair, or the lock file",
	"decks logout                 forget this terminal's token",
	"decks serve [--deck d] [--port n]   run Decks-local on a deck folder",
	"decks attach [--tool claude|codex|opencode] [--as name] [--canvas c]   set a tool up as an agent here",
	"decks detach [--tool ...]    undo decks attach",
];

/** All of it, or one call's entry. */
export function help(call?: AnyCall): string {
	const text = generated();
	if (call) {
		const lines = (text ?? "").split("\n");
		const at = lines.findIndex((line) => line.trim().startsWith(`decks ${call.name.replace(".", " ")}`));
		const entry = at >= 0 ? `${lines[at]!.trim()}\n    ${lines[at + 1]?.trim() ?? ""}` : `decks ${call.name.replace(".", " ")}\n    ${call.summary}`;
		return `${entry}\n\nWho may call it: ${call.who.join(", ")}.`;
	}
	const body = text ?? `decks, protocol ${PROTOCOL_VERSION}. (Run node tools/gen/index.ts for the full help.)\n\n${CALLS.filter((c) => c.side === "server").map((c) => `  decks ${c.name.replace(".", " ")}`).join("\n")}\n`;
	return `${body}\n${EXTRA.join("\n")}\n\nDECKS_URL says where Decks is; DECKS_TOKEN, a token decks login kept, or the deck's lock file says who calls.`;
}

function generated(): string | undefined {
	return existsSync(GENERATED) ? readFileSync(GENERATED, "utf8") : undefined;
}
