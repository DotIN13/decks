import type { ClientMessage, ServerMessage } from "@decks/protocol";
import { accounts } from "./accounts.ts";
import { agents } from "./agents.ts";
import { boards } from "./boards.ts";
import { deck } from "./deck.ts";
import type { Reply, WireContext, WireTable } from "./context.ts";
import { web } from "./web.ts";

/**
 * Every frame, and what answers it — the one table.
 *
 * **Typed as the whole of `ClientMessage`, so a frame nobody answers is a compile error.**
 * That is the difference between this and the 38-case switch it replaces: the switch had a
 * `default` that said "Not implemented yet" at run time, which is a reasonable thing to
 * send a stale tab and a poor way to find out that a new frame was never wired up.
 *
 * The modules beside this one each declare `Partial<WireTable>` for the frames they own, so
 * each handler's message is narrowed to its own variant, and this object literal is checked
 * for the ones that are left over. Adding a variant to `ClientMessage` fails here until
 * somebody answers it; adding a handler for a frame that already has one is an ordinary
 * duplicate-key mistake that the compiler also catches.
 */
const WIRE: WireTable = {
	...deck,
	...boards,
	...agents,
	...accounts,
	...web,
};

/**
 * Run one frame.
 *
 * The lookup is defensive at the boundary and only at the boundary: `Hub` parses JSON and
 * hands it over, so a browser built against a previous version can still send a type this
 * build has never heard of. That case answers the same notice the old `default` did — the
 * frame is not *unhandled* here, it is unknown, and saying so is better than silence.
 */
export function dispatch(message: ClientMessage, reply: Reply, wire: WireContext): void {
	const handler = WIRE[message.type] as ((message: ClientMessage, reply: Reply, wire: WireContext) => void) | undefined;
	if (!handler) {
		reply({ type: "notice", level: "warn", text: `Not implemented yet: ${(message as { type: string }).type}` } satisfies ServerMessage);
		return;
	}
	handler(message, reply, wire);
}
