import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocRemote, DocRemoteStatus, DocServerMessage } from "@decks/docs";
import { merge3 } from "@decks/docs/merge";
import { docToMarkdown, docUnits, FakeDocsApi, GoogleError, plan, segmentEnds, unitRequests, type DocsApi, type DocsDocument, type DocsRequest } from "@decks/docs/gdoc";
import { spliceDiff } from "@decks/docs/merge";
import type { DocLibrary, DocService } from "@decks/docs/server";
import { runtimeDir } from "@decks/runtime";
import { docIdOf, fakeMode, GoogleAuth, GoogleDocsApi, googleDir, type GoogleStatus } from "./api.ts";

/**
 * Google Docs as document pages.
 *
 * A linked Doc gets a folder in the deck's `docs/` like any document, holding a **mirror** of its
 * text in which every character is one of the Doc's indices (`gdoc/units.ts`), which the page types
 * into as it would any file, and `base.txt`, the same of the Doc as this server last read it. The page
 * draws the Doc from Google's own document, sent to it as `doc.gdoc`, not from the mirror; the mirror
 * is only where its edits go. While a page has the mirror open, every couple of seconds:
 *
 * - **Pull.** The Doc is read; if it reads differently from `base.txt`, someone changed it (a
 *   collaborator in Google's editor, or an agent through its Google Docs tools), and that edit is
 *   merged into the mirror three ways (`merge3`), so it is highlighted on the page as a change to
 *   accept or reject, credited to whoever made it.
 * - **Push.** If the mirror then means something the Doc does not (`plan`), the difference goes to
 *   Google as Docs API requests, made against the revision just read; a Doc that moved in between
 *   refuses them, and the next round pulls first and tries again.
 *
 * Without Google set up (`DECKS_GOOGLE=fake`), the same runs against the stand-in in `fake.ts`,
 * with its Docs kept as JSON in `<data>/google/fake/`.
 */

const TICK_MS = 2000;
/** Typing this recent is left to settle before it is pushed, so half a `**` is not sent. */
const SETTLE_MS = 700;
/** How long a pull is credited to the agent whose tool call made it. */
const CREDIT_MS = 15_000;

interface Linked {
	id: string;
	folder: string;
	mirror: string;
	title: string;
	url: string;
}

export interface GoogleDocsHost {
	dataDir: string;
	library: () => DocLibrary;
	docs: DocService;
	send: (message: DocServerMessage) => void;
}

export class GoogleDocs {
	readonly auth: GoogleAuth;
	private readonly fake: FakeDocsApi | undefined;
	private readonly real: GoogleDocsApi;
	private timer: ReturnType<typeof setInterval> | undefined;
	private readonly running = new Map<string, Promise<void>>();
	private readonly status = new Map<string, DocRemoteStatus>();
	/** Who the next pull of a Doc is credited to: the agent whose edit it carries. */
	private readonly credit = new Map<string, { by: string; until: number }>();
	/** Who wrote the mirror just now, for the change the page highlights. */
	private writing: { file: string; by: string } | undefined;
	/** Each Doc as last read, for a page that opens it and for styles made against it. */
	private readonly last = new Map<string, DocsDocument>();

	constructor(private readonly host: GoogleDocsHost) {
		this.auth = new GoogleAuth(googleDir(host.dataDir));
		this.fake = fakeMode(host.dataDir) ? new FakeDocsApi(join(googleDir(host.dataDir), "fake")) : undefined;
		this.real = new GoogleDocsApi(this.auth);
	}

	api(): DocsApi {
		return this.fake ?? this.real;
	}

	state(): GoogleStatus {
		if (this.fake) return { mode: "fake", client: true, signedIn: true, email: "stand-in" };
		return { mode: "google", ...this.auth.status() };
	}

	start(): void {
		this.timer ??= setInterval(() => void this.tick(), TICK_MS);
		this.timer.unref();
		// Docs linked when they were mirrored as markdown are mirrored again as their indices, so their boards open them.
		for (const linked of this.host.library().googleDocs()) if (!linked.mirror.endsWith(".gdoc.txt")) void this.link(linked.google.id).catch(() => undefined);
	}

	stop(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}

	/** A picture in a Doc's markdown points here, so the page fetches it through this server. */
	static imageUrl = (id: string) => (objectId: string) => `/api/google/image/${encodeURIComponent(id)}/${encodeURIComponent(objectId)}`;

