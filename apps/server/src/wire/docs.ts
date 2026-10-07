import type { WirePart } from "./context.ts";

/**
 * Document pages (`@decks/docs`): open, type, review, go back, write back.
 *
 * Opening a file copies it into the deck's `docs/<name>/` (`app.ts`, `DocLibrary`), so its history
 * and suggestions live in the deck; the original changes only on `doc.writeback`.
 *
 * Every frame goes to the service as it came. A page's own answers (`doc.state`, `doc.patched`,
 * `doc.versions`) go to that page alone; what changed goes to every browser as `doc.changed`,
 * from the service, so a second tab, a phone and the page that typed it hear the same thing in
 * the same order.
 */
export const docs = {
	"doc.open": (message, reply, wire) => wire.docs.handle(message, reply),
	"doc.close": (message, reply, wire) => wire.docs.handle(message, reply),
	"doc.patch": (message, reply, wire) => wire.docs.handle(message, reply),
	"doc.review": (message, reply, wire) => wire.docs.handle(message, reply),
	"doc.versions": (message, reply, wire) => wire.docs.handle(message, reply),
	"doc.restore": (message, reply, wire) => wire.docs.handle(message, reply),
	"doc.writeback": (message, reply, wire) => wire.docs.handle(message, reply),
} satisfies WirePart;
