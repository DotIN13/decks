import type { Caller } from "../../../protocol/index.ts";
import type { Deck, Store } from "../../kernel/types.ts";
import { pairs } from "./canvases.ts";
import { syncDrawing, type Pass } from "./drawing.ts";
import { syncFiles, type FilePass } from "./files.ts";
import { readState, writeState, type SyncState } from "./link.ts";
import { answerAsk, isAsk, type Run } from "./asks.ts";
import { StudioApi, StudioError, type LiveLink, type Transport } from "./transport.ts";

// Keeps a deck in step with Studio: a pass over every canvas when asked, when
// the deck changes, and when Studio's live socket says something changed.

export type App = { name: string; title: string; kind: string; [key: string]: unknown };
export type TokenAsk = { id: string; user: { id: string; name: string }; origin: string };
export type SyncOptions = {
	deck: Deck;
	store: Store;
	url: string;
	key: string;
	transport: Transport;
	by?: Caller;
	log?: (line: string) => void;
	inventory?: () => App[] | Promise<App[]>;
	issueToken?: (ask: TokenAsk) => { token: string; expires: number } | Promise<{ token: string; expires: number }>;
	unlinked?: (reason: string) => void;
	/** Runs a call Studio passes down for the deck's owner. */
	run?: Run;
};

export const STUDIO: Caller = { kind: "person", id: "studio", name: "Decks Studio" };

export class DeckSync {
	readonly conflicts: string[] = [];
	private readonly api: StudioApi;
	private readonly pause = { until: 0, onPause: (seconds: number) => this.later(seconds * 1000 + 50) };
	private readonly timers = new Set<ReturnType<typeof setTimeout>>();
	private running: Promise<void> | undefined;
	private again = false;
	private told: string | undefined;
	private link: LiveLink | undefined;
	private stopped = false;

	constructor(private readonly o: SyncOptions) {
		this.api = new StudioApi(o.url.replace(/\/+$/, ""), o.key, o.transport);
	}

	get by(): Caller {
		return this.o.by ?? STUDIO;
	}

	/** Whether Studio takes this key: answers who it is for. */
	hello(): Promise<{ user: { id: string }; harness?: { id: string } }> {
		return this.api.call("GET", "/sync/v1/hello");
	}

	/** One pass at a time; a pass asked for meanwhile runs once after. */
	sync(): Promise<void> {
		if (this.running) {
			this.again = true;
			return this.running;
		}
		this.running = (async () => {
			do {
				this.again = false;
				await this.pass();
			} while (this.again && !this.stopped);
			this.running = undefined;
		})();
		return this.running;
	}

	private async pass(): Promise<void> {
		const log = this.o.log ?? (() => {});
		const state = await readState(this.o.store);
		state.user ??= (await this.hello()).user.id;
		const p: FilePass = { api: this.api, deck: this.o.deck, store: this.o.store, by: this.by, log: (line) => this.sayOnce(state, line, log), state, conflicts: this.conflicts, pause: this.pause };
		const list = (await this.api.call("GET", "/sync/v1/canvases")).canvases;
		const found = await pairs(p, state, list, state.user);
		for (const pair of found) {
			const editable = pair.remote.role !== "view";
			await this.guard(p, pair.name, () => syncDrawing(p as Pass, pair.folder, pair.s, editable));
			if (this.pause.until <= Date.now()) await this.guard(p, pair.name, () => syncFiles(p, pair.folder, pair.name, pair.s, editable));
		}
		state.canvases = Object.fromEntries(found.map((pair) => [pair.folder, pair.s]));
		await writeState(this.o.store, state);
		await this.inventory();
	}

	private async guard(p: FilePass, name: string, work: () => Promise<void>): Promise<void> {
		try {
			await work();
		} catch (error) {
			if (!(error instanceof StudioError)) throw error;
			p.log(`Studio did not sync canvas ${name}: ${error.message}`);
		}
	}

	/** A sentence about a refusal is said once, not every pass. */
	private sayOnce(state: SyncState, line: string, log: (line: string) => void): void {
		if (/did not upload canvas/.test(line)) {
			if (state.said.includes(line)) return;
			state.said.push(line);
		}
		log(line);
	}

	/** The app list goes up once a connection, then when a name, title or kind changes. */
	private async inventory(): Promise<void> {
		if (!this.o.inventory) return;
		const apps = (await this.o.inventory()).map(({ name, title, kind }) => ({ name, title, kind }));
		const key = JSON.stringify(apps);
		if (key === this.told) return;
		try {
			await this.api.call("PUT", "/sync/v1/inventory", { apps });
		} catch (error) {
			if (!(error instanceof StudioError) || error.status !== 404) throw error;
		}
		this.told = key;
	}

	private later(ms: number): void {
		if (this.stopped) return;
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			void this.sync().catch((error: Error) => this.o.log?.(`Studio sync failed: ${error.message}`));
		}, ms);
		timer.unref?.();
		this.timers.add(timer);
	}

	/** Open Studio's live socket: a change there starts a pass, a token ask is answered on it. */
	async start(): Promise<void> {
		this.stopped = false;
		const link = this.api.live();
		if (!link) return;
		this.link = link;
		link.onMessage((text) => void this.heard(link, text));
		link.onClose((code, reason) => {
			if (code === 4001) this.o.unlinked?.(reason || "revoked");
			else if (!this.stopped) this.later(2000);
		});
	}

	private async heard(link: LiveLink, text: string): Promise<void> {
		let got: { type?: string } & Partial<TokenAsk>;
		try {
			got = JSON.parse(text) as typeof got;
		} catch {
			return;
		}
		if (got.type === "canvas" || got.type === "file" || got.type === "canvases") return this.later(100);
		if (isAsk(got)) return this.reply(link, got);
		if (got.type !== "token.ask" || !got.id || !got.user || !got.origin) return;
		try {
			if (!this.o.issueToken) throw new Error("This server gives no tokens.");
			const given = await this.o.issueToken({ id: got.id, user: got.user, origin: got.origin });
			link.send(JSON.stringify({ type: "token", id: got.id, ...given }));
		} catch (error) {
			link.send(JSON.stringify({ type: "token", id: got.id, error: (error as Error).message }));
		}
	}

	private async reply(link: LiveLink, ask: Parameters<typeof answerAsk>[0]): Promise<void> {
		const owner = (await readState(this.o.store)).user ?? (await this.hello().catch(() => undefined))?.user.id;
		link.send(JSON.stringify({ type: "reply", id: ask.id, envelope: await answerAsk(ask, owner, this.o.run) }));
	}

	async stop(): Promise<void> {
		this.stopped = true;
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
		this.link?.close();
		this.link = undefined;
		await this.running?.catch(() => undefined);
	}
}