	private markdown(doc: DocsDocument, id: string): string {
		return docToMarkdown(doc, GoogleDocs.imageUrl(id));
	}

	/** Link a Doc by its address or id: its folder and mirror, made on first sight, and the mirror's path. */
	async link(input: string): Promise<string> {
		const id = docIdOf(input) ?? (this.fake && /^[\w -]{1,80}$/.test(input.trim()) ? input.trim().replace(/\s+/g, "-").toLowerCase() : undefined);
		if (!id) throw new Error("That is not a Google Doc address. Copy it from the Doc's address bar: https://docs.google.com/document/d/…");
		let doc: DocsDocument;
		try {
			doc = await this.api().get(id);
		} catch (error) {
			if (this.fake && error instanceof GoogleError && error.status === 404) {
				await this.fake.create(id, input.trim(), `# ${input.trim()}\n\nA stand-in Google Doc. Type here, or let an agent edit it through its Google Docs tools.\n`);
				doc = await this.api().get(id);
			} else throw explain(error);
		}
		const url = `https://docs.google.com/document/d/${id}/edit`;
		const { mirror, folder, fresh } = this.host.library().googleFolder(id, doc.title ?? "Google Doc", url);
		if (fresh) {
			const text = docUnits(doc);
			writeFileSync(mirror, text);
			writeFileSync(join(folder, "base.txt"), text);
		}
		this.last.set(id, doc);
		return mirror;
	}

	private linkedByMirror(file: string): Linked | undefined {
		const found = this.host.library().googleDocs().find((d) => d.mirror === file);
		return found ? { id: found.google.id, folder: found.folder, mirror: found.mirror, title: found.google.title, url: found.google.url } : undefined;
	}

	private linkedById(id: string): Linked | undefined {
		const found = this.host.library().googleDocs().find((d) => d.google.id === id);
		return found ? { id, folder: found.folder, mirror: found.mirror, title: found.google.title, url: found.google.url } : undefined;
	}

	/** For the page: a mirror's Doc, to show and to open in Google. */
	remote(file: string): DocRemote | undefined {
		const linked = this.linkedByMirror(file);
		return linked ? { kind: "google", title: linked.title, url: linked.url } : undefined;
	}

	/** Who wrote a mirror just now, when this did: the change the page shows is theirs. */
	writer(file: string): string | undefined {
		return this.writing?.file === file ? this.writing.by : undefined;
	}

	private async tick(): Promise<void> {
		for (const file of this.host.docs.openFiles()) {
			const linked = this.linkedByMirror(file);
			if (linked) void this.sync(linked);
		}
	}

	/** One round for one Doc, never two at once; `now` pushes typing however recent, and waits its turn. */
	sync(linked: Linked, now = false): Promise<void> {
		const previous = this.running.get(linked.id);
		if (previous && !now) return previous;
		return this.serial(linked, () => this.round(linked, now));
	}

	/** Work on one Doc after whatever is already running on it. */
	private serial(linked: Linked, work: () => Promise<void>): Promise<void> {
		const previous = this.running.get(linked.id);
		const run = (previous ?? Promise.resolve())
			.catch(() => {})
			.then(work)
			.finally(() => {
				if (this.running.get(linked.id) === run) this.running.delete(linked.id);
			});
		this.running.set(linked.id, run);
		return run;
	}

	/** The Doc to the pages that have its mirror open, to draw. */
	private show(linked: Linked, doc: DocsDocument): void {
		this.last.set(linked.id, doc);
		const key = this.host.docs.keyOfFile(linked.mirror);
		if (key) this.host.send({ type: "doc.gdoc", path: key, document: doc, text: docUnits(doc) });
	}

	private say(linked: Linked, status: DocRemoteStatus): void {
		const state = this.state();
		const full: DocRemoteStatus = { ...status, mode: state.mode, ...(state.email ? { email: state.email } : {}), ...(state.paste ? { paste: true } : {}) };
		const before = this.status.get(linked.id);
		this.status.set(linked.id, full);
		const key = this.host.docs.keyOfFile(linked.mirror);
		if (key && JSON.stringify(before) !== JSON.stringify(full)) this.host.send({ type: "doc.remote", path: key, status: full });
	}

