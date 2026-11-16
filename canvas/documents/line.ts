import type { DocClientMessage, DocServerMessage } from "./model.ts";
import type { DocPageOptions } from "./page/types.ts";

/**
 * A document page's line on the protocol: what the page sends (`doc.open`, `doc.patch`, …) made into file
 * and Google calls, and the socket's `file.changed` and `file.compiled` told back as the page's messages.
 * One per page, the mapping server/compat/docs.ts and google.ts made, moved to where the page is.
 */
export function protocolLine(call: DocCall, on: DocEvents): Pick<DocPageOptions, "send" | "listen"> {
	const line = new Line(call, on);
	return { send: (message) => void line.heard(message), listen: (listener) => line.listen(listener) };
}

/** One call on the protocol, answered in its envelope. */
export type DocCall = (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; value?: unknown; error?: string }>;
/** The socket's `file.changed` and `file.compiled`; answers what stops them. */
export type DocEvents = (listener: (name: string, payload: Record<string, unknown>) => void) => () => void;

type Said = Record<string, unknown>;

/** How often an open Google mirror's comments are read again, as the compat line did. */
export const COMMENTS_MS = 10_000;

class Line {
	private readonly listeners = new Set<(message: DocServerMessage) => void>();
	/** The documents this page has open, by the path the server answered, and the client ids it typed with. */
	private readonly open = new Set<string>();
	private readonly clients = new Set<string>();
	/** A Google mirror's comment timer, while it is open. */
	private readonly mirrors = new Map<string, ReturnType<typeof setInterval>>();
	private stopEvents: (() => void) | undefined;

	constructor(
		private readonly call: DocCall,
		private readonly on: DocEvents,
	) {}

