import { parse, serializeOuter } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import type { ActKind, ServerMessage } from "@decks/protocol";

/**
 * What an agent is doing to a board, said by the server rather than the agent.
 *
 * The canvas draws a cursor and editing marks for an agent at work (`canvas/acts.ts`), and it
 * used to have one source for where to draw them: `stage.cursor`, which an agent had to call
 * itself, and almost never did. Everything the drawing needs is already passing through here:
 *
 * - **A tool call starts.** A write or edit tool naming a file under `boards/` says which board
 *   is about to change. For an edit, the old text it names is looked for in the file as it is
 *   now, and the root block it sits in is the one being held.
 * - **The file lands.** The watcher says the board changed; the file as it was when the tool
 *   call started is diffed against the new one by root-level `data-id`, and the blocks whose
 *   markup differs are what changed.
 * - **A stage verb.** `newBoard`, `fit`, `resize`, `move`, `show` and `hide` name a board and
 *   need no diff.
 *
 * Two phases go out: `start` when the tool call begins, so the held outline can be drawn
 * while the agent writes, and `done` when the file lands or the tool ends without a landing.
 * One message per tool call, never per keystroke, and nothing here writes a byte to a board.
 *
 * The file diff is by root block rather than by character on purpose: a board is a handful
 * of `data-id` blocks, the canvas can only outline a block, and a character diff of two HTML
 * documents would be a lot of work to answer "which box".
 */

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface ToolEvent {
	callId: string;
	name: string;
	args: unknown;
	phase: "start" | "end";
}

export type Act = { kind: "tool"; event: ToolEvent } | { kind: "verb"; what: ActKind; path: string };

export interface ActsHost {
	emit(message: ServerMessage): void;
	/** The agent's name and colour for the label; absent for an agent that is gone. */
	identity(agentId: string): { name: string; color: string } | undefined;
	/** Deck-relative path for a file, or undefined when it is not a board the deck knows. */
	boardPathOf(file: string): string | undefined;
	/** The board's bytes as they are now, or undefined when it cannot be read. */
	read(path: string): string | undefined;
	/** A timer, so a test can fire it by hand. Answers with what cancels it. */
	schedule?(ms: number, run: () => void): () => void;
	now?(): number;
}

/** How long after a tool ends without the file landing before the hold is let go. */
export const END_GRACE_MS = 2500;
/** A tool call that never ends — a runtime that lost the result — still lets go after this. */
export const HOLD_LIMIT_MS = 30_000;
/** More than this many changed blocks is a rewrite: the outline goes on the board, not on each. */
export const MAX_IDS = 12;

interface Pending {
	agentId: string;
	callId: string;
	before: string | undefined;
	cancel: () => void;
}

export class Acts {
	/** One hold per board: a second tool call on the same file replaces the first. */
	private readonly pending = new Map<string, Pending>();

	constructor(private readonly host: ActsHost) {}

	act(agentId: string, act: Act): void {
		if (act.kind === "verb") {
			this.say(agentId, act.path, "done", act.what);
			return;
		}
		const { event } = act;
		const file = fileNamed(event.name, event.args);
		if (!file) return;
		const path = this.host.boardPathOf(file);
		if (!path) return;
		if (event.phase === "start") {
			this.let(path);
			const before = this.host.read(path);
			const old = oldText(event.args);
			const block = before !== undefined && old ? blockAt(before, old) : undefined;
			const cancel = this.later(HOLD_LIMIT_MS, () => this.finish(path, agentId, event.callId));
			this.pending.set(path, { agentId, callId: event.callId, before, cancel });
			this.say(agentId, path, "start", "edit", block ? [block] : undefined);
			return;
		}
		const held = this.pending.get(path);
		if (!held || held.callId !== event.callId) return;
		// The result came back before the watcher spoke: give the disk a moment, then let go.
		held.cancel();
		held.cancel = this.later(END_GRACE_MS, () => this.finish(path, agentId, event.callId));
	}

	/** The watcher saw the board change: whoever held it is done, and the diff says with what. */
	landed(path: string, html: string): void {
		const held = this.pending.get(path);
		if (!held) return;
		this.let(path);
		const ids = held.before === undefined ? [] : changedBlocks(held.before, html);
		this.say(held.agentId, path, "done", "edit", ids.length > 0 && ids.length <= MAX_IDS ? ids : undefined);
	}

