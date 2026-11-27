import type { Identity } from "@decks/protocol";

/**
 * What an agent has not yet said about itself, and the sentence that asks for it.
 *
 * An agent is called by its name (`@name`), addressed in calls by its id (names change), found by its workspace
 * (`decks agent list --workspace …`) and read at a glance by its tags, and the
 * instructions ask for all three once. Agents skip it: the deck filled with `Agent 3`s working
 * on nothing in particular. An instruction read at the start of a session is easy to pass over,
 * so the same request now travels at the two moments it is cheap to act on: at the head of each
 * message the person sends (`agents/session.ts`), and after each canvas call (`calls/tool.ts`),
 * until there is nothing left to ask for.
 */

/** The name an agent wears until it picks one: `Agent`, or `Agent 3` (`agents/names.ts`). */
const UNNAMED = /^agent(?: \d+)?$/i;

type Gap = "name" | "avatar" | "workspace" | "tags";

export function identityGaps(identity: Pick<Identity, "name" | "avatar" | "tags" | "workspace">): Gap[] {
	const gaps: Gap[] = [];
	if (!identity.name.trim() || UNNAMED.test(identity.name.trim())) gaps.push("name");
	if (!identity.avatar) gaps.push("avatar");
	if (!identity.workspace) gaps.push("workspace");
	if (!identity.tags || identity.tags.length === 0) gaps.push("tags");
	return gaps;
}

const ASK: Record<Gap, string> = {
	name: "--name: a short name of your own, not a number",
	/*
	 * The `xmlns` is in the example because an example is what gets copied. Without it an avatar is
	 * not read as SVG when the browser draws it as an image, and renders as nothing; `canvas/avatar.ts`
	 * adds one and says so, which is the real fix, and this is the half that stops it happening.
	 */
	avatar: `--avatar.svg '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">…</svg>': a small picture you draw (or --avatar.emoji)`,
	workspace: "--workspace: the project you are working on",
	tags: `--tags '["…"]': up to four words for what you are doing right now`,
};

/**
 * The request, or nothing when the agent has said everything.
 *
 * Tags are kept when an agent finishes: they are how the person sees what each agent last worked
 * on, so empty tags are asked for at the head of a message (`agents/session.ts`) and after a canvas
 * call alike (`afterCall`), and the request says to leave them set.
 */
export function identityReminder(identity: Pick<Identity, "name" | "avatar" | "tags" | "workspace">, _options: { afterCall?: boolean } = {}): string | undefined {
	const gaps = identityGaps(identity);
	if (gaps.length === 0) return undefined;
	if (gaps.length === 1 && gaps[0] === "tags") {
		return `[Decks] Your tags are empty. Set them to what you are working on with decks agent update --tags '["…"]', change them when the work changes, and leave them set when you finish: they show the person what you last worked on.`;
	}
	return `[Decks] You have not said who you are: set it now with decks agent update ${gaps.map((gap) => ASK[gap]).join("; ")}. It is how the person and other agents find you.`;
}
