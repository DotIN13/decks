import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PairedRow } from "@decks/protocol";
import type { Principal, PrincipalKind } from "./principal.ts";

/**
 * Every token this harness gives out, in one place: who each one is (`principal.ts`), how long it
 * lives, and whether it has been taken back.
 *
 * A **harness token** (`dk_h_`) is whoever acts on the harness as a whole: the person, in a Decks
 * tab, in a terminal (`decks login`, and the file `decks login` reads on this machine) or through
 * Studio's sync; a site the person paired (Decks Studio, a second Decks), bound to that site's
 * origin; or one agent, with that agent's reach. Its subject is the principal it is issued for. A
 * board (`dk_b_`) still has a token of its own here. A token is 32 random bytes after its prefix, so one found in a log can be told apart. Only
 * its sha256 is kept. The person's and a site's are written to `<deck>/.decks/tokens.json`, readable
 * by this user alone, and outlive a restart; an agent's lives in memory, made when the agent starts
 * and taken back when it stops, so it ends with the harness too. An app's server holds an app pass.
 *
 * Tokens slide: each use pushes back the moment they stop working, and one left unused that long is
 * forgotten. Every one lasts a day unused, except the `decks` command's own in a terminal, which
 * lasts `DECKS_TOKEN_DAYS` (30 unless set); an agent's lasts as long as its agent runs, with no idle
 * limit. Passes are not here: they are signed, short and kept nowhere (`passes.ts`, `tickets.ts`).
 *
 * Tokens made before there was one kind (`dk_p_` a tab's or a terminal's, `dk_s_` a site's) are read
 * as harness tokens of the same subject: they are found by their hash, as any is, and given the new
 * lives once, from the moment the harness that knows them first starts, so nobody is signed out by
 * the change. The pairing tokens from before this store (`.decks/pairing.json`) are read in once, as
 * site tokens with the same id and the same site.
 */

/** Days the `decks` command's token in a terminal may go unused before it stops working (`DECKS_TOKEN_DAYS`, 30 unless set). */
export function tokenDays(env: NodeJS.ProcessEnv = process.env): number {
	const days = Number(env.DECKS_TOKEN_DAYS);
	return Number.isFinite(days) && days > 0 ? days : 30;
}

/** How long a harness token may go unused: a day, for all but a terminal's (`tokenDays`). */
export const TOKEN_IDLE_MS = 24 * 3_600_000;
/** How long a board's token may go unused: a day. */
export const BOARD_IDLE_MS = 24 * 3_600_000;

/** The prefix of every harness token, whoever its subject. */
export const HARNESS_PREFIX = "dk_h_";
/** The prefixes harness tokens had before (a tab's or a terminal's, a site's, an agent's), still read by their hash. */
export const OLD_PREFIXES = ["dk_p_", "dk_s_", "dk_a_"] as const;

const PREFIX: Record<Exclude<PrincipalKind, "page" | "canvas" | "app">, string> = { person: HARNESS_PREFIX, site: HARNESS_PREFIX, agent: HARNESS_PREFIX, board: "dk_b_" };

/** The labels of the person's tokens that are not a terminal's: a tab's, Studio's sync, the file `decks login` reads. */
const NOT_A_TERMINAL = new Set(["Decks tab", "Studio sync", "decks login on this machine"]);

/** The store's file version: 2 once tokens of the old kinds were given the new lives. */
const VERSION = 2;

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
	/** A terminal's: `decks login`'s, which lasts `DECKS_TOKEN_DAYS` unused rather than a day. */
	terminal?: true;
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
	/** How long a terminal's token may go unused. */
	private readonly terminalMs: number;

	/** `days`: a terminal's days unused (`tokenDays`). */
	constructor(
		private readonly file: string,
		options: { days?: number; now?: number } = {},
	) {
		this.terminalMs = (options.days ?? tokenDays()) * 86_400_000;
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
	 * A new token for a principal. `idle` is how long it may go unused; left out it is a day, a
	 * terminal's (`terminal`) `DECKS_TOKEN_DAYS`, and none for an agent or an app, which are not written
	 * down and are taken back when their process stops (`revoke`).
	 */
	issue(principal: Principal, options: { label?: string; idle?: number; terminal?: boolean; now?: number } = {}): { token: string; id: string } {
		if (principal.kind === "page") throw new Error("A page is let in by a ticket, not a token.");
		if (principal.kind === "canvas") throw new Error("A canvas frame holds a canvas pass (`passes.ts`), not a token.");
		if (principal.kind === "app") throw new Error("An app holds an app pass (`passes.ts`), not a token.");
		const now = options.now ?? Date.now();
		const token = `${PREFIX[principal.kind]}${randomBytes(32).toString("base64url")}`;
		const hash = hashOf(token);
		const processBound = principal.kind === "agent";
		const terminal = options.terminal === true && principal.kind === "person";
		const idle = processBound ? undefined : (options.idle ?? (principal.kind === "board" ? BOARD_IDLE_MS : terminal ? this.terminalMs : TOKEN_IDLE_MS));
		const stored: Stored = {
			id: hash.slice(0, 10),
			hash,
			principal: clean(principal),
			...(options.label ? { label: options.label.slice(0, 80) } : {}),
			at: now,
			last: now,
			...(idle !== undefined ? { idle } : {}),
			kept: !processBound,
			...(terminal ? { terminal: true as const } : {}),
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
		let version = 0;
		try {
			if (existsSync(this.file)) {
				const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { tokens?: Stored[]; requireCode?: boolean; migrated?: boolean; v?: number };
				this.chosen = parsed.requireCode === true;
				migrated = parsed.migrated === true;
				version = typeof parsed.v === "number" ? parsed.v : 0;
				for (const one of parsed.tokens ?? []) {
					if (typeof one?.hash !== "string" || typeof one.id !== "string" || !one.principal) continue;
					if (one.idle !== undefined && now - one.last > one.idle) continue;
					this.byHash.set(one.hash, { ...one, kept: true });
				}
			}
		} catch {
			/* an unreadable file is no tokens: everyone signs in again, which is the safe way to be wrong */
		}
		if (!migrated) this.migrate(now);
		if (version < VERSION) this.relive(now);
		if (!migrated || version < VERSION) this.save(now, true);
	}

	/**
	 * Tokens written before there was one kind of harness token, given its lives once: a terminal's
	 * (`decks login`, under whatever label it asked for) `DECKS_TOKEN_DAYS`, every other person's and
	 * every site's a day, each counted from now, so a token that worked before the change works after it.
	 */
	private relive(now: number): void {
		for (const one of this.byHash.values()) {
			if (one.principal.kind !== "person" && one.principal.kind !== "site") continue;
			const terminal = one.principal.kind === "person" && !NOT_A_TERMINAL.has(one.label ?? "");
			one.idle = terminal ? this.terminalMs : TOKEN_IDLE_MS;
			if (terminal) one.terminal = true;
			else delete one.terminal;
			one.last = Math.max(one.last, now);
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
				if (now - last > this.terminalMs) continue;
				const origin = typeof one.origin === "string" && one.origin ? one.origin : undefined;
				this.byHash.set(one.hash, {
					id: one.id,
					hash: one.hash,
					principal: { kind: "site", label: typeof one.label === "string" && one.label ? one.label : "Another Decks", ...(origin ? { origin } : {}) },
					at,
					last,
					idle: TOKEN_IDLE_MS,
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
		writeFileSync(this.file, `${JSON.stringify({ v: VERSION, migrated, ...(this.chosen ? { requireCode: true } : {}), tokens }, null, "\t")}\n`, { mode: 0o600 });
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
