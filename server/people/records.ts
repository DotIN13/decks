import { randomBytes } from "node:crypto";
import { Refused, type Caller, type Infer, type shapes } from "../../protocol/index.ts";
import type { Store } from "../kernel/types.ts";
import { avatarUrl, cleanName, cleanTags, cleanWorkspace, nextColour, numberedName } from "./clean.ts";

// Each agent's record, kept in the feature's private store under agents/<id>.
// Names are unique however they are capitalised.

export type AgentKind = Infer<typeof shapes.AgentKind>;
export type AgentChange = Infer<typeof shapes.AgentChange>;

export interface AgentRecord {
	id: string;
	name: string;
	color: string;
	tags: string[];
	avatar?: string;
	kind?: AgentKind;
	workspace?: string;
	canvas?: string;
	model?: string;
	thinking?: string;
	mode?: AgentChange["mode"];
	/** Run by a terminal client of its own, never adopted by a host. */
	attached?: boolean;
	/** The client that started it and delivers its mail. */
	host?: string;
	state?: string;
	/** What waits in its host's queue, as the host last said. */
	queued?: number;
	at: number;
}

export type NewAgent = { name?: string; kind?: AgentKind; workspace?: string; tags?: string[]; canvas?: string; model?: string; thinking?: string; mode?: AgentChange["mode"]; attached?: boolean; host?: string; state?: string };

const KEY = "agents/";
const enc = new TextEncoder();
const dec = new TextDecoder();

export class Roster {
	private byId = new Map<string, AgentRecord>();
	constructor(private store: Store, private clock: () => number = Date.now) {}

	async load(): Promise<void> {
		for (const key of await this.store.keys(KEY)) {
			const bytes = await this.store.get(key);
			if (!bytes) continue;
			const record = JSON.parse(dec.decode(bytes)) as AgentRecord;
			if (record && typeof record.id === "string") this.byId.set(record.id, record);
		}
	}

	all(): AgentRecord[] {
		return [...this.byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
	}

	byIdOrUndefined(id: string): AgentRecord | undefined {
		return this.byId.get(id);
	}

	/** One agent by id, or by a name however capitalised. */
	find(asked: string): AgentRecord {
		const want = asked.trim();
		if (!want) throw new Refused("invalid", "Name an agent, by name or id.", "agent.list");
		const hit = this.byId.get(want);
		if (hit) return hit;
		const named = this.all().filter((a) => a.name.toLowerCase() === want.toLowerCase());
		if (named.length > 1) throw new Refused("conflict", `More than one agent is called ${want}; use its id.`, "agent.list");
		if (!named[0]) throw new Refused("not_found", `No agent is called ${want}.`, "agent.list");
		return named[0];
	}

	private taken(name: string, except?: string): boolean {
		return this.all().some((a) => a.id !== except && a.name.toLowerCase() === name.toLowerCase());
	}

	async create(spec: NewAgent): Promise<AgentRecord> {
		const name = spec.name === undefined ? numberedName("Agent", (n) => this.taken(n)) : cleanName(spec.name);
		if (this.taken(name)) throw new Refused("conflict", `Another agent is already called ${name}. Pick a different name.`, "agent.list");
		const { name: _n, tags, workspace, ...rest } = spec;
		const record: AgentRecord = {
			...dropUndefined(rest),
			id: `a_${randomBytes(6).toString("hex")}`,
			name,
			color: nextColour(this.all().map((a) => a.color)),
			tags: cleanTags(tags ?? []),
			at: this.clock(),
		};
		const space = cleanWorkspace(workspace);
		if (space) record.workspace = space;
		await this.save(record);
		return record;
	}

	/** Apply a change; a no-op change writes nothing and answers false. */
	async update(id: string, change: AgentChange & { host?: string | null; state?: string }): Promise<{ record: AgentRecord; changed: boolean }> {
		const was = this.find(id);
		const next: AgentRecord = { ...was };
		if (change.name !== undefined) {
			const name = cleanName(change.name);
			if (this.taken(name, was.id)) throw new Refused("conflict", `Another agent is already called ${name}. Pick a different name.`, "agent.list");
			next.name = name;
		}
		if (change.avatar !== undefined) next.avatar = avatarUrl(change.avatar);
		if (change.tags !== undefined) next.tags = cleanTags(change.tags);
		if (change.workspace !== undefined) setOrDrop(next, "workspace", cleanWorkspace(change.workspace));
		if (change.host !== undefined) setOrDrop(next, "host", change.host ?? undefined);
		for (const key of ["canvas", "model", "thinking", "mode", "state", "queued"] as const) if (change[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = change[key];
		const changed = JSON.stringify(next) !== JSON.stringify(was);
		if (changed) await this.save(next);
		return { record: next, changed };
	}

	async delete(id: string): Promise<AgentRecord> {
		const record = this.find(id);
		this.byId.delete(record.id);
		await this.store.delete(KEY + record.id);
		return record;
	}

	/** The caller a token of this agent speaks as now; undefined once it is gone. */
	callerOf(id: string): Caller | undefined {
		const record = this.byId.get(id);
		return record ? { kind: "agent", id: record.id, name: record.name, ...(record.canvas ? { canvas: record.canvas } : {}) } : undefined;
	}

	private async save(record: AgentRecord): Promise<void> {
		this.byId.set(record.id, record);
		await this.store.put(KEY + record.id, enc.encode(JSON.stringify(record)));
	}
}

function setOrDrop<K extends keyof AgentRecord>(record: AgentRecord, key: K, value: AgentRecord[K] | undefined): void {
	if (value === undefined) delete record[key];
	else record[key] = value;
}

function dropUndefined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** A record as the protocol's Agent; the token is added only by attach. */
export function asAgent(record: AgentRecord, queued: number): shapes.Agent {
	const { attached: _a, host: _h, at: _t, queued: told, ...shown } = record;
	return { ...shown, queued: told ?? queued };
}
