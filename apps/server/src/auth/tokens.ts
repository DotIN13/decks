import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PairedRow } from "@decks/protocol";
import type { Principal, PrincipalKind } from "./principal.ts";

/**
 * Every token this harness gives out, in one place: who each one is (`principal.ts`), how long it
 * lives, and whether it has been taken back.
 *
 * A token is 32 random bytes with a prefix that says its kind (`dk_p_` the person, `dk_s_` a paired
 * site, `dk_a_` an agent, `dk_x_` an app, `dk_b_` a board), so one found in a log can be told apart.
 * Only its sha256 is kept. Tokens that should outlive this process (the person's, a site's, a
 * board's) are written to `<deck>/.decks/tokens.json`, readable by this user alone; an agent's or an
 * app's lives in memory, is made when its process starts and is taken back when it stops, so it
 * ends with the harness too.
 *
 * Most tokens slide: each use pushes back the moment they stop working, and one left unused that long
 * is forgotten. A terminal's or a paired site's lasts `DECKS_TOKEN_DAYS` (30 unless set) unused; a
 * Decks tab's and a board's a day. Page tickets are not here: they are signed, last a
 * day and are kept nowhere (`tickets.ts`).
 *
 * The pairing tokens from before (`.decks/pairing.json`) are read in once, as site tokens with the
 * same id and the same site, so Studio and the browsers already paired keep working.
 */

/** Days a person's or a site's token may go unused before it stops working (`DECKS_TOKEN_DAYS`, 30 unless set). */
export function tokenDays(env: NodeJS.ProcessEnv = process.env): number {
	const days = Number(env.DECKS_TOKEN_DAYS);
	return Number.isFinite(days) && days > 0 ? days : 30;
}

/** How long a Decks tab's token and a board's may go unused: a day. */
export const TAB_IDLE_MS = 24 * 3_600_000;
export const BOARD_IDLE_MS = 24 * 3_600_000;
const PREFIX: Record<Exclude<PrincipalKind, "page" | "canvas">, string> = { person: "dk_p_", site: "dk_s_", agent: "dk_a_", app: "dk_x_", board: "dk_b_" };

/** One token as kept: its hash, who it is, and its life. */
interface Stored {
	id: string;
	hash: string;
	principal: Principal;
	/** Where it was given, for a person's: "Decks tab", "decks login". */
	label?: string;
	at: number;
	last: number;
	/** How long it may go unused, in milliseconds; none for one that lives as long as its process. */
	idle?: number;
	/** Whether it is written down: false for an agent's and an app's. */
	kept: boolean;
}

/** Why a token was not taken. */
export type Refusal = "missing" | "unknown" | "expired" | "elsewhere";

export type Verified = { ok: true; principal: Principal; id: string } | { ok: false; reason: Refusal };

