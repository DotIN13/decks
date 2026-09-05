import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentChat, AgentState, Identity } from "@decks/protocol";
import { agentFoot, agentMatches, agentSections, agentTally } from "./agent-sections.ts";

/*
 * The cases a reader of the panel would notice: an agent in the wrong section, a section
 * heading with nothing under it, a count that disagrees with the rows, a finished turn
 * shouting as loudly as a question — and a search for a tag finding nothing.
 */

const chat = (id: string, name: string, state: AgentState, lastAt: number, extra: Partial<AgentChat> = {}): AgentChat => ({
	id,
	name,
	state,
	lastAt,
	unread: 0,
	contextCount: 0,
	kind: "claude",
	capabilities: { modes: [] },
	commands: [],
	...extra,
});

const now = 1_700_000_000_000;
const chats = [
	chat("ada", "Ada", "tool", now - 4_000),
	chat("iris", "Iris", "waiting", now - 90_000),
	chat("pi", "Pi", "streaming", now - 20_000, { kind: "pi" }),
	chat("wren", "Wren", "idle", now - 900_000, { kind: "pi" }),
	chat("basil", "Basil", "idle", now - 7_200_000, { dormant: true }),
];

const identities: Record<string, Identity> = {
	ada: { name: "Ada", color: "#1", tags: ["panel-css", "measuring"] },
	iris: { name: "Iris", color: "#2", tags: ["e2e"], userTags: ["mine"] },
	pi: { name: "Pi", color: "#3" },
	wren: { name: "Wren", color: "#4", tags: ["thumbnails"] },
	basil: { name: "Basil", color: "#5" },
};

/** Wren is done-and-unread; the rest are read. */
const unread = { wren: 3 };
const list = (query?: string) => agentSections({ chats, identities, unread, focused: "ada", query });

test("three sections, in urgency order, in sentence case", () => {
	assert.deepEqual(list().map((section) => section.label), ["Wants you", "Working", "Quiet"]);
	assert.deepEqual(list().map((section) => section.kind), ["wants", "working", "quiet"]);
	for (const section of list()) assert.notEqual(section.label, section.label.toUpperCase(), "no caps anywhere");
});

test("a question comes first; a finished turn does not jump the queue", () => {
	const [wants, working, quiet] = list();
	assert.deepEqual(wants?.rows.map((row) => row.chat.id), ["iris"]);
	assert.deepEqual(working?.rows.map((row) => row.chat.id), ["ada", "pi"], "most recent first");
	/*
	 * Wren is `done` — idle with unread — and it stays in Quiet with the green ring rather
	 * than being promoted. "Come and read this" is not the same demand as "answer this now".
	 */
	assert.deepEqual(quiet?.rows.map((row) => row.chat.id), ["wren", "basil"]);
	assert.equal(quiet?.rows[0]?.status, "done", "…but its status still says so, for the ring");
});

test("every agent appears exactly once", () => {
	const ids = list().flatMap((section) => section.rows.map((row) => row.chat.id));
	assert.equal(ids.length, chats.length);
	assert.equal(new Set(ids).size, ids.length);
});

test("a row carries both tag lists, kept apart", () => {
	const iris = list()[0]?.rows[0];
	assert.deepEqual(iris?.tags, ["e2e"], "the agent's own");
	assert.deepEqual(iris?.userTags, ["mine"], "and yours, separately");
	const pi = list()[1]?.rows[1];
	assert.deepEqual(pi?.tags, [], "an agent that has never tagged itself is empty, not undefined");
	assert.deepEqual(pi?.userTags, []);
});

test("the focused agent is marked, and only it", () => {
	const marked = list().flatMap((section) => section.rows.filter((row) => row.current));
	assert.deepEqual(marked.map((row) => row.chat.id), ["ada"]);
});

test("an empty section is not drawn", () => {
	const quietOnly = agentSections({ chats: [chats[3]!, chats[4]!], identities, unread, focused: "ada" });
	assert.deepEqual(quietOnly.map((section) => section.kind), ["quiet"]);
	assert.deepEqual(agentSections({ chats: [], identities, unread }), [], "and no agents is no sections");
});

test("search matches a name, the agent's tags, and yours", () => {
	assert.deepEqual(list("panel").map((section) => section.rows.map((row) => row.chat.id)), [["ada"]]);
	assert.deepEqual(list("e2e").map((section) => section.rows.map((row) => row.chat.id)), [["iris"]]);
	assert.deepEqual(list("mine").map((section) => section.rows.map((row) => row.chat.id)), [["iris"]], "your own tag is searchable too");
	assert.deepEqual(list("wren").map((section) => section.rows.map((row) => row.chat.id)), [["wren"]]);
	assert.deepEqual(list("  PANEL-CSS  ").map((section) => section.rows.map((row) => row.chat.id)), [["ada"]], "trimmed and folded");
	assert.deepEqual(list("nothing-doing"), [], "a search that matches nobody is no sections");
});

test("agentMatches is the whole rule, and an empty needle matches everything", () => {
	const row = { chat: chats[0]!, tags: ["panel-css"], userTags: [] };
	assert.ok(agentMatches(row, ""));
	assert.ok(agentMatches(row, "ada"));
	assert.ok(!agentMatches(row, "iris"));
});

test("the tally comes from the sections, so the foot cannot disagree", () => {
	assert.deepEqual(agentTally(list()), { total: 5, active: 3, wants: 1 });
	assert.deepEqual(agentTally([]), { total: 0, active: 0, wants: 0 });
});

test("the foot counts, and leaves the rest to the headings", () => {
	// It read `5 agents · 3 active · 1 wants you` — the three section headings, each of which
	// already carries its own count, said again under them.
	assert.equal(agentFoot({ total: 5, active: 3, wants: 1 }), "5 agents");
	assert.equal(agentFoot({ total: 1, active: 1, wants: 0 }), "1 agent", "singular");
	assert.equal(agentFoot({ total: 0, active: 0, wants: 0 }), "No agents yet");
});

test("…and says how many matched while a search is running", () => {
	assert.equal(agentFoot({ total: 5, active: 3, wants: 1 }, 1), "1 of 5 match");
	assert.equal(agentFoot({ total: 5, active: 3, wants: 1 }, 0), "0 of 5 match");
});
