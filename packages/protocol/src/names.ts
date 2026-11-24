import type { LineClientMessage, ServerMessage } from "./wire.ts";

/**
 * One vocabulary: every name on the wire is `noun.verb`.
 *
 * Commands are the verbs of the table (`@decks/api`, `VERBS`), called at `POST /api/v1/<noun.verb>`
 * or as `line.call` on the line. Events are the messages the harness says, listed here once; the
 * line, the stream (`GET /api/v1/events`) and every front end read the same list. The nouns are
 * the SDK's: canvas, card, agent, chat, doc, app, view, account, harness, presence, line, call, web.
 *
 * `EVENT_NAMES` is typed over `ServerMessage["type"]`, so a message kind added to `wire.ts` without
 * a line here fails to compile, as does a name here that no message has. `names.test.ts` holds
 * every name to the shape.
 */
export const EVENT_NAMES: Record<ServerMessage["type"], true> = {
	"harness.hello": true,
	"harness.runtimes": true,
	"harness.notice": true,
	"harness.error": true,
	"harness.settings": true,
	"harness.paired": true,
	"deck.changed": true,
	"canvas.changed": true,
	"canvas.list": true,
	"card.changed": true,
	"app.changed": true,
	"agent.list": true,
	"agent.state": true,
	"agent.row": true,
	"agent.removed": true,
	"agent.identity": true,
	"agent.model": true,
	"agent.usage": true,
	"agent.report": true,
	"agent.queued": true,
	"agent.context": true,
	"agent.act": true,
	"agent.account": true,
	"agent.prompt": true,
	"agent.promptClosed": true,
	"chat.history": true,
	"chat.earlier": true,
	"chat.tool": true,
	"chat.item": true,
	"chat.delta": true,
	"chat.preview": true,
	"chat.draft": true,
	"doc.created": true,
	"doc.state": true,
	"doc.changed": true,
	"doc.patched": true,
	"doc.versions": true,
	"doc.version": true,
	"doc.compiled": true,
	"doc.repo": true,
	"doc.remote": true,
	"doc.gdoc": true,
	"doc.gcomments": true,
	"view.called": true,
	"call.answered": true,
	"line.hello": true,
	"presence.changed": true,
	"account.list": true,
	"account.needed": true,
	"account.login": true,
	"web.changed": true,
};

/** Every event the harness says, by name. */
export const EVENTS: readonly ServerMessage["type"][] = Object.keys(EVENT_NAMES) as ServerMessage["type"][];

/** The line's own messages, from a client (`LineClientMessage`): the envelope, not events or commands. */
export const LINE_NAMES: Record<Exclude<LineClientMessage["type"], `doc.${string}`>, true> = {
	"line.hello": true,
	"line.token": true,
	"line.call": true,
	"canvas.watch": true,
	"canvas.unwatch": true,
	"view.answered": true,
	"card.seen": true,
	"card.extent": true,
	"presence.set": true,
};

/** The names that stand outside the shape on purpose: three bare words every agent types. */
export const BARE_NAMES: readonly string[] = ["here", "now", "ports"];

/** Whether a name is `noun.verb`: two or more words, each a lowercase word (camelCase inside), joined by dots. */
export function isNounVerb(name: string): boolean {
	return /^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)+$/.test(name);
}
