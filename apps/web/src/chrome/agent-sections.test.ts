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

/*
 * The keys the panel's store joins on, asserted here because nothing else would notice them.
 *
 * `LeftPanel` keeps this list in a store and hands old and new to `reconcile`, which matches by
 * one key at every level. A section or a row without that key is matched by *position* instead,
 * which does not fail loudly: the list still says the right thing, it just re-draws itself, and
 * an open popup silently attaches to whoever took the row's place. That is what the panel did
 * for as long as an agent worked, and the ids are what stopped it.
 */
test("every section and every row carries the id reconcile joins on", () => {
	for (const section of [...list(), ...grouped()]) {
		assert.equal(typeof section.id, "string");
		assert.ok(section.id.length > 0, "an empty id would join every section to every other");
		for (const row of section.rows) assert.equal(row.id, row.chat.id, "a row's id is the chat's");
	}
});

test("…and no two sections in one list share it", () => {
	for (const sections of [list(), grouped()]) {
		const ids = sections.map((section) => section.id);
		assert.equal(new Set(ids).size, ids.length, ids.join(", "));
	}
	/*
	 * The two axes name the same fact differently, and a workspace is a word a person types —
	 * so `quiet` is a heading here and could also be somebody's project. The prefix is what
	 * keeps them apart, and this is the line that would fail if it went.
	 */
	const named = agentSections({
		chats,
		identities: { ...rooms, ada: { ...identities.ada!, workspace: "quiet" } },
		unread,
		focused: "ada",
		group: "workspace",
	});
	const theirs = named.find((section) => section.label === "quiet");
	assert.equal(theirs?.id, "ws:quiet");
	assert.notEqual(theirs?.id, list()[2]?.id, "a workspace called `quiet` is not the Quiet heading");
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

// --- the workspace axis ---------------------------------------------------------------

/*
 * The same five agents, filed by project. Ada and Pi are on one, Iris and Wren on another, and
 * Basil on none — which is the case that has to work, because an agent nobody has told about a
 * project is the common state and it must not appear in the wrong group.
 */
const rooms: Record<string, Identity> = {
	...identities,
	ada: { ...identities.ada!, workspace: "political-llm" },
	pi: { ...identities.pi!, workspace: "political-llm" },
	iris: { ...identities.iris!, workspace: "irb-84069" },
	wren: { ...identities.wren!, workspace: "irb-84069" },
};

const grouped = (query?: string, focused = "ada") =>
	agentSections({ chats, identities: rooms, unread, focused, query, group: "workspace" });

test("filed by workspace: alphabetical, and `No workspace` last", () => {
	// `irb-84069` before `political-llm` because that is the order of the names, and the focus is
	// in `political-llm` — which is exactly the case the rule this replaced put first.
	assert.deepEqual(grouped().map((section) => section.label), ["irb-84069", "political-llm", "No workspace"]);
	assert.deepEqual(grouped().map((section) => section.kind), ["workspace", "workspace", "unfiled"]);
	assert.deepEqual(grouped(undefined, "iris").map((section) => section.label), ["irb-84069", "political-llm", "No workspace"], "the focus does not move a heading");
	// Basil is in none, and that is a section rather than an absence: a list that hid him would
	// be a list where an agent goes missing by not being told about a project.
	assert.deepEqual(grouped().at(-1)?.rows.map((row) => row.chat.id), ["basil"]);
});

test("…and a big workspace does not climb above a small one", () => {
	/*
	 * Size was once the ranking, and it is the one thing a reader cannot predict: five agents
	 * starting in one project would move every heading under it. The name is a place.
	 */
	const crowd = ["a1", "a2", "a3", "a4", "a5"].map((id, index) => chat(id, `Agent ${index}`, "idle", now - index * 1_000));
	const filed = agentSections({
		chats: [...crowd, chat("z1", "Zed", "idle", now)],
		identities: {
			...Object.fromEntries(crowd.map((one) => [one.id, { name: one.name, color: "#8", workspace: "zeta" }])),
			z1: { name: "Zed", color: "#9", workspace: "alpha" },
		},
		unread: {},
		group: "workspace",
	});
	assert.deepEqual(filed.map((section) => section.label), ["alpha", "zeta"]);
	assert.deepEqual(filed.map((section) => section.rows.length), [1, 5]);
});

test("…and the rows are in the order they last said something", () => {
	/*
	 * An idle agent that spoke five seconds ago leads a waiting one that has been silent for an
	 * hour, in a group whose heading is already saying somebody is waiting. The row order is the
	 * order of messages under both axes: a row moves when the agent says something, and not when
	 * it opens a tool, changes state or has a tag edited.
	 */
	const filed = agentSections({
		chats: [chat("quiet", "Quiet", "waiting", now - 3_600_000), chat("chatty", "Chatty", "idle", now - 5_000)],
		identities: {
			quiet: { name: "Quiet", color: "#6", workspace: "irb-84069" },
			chatty: { name: "Chatty", color: "#7", workspace: "irb-84069" },
		},
		unread: {},
		group: "workspace",
	});
	assert.deepEqual(filed[0]?.rows.map((row) => row.chat.id), ["chatty", "quiet"]);
	assert.equal(filed[0]?.note, "1 wants you", "and the urgency is in the heading rather than in the order");
});

test("…with the count of who needs you in the heading, because the heading does not say", () => {
	assert.equal(grouped()[0]?.note, "1 wants you", "Iris is waiting, and waiting wins over working");
	assert.equal(grouped()[1]?.note, "2 working", "Ada is running tools and Pi is typing");
	assert.equal(grouped()[2]?.note, undefined, "and silence when the group is quiet");
});

test("the focused agent does not move a heading", () => {
	/*
	 * It used to lead, on the argument that the panel sits beside the conversation you are in.
	 * The argument for a fixed order is stronger: a heading that moves when you switch agent is
	 * one you have to re-find, and switching agent is the thing you do most on this panel.
	 */
	const focus = (id: string) => agentSections({ chats, identities: rooms, unread, focused: id, group: "workspace" }).map((section) => section.label);
	assert.deepEqual(focus("ada"), ["irb-84069", "political-llm", "No workspace"]);
	assert.deepEqual(focus("iris"), ["irb-84069", "political-llm", "No workspace"]);
	assert.deepEqual(focus("basil"), ["irb-84069", "political-llm", "No workspace"], "the one in no workspace moves nothing either");
});

test("…and with nobody focused the same order, because the order never depended on who is", () => {
	const list = agentSections({ chats, identities: rooms, unread, group: "workspace" });
	assert.deepEqual(list.map((section) => section.label), ["irb-84069", "political-llm", "No workspace"]);
	const swapped = agentSections({
		chats,
		identities: { ...rooms, ada: { ...rooms.ada!, workspace: "zeta" }, pi: { ...rooms.pi!, workspace: "zeta" }, iris: { ...rooms.iris!, workspace: "alpha" } },
		unread,
		group: "workspace",
	});
	// Zeta holds two and alpha one, and alpha is still first: the count is not part of this.
	assert.deepEqual(swapped.map((section) => section.label), ["alpha", "irb-84069", "zeta", "No workspace"]);
});

test("search finds a project by name, in either grouping", () => {
	assert.deepEqual(grouped("irb").map((section) => section.rows.map((row) => row.chat.id)), [["iris", "wren"]]);
	assert.deepEqual(
		agentSections({ chats, identities: rooms, unread, focused: "ada", query: "irb" }).map((section) => section.rows.map((row) => row.chat.id)),
		[["iris"], ["wren"]],
		"the same two agents in the attention axis, where the workspace is only on the row",
	);
});
