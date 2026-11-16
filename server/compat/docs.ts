// Documents on today's line: a document page's doc.* messages made into the file calls, and file.changed
// told back as doc.changed to the line that has the document open (Folio's mapping, for the canvas page).
import type { Caller } from "../../protocol/index.ts";
import type { SocketDoor, Stop } from "../kernel/index.ts";
import { comment, mirrorChanged, mirrorClosed, mirrorOpened, style } from "./google.ts";

type Said = Record<string, unknown>;

/** What the documents need of a line: who it is, its subscriptions, the documents it has open, and its sender. */
export type DocLine = {
	state: { caller?: Caller; watched: Map<string, Stop>; docs?: Set<string>; clients?: Set<string> };
	door: SocketDoor;
	send: (message: Said) => void;
	client: ReturnType<SocketDoor["client"]>;
};

/** One document message from the page, answered as today's server answered it. */
export async function docHeard(L: DocLine, message: Said): Promise<void> {
	const type = String(message.type);
	const path = String(message.path ?? "");
	const client = typeof message.client === "string" ? message.client : undefined;
	if (type === "doc.open") return open(L, path, client ?? "");
	if (type === "doc.close") {
		L.state.docs?.delete(path);
		mirrorClosed(L, path);
		return void (await call(L, "file.close", { path, client: client ?? "" }));
	}
	if (type === "doc.patch") return patch(L, message, path, client ?? "");
	if (type === "doc.review") return void (await call(L, "file.review", { path, change: message.change, accept: message.accept }));
	if (type === "doc.versions") {
		const got = await call(L, "file.versions", { path });
		// Today's list ran oldest first; the new call answers newest first.
		return L.send({ type: "doc.versions", path, versions: got.ok ? [...(got.value as unknown[])].reverse() : [] });
	}
	if (type === "doc.version") {
		const got = await call(L, "file.read", { path, sha: message.sha });
		return L.send(got.ok ? { type: "doc.version", path, sha: message.sha, text: (got.value as { text: string }).text } : { type: "doc.version", path, sha: message.sha, error: got.error });
	}
	if (type === "doc.restore") return void (await call(L, "file.restore", { path, sha: message.sha }));
	if (type === "doc.compile") return compile(L, path);
	if (type === "doc.git") return git(L, path, String(message.action ?? "status"));
	if (type === "doc.gstyle") return style(L, message, path);
	if (type === "doc.gcomment") return comment(L, message, path);
	L.send({ type: "harness.notice", level: "warn", text: `The line does not know ${type}.` });
}

/** Opened: the document as it is now, to this page, and its changes heard from now on. */
async function open(L: DocLine, path: string, client: string): Promise<void> {
	const got = await call(L, "file.open", { path, client });
	if (!got.ok) return L.send({ type: "doc.state", path, asked: path, client, rev: 0, format: "text", text: "", changes: [], error: got.error });
	const doc = got.value as { path: string; rev: number; format: string; text: string; changes: unknown[]; remote?: unknown };
	(L.state.docs ??= new Set()).add(doc.path);
	(L.state.clients ??= new Set()).add(client);
	hearChanges(L);
	L.send({ type: "doc.state", path: doc.path, asked: path, client, rev: doc.rev, format: doc.format, text: doc.text, changes: doc.changes, ...(doc.remote ? { remote: doc.remote } : {}) });
	// A Google Doc's mirror: its Doc and comments follow, as today.
	if (doc.remote) mirrorOpened(L, doc.path);
}

/** The page's typing as one batch: the revision it made and the splices refused, to this page. */
async function patch(L: DocLine, message: Said, path: string, client: string): Promise<void> {
	const splices = Array.isArray(message.splices) ? message.splices : [];
	const got = await call(L, "file.splice", { path, client, rev: message.rev, batch: message.batch, splices });
	if (!got.ok) return L.send({ type: "doc.patched", path, batch: message.batch, rev: message.rev, refused: splices.map((_, i) => i) });
	const done = got.value as { rev: number; refused: number[]; text?: string };
	L.send({ type: "doc.patched", path, batch: message.batch, rev: done.rev, refused: done.refused, ...(done.text !== undefined ? { text: done.text } : {}) });
}

/** Typeset: the result comes as file.compiled to every page on the document; a refusal, to this page now. */
async function compile(L: DocLine, path: string): Promise<void> {
	const got = await call(L, "file.compile", { path });
	if (!got.ok) L.send({ type: "doc.compiled", path, ok: false, errors: [], at: Date.now(), ms: 0, error: got.error });
}

/** The document's git: status, or a pull or push, answered as today's doc.repo. */
async function git(L: DocLine, path: string, action: string): Promise<void> {
	const name = action === "pull" ? "file.pull" : action === "push" ? "file.push" : "file.repo";
	const got = await call(L, name, { path });
	if (!got.ok) return L.send({ type: "doc.repo", path, action, ok: false, message: got.error });
	if (name === "file.repo") return L.send({ type: "doc.repo", path, action, ok: true, ...(got.value ? { status: got.value } : {}) });
	const synced = got.value as { ok: boolean; message: string; status?: unknown };
	L.send({ type: "doc.repo", path, action, ok: synced.ok, message: synced.message, ...(synced.status ? { status: synced.status } : {}) });
}

/** file.changed and file.compiled for a document this line has open, told as today's doc.changed and doc.compiled; once per line. */
function hearChanges(L: DocLine): void {
	if (!L.state.caller || L.state.watched.has("file.changed")) return;
	const stop = L.door.subscribe({ caller: L.state.caller, client: L.client.id, events: ["file.changed", "file.compiled"] }, (event) => {
		const open = L.state.docs ?? new Set<string>();
		const said = event.name === "file.compiled" ? docCompiled(event.payload, open) : docChanged(event.payload, open);
		if (said) L.send(said);
		if (event.name === "file.changed") mirrorChanged(L, event.payload);
	});
	L.state.watched.set("file.changed", stop);
}

/**
 * Today's doc.changed for a file.changed: words as their splices, an accepted change as no splices
 * with that change settled. Anything else (versions, a Google copy) is not told; undefined.
 */
export function docChanged(payload: Record<string, unknown>, open: ReadonlySet<string>): Said | undefined {
	const path = Array.isArray(payload.ids) ? String(payload.ids[0]) : undefined;
	if (!path || !open.has(path) || (payload.part !== "words" && payload.part !== "review")) return undefined;
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

/** Today's doc.compiled for a file.compiled of a document this line has open. */
export function docCompiled(payload: Record<string, unknown>, open: ReadonlySet<string>): Said | undefined {
	const path = Array.isArray(payload.ids) ? String(payload.ids[0]) : undefined;
	if (!path || !open.has(path)) return undefined;
	const { ok, pdf, errors, at, ms, error } = payload;
	return { type: "doc.compiled", path, ok, ...(pdf !== undefined ? { pdf } : {}), errors: errors ?? [], at, ms, ...(error !== undefined ? { error } : {}) };
}

/** A file call as the line's caller: the value, or the refusal's words. */
export async function call(L: DocLine, name: string, args: Record<string, unknown>): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
	const envelope = await L.door.call(name, args, L.state.caller!, L.client);
	return envelope.ok ? { ok: true, value: envelope.value } : { ok: false, error: envelope.error.message };
}