export function hashOf(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export class TokenStore {
	private readonly byHash = new Map<string, Stored>();
	/** Whether every pairing needs a code: asked for from a settings page, kept with the tokens. */
	private chosen = false;
	private readonly idleMs: number;

	constructor(
		private readonly file: string,
		options: { days?: number; now?: number } = {},
	) {
		this.idleMs = (options.days ?? tokenDays()) * 86_400_000;
		this.load(options.now ?? Date.now());
	}

	/** Whether pairing needs a code from wherever it comes (`issue.ts`), as asked for in Settings. */
	get requireCode(): boolean {
		return this.chosen;
	}

	set requireCode(on: boolean) {
		this.chosen = on;
		this.save();
	}

	/**
	 * A new token for a principal. `idle` is how long it may go unused; left out it is the person's
	 * or a site's days, a Decks tab's or a board's a day, and none for an agent or an app, which
	 * are not written down and are taken back when their process stops (`revoke`).
	 */
	issue(principal: Principal, options: { label?: string; idle?: number; now?: number } = {}): { token: string; id: string } {
		if (principal.kind === "page") throw new Error("A page is let in by a ticket, not a token.");
		if (principal.kind === "canvas") throw new Error("A canvas frame holds a canvas pass (`passes.ts`), not a token.");
		const now = options.now ?? Date.now();
		const token = `${PREFIX[principal.kind]}${randomBytes(32).toString("base64url")}`;
		const hash = hashOf(token);
		const processBound = principal.kind === "agent" || principal.kind === "app";
		const idle = processBound ? undefined : (options.idle ?? (principal.kind === "board" ? BOARD_IDLE_MS : this.idleMs));
		const stored: Stored = {
			id: hash.slice(0, 10),
			hash,
			principal: clean(principal),
			...(options.label ? { label: options.label.slice(0, 80) } : {}),
			at: now,
			last: now,
			...(idle !== undefined ? { idle } : {}),
			kept: !processBound,
		};
		this.byHash.set(hash, stored);
		if (stored.kept) this.save(now);
		return { token, id: stored.id };
	}

	/**
	 * Who a token is, if it is one this harness gave out, has not taken back, and has seen used within
	 * its idle time. `origin` is the page it came with (`Origin`): a site's token was given to one
	 * page, and sent by a page on another site it was copied out of that page, so it is refused
	 * (`elsewhere`) however good it is. A request with no `Origin` (a program) is answered on the
	 * token alone.
	 */
	verify(token: string | undefined, options: { origin?: string | undefined; now?: number } = {}): Verified {
		if (!token) return { ok: false, reason: "missing" };
		const found = this.byHash.get(hashOf(token));
		// Looked up by its hash: what is compared is a digest of the secret, never the secret.
		if (!found) return { ok: false, reason: "unknown" };
		const now = options.now ?? Date.now();
		if (found.idle !== undefined && now - found.last > found.idle) {
			this.byHash.delete(found.hash);
			if (found.kept) this.save(now);
			return { ok: false, reason: "expired" };
		}
		const origin = options.origin;
		if (found.principal.kind === "site" && origin && found.principal.origin && found.principal.origin !== origin) return { ok: false, reason: "elsewhere" };
		// Stamped at most once a minute, so a busy caller does not rewrite the file per request.
		if (now - found.last > 60_000) {
			found.last = now;
			if (found.kept) this.save(now);
		}
		return { ok: true, principal: found.principal, id: found.id };
	}

	/** The id of a token, whether or not it still works, for "this browser" on a settings page. */
	idOf(token: string | undefined): string | undefined {
		return token ? this.byHash.get(hashOf(token))?.id : undefined;
	}

	/** Whether the token with this id still works: what a ticket made with it asks (`tickets.ts`). */
	live(id: string, now = Date.now()): boolean {
		for (const one of this.byHash.values()) if (one.id === id) return one.idle === undefined || now - one.last <= one.idle;
		return false;
	}

	/** Take one token back by its id. */
	revoke(id: string): boolean {
		return this.revokeWhere((_principal, row) => row.id === id) > 0;
	}

	/** Take back every token whose principal matches, as when an agent or an app stops; answers how many. */
	revokeWhere(match: (principal: Principal, row: { id: string; label?: string }) => boolean): number {
		let gone = 0;
		let kept = false;
		for (const [hash, one] of this.byHash) {
			if (!match(one.principal, one)) continue;
			this.byHash.delete(hash);
			gone += 1;
			kept ||= one.kept;
		}
		if (kept) this.save();
		return gone;
	}

	/** The front ends paired with this harness, for Settings and Studio's harness page. */
	paired(): PairedRow[] {
		return [...this.byHash.values()]
			.filter((one) => one.principal.kind === "site")
			.map((one) => {
				const site = one.principal as Extract<Principal, { kind: "site" }>;
				return { id: one.id, label: site.label, origin: site.origin ?? "", at: one.at, last: one.last };
			});
	}

	/** How many tokens of a kind are live: for tests and a status line. */
	count(kind: PrincipalKind): number {
		return [...this.byHash.values()].filter((one) => one.principal.kind === kind).length;
	}

	private load(now: number): void {
		let migrated = false;
		try {
			if (existsSync(this.file)) {
				const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { tokens?: Stored[]; requireCode?: boolean; migrated?: boolean };
				this.chosen = parsed.requireCode === true;
				migrated = parsed.migrated === true;
				for (const one of parsed.tokens ?? []) {
					if (typeof one?.hash !== "string" || typeof one.id !== "string" || !one.principal) continue;
					if (one.idle !== undefined && now - one.last > one.idle) continue;
					this.byHash.set(one.hash, { ...one, kept: true });
				}
			}
		} catch {
			/* an unreadable file is no tokens: everyone signs in again, which is the safe way to be wrong */
		}
		if (!migrated) {
			this.migrate(now);
			this.save(now, true);
		}
	}

	/**
	 * The pairing tokens from before this store (`.decks/pairing.json` beside it), as site tokens with
	 * the same ids, sites and labels. The old file is left where it is, and read only once.
	 */
	private migrate(now: number): void {
		const old = join(dirname(this.file), "pairing.json");
		if (!existsSync(old)) return;
		try {
			const parsed = JSON.parse(readFileSync(old, "utf8")) as { tokens?: Array<{ id?: unknown; hash?: unknown; label?: unknown; origin?: unknown; at?: unknown; last?: unknown }>; requireCode?: boolean };
			if (parsed.requireCode === true) this.chosen = true;
			for (const one of parsed.tokens ?? []) {
				if (typeof one.hash !== "string" || typeof one.id !== "string" || this.byHash.has(one.hash)) continue;
				const at = typeof one.at === "number" ? one.at : now;
				const last = typeof one.last === "number" ? one.last : now;
				if (now - last > this.idleMs) continue;
				const origin = typeof one.origin === "string" && one.origin ? one.origin : undefined;
				this.byHash.set(one.hash, {
					id: one.id,
					hash: one.hash,
					principal: { kind: "site", label: typeof one.label === "string" && one.label ? one.label : "Another Decks", ...(origin ? { origin } : {}) },
					at,
					last,
					idle: this.idleMs,
					kept: true,
				});
			}
		} catch {
			/* a pairing file that does not parse paired no one */
		}
	}

	private save(now = Date.now(), migrated = true): void {
		const tokens = [...this.byHash.values()].filter((one) => one.kept && (one.idle === undefined || now - one.last <= one.idle)).map(({ kept: _kept, ...rest }) => rest);
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, `${JSON.stringify({ migrated, ...(this.chosen ? { requireCode: true } : {}), tokens }, null, "\t")}\n`, { mode: 0o600 });
		try {
			chmodSync(this.file, 0o600);
		} catch {
			/* a file system without modes */
		}
	}
}

/** A principal with nothing in it but its fields: what is written down. */
function clean(principal: Principal): Principal {
	switch (principal.kind) {
		case "site":
			return { kind: "site", label: principal.label.slice(0, 80) || "Another Decks", ...(principal.origin ? { origin: principal.origin.slice(0, 200) } : {}) };
		case "board":
			return { kind: "board", path: principal.path, ...(principal.stage ? { stage: principal.stage } : {}) };
		default:
			return { ...principal };
	}
}
