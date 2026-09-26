import type { Identity } from "@decks/protocol";

/**
 * What an agent has not yet said about itself, and the sentence that asks for it.
 *
 * An agent is addressed by its name (`@name`, `stage.send(name)`), found by its workspace
 * (`stage.agents({ filter: { workspace } })`) and read at a glance by its tags, and the
 * instructions ask for all three once. Agents skip it: the deck filled with `Agent 3`s working
 * on nothing in particular. An instruction read at the start of a session is easy to pass over,
 * so the same request now travels at the two moments it is cheap to act on: at the head of each
 * message the person sends (`agents/session.ts`), and after each stage call (`stage/tool.ts`),
 * until there is nothing left to ask for.
 */

/** The name an agent wears until it picks one: `Agent`, or `Agent 3` (`agents/names.ts`). */
const UNNAMED = /^agent(?: \d+)?$/i;

export type Gap = "name" | "avatar" | "workspace" | "tags";

export function identityGaps(identity: Pick<Identity, "name" | "avatar" | "tags" | "workspace">): Gap[] {
	const gaps: Gap[] = [];
	if (!identity.name.trim() || UNNAMED.test(identity.name.trim())) gaps.push("name");
	if (!identity.avatar) gaps.push("avatar");
	if (!identity.workspace) gaps.push("workspace");
	if (!identity.tags || identity.tags.length === 0) gaps.push("tags");
	return gaps;
}

const ASK: Record<Gap, string> = {
	name: "name: a short name of your own, not a number",
	avatar: 'avatar: { emoji: "…" }',
	workspace: "workspace: the project you are working on",
	tags: "tags: up to four words for what you are doing right now",
};

/** The request, or nothing when the agent has said everything. */
export function identityReminder(identity: Pick<Identity, "name" | "avatar" | "tags" | "workspace">): string | undefined {
	const gaps = identityGaps(identity);
	if (gaps.length === 0) return undefined;
	if (gaps.length === 1 && gaps[0] === "tags") {
		return "[Decks] Your tags are empty. Set them to what this turn is about with stage.me({ tags: [...] }), and to [] when you finish.";
	}
	return `[Decks] You have not said who you are: set it now with stage.me({ ${gaps.map((gap) => ASK[gap]).join("; ")} }). It is how the person and other agents find you.`;
}