	listen(listener: (message: DocServerMessage) => void): () => void {
		this.listeners.add(listener);
		this.stopEvents ??= this.on((name, payload) => this.event(name, payload));
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size) return;
			this.stopEvents?.();
			this.stopEvents = undefined;
			for (const timer of this.mirrors.values()) clearInterval(timer);
			this.mirrors.clear();
		};
	}

	private tell(message: Said): void {
		for (const listener of this.listeners) listener(message as DocServerMessage);
	}

	// --- what the page sends, as calls ---

	/** One message from the page, answered as the compat line answered it. */
	async heard(message: DocClientMessage): Promise<void> {
		const said = message as unknown as Said;
		const path = String(said.path ?? "");
		const client = typeof said.client === "string" ? said.client : "";
		switch (message.type) {
			case "doc.open":
				return this.opened(path, client);
			case "doc.close":
				this.open.delete(path);
				this.mirrorClosed(path);
				return void (await this.call("file.close", { path, client }));
			case "doc.patch":
				return this.patch(said, path, client);
			case "doc.review":
				return void (await this.call("file.review", { path, change: said.change, accept: said.accept }));
			case "doc.versions": {
				const got = await this.call("file.versions", { path });
				// The page's list runs oldest first; the call answers newest first.
				return this.tell({ type: "doc.versions", path, versions: got.ok ? [...(got.value as unknown[])].reverse() : [] });
			}
			case "doc.version": {
				const got = await this.call("file.read", { path, sha: said.sha });
				return this.tell(got.ok ? { type: "doc.version", path, sha: said.sha, text: (got.value as { text: string }).text } : { type: "doc.version", path, sha: said.sha, error: got.error });
			}
			case "doc.restore":
				return void (await this.call("file.restore", { path, sha: said.sha }));
			case "doc.compile":
				return this.compile(path);
			case "doc.git":
				return this.git(path, String(said.action ?? "status"));
			case "doc.gstyle":
				return this.style(said, path);
			case "doc.gcomment":
				return this.comment(said, path);
		}
	}

	/** Opened: the document as it is now, and a Google mirror's Doc and comments after it. */
	private async opened(path: string, client: string): Promise<void> {
		const got = await this.call("file.open", { path, client });
		if (!got.ok) return this.tell({ type: "doc.state", path, asked: path, client, rev: 0, format: "text", text: "", changes: [], error: got.error });
		const doc = got.value as { path: string; rev: number; format: string; text: string; changes: unknown[]; remote?: unknown };
		this.open.add(doc.path);
		this.clients.add(client);
		this.tell({ type: "doc.state", path: doc.path, asked: path, client, rev: doc.rev, format: doc.format, text: doc.text, changes: doc.changes, ...(doc.remote ? { remote: doc.remote } : {}) });
		if (doc.remote) this.mirrorOpened(doc.path);
	}

	/** The page's typing as one batch: the revision it made and the splices refused. */
	private async patch(said: Said, path: string, client: string): Promise<void> {
		const splices = Array.isArray(said.splices) ? said.splices : [];
		const got = await this.call("file.splice", { path, client, rev: said.rev, batch: said.batch, splices });
		if (!got.ok) return this.tell({ type: "doc.patched", path, batch: said.batch, rev: said.rev, refused: splices.map((_, i) => i) });
		const done = got.value as { rev: number; refused: number[]; text?: string };
		this.tell({ type: "doc.patched", path, batch: said.batch, rev: done.rev, refused: done.refused, ...(done.text !== undefined ? { text: done.text } : {}) });
	}

	/** Typeset: the result comes as file.compiled; a refusal, now. */
	private async compile(path: string): Promise<void> {
		const got = await this.call("file.compile", { path });
		if (!got.ok) this.tell({ type: "doc.compiled", path, ok: false, errors: [], at: Date.now(), ms: 0, error: got.error });
	}

	/** The document's git: its status, or a pull or a push. */
	private async git(path: string, action: string): Promise<void> {
		const name = action === "pull" ? "file.pull" : action === "push" ? "file.push" : "file.repo";
		const got = await this.call(name, { path });
		if (!got.ok) return this.tell({ type: "doc.repo", path, action, ok: false, message: got.error });
		if (name === "file.repo") return this.tell({ type: "doc.repo", path, action, ok: true, ...(got.value ? { status: got.value } : {}) });
		const synced = got.value as { ok: boolean; message: string; status?: unknown };
		this.tell({ type: "doc.repo", path, action, ok: synced.ok, message: synced.message, ...(synced.status ? { status: synced.status } : {}) });
	}

	// --- what the socket says, as the page's messages ---

	private event(name: string, payload: Record<string, unknown>): void {
		const path = Array.isArray(payload.ids) ? String(payload.ids[0]) : undefined;
		if (!path || !this.open.has(path)) return;
		if (name === "file.compiled") return this.tell(compiledOf(path, payload));
		const said = changedOf(path, payload);
		if (said) this.tell(said);
		if (!this.mirrors.has(path)) return;
		// A mirror: Google's words pulled in (not this page's typing) bring the Doc again; its link's state as doc.remote.
		if (payload.part === "words" && !(typeof payload.client === "string" && this.clients.has(payload.client))) void this.sendDoc(path);
		if (payload.part === "remote" && payload.remote) void this.sendRemote(path, payload.remote as Said);
	}

	// --- a Google Doc's mirror ---

	private mirrorOpened(path: string): void {
		void this.sendDoc(path);
		void this.sendComments(path);
		if (!this.mirrors.has(path)) this.mirrors.set(path, setInterval(() => void this.sendComments(path), COMMENTS_MS));
	}

	private mirrorClosed(path: string): void {
		clearInterval(this.mirrors.get(path));
		this.mirrors.delete(path);
	}

	/** Styles for the Doc, then the Doc as it is after them. */
	private async style(said: Said, path: string): Promise<void> {
		const got = await this.call("google.style", { path, requests: said.requests ?? [], ...(typeof said.text === "string" ? { text: said.text } : {}) });
		if (got.ok) await this.sendDoc(path);
	}

	/** A comment made, answered or resolved; the comments after it. */
	private async comment(said: Said, path: string): Promise<void> {
		const { action, comment: id, content, quote } = said;
		const got = await this.call("google.comment", { path, action, ...(id !== undefined ? { comment: id } : {}), ...(content !== undefined ? { content } : {}), ...(quote !== undefined ? { quote } : {}) });
		this.tell(got.ok ? { type: "doc.gcomments", path, comments: got.value } : { type: "doc.gcomments", path, comments: [], error: got.error });
	}

	private async sendDoc(path: string): Promise<void> {
		const got = await this.call("google.get", { path });
		if (got.ok) this.tell({ type: "doc.gdoc", path, ...(got.value as { document: unknown; text: string }) });
	}

	private async sendComments(path: string): Promise<void> {
		const got = await this.call("google.comments", { path });
		this.tell(got.ok ? { type: "doc.gcomments", path, comments: got.value } : { type: "doc.gcomments", path, comments: [], error: got.error });
	}

	private async sendRemote(path: string, remote: Said): Promise<void> {
		const signed = await this.call("google.status", {});
		const email = signed.ok ? (signed.value as { email?: string }).email : undefined;
		this.tell({ type: "doc.remote", path, status: { ...remote, ...(email ? { email } : {}) } });
	}
}

/**
 * The page's doc.changed for a file.changed: words as their splices, an accepted or rejected change as
 * no splices with that change settled. Versions and a Google copy's state are told otherwise; undefined.
 */
export function changedOf(path: string, payload: Record<string, unknown>): Said | undefined {
	if (payload.part !== "words" && payload.part !== "review") return undefined;
	const words = payload.part === "words";
	return {
		type: "doc.changed",
		path,
		base: payload.base,
		rev: payload.rev,
		splices: words ? (payload.splices ?? []) : [],
		by: payload.by,
		...(typeof payload.client === "string" ? { client: payload.client } : {}),
		...(typeof payload.batch === "string" ? { batch: payload.batch } : {}),
		...(payload.record ? { change: payload.record } : {}),
		...(payload.settled || !words ? (typeof payload.change === "string" ? { settled: [payload.change] } : {}) : {}),
	};
}

/** The page's doc.compiled for a file.compiled. */
export function compiledOf(path: string, payload: Record<string, unknown>): Said {
	const { ok, pdf, errors, at, ms, error } = payload;
	return { type: "doc.compiled", path, ok, ...(pdf !== undefined ? { pdf } : {}), errors: errors ?? [], at, ms, ...(error !== undefined ? { error } : {}) };
}
