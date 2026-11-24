/**
 * The password that locks a Decks served where anyone can reach it.
 *
 * Decks hands out access in one place: loading the page gives the tab a person token
 * (`connections/http.ts`, `pageShell`). On the tailnet that is safe because only the person can load
 * it; on the internet anyone could. With a password set, the page is given only to a browser that
 * logged in: it holds a login cookie, which is a person token of its own that lasts thirty days
 * while it is used. Everything after the page is as it was.
 *
 * Kept here: the password (a scrypt hash in the data folder, outside the deck, so nothing syncs it),
 * the count of wrong tries that slows a guesser down, the terminals waiting for the person to let
 * them in from a browser (`decks login https://…`), and the cookie itself.
 */
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { dirname, join } from "node:path";
import { isPrivateAddress } from "./issue.ts";

/** The shortest password taken: long enough that the throttle below makes guessing hopeless. */
export const PASSWORD_MIN = 10;

/** How long a browser stays logged in while it is used. */
export const LOGIN_IDLE_MS = 30 * 86_400_000;

/** The cookie a logged-in browser carries. */
export const LOGIN_COOKIE = "decks_login";

/** The label of a login's token in the token store, and in Settings' list of what is signed in. */
export const LOGIN_LABEL = "Browser login";

// scrypt's cost: 2^15 rounds of 8 × 128 bytes, about 32 MB and 60 ms a try on this Mac.
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

type Kept = { scrypt: { N: number; r: number; p: number }; salt: string; hash: string; set: number };

export class PasswordStore {
	private kept: Kept | undefined;

	constructor(private readonly file: string) {
		this.kept = this.read();
	}

	/** The file in a harness's data folder. */
	static in(dataDir: string): PasswordStore {
		return new PasswordStore(join(dataDir, "password.json"));
	}

	/** Whether a password is set: then the page asks for it (`pageShell`). */
	get isSet(): boolean {
		return this.kept !== undefined;
	}

	/** When it was set, for Settings. */
	get setAt(): number | undefined {
		return this.kept?.set;
	}

	/** Set the password, or `null` to take it away. Refused, with why, when it is too short. */
	set(password: string | null, now = Date.now()): void {
		if (password === null) {
			this.kept = undefined;
			rmSync(this.file, { force: true });
			return;
		}
		if (password.length < PASSWORD_MIN) throw new Error(`A password needs at least ${PASSWORD_MIN} characters.`);
		const salt = randomBytes(16);
		const hash = scryptSync(password.normalize("NFC"), salt, 32, SCRYPT);
		this.kept = { scrypt: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, salt: salt.toString("base64"), hash: hash.toString("base64"), set: now };
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, `${JSON.stringify(this.kept, null, "\t")}\n`, { mode: 0o600 });
	}

	/** Whether this is the password, in time that does not depend on how much of it was right. */
	check(password: string): boolean {
		if (!this.kept || typeof password !== "string") return false;
		const want = Buffer.from(this.kept.hash, "base64");
		const { N, r, p } = this.kept.scrypt;
		const got = scryptSync(password.normalize("NFC"), Buffer.from(this.kept.salt, "base64"), want.length, { N, r, p, maxmem: SCRYPT.maxmem });
		return timingSafeEqual(got, want);
	}

	private read(): Kept | undefined {
		if (!existsSync(this.file)) return undefined;
		try {
			const kept = JSON.parse(readFileSync(this.file, "utf8")) as Kept;
			return kept.hash && kept.salt && kept.scrypt ? kept : undefined;
		} catch {
			return undefined;
		}
	}
}

/**
 * Wrong tries, counted by where they come from: five in fifteen minutes, then a wait that doubles
 * with each wrong try after, up to an hour. A guesser gets about twenty tries a day from one
 * address, so ten characters are out of reach. Every address together is held to sixty a minute,
 * for one that spreads its guesses over many.
 */
export class LoginThrottle {
	private readonly tries = new Map<string, { wrong: number; first: number; until: number }>();
	private readonly recent: number[] = [];

	/** Seconds to wait before this address may try again, or 0. */
	wait(from: string, now = Date.now()): number {
		while (this.recent.length && this.recent[0]! < now - 60_000) this.recent.shift();
		if (this.recent.length >= 60) return Math.ceil((this.recent[0]! + 60_000 - now) / 1000);
		const seen = this.tries.get(from);
		return seen && seen.until > now ? Math.ceil((seen.until - now) / 1000) : 0;
	}

	/** A try from this address was wrong. */
	wrong(from: string, now = Date.now()): void {
		this.recent.push(now);
		const seen = this.tries.get(from);
		const fresh = !seen || now - seen.first > 15 * 60_000;
		const wrong = fresh ? 1 : seen.wrong + 1;
		const until = wrong < 5 ? 0 : now + Math.min(60 * 60_000, 30_000 * 2 ** (wrong - 5));
		this.tries.set(from, { wrong, first: fresh ? now : seen.first, until });
	}

