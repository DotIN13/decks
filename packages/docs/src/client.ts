import { applySplice, transformSplices, type DocChange, type DocClientMessage, type DocFormat, type DocServerMessage, type Splice } from "./index.ts";

/**
 * `@decks/docs/client`: one page's copy of a document, kept in step with the file through the
 * service in `@decks/docs/server`, over whatever carries messages between them.
 *
 * The page edits its own text at once and hands each change here as a splice. Splices go out
 * at most every `BATCH_MS`, one batch in flight at a time, made on the last revision the server
 * confirmed. What others did arrives as `doc.changed`: it is moved past this page's unconfirmed
 * splices and applied, and the unconfirmed ones are moved past it, which is the same rule the
 * server lands them by, so both sides end on the same text. When the two cannot be reconciled —
 * a collision, a refused splice, a revision this page never saw — the page opens the document
 * again and starts from the server's text.
 *
 * Framework-free: the page draws from `text` and `changes` whenever `onUpdate` fires.
 */

export const BATCH_MS = 50;

export interface DocSyncOptions {
	path: string;
	send: (message: DocClientMessage) => void;
	onUpdate: (sync: DocSync, why: "open" | "remote" | "local" | "review") => void;
	/** A name for this page; random by default. */
	client?: string;
	/** For tests: how a batch is scheduled. */
	schedule?: (run: () => void, ms: number) => unknown;
}

export class DocSync {
	readonly path: string;
	readonly client: string;
	text = "";
	format: DocFormat = "text";
	/** The last revision the server confirmed this page has. */
	rev = 0;
	changes: DocChange[] = [];
	error: string | undefined;
	ready = false;
	/** Opened from a root that is not writable: shown, never sent. */
	readOnly = false;

	private inflight: { batch: string; splices: Splice[] } | undefined;
	private pending: Splice[] = [];
	private timer: unknown;
	private seq = 0;

	constructor(private readonly options: DocSyncOptions) {
		this.path = options.path;
		this.client = options.client ?? `page-${Math.random().toString(36).slice(2, 10)}`;
	}

	open(): void {
		this.ready = false;
		// What was sent may still land; if it does, it arrives as a batch this page no longer holds.
		this.inflight = undefined;
		this.pending = [];
		this.options.send({ type: "doc.open", path: this.path, client: this.client });
	}

	close(): void {
		this.flush();
		this.options.send({ type: "doc.close", path: this.path, client: this.client });
	}

	/** A change the page has already made to its own text. */
	edit(splice: Splice): void {
		if (!this.ready || this.readOnly) return;
		this.text = applySplice(this.text, splice);
		this.pending.push(splice);
		this.options.onUpdate(this, "local");
		if (this.timer === undefined) {
			const schedule = this.options.schedule ?? ((run, ms) => setTimeout(run, ms));
			this.timer = schedule(() => {
				this.timer = undefined;
				this.flush();
			}, BATCH_MS);
		}
	}

	accept(change: string): void {
		this.options.send({ type: "doc.review", path: this.path, client: this.client, change, accept: true });
	}

	reject(change: string): void {
		this.options.send({ type: "doc.review", path: this.path, client: this.client, change, accept: false });
	}

	restore(sha: string): void {
		this.options.send({ type: "doc.restore", path: this.path, client: this.client, sha });
	}

	versions(): void {
		this.options.send({ type: "doc.versions", path: this.path });
	}

	/** Send what is waiting, unless a batch is still on its way. */
	flush(): void {
		if (this.inflight || this.pending.length === 0 || !this.ready) return;
		this.inflight = { batch: `${this.client}-${++this.seq}`, splices: this.pending };
		this.pending = [];
		this.options.send({ type: "doc.patch", path: this.path, client: this.client, rev: this.rev, batch: this.inflight.batch, splices: this.inflight.splices });
	}

	/**
	 * Every message from the server; those about other documents, and any that are not about
	 * documents at all, are ignored, so a host can pass its whole stream through.
	 */
	receive(incoming: DocServerMessage | { type: string }): void {
		const message = incoming as DocServerMessage;
		if (!("path" in message)) return;
		switch (message.type) {
			case "doc.state":
				if (message.path !== this.path) return;
				this.text = message.text;
				this.format = message.format;
				this.rev = message.rev;
				this.changes = message.changes;
				this.error = message.error;
				this.inflight = undefined;
				this.pending = [];
				// An error with a revision is a document that opened read-only; without one, it did not open.
				this.ready = !message.error || message.rev !== 0;
				this.readOnly = !!message.error && message.rev !== 0;
				this.options.onUpdate(this, "open");
				return;
			case "doc.patched":
				if (!this.matches(message.path) || message.batch !== this.inflight?.batch) return;
				if (message.refused.length > 0) {
					// The server sent the text as it stands, so the page starts again from it without asking.
					if (message.text === undefined) return this.open();
					this.text = message.text;
					this.rev = message.rev;
					this.inflight = undefined;
					this.pending = [];
					this.options.onUpdate(this, "open");
					return;
				}
				this.rev = message.rev;
				this.inflight = undefined;
				this.flush();
				return;
			case "doc.changed":
				if (!this.matches(message.path) || !this.ready) return;
				if (message.client === this.client && message.batch !== undefined && message.batch === this.inflight?.batch) {
					// Our own batch: already in our text, so this only moves the revision on.
					if (message.base === this.rev) this.rev = message.rev;
					return;
				}
				if (message.base !== this.rev) return this.open();
				if (!this.take(message.splices)) return this.open();
				this.rev = message.rev;
				if (message.change) this.changes = [...this.changes, message.change];
				if (message.settled) this.changes = this.changes.filter((c) => c.id !== message.settled);
				this.options.onUpdate(this, message.change || message.settled ? "review" : "remote");
				return;
		}
	}

	/**
	 * The server's path for a document inside the deck is deck-relative, and a page may have
	 * opened it by another spelling (`./paper.md`), so the comparison is on the cleaned path.
	 */
	private matches(path: string): boolean {
		return clean(path) === clean(this.path);
	}

	/**
	 * Apply others' splices past ours, and move ours past theirs, by the rule the server landed
	 * ours by. In flight and waiting are moved one after the other, so each stays its own list.
	 * False only when what they say they replaced is not in this page's text, which means the two
	 * have already drifted and the page must start again.
	 */
	private take(theirs: readonly Splice[]): boolean {
		const flying = transformSplices(theirs, this.inflight?.splices ?? [], false);
		const waiting = transformSplices(flying.a, this.pending, false);
		let text = this.text;
		for (const splice of waiting.a) {
			if (text.slice(splice.at, splice.at + splice.before.length) !== splice.before) return false;
			text = applySplice(text, splice);
		}
		if (this.inflight) this.inflight = { ...this.inflight, splices: flying.b };
		this.pending = waiting.b;
		this.text = text;
		return true;
	}
}

function clean(path: string): string {
	return path.replace(/^\.\//, "").replace(/^\/+/, "");
}
