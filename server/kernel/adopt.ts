import { createHash } from "node:crypto";
import type { Caller } from "../../protocol/index.ts";
import { readJson, writeJson, type Stores } from "./store.ts";
import { toDeckPath, type Store } from "./types.ts";

// Today's .decks/, adopted once when a deck opens, before history and the
// tokens load: paired front ends keep their tokens, and every card version
// today's server kept becomes history at negative revisions, oldest lowest.

type OldToken = { id: string; hash: string; principal: { kind: string; id?: string; name?: string; label?: string }; label?: string; at: number };
type Kept = { hash: string; who: Caller; label?: string; at: number };
type OldVersion = { sha: string; at: number };
const DONE = "adopted.json";

/** Adopts what today's server left, once per deck; answers what it carried over. */
export async function adopt(old: Store, stores: Stores): Promise<string[]> {
	const kernel = stores("kernel");
	const done = await readJson<{ tokens?: number; revisions?: number }>(kernel, DONE, {});
	if (done.tokens !== undefined && done.revisions !== undefined) return [];
	const tokens = done.tokens ?? (await adoptTokens(old, kernel));
	const revisions = done.revisions ?? (await adoptRevisions(old, stores("history")));
	await writeJson(kernel, DONE, { tokens, revisions });
	return [`Adopted ${tokens} paired tokens and ${revisions} card versions from today's .decks/.`];
}

// Tokens: today's v2 file, kept by hash, as callers; canvas passes are not kept.

async function adoptTokens(old: Store, kernel: Store): Promise<number> {
	const file = await readJson<{ v?: number; tokens?: OldToken[] }>(old, "tokens.json", {});
	const known = await readJson<Kept[]>(kernel, "tokens.json", []);
	const hashes = new Set(known.map((one) => one.hash));
	const adopted = (file.tokens ?? []).flatMap((one) => {
		const who = callerOf(one);
		return who && !hashes.has(one.hash) ? [{ hash: one.hash, who, at: one.at, ...(one.label ? { label: one.label } : {}) }] : [];
	});
	if (adopted.length) await writeJson(kernel, "tokens.json", [...known, ...adopted]);
	return adopted.length;
}

/** Who an old token stands for now; a person's or a site's token is a paired front end. */
function callerOf(one: OldToken): Caller | undefined {
	const { kind } = one.principal;
	if (kind === "person" || kind === "site") return { kind: "person", id: `pair-${one.id}`, name: one.principal.label ?? one.label ?? "front end" };
	if (kind === "agent" && one.principal.id) return { kind: "agent", id: one.principal.id, name: one.principal.id };
	if (kind === "app" && one.principal.name) return { kind: "app", id: one.principal.name, name: one.principal.name };
	return undefined;
}

// Card versions: revisions/index.json names each card's versions in order;
// each becomes a written entry in history, its bytes kept once by hash.

async function adoptRevisions(old: Store, history: Store): Promise<number> {
	const index = await readJson<Record<string, OldVersion[]>>(old, "revisions/index.json", {});
	const all = Object.entries(index)
		.flatMap(([path, versions]) => versions.map((one) => ({ path, ...one })))
		.sort((a, b) => a.at - b.at);
	let count = 0;
	for (const [i, one] of all.entries()) {
		const bytes = await old.get(`revisions/${one.sha}.html`);
		const path = safePath(one.path);
		if (!bytes || !path) continue;
		const hash = createHash("sha256").update(bytes).digest("hex");
		if (!(await history.get(`blob/${hash}`))) await history.put(`blob/${hash}`, bytes);
		const entry = { path, rev: i - all.length, by: "before", at: one.at, kind: "written", hash };
		await writeJson(history, `log/before/${String(i).padStart(8, "0")}`, entry);
		count++;
	}
	return count;
}

function safePath(raw: string): string | undefined {
	try {
		return toDeckPath(raw);
	} catch {
		return undefined;
	}
}
