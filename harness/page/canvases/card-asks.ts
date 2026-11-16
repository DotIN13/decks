// A card's agent calls from the canvas frame, made with your token: the ones that put words in
// front of an agent, or start one, wait for your OK; reading the agents and showing a canvas do not.
import { ask } from "../state/confirm.ts";
import { call as callServer } from "../state/line.ts";
import { cardCall, cardMayCall } from "./card-calls.ts";

/**
 * A card's agent call, from the canvas frame, made with your token. Anything in the frame can make one,
 * a card's script or a library it loaded, and which card asked is only what the frame says, so a call
 * that sends an agent words or makes one is put to you each time, naming the card and what it would
 * say; reading who the agents are, and showing another canvas, are not.
 */
export async function cardAgentCall(call: { verb: string; args: unknown[]; card: string }): Promise<unknown> {
	if (!cardMayCall(call.verb)) throw new Error(`${call.verb} is not a card's to call.`);
	const asking = ASKS_FIRST[call.verb];
	if (asking) {
		const yes = await ask({ title: "Let this card message an agent?", body: `${call.card} wants to ${asking(call.args)}.`, yes: "Allow", no: "Don't allow" });
		if (!yes) throw new Error(`You did not let ${call.card} ${call.verb === "agent.create" ? "start an agent" : "message an agent"}.`);
	}
	const [name, args] = cardCall(call.verb, call.args);
	const answer = await callServer(name, args);
	if (!answer.ok) throw new Error(answer.error);
	return answer.value;
}

/** The ones that put words in front of an agent, or make one: each waits for your OK. */
const ASKS_FIRST: Record<string, (args: unknown[]) => string> = {
	"agent.send": (args) => `send ${String(args[0] ?? "an agent")} this message now: “${clip((args[1] as { task?: unknown } | undefined)?.task)}”`,
	"agent.queue": (args) => `give ${String(args[0] ?? "an agent")} this task: “${clip((args[1] as { task?: unknown } | undefined)?.task)}”`,
	"agent.create": (args) => `start a new agent called ${String((args[0] as { name?: unknown } | undefined)?.name ?? "something")}`,
};
const clip = (text: unknown) => {
	const words = String(text ?? "").trim().replace(/\s+/g, " ");
	return words.length > 280 ? `${words.slice(0, 280)}…` : words;
};
