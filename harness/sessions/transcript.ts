import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMode, AgentModel, ChatItem, ModelOption, RunKind } from "../runtimes/types/index.ts";

// Each agent's conversation and runtime state, kept in the harness's folder,
// never the deck: <home>/harness/agents/<id>.json, and the entries that fell
// out of the window in <id>.archive.jsonl, oldest first.

export type Saved = {
	id: string;
	kind: RunKind;
	token?: string;
	sessionRef?: string;
	model?: AgentModel;
	mode?: AgentMode;
	account?: string;
	/** For each user message, the settled version of each file the agent had touched when it was sent. */
	marks?: Record<string, Record<string, string>>;
	items: ChatItem[];
};

const safe = (id: string): string => id.replace(/[^\w.-]/g, "_");

export class Transcripts {
	readonly dir: string;

	constructor(home: string) {
		this.dir = join(home, "harness", "agents");
	}

	read(id: string): Saved | undefined {
		const file = this.file(id);
		if (!existsSync(file)) return undefined;
		try {
			return JSON.parse(readFileSync(file, "utf8")) as Saved;
		} catch {
			return undefined;
		}
	}

	/** Written whole, through a file beside it, so a crash leaves the old copy. */
	write(saved: Saved): void {
		mkdirSync(this.dir, { recursive: true });
		const file = this.file(saved.id);
		writeFileSync(`${file}.tmp`, JSON.stringify(saved));
		renameSync(`${file}.tmp`, file);
	}

	archive(id: string, items: ChatItem[]): void {
		if (!items.length) return;
		mkdirSync(this.dir, { recursive: true });
		appendFileSync(this.archiveFile(id), items.map((one) => JSON.stringify(one)).join("\n") + "\n");
	}

	archived(id: string): ChatItem[] {
		const file = this.archiveFile(id);
		if (!existsSync(file)) return [];
		return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ChatItem);
	}

	/** The entries before one, newest last, from the window and the archive together. */
	page(id: string, current: ChatItem[], before: string | undefined, limit: number): ChatItem[] {
		const all = before ? [...this.archived(id), ...current] : current;
		const end = before ? all.findIndex((one) => one.id === before) : all.length;
		const stop = end < 0 ? all.length : end;
		return all.slice(Math.max(0, stop - limit), stop);
	}

	find(id: string, current: ChatItem[], item: string): ChatItem | undefined {
		return current.find((one) => one.id === item) ?? this.archived(id).find((one) => one.id === item);
	}

	forget(id: string): void {
		rmSync(this.file(id), { force: true });
		rmSync(this.archiveFile(id), { force: true });
	}

	rememberModels(kind: RunKind, models: ModelOption[]): void {
		mkdirSync(this.dir, { recursive: true });
		const all = this.models();
		all[kind] = models;
		writeFileSync(join(this.dir, "..", "models.json"), JSON.stringify(all));
	}

	knownModels(kind: RunKind): ModelOption[] {
		return this.models()[kind] ?? [];
	}

	private models(): Partial<Record<RunKind, ModelOption[]>> {
		const file = join(this.dir, "..", "models.json");
		try {
			return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<Record<RunKind, ModelOption[]>>) : {};
		} catch {
			return {};
		}
	}

	private file(id: string): string {
		return join(this.dir, `${safe(id)}.json`);
	}

	private archiveFile(id: string): string {
		return join(this.dir, `${safe(id)}.archive.jsonl`);
	}
}