	/** A page opened a mirror: what was last said about its Doc, and a round now rather than in two seconds. */
	opened(file: string): void {
		const linked = this.linkedByMirror(file);
		if (!linked) return;
		const key = this.host.docs.keyOfFile(file);
		const status = this.status.get(linked.id);
		if (key && status) this.host.send({ type: "doc.remote", path: key, status });
		const doc = this.last.get(linked.id);
		if (doc) this.show(linked, doc);
		void this.sync(linked);
		void this.showComments(linked, true);
	}

	/**
	 * Styles a page set, as Docs requests at the indices of its text: the typing before them is
	 * pushed first, so the Doc's indices are the page's, and any index someone else's edit has
	 * moved since is moved with it. Styles cannot conflict with text, so Google takes them against
	 * the revision they were made for and moves them past anything written since.
	 */
	async style(file: string, requests: unknown[], text?: string): Promise<void> {
		const linked = this.linkedByMirror(file);
		if (!linked || !Array.isArray(requests) || requests.length === 0) return;
		await this.serial(linked, async () => {
			const basePath = join(linked.folder, "base.txt");
			let doc = await this.api().get(linked.id);
			let theirs = docUnits(doc);
			const base = read(basePath);
			const mirror = read(linked.mirror);
			/*
			 * The Doc brought to the text the page had when it made the style, when that is all the Doc
			 * lacks of it and nobody else has written since: so what was typed after the style reaches
			 * Google after it, as it did on the page (a list item made after a bullet is in the list).
			 * Otherwise the page's typing goes first, as a round would push it.
			 */
			if (text !== undefined && theirs === base && merge3(base, text, mirror).text === mirror) {
				const { requests: push } = unitRequests(theirs, text, segmentEnds(doc));
				if (push.length) {
					const result = await this.api().batchUpdate(linked.id, push, { requiredRevisionId: doc.revisionId });
					doc = await this.api().get(linked.id);
					theirs = docUnits(doc);
					if (!result.writeControl?.requiredRevisionId || doc.revisionId === result.writeControl.requiredRevisionId) writeFileSync(basePath, theirs);
				}
			} else {
				await this.round(linked, true);
				doc = this.last.get(linked.id) ?? (await this.api().get(linked.id));
				theirs = docUnits(doc);
				text = read(linked.mirror);
			}
			const page = text ?? read(linked.mirror);
			const moved = page === theirs ? (requests as DocsRequest[]) : moveRequests(requests as DocsRequest[], page, theirs);
			await this.api().batchUpdate(linked.id, moved, doc.revisionId ? { targetRevisionId: doc.revisionId } : undefined);
			const after = await this.api().get(linked.id);
			const now = docUnits(after);
			writeFileSync(basePath, now);
			// What the style did to the text (a table's rows, a page break) goes into the mirror around whatever was typed since: the person's own edit.
			const current = read(linked.mirror);
			const merged = now === theirs ? current : merge3(theirs, now, current).text;
			if (merged !== current) this.host.docs.rewrite(linked.mirror, merged);
			this.show(linked, after);
		});
	}

	// -- comments -----------------------------------------------------------------------------------

	/** Each Doc's comments as last read, and when, so a quiet Doc is asked every ten seconds rather than every round. */
	private readonly comments = new Map<string, { at: number; json: string }>();

	/** The Doc's open comments to its pages, when they changed or `now`. */
	private async showComments(linked: Linked, now = false): Promise<void> {
		const key = this.host.docs.keyOfFile(linked.mirror);
		if (!key) return;
		const seen = this.comments.get(linked.id);
		if (!now && seen && Date.now() - seen.at < 10_000) return;
		if (!this.fake && !this.auth.status().comments) {
			const error = "Comments need Decks to be allowed to read your Drive: sign in to Google again, and turn on the Google Drive API in the same Cloud project.";
			if (now || seen?.json !== error) this.host.send({ type: "doc.gcomments", path: key, comments: [], error });
			this.comments.set(linked.id, { at: Date.now(), json: error });
			return;
		}
		try {
			const list = await this.api().comments(linked.id);
			const json = JSON.stringify(list);
			if (now || json !== seen?.json) this.host.send({ type: "doc.gcomments", path: key, comments: list });
			this.comments.set(linked.id, { at: Date.now(), json });
		} catch (error) {
			const message = error instanceof GoogleError && error.status === 403 ? "Google refused to list the comments: turn on the Google Drive API in your Cloud project." : explain(error).message;
			if (now || seen?.json !== message) this.host.send({ type: "doc.gcomments", path: key, comments: [], error: message });
			this.comments.set(linked.id, { at: Date.now(), json: message });
		}
	}

