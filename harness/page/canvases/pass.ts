import { api } from "../connections/connection.ts";
import { cardCalls } from "@decks/api";
import { connect } from "@decks/sdk";
import { authHeaders } from "../lib/session.ts";
import type { CanvasPass } from "@decks/canvas";
import { ask } from "../state/confirm.ts";
import { deckAddress, stageOnScreen } from "../state/decks.ts";

/**
 * A canvas pass for the one canvas the frame shows (`server/src/auth/passes.ts`), asked for with this
 * tab's token: the frame makes its calls with it in the header, and reads that canvas's files and
 * pictures with it in their address, since it has no token and no cookie of its own. It lives an
 * hour; the frame's host asks for the next one at half that (`@decks/canvas`, `frame/outside/host.tsx`).
 */
export function canvasPass(canvas: string): Promise<CanvasPass> {
	/*
	 * One pass per canvas for the first half of its life, given again to whoever asks: a card's
	 * pictures, modules and sheets carry the pass in their address, so a new pass at every visit made
	 * every address new and the browser fetched every card again. The host asks again at half its
	 * life (`renew`), which is when this lets it go, so a renewal gets a new one.
	 */
	const kept = passes.get(canvas);
	if (kept && Date.now() < kept.until) return kept.pass;
	const pass = askPass(canvas);
	const entry = { pass, until: Date.now() + 25 * 60_000 };
	passes.set(canvas, entry);
	void pass.then(
		(got) => (entry.until = Date.now() + (got.expires - Date.now()) / 2 - 60_000),
		() => passes.get(canvas) === entry && passes.delete(canvas),
	);
	return pass;
}

/** The pass each canvas was last given, and until when it is given again. */
const passes = new Map<string, { pass: Promise<CanvasPass>; until: number }>();

async function askPass(canvas: string): Promise<CanvasPass> {
	const response = await fetch(api("/passes"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ canvas }) });
	const answer = (await response.json().catch(() => ({}))) as { pass?: string; expires?: number; error?: string; imports?: Record<string, string> };
	if (!answer.pass) throw new Error(`No pass for the canvas ${canvas}: ${answer.error ?? response.status}`);
	const at = (rest: string) => new URL(api(`/t/${answer.pass}/${rest}`), location.href).href;
	return {
		api: new URL(api("/"), location.href).href.replace(/\/$/, ""),
		token: answer.pass,
		files: at("card/"),
		pictures: at("thumb/"),
		expires: answer.expires ?? Date.now() + 3_600_000,
		// The deck's import map, handed to the frame once: none (an older harness) and each card looks for it itself.
		...(answer.imports ? { imports: answer.imports } : {}),
	};
}

/** A card's calls the page answers (`@decks/api`, a verb's `card: "page"`; `@decks/canvas`, `frame/card-calls.ts`): the agents, and showing another canvas. */
const FOR_CARDS = cardCalls("page");
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

/**
 * A card's agent call, from the canvas frame, made with your token. Anything in the frame can make one,
 * a card's script or a library it loaded, and which card asked is only what the frame says, so a call
 * that sends an agent words or makes one is put to you each time, naming the card and what it would
 * say; reading who the agents are, and showing another canvas, are not.
 */
export async function cardAgentCall(call: { verb: string; args: unknown[]; card: string }): Promise<unknown> {
	if (!FOR_CARDS.has(call.verb)) throw new Error(`${call.verb} is not a card's to call.`);
	const asking = ASKS_FIRST[call.verb];
	if (asking) {
		const yes = await ask({ title: "Let this card message an agent?", body: `${call.card} wants to ${asking(call.args)}.`, yes: "Allow", no: "Don't allow" });
		if (!yes) throw new Error(`You did not let ${call.card} ${call.verb === "agent.create" ? "start an agent" : "message an agent"}.`);
	}
	const answer = await connect({ url: deckAddress(), stage: () => stageOnScreen(), notes: () => {}, headers: authHeaders() }).call(call.verb, call.args);
	return answer.value;
}
