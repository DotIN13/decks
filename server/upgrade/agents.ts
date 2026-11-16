// 0.6.0: today's agents (.decks/agents/<id>/meta.json, .decks/avatars/<id>.svg) become the people
// store's records (agents/<id>), keeping each id, so the harness's own half finds the conversation
// and the session it resumes under the same id. Nothing of today's is changed or removed: the
// harness reads .decks/agents/ itself when it adopts an agent, and a later step retires the folder.
import type { Deck, Store, UpgradeParts } from "../kernel/index.ts";
import { readJson, writeJson } from "../kernel/store.ts";

/** What today's meta.json holds of an agent, as far as the people store keeps it. */
type OldMeta = {
	id?: unknown;
	kind?: unknown;
	name?: unknown;
	color?: unknown;
	tags?: unknown;
	workspace?: unknown;
	stage?: unknown;
	createdAt?: unknown;
	model?: { model?: unknown; thinking?: unknown };
	mode?: unknown;
};

/** The people store's record (server/people/records.ts AgentRecord), as written here. */
type PeopleRecord = { id: string; name: string; color: string; tags: string[]; avatar?: string; kind?: string; workspace?: string; canvas?: string; model?: string; thinking?: string; mode?: string; at: number };

/** The kinds protocol/chat.ts AgentKind names; an agent of another kind keeps its record, with no kind. */
const KINDS = new Set(["pi", "claude", "opencode", "opencode2", "antigravity", "codex"]);
const MODES = new Set(["manual", "acceptEdits", "plan", "auto"]);
const FALLBACK_COLOUR = "#3b5cf6";

/** Every agent of today's deck written into the people store once; an id already there is left as it is. */
export async function agentsToPeople(deck: Deck, say: (line: string) => void, parts: UpgradeParts): Promise<void> {
	const people = parts.stores("people");
	const metas = await oldMetas(parts.old);
	if (!metas.length) return;
	await backUp(parts.old, metas.map((m) => m.id));
	const canvases = new Set((await deck.list("canvases" as never).catch(() => [])).map((e) => e.path.split("/")[1]));
	const taken = new Set((await existing(people)).map((r) => r.name.toLowerCase()));
	const known = new Set((await existing(people)).map((r) => r.id));
	let written = 0;
	for (const meta of metas) {
		if (known.has(meta.id)) continue;
		const record = recordOf(meta, canvases, taken, await avatarOf(parts.old, meta.id));
		taken.add(record.name.toLowerCase());
		await writeJson(people, `agents/${record.id}`, record);
		written += 1;
	}
	say(`${written} of today's ${metas.length} agents written to the people store; .decks/agents stays for the harness to read`);
}

// Today's records in, oldest first.

/** Each agent folder with a readable meta.json, oldest first, so a later one takes the numbered name. */
async function oldMetas(old: Store): Promise<(OldMeta & { id: string })[]> {
	const ids = new Set((await old.keys("agents/")).map((key) => key.split("/")[1]).filter((id): id is string => !!id));
	const out: (OldMeta & { id: string })[] = [];
	for (const id of ids) {
		const meta = await readJson<OldMeta | undefined>(old, `agents/${id}/meta.json`, undefined).catch(() => undefined);
		if (meta && typeof meta === "object") out.push({ ...meta, id: typeof meta.id === "string" ? meta.id : id });
	}
	return out.sort((a, b) => atOf(a) - atOf(b) || a.id.localeCompare(b.id));
}

/** A copy of each agent's meta.json and avatar under backups/, as today's migrations keep one; chats are never changed, so they are not copied. */
async function backUp(old: Store, ids: string[]): Promise<void> {
	const into = `backups/${new Date().toISOString().replace(/[:.]/g, "-")}-before-agents-to-people`;
	for (const id of ids) {
		for (const key of [`agents/${id}/meta.json`, `avatars/${id}.svg`]) {
			const bytes = await old.get(key);
			if (bytes) await old.put(`${into}/${key}`, bytes);
		}
	}
}

async function existing(people: Store): Promise<PeopleRecord[]> {
	const out: PeopleRecord[] = [];
	for (const key of await people.keys("agents/")) {
		const record = await readJson<PeopleRecord | undefined>(people, key, undefined);
		if (record?.id) out.push(record);
	}
	return out;
}

// One record, as the people store reads it.

function recordOf(meta: OldMeta & { id: string }, canvases: Set<string | undefined>, taken: Set<string>, avatar: string | undefined): PeopleRecord {
	const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
	const record: PeopleRecord = { id: meta.id, name: uniqueName(str(meta.name) ?? "Agent", taken), color: str(meta.color) ?? FALLBACK_COLOUR, tags: Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === "string").slice(0, 4) : [], at: atOf(meta) };
	const kind = str(meta.kind);
	if (kind && KINDS.has(kind)) record.kind = kind;
	if (str(meta.workspace)) record.workspace = str(meta.workspace);
	// A home canvas this deck still has; one since deleted is left out, and the agent is given one when it starts.
	if (str(meta.stage) && canvases.has(str(meta.stage))) record.canvas = str(meta.stage);
	if (str(meta.model?.model)) record.model = str(meta.model?.model);
	if (str(meta.model?.thinking)) record.thinking = str(meta.model?.thinking);
	if (str(meta.mode) && MODES.has(str(meta.mode)!)) record.mode = str(meta.mode);
	if (avatar) record.avatar = avatar;
	return record;
}

/** Today's avatar file as a data address, which the people store keeps in place of today's /api/avatar/<id>. */
async function avatarOf(old: Store, id: string): Promise<string | undefined> {
	const bytes = await old.get(`avatars/${id}.svg`);
	const svg = bytes ? new TextDecoder().decode(bytes).trim() : "";
	if (!/^<svg\b/i.test(svg) || /<script\b|\son\w+=/i.test(svg) || svg.length > 20000) return undefined;
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** A name not yet taken however capitalised: the later of two the same is "Name 2", then "Name 3" (today's rule). */
function uniqueName(name: string, taken: Set<string>): string {
	if (!taken.has(name.toLowerCase())) return name;
	for (let n = 2; ; n += 1) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}

function atOf(meta: OldMeta): number {
	if (typeof meta.createdAt === "number") return meta.createdAt;
	const parsed = typeof meta.createdAt === "string" ? Date.parse(meta.createdAt) : NaN;
	return Number.isFinite(parsed) ? parsed : 0;
}