	/** A comment made on the page: a new one on the selected words, a reply, or resolving one. */
	async comment(file: string, message: { action: "create" | "reply" | "resolve"; comment?: string; content?: string; quote?: string }): Promise<void> {
		const linked = this.linkedByMirror(file);
		if (!linked) return;
		const api = this.api();
		if (message.action === "create") await api.comment(linked.id, String(message.content ?? "").trim(), String(message.quote ?? ""));
		else if (message.comment) await api.reply(linked.id, message.comment, String(message.content ?? ""), message.action === "resolve" ? "resolve" : undefined);
		await this.showComments(linked, true);
	}

	private async round(linked: Linked, now = false): Promise<void> {
		if (!this.fake && !this.auth.status().signedIn) {
			this.say(linked, { state: "signin", message: this.auth.client() ? "Sign in to Google to keep this page in step with the Doc." : "Google is not set up on this server yet." });
			return;
		}
		const basePath = join(linked.folder, "base.txt");
		try {
			let changed = !this.status.get(linked.id)?.at;
			let doc = await this.api().get(linked.id);
			const theirs = docUnits(doc);
			const seen = this.last.get(linked.id)?.revisionId;
			const base = read(basePath);
			// Pull: what changed in the Doc since it was last read, merged into what the page has.
			if (theirs !== base) {
				const mirror = read(linked.mirror);
				const merged = merge3(base, theirs, mirror);
				if (merged.text !== mirror) {
					const credit = this.credit.get(linked.id);
					this.writing = { file: linked.mirror, by: credit && credit.until > Date.now() ? credit.by : "Google Docs" };
					writeFileSync(linked.mirror, merged.text);
					// The service reads it on its next turn; the credit holds until it has.
					setTimeout(() => {
						if (this.writing?.file === linked.mirror) this.writing = undefined;
					}, 1500);
				}
				writeFileSync(basePath, theirs);
				this.credit.delete(linked.id);
				changed = true;
			}
			// Push: what the page says that the Doc does not, once the typing has settled.
			if (now || Date.now() - mtime(linked.mirror) >= SETTLE_MS) {
				const mirror = read(linked.mirror);
				const { requests, refused } = unitRequests(theirs, mirror, segmentEnds(doc));
				if (requests.length || refused) {
					this.say(linked, { state: "syncing" });
					try {
						const result = requests.length ? await this.api().batchUpdate(linked.id, requests, { requiredRevisionId: doc.revisionId }) : {};
						doc = await this.api().get(linked.id);
						const after = docUnits(doc);
						// Read back exactly as written, it is the new base; if someone else wrote in between, the next pull brings theirs in.
						if (!result.writeControl?.requiredRevisionId || doc.revisionId === result.writeControl.requiredRevisionId) writeFileSync(basePath, after);
						// What Docs cannot take (structure typed over, a picture typed) goes from the page too, so the two read the same.
						if (refused && after !== mirror) {
							this.writing = { file: linked.mirror, by: "Google Docs" };
							writeFileSync(linked.mirror, after);
						}
						changed = true;
					} catch (error) {
						if (error instanceof GoogleError && error.status === 400 && /revision|precondition/i.test(error.message)) return;
						throw error;
					}
				}
			}
			// A Doc that changed, either way or in its styles alone, is drawn again.
			if (doc.revisionId !== seen) this.show(linked, doc);
			void this.showComments(linked);
			// The time moves only when something went one way or the other, so a quiet Doc says nothing new.
			this.say(linked, { state: "synced", at: changed ? Date.now() : (this.status.get(linked.id)?.at ?? Date.now()) });
		} catch (error) {
			const explained = explain(error);
			const signin = error instanceof GoogleError && error.status === 401;
			this.say(linked, { state: signin ? "signin" : "error", message: explained.message });
		}
	}

	// -- the agent's tools ----------------------------------------------------------------------

