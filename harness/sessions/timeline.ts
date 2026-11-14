import type { Session } from "./session.ts";

// Going back in a conversation: rewind and fork by the runtime's own session
// tree, and the cards the agent wrote as they were then, from the server's
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

/** For each card the agent last wrote, the version that was current when the message was sent. */
export async function cardsAt(session: Session, entry: string): Promise<Record<string, string>> {
	const at = userEntry(session, entry)?.at;
	if (at === undefined) return {};
	const cards = ((await session.client.call("card.list").catch(() => undefined))?.value ?? []) as CardRow[];
	const mine = cards.filter((one) => one.by === session.id || one.by === session.spec.name);
	const out: Record<string, string> = {};
	for (const card of mine) {
		const versions = ((await session.client.call("file.versions", { path: card.path }).catch(() => undefined))?.value ?? []) as Version[];
		const then = versions.filter((one) => one.at <= at).sort((a, b) => b.at - a.at)[0];
		if (then) out[card.path] = then.sha;
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
