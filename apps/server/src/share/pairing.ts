import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PairedRow } from "@decks/protocol";

/**
 * Who else may use this server: other Decks front ends, each holding a token (`web/src/connections`).
 *
 * The server has no sign-in of its own (DEPLOYMENT §1): whoever reaches the page is trusted, and that
 * stays true for this server's own front end. A front end served from **another site** is different,
 * because the browser lets any site call a server it can reach. So a request from another site is
 * answered only with a token. From this machine, a home network or the tailnet the token is given
 * for the asking, since reaching the server there is already being inside. From the internet it is
 * had only by trading a pairing code that this server's own front end shows: being able to read the
 * code is being trusted already.
 *
 * A code is six digits, lasts ten minutes, and dies after five wrong tries, which together put a
 * guess at one in two hundred thousand per code shown. A token is 32 random bytes, kept here only
 * as its hash, and can be revoked from Settings.
 */
const CODE_MS = 10 * 60_000;
const CODE_TRIES = 5;

interface Stored {
	id: string;
	hash: string;
	label: string;
	origin: string;
	at: number;
	last?: number;
}

function hashOf(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export class Pairing {
	private code: { value: string; expires: number; tries: number } | undefined;
	private tokens: Stored[];

	constructor(private readonly file: string) {
		this.tokens = this.load();
	}

	private load(): Stored[] {
		try {
			if (!existsSync(this.file)) return [];
			const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { tokens?: Stored[] };
			return Array.isArray(parsed.tokens) ? parsed.tokens.filter((one) => typeof one.hash === "string" && typeof one.id === "string") : [];
		} catch {
			return [];
		}
	}

	private save(): void {
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, `${JSON.stringify({ tokens: this.tokens }, null, "\t")}\n`, { mode: 0o600 });
	}

	/** A fresh code, replacing any other: only the newest one shown can be used. */
	newCode(now = Date.now()): { code: string; expires: number } {
		const value = String(randomInt(0, 1_000_000)).padStart(6, "0");
		this.code = { value, expires: now + CODE_MS, tries: 0 };
		return { code: value, expires: this.code.expires };
	}

	/** The code being shown, if it still works. */
	current(now = Date.now()): { code: string; expires: number } | undefined {
		if (!this.code || this.code.expires <= now || this.code.tries >= CODE_TRIES) return undefined;
		return { code: this.code.value, expires: this.code.expires };
	}

	/**
	 * A token with no code, for a front end on this machine or the same private network
	 * (`fromPrivateNetwork`): reaching the server at all is already being inside, so a code there
	 * is ceremony. Over the internet the code stays the only way in.
	 */
	grant(origin: string, label: string, now = Date.now()): string {
		const token = randomBytes(32).toString("base64url");
		const hash = hashOf(token);
		this.tokens.push({ id: hash.slice(0, 10), hash, label: label.slice(0, 80) || "Another Decks", origin: origin.slice(0, 200), at: now });
		this.save();
		return token;
	}

	/** Trade a code for a token. The code is spent either way once it works. */
	redeem(code: string, origin: string, label: string, now = Date.now()): string | undefined {
		const held = this.code;
		if (!held || held.expires <= now || held.tries >= CODE_TRIES) return undefined;
		const given = Buffer.from(code.replace(/\D/g, "").padStart(6, "0").slice(0, 6));
		const wanted = Buffer.from(held.value);
		if (!timingSafeEqual(given, wanted)) {
			held.tries += 1;
			return undefined;
		}
		this.code = undefined;
		return this.grant(origin, label, now);
	}

	/** Whether a token is one this server gave out and has not revoked. */
	check(token: string | undefined, now = Date.now()): boolean {
		if (!token) return false;
		const hash = hashOf(token);
		const found = this.tokens.find((one) => one.hash === hash);
		if (!found) return false;
		// Recorded at most once a minute, so a busy front end does not rewrite the file per request.
		if (!found.last || now - found.last > 60_000) {
			found.last = now;
			this.save();
		}
		return true;
	}

	revoke(id: string): boolean {
		const before = this.tokens.length;
		this.tokens = this.tokens.filter((one) => one.id !== id);
		if (this.tokens.length === before) return false;
		this.save();
		return true;
	}

	list(): PairedRow[] {
		return this.tokens.map(({ id, label, origin, at, last }) => ({ id, label, origin, at, ...(last ? { last } : {}) }));
	}
}

/**
 * Whether a request came from another site, by what the browser says about it.
 *
 * `Sec-Fetch-Site` first: behind `tailscale serve` or any proxy the host the server sees is not the
 * one the page was loaded from, and a wrong answer here would lock this server's own front end out.
 * But a browser sends that header only to HTTPS and localhost, so a server on a plain `http://`
 * address hears nothing from it; there the page's `Origin` is compared with the host it asked,
 * which no proxy on such an address rewrites. No `Origin` at all is not a page asking from another
 * site, and is answered as it always was.
 */
export function fromAnotherSite(headers: Record<string, string | string[] | undefined>): boolean {
	const site = headers["sec-fetch-site"];
	if (typeof site === "string") return site === "cross-site" || site === "same-site";
	const origin = headers.origin;
	if (typeof origin !== "string" || origin === "null") return false;
	const forwarded = headers["x-forwarded-host"];
	const host = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) ?? headers.host;
	try {
		return new URL(origin).host.toLowerCase() !== String(host ?? "").toLowerCase();
	} catch {
		return true;
	}
}

/** The token a request carries: a bearer header, or `decks_token` in the query for a socket, which cannot set headers. */
export function tokenOf(headers: Record<string, string | string[] | undefined>, url: string | undefined): string | undefined {
	const header = headers.authorization;
	if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7).trim();
	try {
		return new URL(url ?? "/", "http://decks").searchParams.get("decks_token") ?? undefined;
	} catch {
		return undefined;
	}
}

/** Loopback, the private ranges, link-local, and the 100.64/10 block Tailscale's addresses are in; IPv6 alike. */
export function isPrivateAddress(address: string | undefined): boolean {
	if (!address) return false;
	const ip = address.trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "").toLowerCase();
	const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
	}
	if (ip === "::1") return true;
	// fc00::/7, unique local, which holds Tailscale's fd7a:115c:a1e0::/48; fe80::/10, link-local.
	return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

/**
 * Whether a request comes from this machine or a private network: no pairing code is asked then.
 *
 * The socket's own address, unless that is this machine and a proxy on it says who it was passing
 * on: `tailscale serve` and Vite's dev proxy both connect from loopback, and the first address in
 * `X-Forwarded-For` is the browser. Behind Tailscale Funnel that is an internet address, so a
 * server opened to the internet asks for a code again, as it should.
 */
export function fromPrivateNetwork(remote: string | undefined, headers: Record<string, string | string[] | undefined>): boolean {
	if (!isPrivateAddress(remote)) return false;
	const forwarded = headers["x-forwarded-for"];
	const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
	const loopback = /^(?:127\.|::1$|::ffff:127\.)/.test(remote ?? "");
	return first && loopback ? isPrivateAddress(first) : true;
}
