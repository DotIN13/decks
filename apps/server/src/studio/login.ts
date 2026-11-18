import { createHash, randomBytes } from "node:crypto";

/**
 * This harness signs in to Decks Studio: how it comes by its Studio key. The way Claude Code signs in.
 *
 * The harness starts it, never Studio and never a page of another site. It makes a secret (the
 * verifier), keeps it here, and gives the person an address on Studio that carries only its hash
 * (the challenge) (`start`). Signed in to Studio in a browser, they are shown a code there, and it
 * reaches this harness one of two ways (`finish`):
 *
 * - **by Studio's button**, when their browser is on this machine: the address also carried this
 *   harness's loopback address, and the button sends the tab back to `/api/studio/callback` with the
 *   code and the state this harness made;
 * - **pasted**, from any other device or a machine with no browser: the person copies the code from
 *   Studio's page and pastes it into Settings, or into the terminal where `decks studio login` asked.
 *
 * Either way the harness trades the code, with the verifier, for the key, and is told the account it
 * now syncs as (`signedIn`). A code caught by anything else is useless without the verifier, which
 * never leaves this process. One sign-in at a time: starting another forgets the last.
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
/** A sign-in under way: the address on Studio that shows its code, and until when (epoch ms) the code can be brought here. */
export interface SignInOpen {
	url: string;
	studio: string;
	expires: number;
}

export interface LoginNeeds {
	/** What this harness calls itself in Studio's list: the machine's name. */
	name: () => string;
	/** The key is here: keep it, and start syncing. */
	signedIn: (got: SignedIn) => void;
	/** What Settings shows of a sign-in changed (one under way, gone, or failed). */
	changed: () => void;
	fetch?: typeof fetch;
}

/** How long a sign-in waits for its code: as long as Studio's code lasts. */
const OPEN_MS = 10 * 60_000;

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
	private open: (SignInOpen & { state: string; verifier: string; timer: ReturnType<typeof setTimeout> }) | undefined;
	/** Why the last sign-in ended without a key, until another starts. */
	private failed: string | undefined;

	constructor(private readonly needs: LoginNeeds) {}

	/**
	 * Start a sign-in: the address to open on Studio, which shows the code. `back` is this harness's
	 * own origin as the person's page has it; when that is loopback, Studio's page can send the tab
	 * back by itself, and from anywhere else the code is pasted.
	 */
	start(studio: string, back?: string): SignInOpen {
		this.forget();
		const verifier = secret();
		const state = randomBytes(16).toString("base64url");
		const url = new URL("/connect", studio);
		url.searchParams.set("challenge", challengeOf(verifier));
		url.searchParams.set("name", this.needs.name());
		if (isLoopbackOrigin(back)) {
			url.searchParams.set("state", state);
			url.searchParams.set("redirect", `${new URL(back).origin}/api/studio/callback`);
		}
		const open: NonNullable<StudioLogin["open"]> = { url: url.href, studio, expires: Date.now() + OPEN_MS, state, verifier, timer: setTimeout(() => this.open === open && this.end("Nobody brought the code from Studio in time. Sign in again."), OPEN_MS) };
		open.timer.unref?.();
		this.open = open;
		this.needs.changed();
		return { url: open.url, studio, expires: open.expires };
	}

	/**
	 * The code from Studio is here: trade it for the key. Pasted, it is the sign-in under way that
	 * takes it; come back with a tab, it must also carry the `state` this harness made, so that no
	 * other page can hand this harness a code. A code Studio refuses leaves the sign-in open: the
	 * person may have mistyped it.
	 */
	async finish(code: string, state?: string): Promise<SignedIn> {
		const mine = this.open;
		if (!mine || mine.expires <= Date.now()) throw new Error("No sign-in to Studio is under way here, or it has run out. Press Sign in to Studio again.");
		if (state !== undefined && state !== mine.state) throw new Error("This harness did not start that sign-in. Press Sign in to Studio again.");
		if (!code.trim()) throw new Error("Paste the code Studio shows.");
		const got = await this.trade(mine.studio, { code: code.trim(), verifier: mine.verifier });
		if (this.open === mine) this.forget();
		this.needs.signedIn(got);
		return got;
	}

	/** The sign-in under way, if there is one; or why the last one ended. */
	showing(): { open?: SignInOpen; failed?: string } {
		const { open } = this;
		return { ...(open ? { open: { url: open.url, studio: open.studio, expires: open.expires } } : {}), ...(this.failed ? { failed: this.failed } : {}) };
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
		if (this.open) clearTimeout(this.open.timer);
		this.open = undefined;
		this.failed = undefined;
	}

	/** The code, with this harness's secret, for the key and the account. Studio's own words when it says no. */
	private async trade(studio: string, held: { code: string; verifier: string }): Promise<SignedIn> {
		const response = await (this.needs.fetch ?? fetch)(`${studio}/api/connect/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(held) }).catch((error: unknown) => {
			throw new Error(`Studio at ${studio} was not reached: ${(error as Error).message}`);
		});
		const said = (await response.json().catch(() => ({}))) as { key?: string; account?: StudioAccount; error?: string };
		if (!response.ok || !said.key) throw new Error(said.error || `Studio would not hand over a key (${response.status}).`);
		return { url: studio, key: said.key, account: said.account ?? { name: "", email: "" } };
	}
}
