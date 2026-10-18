import type { DeckAgent } from "../agents/session.ts";
import type { Registry } from "../agents/registry.ts";
import type { StagePens } from "../stage/pens.ts";

/**
 * Whose stage the person's click acts on.
 *
 * The browser names the canvas on screen (`X-Decks-Stage`, or `stage` on a socket message) and the
 * agent it is talking to (`X-Decks-Agent`). The stage wins: the change goes to the agent on that
 * canvas, the one the browser is looking at first; with no canvas named, to the agent it names, and
 * then to the focused conversation, which is what every board frame acts on.
 */
export function personAgent(context: { agents: Registry; pens?: StagePens | undefined }, asked: { stage?: string; agent?: string }): DeckAgent {
	const named = asked.agent ? context.agents.get(asked.agent) : undefined;
	const fallback = named ?? context.agents.focused();
	const stage = asked.stage && context.pens?.has(asked.stage) ? asked.stage : undefined;
	if (!stage || fallback.stageName() === stage) return fallback;
	const looking = context.agents.looking();
	if (looking?.stageName() === stage) return looking;
	return context.agents.all().find((one) => one.stageName() === stage) ?? fallback;
}

/**
 * One verb, called as the person: what the browser's older socket messages do now, so a drag sent
 * over the socket and one sent through the SDK are one code path (`wire/boards.ts`, `wire/pen.ts`).
 * A refusal comes back as the notice the person sees.
 */
export async function asPerson(
	context: { agents: Registry; pens?: StagePens | undefined },
	asked: { stage?: string; agent?: string },
	verb: string,
	args: unknown[],
	reply: (message: { type: "notice"; level: "warn"; text: string }) => void,
): Promise<boolean> {
	const answer = await personAgent(context, asked).personTool().call(verb, args);
	if (!answer.ok) reply({ type: "notice", level: "warn", text: answer.error ?? `${verb} failed` });
	return answer.ok;
}
