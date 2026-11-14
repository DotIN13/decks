import type { Session } from "./session.ts";

// Going back in a conversation: rewind and fork by the runtime's own session
// tree, and the files the agent wrote as they were then, from the server's
// history (file.versions, file.restore). README rule 11.

type UserItem = { id: string; kind: string; entryId?: string; at: number; text?: string };
type CardRow = { path: string; by?: string };
type Version = { sha: string; at: number };

/** The user message an entry names: its transcript id or its runtime entry. */
export function userEntry(session: Session, entry: string): UserItem | undefined {
	return (session.history() as UserItem[]).find((one) => one.kind === "user" && (one.id === entry || one.entryId === entry));
}

function runtimeEntry(session: Session, entry: string): string {
	const found = userEntry(session, entry);
	if (!found?.entryId) throw Object.assign(new Error("That message cannot be gone back to: the runtime has no point for it."), { code: "not_found" });
	return found.entryId;
}

export async function rewind(session: Session, entry: string): Promise<void> {
	await session.start();
	if (!session.backend) throw Object.assign(new Error(`Not started: ${session.failure ?? "unknown reason"}`), { code: "unavailable" });
	const shown = userEntry(session, entry)?.text;
	const result = await session.backend.rewindTo(runtimeEntry(session, entry));
	if (result.cancelled) return;
	session.translator.truncateToUserMessage(result.editorText ?? shown);
	await session.backend.syncEntryIds();
	session.flush();
}

/** A handle a new session can resume, holding the conversation up to that message. */
export async function forkRef(session: Session, entry: string): Promise<string | undefined> {
	await session.start();
	return session.backend?.forkFrom(runtimeEntry(session, entry));
}

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

/** For each file the agent wrote or named, by its tools or as a card's writer, the version current when the message was sent. */
export async function cardsAt(session: Session, entry: string): Promise<Record<string, string>> {
	const at = userEntry(session, entry)?.at;
	if (at === undefined) return {};
	const cards = ((await session.client.call("card.list").catch(() => undefined))?.value ?? []) as CardRow[];
	const written = cards.filter((one) => one.by === session.id || one.by === session.spec.name).map((one) => one.path);
	const out: Record<string, string> = {};
	for (const path of new Set([...written, ...touchedFiles(session, session.deckPath)])) {
		const versions = ((await session.client.call("file.versions", { path }).catch(() => undefined))?.value ?? []) as Version[];
		const then = versions.filter((one) => one.at <= at).sort((a, b) => b.at - a.at)[0];
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
