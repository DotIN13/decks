import type { Answerer } from "@decks/sdk";
import type { ExtensionUiAnswer, MessagePart } from "../runtimes/types/index.ts";
import { cleanParts } from "../runtimes/shared/message-parts.ts";
import type { Sessions } from "./index.ts";
import type { HostLink, Session } from "./session.ts";
import { cardsAt, forkRef, restoreCards, rewind } from "./timeline.ts";

// The chat calls the server passes to this harness, one short answer each.
// An agent this harness does not run is refused not_found.

export interface ChatDeps {
	sessions: Sessions;
	host: HostLink;
	/** A fork's runtime handle, waiting for its agent.requested. */
	forks: Map<string, string>;
	/** Remember the agent every new page starts on. */
	focus(agent: string): void;
}

type A = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const refused = (code: string, message: string, hint?: string) => Object.assign(new Error(message), { code, ...(hint ? { hint } : {}) });

export function chatAnswers(deps: ChatDeps): Record<string, Answerer> {
	const one = (args: A): Session => deps.sessions.require(text(args.agent));
	const agent = (id: string) => deps.host.call("agent.get", { agent: id });
	return {
		"chat.focus": (args) => {
			const id = one(args).id;
			deps.focus(id);
			return agent(id);
		},
		"chat.send": (args) => send(one(args), text(args.text), cleanParts(args.parts)),
		"chat.abort": async (args) => {
			const session = one(args);
			await session.abort();
			return agent(session.id);
		},
		"chat.queue": (args) => queue(one(args), args),
		"chat.list": (args) => list(deps, one(args), args),
		"chat.get": (args) => {
			const session = one(args);
			const found = deps.sessions.transcripts.find(session.id, session.history(), text(args.item));
			if (!found) throw refused("not_found", "That entry is not in this conversation.", "chat.list");
			return found;
		},
		"chat.preview": async (args) => (args.entry === null ? { entry: null, cards: {} } : { entry: text(args.entry), cards: await cardsAt(one(args), text(args.entry)) }),
		"chat.rewind": async (args) => {
			const session = one(args);
			const words = await rewind(session, text(args.entry));
			if (words !== undefined) {
				deps.host.tell("chat.changed", { ids: [session.id], by: session.id, rev: Date.now() });
				if (words) deps.host.tell("chat.drafted", { ids: [session.id], by: session.id, rev: Date.now(), text: words });
			}
			return agent(session.id);
		},
		"chat.fork": (args) => fork(deps, one(args), text(args.entry)),
		"chat.restore": (args) => restoreCards(one(args), text(args.entry)),
		"chat.answer": (args) => {
			const session = one(args);
			session.bridge.answer({ id: text(args.question), ...(args.answer as object) } as ExtensionUiAnswer);
			return agent(session.id);
		},
		"chat.delete": (args) => {
			const id = one(args).id;
			deps.sessions.restart(id);
			deps.host.tell("chat.changed", { ids: [id], by: id, rev: 0 });
			return { deleted: id };
		},
	};
}

function send(session: Session, words: string, parts: MessagePart[] | undefined) {
	if (!words.trim()) throw refused("invalid", "A message needs words.");
	return session.send(words, parts) ?? { id: `queued-${Date.now().toString(36)}`, kind: "notice", level: "info", text: "Queued until this turn ends.", at: Date.now() };
}

function queue(session: Session, args: A) {
	const action = text(args.action);
	if (action === "add") session.queues.add(text(args.text), cleanParts(args.parts));
	else if (action === "remove") session.queues.remove(text(args.item));
	else if (action === "send") session.queues.sendNow(text(args.item));
	else if (action === "release") session.queues.release();
	return session.queues.view();
}

function list(deps: ChatDeps, session: Session, args: A) {
	const limit = Math.min(Math.max(typeof args.limit === "number" ? args.limit : 200, 1), 500);
	const before = typeof args.before === "string" ? args.before : undefined;
	return deps.sessions.transcripts.page(session.id, session.history(), before, limit);
}

/** A new agent of the same kind, near this one, that opens on the conversation up to the entry. */
async function fork(deps: ChatDeps, session: Session, entry: string) {
	const ref = await forkRef(session, entry);
	if (!ref) throw refused("not_found", "There is nothing before that message to fork from.", "chat.list");
	const made = (await deps.host.call("agent.create", { kind: session.spec.kind, name: `${session.spec.name} fork`, near: session.id })) as { id: string };
	deps.forks.set(made.id, ref);
	deps.sessions.get(made.id)?.resumeFrom(ref);
	return made;
}
