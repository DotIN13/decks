import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentKind, type AgentMode, type AgentModel, type ChatItem, type ThinkingLevel } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";

/**
 * The chat list, on disk, per deck (DESIGN §6.2).
 *
 * Agents used to live only in `Registry`'s array, so every restart emptied the list and
 * `focused()` minted a replacement with a fresh id. Nothing was corrupted — each runtime
 * keeps its own transcript — but Decks had no way back to any of it, and in development,
 * where `node --watch` restarts the server on every source edit, the list was gone every
 * few minutes.
 *
 * Two things are stored, and they answer different questions:
 *
 * - **`meta.json`** — how to *continue*: the runtime, the ref to resume, and what the row
 *   should say before anything is started. `resumeRef` belongs to the runtime (a session
 *   file path for pi, a session id for Claude); this store only carries it.
 * - **`chat.json`** — what to *show*. The runtime's own transcript is the record of the
 *   conversation, but it is in the runtime's format and reading it would mean a mapper per
 *   backend, one of them against pi's internal session shape. This is the display copy,
 *   in the shape the browser already receives.
 *
 * **A whole-array rewrite rather than an append log**, which is worth the paragraph because
 * append is the obvious choice and is wrong here. `ChatItem`s mutate after they are pushed:
 * a reply accumulates deltas, a tool call gets its result, an assistant turn that said
 * nothing is spliced out again. Appending would persist half-built rows and need
 * rewrite-the-line logic, and a rewind — which truncates the transcript — would need its own
 * truncation pass. Writing `history()` whole makes both disappear: nothing is ever written
 * mid-flight, and a truncated transcript is just a shorter array. The translator already
 * caps itself at 500 items, so the file cannot grow without bound.
 *
 * **A directory per agent, not one index**, so a bad write costs one chat rather than the
 * list. Every write goes to a temporary file and is renamed over the target, so a restart
 * during one leaves the previous version rather than half of the new one.
 */

/** What a row needs before its runtime has been started. */
export interface AgentRecord {
	id: string;
	kind: AgentKind;
	/** Absent until the backend has started once and reported a session to come back to. */
	resumeRef?: string;
	name: string;
	avatar?: string;
	color: string;
	parentId?: string;
	context: string[];
	inPlay: string[];
	createdAt: number;
	/** The model (and thinking level) the chat was last on, so a dormant row can still say what it will use. */
	model?: AgentModel;
	/** What it last asked before acting. Claude Code only; `capabilities.modes` is empty for pi. */
	mode?: AgentMode;
	/** Ordering, and what `prune` keeps. */
	lastAt: number;
}

export class AgentStore {
	constructor(private deck: Deck) {}

	setDeck(deck: Deck): void {
		this.deck = deck;
	}

	private get dir(): string {
		return join(this.deck.path, ".decks", "agents");
	}

	private folder(id: string): string {
		return join(this.dir, id);
	}

	/**
	 * Persist one agent.
	 *
	 * `items` is the transcript as it stands. Passing it separately rather than putting it
	 * on the record keeps the two files independent: a torn `chat.json` costs a transcript,
	 * not the row.
	 */
	write(record: AgentRecord, items: ChatItem[]): void {
		try {
			const folder = this.folder(record.id);
			mkdirSync(folder, { recursive: true });
			atomicWrite(join(folder, "meta.json"), JSON.stringify(record, null, 2));
			atomicWrite(join(folder, "chat.json"), JSON.stringify(items));
		} catch {
			/*
			 * A deck on a read-only volume, or a disk that is full. Losing the chat list is
			 * not worth taking the deck down for — the boards are the artifact, and they
			 * have their own error paths.
			 */
		}
	}

	/**
	 * One agent's record and transcript.
	 *
	 * An unreadable `meta.json` means the row cannot be rebuilt at all, so it is skipped.
	 * An unreadable `chat.json` is survivable and treated as an empty transcript: the chat
	 * still resumes, and the runtime still has the conversation in its own context — better
	 * a row with no visible history than no row.
	 */
	read(id: string): { record: AgentRecord; items: ChatItem[] } | undefined {
		let record: AgentRecord;
		try {
			record = validate(JSON.parse(readFileSync(join(this.folder(id), "meta.json"), "utf8")) as unknown, id);
		} catch {
			return undefined;
		}
		let items: ChatItem[] = [];
		try {
			const parsed = JSON.parse(readFileSync(join(this.folder(id), "chat.json"), "utf8")) as unknown;
			if (Array.isArray(parsed)) items = parsed as ChatItem[];
		} catch {
			/* covered above: a lost transcript is not a lost chat */
		}
		return { record, items };
	}

