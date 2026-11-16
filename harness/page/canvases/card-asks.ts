// A card's agent calls from the canvas frame, made with your token: the ones that put words in
// front of an agent, or start one, wait for your OK; reading the agents and showing a canvas do not.
import { callsFor } from "@decks/protocol";
import { ask } from "../state/confirm.ts";
import { call as callServer } from "../state/line.ts";

/** What the frame hands the page: a card's call by its protocol name, already turned from an old card's shape. */
const CARD_MAY = callsFor("card");
const mayCall = (name: string) => CARD_MAY.has(name) && (name.startsWith("agent.") || name === "view.goto");

/**
 * A card's agent call. Anything in the frame can make one and which card asked is only what the
 * frame says, so a call that sends an agent words or starts one is put to you each time, naming the
 * card and what it would say.
 */
export async function cardAgentCall(call: { name: string; args: Record<string, unknown>; card: string }): Promise<unknown> {
	if (!mayCall(call.name)) throw new Error(`${call.name} is not a card's to call.`);
	const asking = ASKS_FIRST[call.name];
	if (asking) {
		const yes = await ask({ title: "Let this card message an agent?", body: `${call.card} wants to ${asking(call.args)}.`, yes: "Allow", no: "Don't allow" });
		if (!yes) throw new Error(`You did not let ${call.card} ${call.name === "agent.create" ? "start an agent" : "message an agent"}.`);
	}
	const answer = await callServer(call.name, call.args);
	if (!answer.ok) throw new Error(answer.error);
	return answer.value;
}

/** The ones that put words in front of an agent, or make one: each waits for your OK. */
const ASKS_FIRST: Record<string, (args: Record<string, unknown>) => string> = {
	"agent.send": (args) => `send ${String(args.agent ?? "an agent")} this message now: “${clip(args.task)}”`,
	"agent.queue": (args) => `give ${String(args.agent ?? "an agent")} this task: “${clip(args.task)}”`,
	"agent.create": (args) => `start a new agent called ${String(args.name ?? "something")}`,
};
const clip = (text: unknown) => {
	const words = String(text ?? "").trim().replace(/\s+/g, " ");
	return words.length > 280 ? `${words.slice(0, 280)}…` : words;
};
