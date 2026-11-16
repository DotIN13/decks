import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Caller, Who } from "../../protocol/index.ts";
import { readJson, writeJson } from "./store.ts";
import type { Scope, Store, Tokens } from "./types.ts";

// A token or a pass becomes a Caller at the door, and nothing else says who
// is calling. Only a token's hash is kept. A pass is a token issued to a card
// or an app. The person on this machine has id "person"; a paired front end
// or a terminal gets an id of its own.

type Kept = { hash: string; who: Caller; label?: string; at: number; scope?: Scope };
type Pairing = { code: string; expires: number };

export const LOCAL_PERSON: Caller = { kind: "person", id: "person", name: "you" };
const PAIR_MS = 10 * 60 * 1000;

/** Whether a scoped token's end has come. */
const ended = (kept: Kept, at: number) => kept.scope !== undefined && kept.scope.until <= at;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export class Callers implements Tokens {
	private kept = new Map<string, Kept>();
	private now = new Map<Who, (id: string, issued: Caller) => Caller | undefined>();
	private pairings: Pairing[] = [];
	private saving: Promise<void> = Promise.resolve();

	constructor(
		private store: Store,
		private clock: () => number = Date.now,
	) {}

	async load(): Promise<void> {
		for (const one of await readJson<Kept[]>(this.store, "tokens.json", [])) this.kept.set(one.hash, one);
	}

	// Tokens, and who they stand for.
	issue(who: Caller, label?: string, scope?: Scope): string {
		const token = `dk_${randomBytes(24).toString("base64url")}`;
		const kept: Kept = { hash: hashOf(token), who: { ...who }, at: this.clock(), ...(label ? { label } : {}), ...(scope ? { scope } : {}) };
		this.kept.set(kept.hash, kept);
		this.save();
		return token;
	}

	revoke(id: string): void {
		for (const [hash, one] of this.kept) if (one.who.id === id) this.kept.delete(hash);
		this.save();
	}

	forget(token: string): void {
		if (this.kept.delete(hashOf(token))) this.save();
	}

	describe(kind: Who, now: (id: string, issued: Caller) => Caller | undefined): void {
		this.now.set(kind, now);
	}

	/** The caller a token stands for now, or undefined. */
	resolve(token: string | undefined): Caller | undefined {
		if (!token) return undefined;
		const kept = this.kept.get(hashOf(token));
		if (!kept || ended(kept, this.clock())) return undefined;
		const now = this.now.get(kept.who.kind);
		const caller = now ? now(kept.who.id, { ...kept.who }) : { ...kept.who };
		return caller && kept.scope?.canvas ? { ...caller, canvas: kept.scope.canvas } : caller;
	}

	/** The scope a caller's tokens were issued with, or undefined when it has none. */
	scopeOf(caller: Caller): Scope | undefined {
		for (const one of this.kept.values()) if (one.who.id === caller.id && one.scope && !ended(one, this.clock())) return one.scope;
		return undefined;
	}

	/** Ids that hold tokens, with their labels, for the person. */
	holders(): { id: string; kind: Who; name: string; label?: string }[] {
		const seen = new Map<string, { id: string; kind: Who; name: string; label?: string }>();
		for (const one of this.kept.values()) seen.set(one.who.id, { id: one.who.id, kind: one.who.kind, name: one.who.name, ...(one.label ? { label: one.label } : {}) });
		return [...seen.values()];
	}

	// Pairing another front end, or a terminal.
	/** A six-digit code, good for ten minutes, once. */
	pair(): Pairing {
		const at = this.clock();
		this.pairings = this.pairings.filter((one) => one.expires > at);
		const pairing = { code: String(randomInt(0, 1_000_000)).padStart(6, "0"), expires: at + PAIR_MS };
		this.pairings.push(pairing);
		return pairing;
	}

	/** Trade a live code for a new person's token; undefined if the code is wrong or spent. */
	redeem(code: string, label = "front end"): { token: string; who: Caller } | undefined {
		const at = this.clock();
		const found = this.pairings.find((one) => one.code === code && one.expires > at);
		if (!found) return undefined;
		this.pairings = this.pairings.filter((one) => one !== found);
		return this.login(label, "pair");
	}

	/** A new person's token with an id of its own: a terminal, or a paired front end. */
	login(label = "terminal", prefix = "term"): { token: string; who: Caller } {
		const who: Caller = { kind: "person", id: `${prefix}-${randomBytes(4).toString("hex")}`, name: label };
		return { token: this.issue(who, label), who };
	}

	// Keeping them.
	/** Waits until every change is on disk. */
	flush(): Promise<void> {
		return this.saving;
	}

	private save(): void {
		const at = this.clock();
		for (const [hash, one] of this.kept) if (ended(one, at)) this.kept.delete(hash);
		const all = [...this.kept.values()];
		this.saving = this.saving.then(() => writeJson(this.store, "tokens.json", all));
	}
}
