import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chat, check } from "@decks/protocol";
import type { AgentMode, AgentModel, ChatItem, RunKind } from "../runtimes/types/index.ts";
import type { Saved } from "./transcript.ts";

// An agent's conversation from before the rewrite. Today's Decks keeps it in the deck, in
// .decks/agents/<id>/: meta.json (its runtime's session, model, mode, account), chat.json (the
// window) and chat.log (everything, one item a line). The harness reads it once, when it adopts an
// agent it has no file for, and keeps it as its own (`Transcripts`); the deck's copy is left alone.

/** What the deck held for an agent, as the harness keeps it: its file, and what fell out of the window. */
export type FromDeck = { saved: Saved; archive: ChatItem[] };

/** The agent's conversation from the deck, when it has one and it is of this kind; else none. */
export function fromDeck(deck: string, id: string, kind: RunKind): FromDeck | undefined {
	const folder = join(deck, ".decks", "agents", id.replace(/[^\w.-]/g, "_"));
	const meta = readJson(join(folder, "meta.json"));
	if (!meta || typeof meta !== "object" || (meta as { kind?: unknown }).kind !== kind) return undefined;
	const items = itemsOf(readJson(join(folder, "chat.json")));
	const inWindow = new Set(items.map((one) => one.id));
	const archive = linesOf(join(folder, "chat.log")).filter((one) => !inWindow.has(one.id));
	return { saved: { id, kind, ...runtimeOf(meta as Record<string, unknown>), items }, archive };
}

// The runtime's state

const MODES: readonly AgentMode[] = ["manual", "acceptEdits", "plan", "auto"];

/** meta.json's runtime fields, each kept only when it is of today's shape: its session, model, mode, account. */
function runtimeOf(meta: Record<string, unknown>): Partial<Saved> {
	const out: Partial<Saved> = {};
	if (typeof meta.resumeRef === "string" && meta.resumeRef) out.sessionRef = meta.resumeRef;
	if (meta.model && !check(chat.AgentModel, meta.model).length) out.model = meta.model as AgentModel;
	if (MODES.includes(meta.mode as AgentMode)) out.mode = meta.mode as AgentMode;
	if (typeof meta.account === "string" && meta.account) out.account = meta.account;
	return out;
}

// The conversation

/** chat.json: a list of items (or one under `items`), each made today's shape; any that cannot be, dropped. */
function itemsOf(raw: unknown): ChatItem[] {
	const list = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown } | undefined)?.items) ? (raw as { items: unknown[] }).items : [];
	return list.map(chatItem).filter((one): one is ChatItem => !!one);
}

/** chat.log: one item a line, oldest first; a line that is not one is skipped. */
function linesOf(file: string): ChatItem[] {
	if (!existsSync(file)) return [];
	const out: ChatItem[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const item = chatItem(JSON.parse(line));
			if (item) out.push(item);
		} catch {
			// A torn line, as a crash leaves at the end: skipped.
		}
	}
	return out;
}

/**
 * One of today's items as the protocol's ChatItem: each kind keeps its own fields only. A tool counts
 * its pictures, has no time, and is done unless it erred (one left running is done: nothing runs it
 * now); a reply is never streaming. Whatever still fails the protocol's shape is dropped.
 */
function chatItem(raw: unknown): ChatItem | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const item = (() => {
		switch (r.kind) {
			case "user":
				return pick({ kind: "user", id: r.id, text: r.text, at: r.at, entryId: r.entryId, parts: r.parts });
			case "assistant":
				return pick({ kind: "assistant", id: r.id, text: r.text, at: r.at, thinking: r.thinking });
			case "tool": {
				const images = Array.isArray(r.images) ? r.images.length : typeof r.images === "number" ? r.images : undefined;
				const state = r.state === "error" ? "error" : "done";
				return pick({ kind: "tool", id: r.id, name: r.name, title: r.title ?? r.name, args: r.args, result: typeof r.result === "string" ? r.result : r.result === undefined ? undefined : JSON.stringify(r.result), full: r.full, images: images || undefined, state });
			}
			case "notice":
				return pick({ kind: "notice", id: r.id, level: r.level ?? "info", text: r.text, at: r.at });
			default:
				return undefined;
		}
	})();
	return item && !check(chat.ChatItem, item).length ? (item as ChatItem) : undefined;
}

/** The fields that have a value: a field left out stays out. */
function pick(fields: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null));
}

function readJson(file: string): unknown {
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as unknown;
	} catch {
		return undefined;
	}
}
