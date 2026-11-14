import { Session, type SessionDeps } from "./session.ts";
import type { Spec } from "./identity.ts";

// The sessions a harness holds, one per agent the server asked it to run.
export { Session, type HostLink, type SessionDeps } from "./session.ts";
export { specOf, identityReminder, type Spec, type Agent } from "./identity.ts";
export { Transcripts, type Saved } from "./transcript.ts";
export { Queues, QUEUE_LIMIT, type Mail } from "./queue.ts";
export * as timeline from "./timeline.ts";
export { chatAnswers, type ChatDeps } from "./answers.ts";

const notFound = (id: string) => Object.assign(new Error(`This harness runs no agent ${id}.`), { code: "not_found", hint: "agent.list" });

export class Sessions {
	private readonly held = new Map<string, Session>();

	constructor(private readonly deps: SessionDeps) {}

	get transcripts(): SessionDeps["transcripts"] {
		return this.deps.transcripts;
	}

	/** agent.requested: a new session, or an adopted one given its fresh token. Dormant either way. */
	start(spec: Spec): Session {
		const known = this.held.get(spec.id);
		if (known) {
			if (spec.token) known.retoken(spec.token);
			return known;
		}
		const saved = this.deps.transcripts.read(spec.id);
		const session = new Session(spec, this.deps, saved && saved.kind === spec.kind ? saved : undefined);
		this.held.set(spec.id, session);
		return session;
	}

	get(id: string): Session | undefined {
		return this.held.get(id);
	}

	require(id: string): Session {
		const found = this.held.get(id);
		if (!found) throw notFound(id);
		return found;
	}

	all(): Session[] {
		return [...this.held.values()];
	}

	/** chat.delete: the conversation starts over; the agent stays. */
	restart(id: string): Session {
		const old = this.require(id);
		old.dispose();
		this.deps.transcripts.forget(id);
		this.held.delete(id);
		const token = old.snapshot().token;
		return this.start({ ...old.spec, ...(token ? { token } : {}) });
	}

	/** The agent was deleted: its session ends and its transcript goes. */
	drop(id: string): void {
		this.held.get(id)?.dispose();
		this.held.delete(id);
		this.deps.transcripts.forget(id);
	}

	dispose(): void {
		for (const session of this.held.values()) session.dispose();
		this.held.clear();
	}
}
