import { createHash, randomBytes } from "node:crypto";

/**
 * This harness signs in to Decks Studio: how it comes by its Studio key.
 *
 * The harness starts it, never Studio and never a page of another site. It makes a secret (the
 * verifier), keeps it here, and sends Studio only its hash (the challenge). The person, signed in to
 * Studio in a browser, then says this harness is theirs, one of two ways:
 *
 * - **by a redirect**, when their browser is on this machine (`start`, `finish`): the harness's page
 *   opens Studio's connect address with the challenge and this harness's loopback address; Studio
 *   sends the tab back to `/api/studio/callback` with a one-time code;
 * - **by a short code**, from any other device or a machine with no browser (`code`): the harness
 *   asks Studio for a short code, shows it with Studio's address, and asks again every few seconds
 *   until the person has typed it there.
 *
 * Either way the harness trades what it holds, with the verifier, for the key, and is told the
 * account it now syncs as (`signedIn`). A code caught by anything else is useless without the
 * verifier, which never leaves this process. One sign-in at a time: starting another forgets the last.
 *
 * It replaces Studio's pairing, where Studio's page carried a key to the harness: the person typed
 * the harness's address into Studio, and off this machine fetched a code from a shell.
 */

export const DEFAULT_STUDIO = "https://studio.decks.app";

export type StudioAccount = { name: string; email: string };
/** What a finished sign-in hands over: Studio's address, this harness's key, and whose account it is. */
export interface SignedIn {
	url: string;
	key: string;
	account: StudioAccount;
}
/** A short code on show: what the person types, where, and until when (epoch ms). */
export interface CodeShown {
	code: string;
	verify: string;
	expires: number;
}

export interface LoginNeeds {
	/** What this harness calls itself in Studio's list: the machine's name. */
	name: () => string;
	/** The key is here: keep it, and start syncing. */
	signedIn: (got: SignedIn) => void;
	/** What Settings shows of a sign-in changed (a code on show, gone, or failed). */
	changed: () => void;
	fetch?: typeof fetch;
}

const REDIRECT_MS = 10 * 60_000;

/** Studio's origin from an address someone gave, or a sentence saying what is wrong with it. */
export function studioAddress(url: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
	const given = url?.trim() || env.DECKS_STUDIO_URL || DEFAULT_STUDIO;
	let address: URL;
	try {
		address = new URL(given);
	} catch {
		throw new Error("Studio's address is an http or https URL.");
	}
	if (address.protocol !== "https:" && address.protocol !== "http:") throw new Error("Studio's address is an http or https URL.");
	return address.origin;
}

/** Whether an origin is this machine's own, by loopback: where Studio may send a tab back to. */
export function isLoopbackOrigin(origin: string | undefined): origin is string {
	try {
		const url = new URL(origin ?? "");
		return url.protocol === "http:" && url.port !== "" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
	} catch {
		return false;
	}
}

const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const secret = () => randomBytes(32).toString("base64url");

export class StudioLogin {
	private redirecting: { studio: string; state: string; verifier: string; expires: number } | undefined;
	private waiting: (CodeShown & { studio: string; verifier: string; device: string; timer?: ReturnType<typeof setTimeout> }) | undefined;
	/** Why the last sign-in by code ended without a key, until another starts. */
	private failed: string | undefined;

	constructor(private readonly needs: LoginNeeds) {}

	// --- by a redirect -------------------------------------------------------------------------

	/** Start a sign-in the person's browser on this machine carries: the address to open on Studio. `back` is this harness's own loopback origin, as the page has it. */
	start(studio: string, back: string): { url: string } {
		if (!isLoopbackOrigin(back)) throw new Error("A redirect comes back only to this machine. From another device, sign in with the short code.");
		this.forget();
		const verifier = secret();
		const state = randomBytes(16).toString("base64url");
		this.redirecting = { studio, state, verifier, expires: Date.now() + REDIRECT_MS };
		const url = new URL("/connect", studio);
		url.searchParams.set("challenge", challengeOf(verifier));
		url.searchParams.set("state", state);
		url.searchParams.set("redirect", `${new URL(back).origin}/api/studio/callback`);
		url.searchParams.set("name", this.needs.name());
		return { url: url.href };
	}

