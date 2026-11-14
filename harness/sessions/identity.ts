import type { shapes, Infer } from "@decks-next/protocol";
import { AGENT_KINDS, type AgentMode, type RunKind } from "../runtimes/types/index.ts";

// Who an agent is, as the harness holds it: what agent.requested said, and
// the reminder an agent gets until it has said who it is.

export type Agent = Infer<typeof shapes.Agent>;

export type Spec = { id: string; name: string; kind: RunKind; canvas?: string; model?: string; thinking?: string; mode?: AgentMode; token?: string };

const str = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** A spec from agent.requested, checked: an unknown kind is refused, the rest is kept as given. */
export function specOf(raw: unknown, id: string): Spec {
	const from = (raw ?? {}) as Record<string, unknown>;
	const kind = str(from.kind) as RunKind | undefined;
	if (!kind || !AGENT_KINDS.includes(kind)) throw new Error(`This harness does not run ${kind ?? "an unnamed kind of"} agents.`);
	const spec: Spec = { id: str(from.id) ?? id, name: str(from.name) ?? id, kind };
	for (const key of ["canvas", "model", "thinking", "token"] as const) {
		const value = str(from[key]);
		if (value) spec[key] = value;
	}
	const mode = str(from.mode);
	if (mode) spec.mode = mode as AgentMode;
	return spec;
}

const UNNAMED = /^agent(?: \d+)?$/i;
type Gap = "name" | "avatar" | "workspace" | "tags";

export function identityGaps(agent: Pick<Agent, "name" | "avatar" | "tags" | "workspace">): Gap[] {
	const gaps: Gap[] = [];
	if (!agent.name.trim() || UNNAMED.test(agent.name.trim())) gaps.push("name");
	if (!agent.avatar) gaps.push("avatar");
	if (!agent.workspace) gaps.push("workspace");
	if (!agent.tags?.length) gaps.push("tags");
	return gaps;
}

const ASK: Record<Gap, string> = {
	name: "--name: a short name of your own, not a number",
	avatar: `--avatar.svg '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">…</svg>': a small picture you draw (or --avatar.emoji)`,
	workspace: "--workspace: the project you are working on",
	tags: `--tags '["…"]': up to four words for what you are doing right now`,
};

/** The line put in front of a message until the agent has said who it is; none once it has. */
export function identityReminder(agent: Pick<Agent, "name" | "avatar" | "tags" | "workspace">): string | undefined {
	const gaps = identityGaps(agent);
	if (gaps.length === 0) return undefined;
	if (gaps.length === 1 && gaps[0] === "tags") return `[Decks] Your tags are empty. Set them to what this turn is about with decks agent update --tags '["…"]', and to '[]' when you finish.`;
	return `[Decks] You have not said who you are: set it now with decks agent update ${gaps.map((gap) => ASK[gap]).join("; ")}. It is how the person and other agents find you.`;
}