	/**
	 * `gdocs_read`: a Doc as markdown, the same markdown its page shows. `gdocs_edit`: one exact
	 * piece of that markdown replaced, written to the Doc as the smallest Docs API edit, and
	 * brought into an open page as this agent's change. Both answer in a sentence when they fail.
	 */
	async tool(name: string, args: Record<string, unknown>, by: string): Promise<{ text: string; isError: boolean }> {
		try {
			const id = docIdOf(String(args.doc ?? "")) ?? (this.fake ? String(args.doc ?? "").trim() : undefined);
			if (!id) return { text: "Name the Doc by its address (https://docs.google.com/document/d/…) or its id.", isError: true };
			if (!this.fake && !this.auth.status().signedIn) return { text: "This Decks server is not signed in to Google. Ask the person to sign in from a Google Doc's page.", isError: true };
			if (name === "gdocs_read") {
				const doc = await this.api().get(id);
				return { text: `# ${doc.title ?? "Untitled"} (Google Doc ${id})\n\n${this.markdown(doc, id)}`, isError: false };
			}
			if (name === "gdocs_edit") {
				const old = String(args.old ?? "");
				const replacement = String(args.new ?? "");
				for (let attempt = 0; attempt < 3; attempt++) {
					const doc = await this.api().get(id);
					const md = this.markdown(doc, id);
					const at = md.indexOf(old);
					if (!old || at === -1) return { text: "That text is not in the Doc as gdocs_read shows it. Read it again and copy the words exactly.", isError: true };
					if (md.indexOf(old, at + 1) !== -1) return { text: "That text is in the Doc more than once. Include more of the words around it.", isError: true };
					const requests = plan(doc, md.slice(0, at) + replacement + md.slice(at + old.length));
					if (!requests.length) return { text: "Nothing to change: the Doc already says that.", isError: false };
					try {
						await this.api().batchUpdate(id, requests, { requiredRevisionId: doc.revisionId });
					} catch (error) {
						if (error instanceof GoogleError && error.status === 400 && /revision|precondition/i.test(error.message)) continue;
						throw error;
					}
					this.credit.set(id, { by, until: Date.now() + CREDIT_MS });
					const linked = this.linkedById(id);
					if (linked && this.host.docs.openFiles().includes(linked.mirror)) void this.sync(linked);
					return { text: `Edited the Doc (${requests.length} change${requests.length === 1 ? "" : "s"}).${linked ? " The person sees it highlighted on its page." : ""}`, isError: false };
				}
				return { text: "The Doc kept changing while this edit was made. Try again.", isError: true };
			}
			return { text: `No tool ${name}.`, isError: true };
		} catch (error) {
			return { text: explain(error).message, isError: true };
		}
	}
}

/** Requests made at the page's indices, moved to the Doc's where someone else's typing has shifted them. */
function moveRequests(requests: DocsRequest[], page: string, doc: string): DocsRequest[] {
	let shift = 0;
	const splices = spliceDiff(page, doc).map((s) => {
		const at = s.at - shift;
		shift += s.text.length - s.before.length;
		return { at, before: s.before.length, after: s.text.length };
	});
	const point = (p: number) => {
		let shift = 0;
		for (const s of splices) {
			if (p >= s.at + s.before) shift += s.after - s.before;
			// Inside text someone else replaced: to where their text starts.
			else if (p > s.at) return s.at + shift;
			else break;
		}
		return p + shift;
	};
	return JSON.parse(JSON.stringify(requests), (key, value) => (key === "startIndex" || key === "endIndex" || key === "index") && typeof value === "number" ? point(value) : value) as DocsRequest[];
}

function read(file: string): string {
	try {
		return readFileSync(file, "utf8");
	} catch {
		return "";
	}
}

function mtime(file: string): number {
	try {
		return statSync(file).mtimeMs;
	} catch {
		return 0;
	}
}

/** Google's answers, said plainly. */
function explain(error: unknown): Error {
	if (!(error instanceof GoogleError)) return error instanceof Error ? error : new Error(String(error));
	if (error.status === 401) return new Error("Decks is not signed in to Google, or the sign-in ran out. Sign in again.");
	if (error.status === 403) return new Error("Your Google account cannot open that Doc, or the Docs API is not turned on in your Google Cloud project.");
	if (error.status === 404) return new Error("Google has no Doc at that address, or it is not shared with your account.");
	if (error.status === 429) return new Error("Google asked to slow down; trying again shortly.");
	return new Error(error.message);
}

/**
 * The tools' names and words, in `runtime/gdocs-tools.json`: Claude and Pi read them here, and
 * opencode's tool files and antigravity's MCP script read the same file, so all four runtimes
 * show a model the same words.
 */
export const GDOCS_TOOLS = JSON.parse(readFileSync(join(runtimeDir(), "gdocs-tools.json"), "utf8")) as ReadonlyArray<{ name: string; description: string; parameters: Record<string, string> }>;
