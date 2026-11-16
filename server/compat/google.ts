// Google Docs on today's line, for a mirror (docs/google/<name>.md) a page has open: the Doc as Google
// has it (doc.gdoc), its comments (doc.gcomments, every 10 s as today) and its link's state (doc.remote).
import { call, type DocLine } from "./docs.ts";

type Said = Record<string, unknown>;

/** How often an open mirror's comments are read again, as today. */
export const COMMENTS_MS = 10_000;

/** A mirror opened: its Doc and its comments now, and the comments again every COMMENTS_MS while it is open. */
export function mirrorOpened(L: DocLine, path: string): void {
	void sendDoc(L, path);
	void sendComments(L, path);
	const key = `google:${path}`;
	if (L.state.watched.has(key)) return;
	const timer = setInterval(() => void sendComments(L, path), COMMENTS_MS);
	L.state.watched.set(key, () => clearInterval(timer));
}

/** A mirror closed: its comments no longer read. */
export function mirrorClosed(L: DocLine, path: string): void {
	const key = `google:${path}`;
	L.state.watched.get(key)?.();
	L.state.watched.delete(key);
}

/** Styles for the Doc, then the Doc as it is after them, to this page; a refusal as a notice. */
export async function style(L: DocLine, message: Said, path: string): Promise<void> {
	const got = await call(L, "google.style", { path, requests: message.requests ?? [], ...(typeof message.text === "string" ? { text: message.text } : {}) });
	if (!got.ok) return L.send({ type: "harness.notice", level: "warn", text: got.error });
	await sendDoc(L, path);
}

/** A comment made, answered or resolved; the comments after it, to this page. */
export async function comment(L: DocLine, message: Said, path: string): Promise<void> {
	const { action, comment: id, content, quote } = message;
	const got = await call(L, "google.comment", { path, action, ...(id !== undefined ? { comment: id } : {}), ...(content !== undefined ? { content } : {}), ...(quote !== undefined ? { quote } : {}) });
	L.send(got.ok ? { type: "doc.gcomments", path, comments: got.value } : { type: "doc.gcomments", path, comments: [], error: got.error });
}

/**
 * A file.changed for a mirror this line has open: Google's words pulled in (not this line's own typing)
 * bring the Doc again; its link's state is told as today's doc.remote.
 */
export function mirrorChanged(L: DocLine, payload: Record<string, unknown>): void {
	const path = Array.isArray(payload.ids) ? String(payload.ids[0]) : undefined;
	if (!path || !L.state.watched.has(`google:${path}`)) return;
	if (payload.part === "words" && !(typeof payload.client === "string" && L.state.clients?.has(payload.client))) void sendDoc(L, path);
	if (payload.part === "remote" && payload.remote) void sendRemote(L, path, payload.remote as Record<string, unknown>);
}

/** The Doc as Google has it, and the text it reads as, as today's doc.gdoc. */
async function sendDoc(L: DocLine, path: string): Promise<void> {
	const got = await call(L, "google.get", { path });
	if (got.ok) L.send({ type: "doc.gdoc", path, ...(got.value as { document: unknown; text: string }) });
}

/** The Doc's open comments, as today's doc.gcomments. */
async function sendComments(L: DocLine, path: string): Promise<void> {
	const got = await call(L, "google.comments", { path });
	L.send(got.ok ? { type: "doc.gcomments", path, comments: got.value } : { type: "doc.gcomments", path, comments: [], error: got.error });
}

/** The link's state, with the Google account it syncs as when signed in. */
async function sendRemote(L: DocLine, path: string, remote: Record<string, unknown>): Promise<void> {
	const signed = await call(L, "google.status", {});
	const email = signed.ok ? (signed.value as { email?: string }).email : undefined;
	L.send({ type: "doc.remote", path, status: { ...remote, ...(email ? { email } : {}) } });
}