	/** The tab came back from Studio: trade its code for the key. Only the sign-in this harness started, once. */
	async finish(state: string, code: string): Promise<SignedIn> {
		const mine = this.redirecting;
		if (!mine || !state || mine.state !== state || mine.expires <= Date.now()) throw new Error("This harness did not start that sign-in, or it has run out. Press Sign in to Studio again.");
		this.redirecting = undefined;
		if (!code) throw new Error("Studio sent no code back. Press Sign in to Studio again.");
		const got = await this.trade(mine.studio, { code, verifier: mine.verifier });
		if (got === "waiting") throw new Error("Studio is not done with that sign-in. Press Sign in to Studio again.");
		this.needs.signedIn(got);
		return got;
	}

	// --- by a short code -----------------------------------------------------------------------

	/** Start a sign-in by short code: ask Studio for one, show it, and keep asking until it is typed there or runs out. */
	async code(studio: string): Promise<CodeShown> {
		this.forget();
		const verifier = secret();
		const response = await this.post(studio, "/api/connect/device", { name: this.needs.name(), challenge: challengeOf(verifier) });
		const said = (await response.json().catch(() => ({}))) as { device?: string; code?: string; verify?: string; expires?: number; interval?: number; error?: string };
		if (!response.ok || !said.device || !said.code) throw new Error(said.error || `Studio at ${studio} would not start a sign-in (${response.status}).`);
		const shown: CodeShown = { code: said.code, verify: said.verify || `${studio}/connect`, expires: Date.now() + (said.expires ?? 600) * 1000 };
		const waiting: NonNullable<StudioLogin["waiting"]> = { ...shown, studio, verifier, device: said.device };
		this.waiting = waiting;
		// As often as Studio says, and never more than four times a second.
		const every = Math.max(0.25, said.interval ?? 2) * 1000;
		const ask = async () => {
			if (this.waiting !== waiting) return;
			if (Date.now() >= waiting.expires) return this.end("The code ran out before it was typed on Studio. Start again.");
			let got: SignedIn | "waiting";
			try {
				got = await this.trade(studio, { device: waiting.device, verifier });
			} catch (error) {
				// Studio said no: the code is spent. Not reached at all: it may be next time.
				if (error instanceof Refused) return this.end(error.message);
				got = "waiting";
			}
			if (this.waiting !== waiting) return;
			if (got === "waiting") return void (waiting.timer = setTimeout(() => void ask(), every));
			this.waiting = undefined;
			this.needs.signedIn(got);
		};
		waiting.timer = setTimeout(() => void ask(), every);
		this.needs.changed();
		return shown;
	}

	/** The short code on show, if a sign-in by code is under way; or why the last one ended. */
	showing(): { code?: CodeShown; failed?: string } {
		const { waiting } = this;
		return { ...(waiting ? { code: { code: waiting.code, verify: waiting.verify, expires: waiting.expires } } : {}), ...(this.failed ? { failed: this.failed } : {}) };
	}

	/** Give up the sign-in under way. */
	cancel(): void {
		this.forget();
		this.needs.changed();
	}

	/** At shutdown: no timer left behind. */
	stop(): void {
		this.forget();
	}

	// --- the trade ------------------------------------------------------------------------------

	private end(why: string): void {
		this.forget();
		this.failed = why;
		this.needs.changed();
	}

	private forget(): void {
		if (this.waiting?.timer) clearTimeout(this.waiting.timer);
		this.waiting = undefined;
		this.redirecting = undefined;
		this.failed = undefined;
	}

	private post(studio: string, path: string, body: unknown): Promise<Response> {
		return (this.needs.fetch ?? fetch)(`${studio}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch((error: unknown) => {
			throw new Error(`Studio at ${studio} was not reached: ${(error as Error).message}`);
		});
	}

	/** What this harness holds, with its secret, for the key: the key and the account, `"waiting"` while the short code is untyped, a `Refused` when Studio says no. */
	private async trade(studio: string, held: { code?: string; device?: string; verifier: string }): Promise<SignedIn | "waiting"> {
		const response = await this.post(studio, "/api/connect/exchange", held);
		const said = (await response.json().catch(() => ({}))) as { key?: string; account?: StudioAccount; error?: string };
		if (response.status === 202) return "waiting";
		if (!response.ok || !said.key) throw new Refused(said.error || `Studio would not hand over a key (${response.status}).`);
		return { url: studio, key: said.key, account: said.account ?? { name: "", email: "" } };
	}
}

/** Studio answered, and the answer was no: the sign-in is over. */
class Refused extends Error {}
