// A document's line: what the documents (docs.ts, google.ts) need of the line a page talks on, and the
// file calls they make as its caller.
import type { Caller } from "../../protocol/index.ts";
import type { SocketDoor, Stop } from "../kernel/index.ts";

type Said = Record<string, unknown>;

/** What the documents need of a line: who it is, its subscriptions, the documents it has open, and its sender. */
export type DocLine = {
	state: { caller?: Caller; watched: Map<string, Stop>; docs?: Set<string>; clients?: Set<string> };
	door: SocketDoor;
	send: (message: Said) => void;
	client: ReturnType<SocketDoor["client"]>;
};

/** A file call as the line's caller: the value, or the refusal's words. */
export async function call(L: DocLine, name: string, args: Record<string, unknown>): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
	const envelope = await L.door.call(name, args, L.state.caller!, L.client);
	return envelope.ok ? { ok: true, value: envelope.value } : { ok: false, error: envelope.error.message };
}
