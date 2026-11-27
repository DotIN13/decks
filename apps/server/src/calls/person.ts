import type { DeckAgent } from "../agents/session.ts";
import type { Registry } from "../agents/registry.ts";
import type { CanvasPens } from "../canvas/pens.ts";
import { personToolOf } from "./agent-tools.ts";

/**
 * Whose canvas the person's click acts on.
 *
 * The browser names the canvas on screen (`X-Decks-Stage`, or `stage` on a socket message) and the
 * agent it is talking to (`X-Decks-Agent`). The canvas wins: the change goes to the agent on that
 * canvas, the one the browser is looking at first; with no canvas named, to the agent it names, and
 * then to the focused conversation, which is what every card frame acts on.
 */
export function personAgent(context: { agents: Registry; pens?: CanvasPens | undefined }, asked: { canvas?: string; agent?: string }): DeckAgent {
	const named = asked.agent ? context.agents.get(asked.agent) : undefined;
	const fallback = named ?? context.agents.focused();
	const canvas = asked.canvas && context.pens?.has(asked.canvas) ? asked.canvas : undefined;
	if (!canvas || fallback.seat.stageName() === canvas) return fallback;
	const looking = context.agents.looking();
	if (looking?.seat.stageName() === canvas) return looking;
	return context.agents.all().find((one) => one.seat.stageName() === canvas) ?? fallback;
}

/**
 * One verb, called as the person: what the browser's older socket messages do now, so a drag sent
 * over the socket and one sent through the SDK are one code path (`calls/person-table.ts`).
 * A refusal comes back as the notice the person sees.
 */
export async function asPerson(
	context: { agents: Registry; pens?: CanvasPens | undefined },
	asked: { canvas?: string; agent?: string },
	verb: string,
	args: unknown[],
	reply: (message: { type: "harness.notice"; level: "warn"; text: string }) => void,
): Promise<boolean> {
	const answer = await personToolOf(personAgent(context, asked)).call(verb, args);
	if (!answer.ok) reply({ type: "harness.notice", level: "warn", text: answer.error ?? `${verb} failed` });
	return answer.ok;
}

