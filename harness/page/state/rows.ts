import type { shapes } from "@decks-next/protocol";
import type { AgentChat, AgentKind, AgentModel, AgentState, ClaudeAccount, Identity, Page, RuntimeInfo, StageRow, ThinkingLevel } from "./types/index.ts";

// What the server and the harness answer, as the rows the page draws. Pure:
// no store, no DOM. A field the protocol does not carry gets the value the
// page drew before it arrived (idle, no lines, no boards).

type Agent = shapes.Agent;
type Canvas = { name: string; title: string; open: string[]; cards: number; rev?: number; shared?: { owner: string; role: "edit" | "view" } };
type Card = { path: string; title: string; placements?: Array<{ card: string; canvas: string; box: { x1: number; y1: number; x2: number; y2: number } }> };

/** What runtime.get({ agent }) adds to an agent's row: what only its harness knows. */
export type AgentExtra = {
	usage?: AgentChat["usage"];
	account?: string;
	commands?: AgentChat["commands"];
	lastLine?: string;
	lastAt?: number;
	dormant?: boolean;
	model?: string | AgentModel;
	thinking?: string;
	queued?: { items: Array<{ id: string; text: string }>; held: boolean };
	dialogs?: unknown[];
};

const STATES: readonly AgentState[] = ["idle", "thinking", "streaming", "tool", "waiting"];
const KINDS: readonly AgentKind[] = ["pi", "claude", "opencode", "opencode2", "antigravity", "codex"];

/** An agent's state as the page knows it: anything else (error, a new word) reads as idle. */
export function stateOf(word: string | undefined): AgentState {
	return STATES.includes(word as AgentState) ? (word as AgentState) : "idle";
}

/** The model an agent is on: the harness's whole model when it says one, else the record's words. */
export function modelOf(agent: Agent, extra: AgentExtra = {}): AgentModel | undefined {
	if (extra.model && typeof extra.model === "object") return extra.model;
	const name = (typeof extra.model === "string" ? extra.model : undefined) ?? agent.model;
	if (!name) return undefined;
	const [provider, ...rest] = name.includes("/") ? name.split("/") : ["", name];
	return { provider: provider ?? "", model: rest.join("/"), thinking: ((extra.thinking ?? agent.thinking ?? "off") as ThinkingLevel) };
}

/** What the agent says about itself, for its face, its cursor and the panel's grouping. */
export function identityOf(agent: Agent): Identity {
	return {
		name: agent.name,
		color: agent.color ?? "#888888",
		...(agent.avatar ? { avatar: agent.avatar } : {}),
		...(agent.tags.length ? { tags: agent.tags } : {}),
		...(agent.workspace ? { workspace: agent.workspace } : {}),
	};
}

/** One row of the agent list. `boards` are the cards placed on its home canvas. */
export function chatOf(agent: Agent, extra: AgentExtra = {}, boards: string[] = []): AgentChat {
	const model = modelOf(agent, extra);
	return {
		id: agent.id,
		name: agent.name,
		...(agent.avatar ? { avatar: agent.avatar } : {}),
		state: stateOf(agent.state),
		unread: 0,
		kind: KINDS.includes(agent.kind as AgentKind) ? (agent.kind as AgentKind) : "claude",
		...(agent.mode ? { mode: agent.mode } : {}),
		identity: identityOf(agent),
		cards: boards,
		inPlay: boards,
		...(model ? { model } : {}),
		...(extra.usage ? { usage: extra.usage } : {}),
		...(extra.account ? { account: extra.account } : {}),
		...(extra.commands ? { commands: extra.commands } : {}),
		...(extra.lastLine !== undefined ? { lastLine: extra.lastLine } : {}),
		...(extra.lastAt !== undefined ? { lastAt: extra.lastAt } : {}),
		...(extra.dormant ? { dormant: true as const } : {}),
	};
}

/** One row of the canvas manager: the agents whose home it is, and its cards counted as boards. */
export function stageRowOf(canvas: Canvas, agents: readonly Agent[]): StageRow {
	const here = agents.filter((agent) => agent.canvas === canvas.name || canvas.open.includes(agent.id));
	return {
		name: canvas.name,
		title: canvas.title,
		boards: canvas.cards,
		rev: canvas.rev ?? 0,
		agents: here.map((agent) => ({ id: agent.id, name: agent.name, color: agent.color ?? "#888888" })),
		words: canvas.title,
		...(canvas.shared ? { shared: { owner: canvas.shared.owner, role: canvas.shared.role } } : {}),
	};
}

/** A card as the page's Page: its place on its canvas, or none when it is on no canvas. */
export function pageOf(card: Card): Page {
	const at = card.placements?.[0]?.box;
	return { path: card.path, title: card.title, card: true, x: at?.x1 ?? 0, y: at?.y1 ?? 0, w: at ? at.x2 - at.x1 : 0, h: at ? at.y2 - at.y1 : 0 } as Page;
}

/** The cards placed on a canvas, by path: an agent's boards are those on its home canvas. */
export function cardsOn(cards: readonly Card[], canvas: string | undefined): string[] {
	if (!canvas) return [];
	return cards.filter((card) => card.placements?.some((one) => one.canvas === canvas)).map((card) => card.path);
}

/** A runtime the harness can run, with the page's fields filled when it does not say them. */
export function runtimeOf(runtime: { kind: AgentKind; available: boolean; reason?: string; models?: unknown[]; label?: string; commands?: unknown[]; capabilities?: unknown }): RuntimeInfo {
	const models = (runtime.models ?? []).map((one) => (typeof one === "string" ? { provider: "", model: one, label: one, reasoning: false } : one));
	return {
		kind: runtime.kind,
		label: runtime.label ?? runtime.kind,
		available: runtime.available,
		...(runtime.reason ? { reason: runtime.reason } : {}),
		capabilities: (runtime.capabilities as RuntimeInfo["capabilities"]) ?? { modes: [] },
		commands: (runtime.commands as RuntimeInfo["commands"]) ?? [],
		models: models as RuntimeInfo["models"],
	};
}

/** The accounts and the one a new agent starts on, from account.list. */
export function accountsOf(list: ReadonlyArray<{ id: string; label: string; active: boolean; spending?: string }>): { accounts: ClaudeAccount[]; active: string } {
	const accounts = list.map((one) => ({ id: one.id, email: one.label, signedIn: true, ...(one.id === "default" ? { isDefault: true as const } : {}) }));
	return { accounts, active: list.find((one) => one.active)?.id ?? "default" };
}
