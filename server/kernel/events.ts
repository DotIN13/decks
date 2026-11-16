import { check, EVENTS, layout, type AnyEvent, type Caller, type Payload } from "../../protocol/index.ts";
import type { EmitOptions, Events, Scope, Sees, Stop } from "./types.ts";

// One stream. A feature hears everything with on(); a door subscribes for its
// caller and hears only what that caller may see: person-only events go to
// the person, a card hears only its own canvas. A payload that does not fit
// its event is a bug, and throws.

export type Heard = { name: string; payload: Record<string, unknown> };

export type Subscriber = { caller: Caller; client?: string; events?: string[]; canvas?: string };

const BY_NAME = new Map<string, AnyEvent>(EVENTS.map((event) => [event.name, event]));

export class EventBus implements Events {
	/** Checks of who may see a canvas, added by a feature (Studio's sharing). */
	readonly sees: Sees[] = [];
	/** The scope a caller is held to; a scoped caller hears only its canvas's events. Set by the kernel. */
	scopeOf?: (caller: Caller) => Scope | undefined;
	/** Ways features say an event with no canvas belongs to a scope's canvas (Kernel.belongs). */
	readonly belongs: ((scope: Scope, event: string, payload: Record<string, unknown>) => boolean)[] = [];
	private listeners = new Map<string, Set<(payload: never) => void>>();
	private subscribers = new Set<{ sub: Subscriber; hear: (heard: Heard) => void }>();

	emit<E extends AnyEvent>(event: E, payload: Payload<E>, options?: EmitOptions): void {
		if (!BY_NAME.has(event.name)) throw new Error(`${event.name} is not an event in the protocol.`);
		const problems = check(event.payload, payload, event.name);
		if (problems.length) throw new Error(problems.join(" "));
		for (const hear of this.listeners.get(event.name) ?? []) hear(payload as never);
		const record = payload as Record<string, unknown>;
		for (const { sub, hear } of this.subscribers) {
			if (options?.clients && (!sub.client || !options.clients.includes(sub.client))) continue;
			if (sub.events && !sub.events.includes(event.name)) continue;
			if (sub.canvas && record.canvas !== undefined && record.canvas !== sub.canvas) continue;
			const canvas = typeof record.canvas === "string" ? record.canvas : undefined;
			if (canvas && !this.sees.every((one) => one(sub.caller, canvas))) continue;
			if (!this.inScope(sub.caller, event.name, record)) continue;
			if (mayHear(sub.caller, event, record)) hear({ name: event.name, payload: record });
		}
	}

	on<E extends AnyEvent>(event: E, hear: (payload: Payload<E>) => void): Stop {
		const set = this.listeners.get(event.name) ?? new Set();
		set.add(hear as (payload: never) => void);
		this.listeners.set(event.name, set);
		return () => void set.delete(hear as (payload: never) => void);
	}

	/** Whether a caller may hear this event and payload, as a subscriber would: for a door's replay. */
	may(caller: Caller, name: string, payload: Record<string, unknown>): boolean {
		const event = BY_NAME.get(name);
		const canvas = typeof payload.canvas === "string" ? payload.canvas : undefined;
		if (!event || (canvas && !this.sees.every((one) => one(caller, canvas)))) return false;
		return this.inScope(caller, name, payload) && mayHear(caller, event, payload);
	}

	/** Whether a scoped caller may hear an event: of its canvas, or with no canvas whose every id is a path
	 *  inside its canvas's folder, or one a feature says belongs to it (an app placed there). */
	private inScope(caller: Caller, name: string, payload: Record<string, unknown>): boolean {
		const scope = this.scopeOf?.(caller);
		if (scope?.canvas === undefined) return true;
		if (typeof payload.canvas === "string") return payload.canvas === scope.canvas;
		const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
		if (ids.length && ids.every((id) => layout.canvasOfPath(id)?.name === scope.canvas)) return true;
		return this.belongs.some((one) => one(scope, name, payload));
	}

	/** For a door: what one caller may hear, optionally narrowed to some events or a canvas. */
	subscribe(sub: Subscriber, hear: (heard: Heard) => void): Stop {
		const entry = { sub, hear };
		this.subscribers.add(entry);
		return () => void this.subscribers.delete(entry);
	}
}

/** Whether a caller may hear this event at all. */
export function mayHear(caller: Caller, event: AnyEvent, payload: Record<string, unknown>): boolean {
	if (event.to === "person") return caller.kind === "person";
	if (caller.kind === "card") return payload.canvas !== undefined && payload.canvas === caller.canvas;
	return true;
}
