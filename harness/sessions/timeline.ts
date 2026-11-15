import type { Session } from "./session.ts";

// Going back in a conversation: rewind and fork by the runtime's own session
// tree, and the files the agent wrote as they were then, from the server's
// history (file.versions, file.restore). README rule 11.

type UserItem = { id: string; kind: string; entryId?: string; at: number; text?: string };

type CardRow = { path: string; by?: string };
type Version = { sha: string; at: number };
type Text = { text: string };

// Rewind and fork
/** The user message an entry names: its transcript id or its runtime entry. */
export function userEntry(session: Session, entry: string): UserItem | undefined {
	return (session.history() as UserItem[]).find((one) => one.kind === "user" && (one.id === entry || one.entryId === entry));
}

function runtimeEntry(session: Session, entry: string): string {
	const found = userEntry(session, entry);
	if (!found?.entryId) throw Object.assign(new Error("That message cannot be gone back to: the runtime has no point for it."), { code: "not_found" });
	return found.entryId;
}

/** Back to just before a message; answers its words, for the composer, or nothing when cancelled. */
export async function rewind(session: Session, entry: string): Promise<string | undefined> {
	await session.start();
	if (!session.backend) throw Object.assign(new Error(`Not started: ${session.failure ?? "unknown reason"}`), { code: "unavailable" });
	const shown = userEntry(session, entry)?.text;
	const result = await session.backend.rewindTo(runtimeEntry(session, entry));
	if (result.cancelled) return undefined;
	// The person's words, not the runtime's copy, which carries the news put in front of them.
	const words = shown ?? result.editorText;
	session.translator.truncateToUserMessage(words);
	await session.backend.syncEntryIds();
	session.flush();
	return words ?? "";
}

/** A handle a new session can resume, holding the conversation up to that message. */
export async function forkRef(session: Session, entry: string): Promise<string | undefined> {
	await session.start();
	return session.backend?.forkFrom(runtimeEntry(session, entry));
}

// The files the agent touched, and their versions as each message was sent
const FILE = /(?:^|[\s"'=(])((?:\/|\.\/)?[\w.@-]+(?:\/[\w.@-]+)*\.(?:html|css|js|mjs|json|md|svg|pen))(?=$|[\s"',)])/g;

/** The deck files the agent's tool calls named: paths in their arguments, made relative to the deck. */

export function touchedFiles(session: Session, deckPath: string): string[] {
	const found = new Set<string>();
	for (const item of session.history() as Array<{ kind: string; args?: unknown; title?: string }>) {
		if (item.kind !== "tool") continue;
		const text = `${JSON.stringify(item.args ?? {}).replace(/\\"/g, '"')} ${item.title ?? ""}`;
		for (const match of text.matchAll(FILE)) {
			const raw = match[1]!.replace(/^\.\//, "");
			const path = raw.startsWith("/") ? (raw.startsWith(`${deckPath}/`) ? raw.slice(deckPath.length + 1) : "") : raw;
			if (path && !path.startsWith("..")) found.add(path);
		}
	}
	return [...found];
}

/** What a message is marked with as it is sent: each touched file's settled version. */
export async function markFiles(session: Session, paths: string[]): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const path of paths) {
		const sha = await settledVersion(session, path);
		if (sha !== undefined) out[path] = sha;
	}
	return out;
}

/** The file's newest version once the server has heard its last write: its text matches the disk's. */
export async function settledVersion(session: Session, path: string, tries = 20): Promise<string | undefined> {
	for (let i = 0; i < tries; i++) {
		const versions = ((await session.client.call("file.versions", { path }).catch(() => undefined))?.value ?? []) as Version[];
		const newest = versions[0]?.sha;
		if (newest === undefined) return undefined;
		const [now, then] = await Promise.all([session.client.call("file.read", { path }), session.client.call("file.read", { path, sha: newest })].map((one) => one.then((a) => (a.value as Text).text).catch(() => undefined)));
		if (now !== undefined && now === then) return newest;
		await new Promise((done) => setTimeout(done, 100));
	}
	return undefined;
}

// Preview and restore
/** For each file the agent named or wrote, its version when the message was sent: the mark, else by time. */
export async function cardsAt(session: Session, entry: string): Promise<Record<string, string>> {
	const user = userEntry(session, entry);
	if (!user) return {};
	const marked = session.marksOf(user.id);
	const cards = ((await session.client.call("card.list").catch(() => undefined))?.value ?? []) as CardRow[];
	const written = cards.filter((one) => one.by === session.id || one.by === session.spec.name).map((one) => one.path);
	const out: Record<string, string> = {};
	for (const path of new Set([...written, ...touchedFiles(session, session.deckPath), ...Object.keys(marked)])) {
		if (marked[path] !== undefined) {
			out[path] = marked[path];
			continue;
		}
		const versions = ((await session.client.call("file.versions", { path }).catch(() => undefined))?.value ?? []) as Version[];
		const then = versions.filter((one) => one.at <= user.at).sort((a, b) => b.at - a.at)[0];
		if (then) out[path] = then.sha;
	}
	return out;
}

/** Put those versions back; answers how many cards changed. */
export async function restoreCards(session: Session, entry: string): Promise<number> {
	const then = await cardsAt(session, entry);
	let changed = 0;
	for (const [path, sha] of Object.entries(then)) {
		const versions = ((await session.client.call("file.versions", { path }).catch(() => undefined))?.value ?? []) as Version[];
		if (versions[0]?.sha === sha) continue;
		await session.client.call("file.restore", { path, sha });
		changed += 1;
	}
	return changed;
}