	/** The agent is gone: its holds go with it, silently. */
	forget(agentId: string): void {
		for (const [path, held] of this.pending) {
			if (held.agentId !== agentId) continue;
			held.cancel();
			this.pending.delete(path);
		}
	}

	private finish(path: string, agentId: string, callId: string): void {
		const held = this.pending.get(path);
		if (!held || held.callId !== callId) return;
		this.pending.delete(path);
		this.say(agentId, path, "done", "edit");
	}

	private let(path: string): void {
		this.pending.get(path)?.cancel();
		this.pending.delete(path);
	}

	private say(agentId: string, path: string, phase: "start" | "done", what: ActKind, ids?: string[]): void {
		const who = this.host.identity(agentId);
		if (!who) return;
		this.host.emit({ type: "agent.act", agentId, path, phase, what, ...(ids ? { ids } : {}), label: who.name, color: who.color, at: this.host.now?.() ?? Date.now() });
	}

	private later(ms: number, run: () => void): () => void {
		if (this.host.schedule) return this.host.schedule(ms, run);
		const timer = setTimeout(run, ms);
		timer.unref?.();
		return () => clearTimeout(timer);
	}
}

/**
 * The file a write or edit tool is about to change, or undefined for any other tool.
 *
 * Matched by what the tool is called and which argument names the file, because four runtimes
 * name them four ways: Claude's `Write`/`Edit` take `file_path`, pi's `write`/`edit` take
 * `path`, and the others are close enough to one of those. A read tool named `Read` has a
 * `file_path` too, which is why the name is checked first.
 */
export function fileNamed(name: string, args: unknown): string | undefined {
	if (!/(^|_)(write|edit|multiedit|str_replace|create_file|replace)(_|$)/i.test(name) && !/^(write|edit|multiedit)$/i.test(name)) return undefined;
	if (!args || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	for (const key of ["file_path", "path", "filePath", "filename", "file"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

/** The text an edit is about to replace, when the tool says one. */
function oldText(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	for (const key of ["old_string", "oldString", "old_str", "oldText", "old"]) {
		const value = record[key];
		if (typeof value === "string" && value) return value;
	}
	return undefined;
}

/** Every root-level block of a board, by `data-id`, with its markup and where it sits in the file. */
function rootBlocks(html: string): Map<string, { markup: string; start: number; end: number }> {
	const out = new Map<string, { markup: string; start: number; end: number }>();
	let document: ReturnType<typeof parse>;
	try {
		document = parse(html, { sourceCodeLocationInfo: true });
	} catch {
		return out;
	}
	const body = findBody(document as unknown as Node);
	if (!body) return out;
	for (const child of body.childNodes) {
		if (!("tagName" in child)) continue;
		const element = child as Element;
		const id = element.attrs.find((attr) => attr.name === "data-id")?.value;
		if (!id || out.has(id)) continue;
		const at = element.sourceCodeLocation;
		out.set(id, { markup: serializeOuter(element), start: at?.startOffset ?? 0, end: at?.endOffset ?? 0 });
	}
	return out;
}

function findBody(node: Node): Element | undefined {
	if ("tagName" in node && (node as Element).tagName === "body") return node as Element;
	if (!("childNodes" in node)) return undefined;
	for (const child of (node as { childNodes: Node[] }).childNodes) {
		const found = findBody(child as Node);
		if (found) return found;
	}
	return undefined;
}

/**
 * The root block an edit lands in: the one whose source range holds the old text.
 *
 * Undefined when the text is not in the file (the edit will be refused, or it is in the head),
 * or when it sits outside every block. The first occurrence is the one an edit tool replaces.
 */
export function blockAt(html: string, text: string): string | undefined {
	const offset = html.indexOf(text);
	if (offset < 0) return undefined;
	for (const [id, block] of rootBlocks(html)) {
		if (offset >= block.start && offset < block.end) return id;
	}
	return undefined;
}

/**
 * The root blocks whose markup differs between two versions of a board, plus the ones that are
 * new. A block that was removed has nowhere to be drawn, so it is not named.
 */
export function changedBlocks(before: string, after: string): string[] {
	const was = rootBlocks(before);
	const out: string[] = [];
	for (const [id, block] of rootBlocks(after)) {
		if (was.get(id)?.markup !== block.markup) out.push(id);
	}
	return out;
}