	/** A try from this address was right: its count starts again. */
	right(from: string): void {
		this.tries.delete(from);
	}
}

/** Letters a person reads off a screen without mistaking one for another. */
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEVICE_MS = 10 * 60_000;

type Waiting = { id: string; code: string; label: string; expires: number; token?: string };

/**
 * Terminals waiting to be let in from a browser: `decks login https://…` asks for a code, prints a
 * link to `/login?approve=CODE`, and asks again every few seconds until the person, logged in,
 * presses Approve there. The terminal gets its own person token, as a pairing code gave one.
 */
export class DeviceLogins {
	private readonly waiting = new Map<string, Waiting>();

	/** A new waiting terminal: `id` is the terminal's to ask with, `code` the person's to see. */
	start(label: string, now = Date.now()): { id: string; code: string; expires: number } {
		this.sweep(now);
		if (this.waiting.size >= 20) throw new Error("Too many terminals are waiting to be let in. Try again in a few minutes.");
		const code = Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
		const waiting: Waiting = { id: randomBytes(24).toString("base64url"), code, label: label.slice(0, 80) || "decks login", expires: now + DEVICE_MS };
		this.waiting.set(waiting.id, waiting);
		return { id: waiting.id, code, expires: waiting.expires };
	}

	/** The terminal a code names, for the page to say what it is letting in. */
	find(code: string, now = Date.now()): { label: string; expires: number } | undefined {
		this.sweep(now);
		const found = this.byCode(code);
		return found && !found.token ? { label: found.label, expires: found.expires } : undefined;
	}

	/** Let the terminal a code names in, with this token: false when there is no such code now. */
	approve(code: string, token: () => string, now = Date.now()): { label: string } | undefined {
		this.sweep(now);
		const found = this.byCode(code);
		if (!found || found.token) return undefined;
		found.token = token();
		return { label: found.label };
	}

	/** What a waiting terminal asking again is told: still waiting, its token (once), or gone. */
	poll(id: string, now = Date.now()): { waiting: true } | { token: string } | undefined {
		this.sweep(now);
		const found = this.waiting.get(id);
		if (!found) return undefined;
		if (!found.token) return { waiting: true };
		this.waiting.delete(id);
		return { token: found.token };
	}

	private byCode(code: string): Waiting | undefined {
		const want = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
		return [...this.waiting.values()].find((one) => one.code.replace("-", "") === want);
	}

	private sweep(now: number): void {
		for (const [id, one] of this.waiting) if (one.expires < now) this.waiting.delete(id);
	}
}

// --- the cookie and the request --------------------------------------------------------------

/** The login cookie a request carries, if any. */
export function loginCookieOf(headers: IncomingHttpHeaders): string | undefined {
	for (const part of String(headers.cookie ?? "").split(";")) {
		const [name, ...value] = part.trim().split("=");
		if (name === LOGIN_COOKIE) return decodeURIComponent(value.join("="));
	}
	return undefined;
}

/** Whether the proxy in front may be believed about who is calling and how: `DECKS_TRUST_PROXY=1`. */
export function trustProxy(env: NodeJS.ProcessEnv = process.env): boolean {
	return ["1", "true", "yes", "on"].includes(String(env.DECKS_TRUST_PROXY ?? "").trim().toLowerCase());
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim() || undefined;

/** Who is calling, for counting wrong tries: the proxy's word for it when trusted, else the socket's. */
export function callerOf(remote: string | undefined, headers: IncomingHttpHeaders, env: NodeJS.ProcessEnv = process.env): string {
	return (trustProxy(env) && first(headers["x-forwarded-for"])) || remote || "unknown";
}

/** Whether the browser reached Decks over HTTPS: the proxy's word when trusted, else the socket's. */
export function overHttps(encrypted: boolean, headers: IncomingHttpHeaders, env: NodeJS.ProcessEnv = process.env): boolean {
	return encrypted || (trustProxy(env) && first(headers["x-forwarded-proto"]) === "https");
}

/**
 * Whether a password may be sent on this request: over HTTPS, or straight from this Mac or a private
 * network (the tailnet), where nobody in between reads it. A plain `http://` request through a proxy,
 * or from a public address, is refused before the password is looked at.
 */
export function passwordMaySend(remote: string | undefined, encrypted: boolean, headers: IncomingHttpHeaders, env: NodeJS.ProcessEnv = process.env): boolean {
	if (overHttps(encrypted, headers, env)) return true;
	return isPrivateAddress(remote) && headers["x-forwarded-for"] === undefined;
}

/** The `Set-Cookie` for a login, or for taking one away (`token` undefined). */
export function loginCookie(token: string | undefined, secure: boolean): string {
	const parts = [`${LOGIN_COOKIE}=${token ? encodeURIComponent(token) : ""}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${token ? Math.floor(LOGIN_IDLE_MS / 1000) : 0}`];
	if (secure) parts.push("Secure");
	return parts.join("; ");
}
