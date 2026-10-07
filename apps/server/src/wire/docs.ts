import type { WirePart } from "./context.ts";

/**
 * Document pages (`docs/service.ts`): open, type, review, go back.
 *
 * A page's own answers (`doc.state`, `doc.patched`, `doc.versions`) go to that page alone; what
 * changed goes to every browser as `doc.changed`, from the service, so a second tab, a phone and
 * the page that typed it all hear the same thing in the same order.
 */
export const docs = {
	"doc.open": (message, reply, wire) => {
		reply(wire.docs.opened(message.path, message.client));
	},
	"doc.close": (message, _reply, wire) => {
		wire.docs.closed(message.path, message.client);
	},
	"doc.patch": (message, reply, wire) => {
		reply(wire.docs.patch(message.path, message.client, message.rev, message.batch, message.splices));
	},
	"doc.review": (message, _reply, wire) => {
		wire.docs.review(message.path, message.change, message.accept);
	},
	"doc.versions": (message, reply, wire) => {
		try {
			reply(wire.docs.versions(message.path));
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
		}
	},
	"doc.restore": (message, reply, wire) => {
		try {
			wire.docs.restore(message.path, message.sha);
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
		}
	},
} satisfies WirePart;