	/** Every readable record, newest conversation first. */
	list(): Array<{ record: AgentRecord; items: ChatItem[] }> {
		let ids: string[];
		try {
			ids = readdirSync(this.dir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name);
		} catch {
			return [];
		}
		return ids
			.map((id) => this.read(id))
			.filter((found): found is { record: AgentRecord; items: ChatItem[] } => found !== undefined)
			.sort((a, b) => b.record.lastAt - a.record.lastAt);
	}

	/**
	 * Drop an agent's record.
	 *
	 * The runtime's own session file is left alone. Closing a chat is not deleting a
	 * conversation, and pi's and Claude's session directories are theirs.
	 */
	forget(id: string): void {
		try {
			rmSync(this.folder(id), { recursive: true, force: true });
		} catch {
			/* already gone, which is the outcome wanted */
		}
	}

	/** Keep the newest `keep` records and forget the rest. Returns what was kept. */
	prune(keep: number): Array<{ record: AgentRecord; items: ChatItem[] }> {
		const all = this.list();
		for (const { record } of all.slice(keep)) this.forget(record.id);
		return all.slice(0, keep);
	}
}

/**
 * Write through a temporary file in the same directory.
 *
 * `rename` within one filesystem is atomic, so a reader sees either the old file or the new
 * one. Writing in place would let a restart mid-write leave truncated JSON, which is exactly
 * the case this store exists to survive.
 */
function atomicWrite(file: string, text: string): void {
	const temporary = `${file}.tmp`;
	writeFileSync(temporary, text);
	renameSync(temporary, file);
}

/**
 * Take only what is the right shape, and supply the rest.
 *
 * Records are read from disk and may have been written by an older build, so nothing here
 * assumes a field exists. The id comes from the directory name rather than the file, so a
 * record cannot claim to be an agent it is not — the avatar at
 * `.decks/avatars/<id>.svg` is addressed by it.
 */
function validate(raw: unknown, id: string): AgentRecord {
	if (!raw || typeof raw !== "object") throw new Error("not a record");
	const source = raw as Record<string, unknown>;
	const strings = (value: unknown): string[] =>
		Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
	/*
	 * `?? fallback` on a parsed number, not `|| fallback`.
	 *
	 * `Number(x) || fallback` reads a legitimate zero as missing, which put an epoch-dated
	 * record at the *top* of a list sorted by recency — it was handed `Date.now()` instead.
	 * Real timestamps are never zero, so this only ever showed up in a test, which is the
	 * argument for the test rather than against the distinction.
	 */
	const finite = (value: unknown, fallback: number): number => {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	};
	const created = finite(source.createdAt, Date.now());
	const model = modelOf(source.model);
	return {
		id,
		kind: source.kind === "claude" ? "claude" : "pi",
		...(typeof source.resumeRef === "string" ? { resumeRef: source.resumeRef } : {}),
		name: typeof source.name === "string" && source.name ? source.name : "Agent",
		...(typeof source.avatar === "string" ? { avatar: source.avatar } : {}),
		color: typeof source.color === "string" ? source.color : "#3b5cf6",
		...(typeof source.parentId === "string" ? { parentId: source.parentId } : {}),
		context: strings(source.context),
		inPlay: strings(source.inPlay),
		createdAt: created,
		...(model ? { model } : {}),
		...(MODES.includes(source.mode as AgentMode) ? { mode: source.mode as AgentMode } : {}),
		lastAt: finite(source.lastAt, created),
	};
}

const THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const MODES: AgentMode[] = ["manual", "acceptEdits", "plan", "auto"];

/**
 * The stored model, if it is one.
 *
 * A provider and a model id and nothing else — a half-written pair is no answer, because
 * `setModel` takes both and a runtime asked for `undefined/gpt-4` would refuse. The
 * thinking level is checked against the list rather than trusted: it is fed to two
 * runtimes' APIs, and a value from an older build that has since been renamed should
 * degrade to the middle rather than be passed through.
 */
function modelOf(raw: unknown): AgentModel | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const source = raw as Record<string, unknown>;
	const { provider, model, thinking } = source;
	if (typeof provider !== "string" || !provider) return undefined;
	if (typeof model !== "string" || !model) return undefined;
	return { provider, model, thinking: THINKING.includes(thinking as ThinkingLevel) ? (thinking as ThinkingLevel) : "medium" };
}
