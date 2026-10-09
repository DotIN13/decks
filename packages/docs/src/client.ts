import { applySplice, transformSplices, type DocChange, type DocClientMessage, type DocFormat, type DocRemote, type DocServerMessage, type Splice } from "./index.ts";

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
	/**
	 * After every change to `text`. `applied` are the splices that made it, in order, so a page
	 * can move its caret and its marks; absent when the text was replaced whole (`"open"`).
	 */
	onUpdate: (sync: DocSync, why: "open" | "remote" | "local" | "outside" | "review", applied?: readonly Splice[]) => void;
	/** A name for this page; random by default. */
	client?: string;
	/** For tests: how a batch is scheduled. */
	schedule?: (run: () => void, ms: number) => unknown;
}

export class DocSync {
	/** What the server calls the document: the path asked for, until the server names it otherwise. */
	path: string;
	/** Where its words live when that is not the file: a Google Doc. */
	remote: DocRemote | undefined;
	readonly client: string;
	text = "";
	format: DocFormat = "text";
	/** The last revision the server confirmed this page has. */
	rev = 0;
	/** Writes from outside this page's typing (an agent, another program) waiting for review, oldest first. */
	changes: DocChange[] = [];
	error: string | undefined;
	ready = false;
	/** Opened from a root that is not writable: shown, never sent. */
	readOnly = false;

	private inflight: { batch: string; splices: Splice[]; n: number } | undefined;
	private pending: Splice[] = [];
	private timer: unknown;
	private seq = 0;
	/** The last of this page's batches the server has taken (`mark`, `landed`). */
	private taken = 0;

	constructor(private readonly options: DocSyncOptions) {
		this.path = options.path;
		this.client = options.client ?? `page-${Math.random().toString(36).slice(2, 10)}`;
	}

	open(): void {
		this.ready = false;
		// What was sent may still land; if it does, it arrives as a batch this page no longer holds.
		this.inflight = undefined;
		this.taken = this.seq;
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
		this.options.onUpdate(this, "local", [splice]);
		if (this.timer === undefined) {
			const schedule = this.options.schedule ?? ((run, ms) => setTimeout(run, ms));
			this.timer = schedule(() => {
				this.timer = undefined;
				this.flush();
			}, BATCH_MS);
		}
	}

	/** Keep a change from outside; `"*"` keeps every one waiting. */
	accept(change: string): void {
		this.options.send({ type: "doc.review", path: this.path, client: this.client, change, accept: true });
	}

	/** Take a change from outside back; `"*"` takes every one waiting back. */
	reject(change: string): void {
		this.flush();
		this.options.send({ type: "doc.review", path: this.path, client: this.client, change, accept: false });
	}

	/** Ask for one kept version's text, which comes back as `doc.version`. */
	version(sha: string): void {
		this.options.send({ type: "doc.version", path: this.path, sha });
	}

	/** Ask for the document typeset as it stands; the answer comes back as `doc.compiled`. */
	compile(): void {
		this.flush();
		this.options.send({ type: "doc.compile", path: this.path, client: this.client });
	}

	/** Read the document's git repository, or pull or push it; the answer comes back as `doc.repo`. */
	git(action: "status" | "pull" | "push"): void {
		if (action !== "status") this.flush();
		this.options.send({ type: "doc.git", path: this.path, client: this.client, action });
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
		this.inflight = { batch: `${this.client}-${++this.seq}`, splices: this.pending, n: this.seq };
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
				if (message.asked !== this.path && message.path !== this.path) return;
				// Another page on this document, in the same browser, asked: its answer is not ours.
				if (message.client !== undefined && message.client !== this.client) return;
				this.path = message.path;
				this.remote = message.remote;
				this.text = message.text;
				this.format = message.format;
				this.rev = message.rev;
				this.changes = message.changes;
				this.error = message.error;
				this.inflight = undefined;
				this.taken = this.seq;
				this.pending = [];
				// An error with a revision is a document that opened read-only; without one, it did not open.
				this.ready = !message.error || message.rev !== 0;
				this.readOnly = !!message.error && message.rev !== 0;
				this.options.onUpdate(this, "open");
				return;
			case "doc.patched":
				if (!this.matches(message.path) || message.batch !== this.inflight?.batch) return;
				if (message.refused.length > 0) {
					// Nothing waiting on this typing can wait for it any longer.
					this.taken = this.seq;
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
				this.taken = this.inflight.n;
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
				const applied = this.take(message.splices);
				if (!applied) return this.open();
				this.rev = message.rev;
				if (message.change) this.changes = [...this.changes, message.change];
				if (message.settled) this.changes = this.changes.filter((c) => !message.settled!.includes(c.id));
				this.options.onUpdate(this, message.change ? "outside" : message.settled ? "review" : "remote", applied);
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
	 * Answers the splices applied here, or undefined when what they say they replaced is not in
	 * this page's text, which means the two have already drifted and the page must start again.
	 */
	private take(theirs: readonly Splice[]): Splice[] | undefined {
		const flying = transformSplices(theirs, this.inflight?.splices ?? [], false);
		const waiting = transformSplices(flying.a, this.pending, false);
		let text = this.text;
		for (const splice of waiting.a) {
			if (text.slice(splice.at, splice.at + splice.before.length) !== splice.before) return undefined;
			text = applySplice(text, splice);
		}
		if (this.inflight) this.inflight = { ...this.inflight, splices: flying.b };
		this.pending = waiting.b;
		this.text = text;
		return waiting.a;
	}

	/** The batch that will carry everything typed here so far, for `landed`. */
	mark(): number {
		return this.pending.length ? this.seq + 1 : this.seq;
	}

	/** The server has everything that was typed here by `mark`, whatever has been typed since. */
	landed(mark: number): boolean {
		return this.taken >= mark || !this.ready;
	}

	/** Nothing typed here is still on its way to the server. */
	get settled(): boolean {
		return !this.inflight && this.pending.length === 0;
	}
}

function clean(path: string): string {
	return path.replace(/^\.\//, "").replace(/^\/+/, "");
}
