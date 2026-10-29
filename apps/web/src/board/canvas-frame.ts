import { api } from "../connections/connection.ts";
import { connect } from "@decks/sdk";
import { authHeaders } from "../lib/session.ts";
import { ask } from "../state/confirm.ts";
import { deckAddress, stageOnScreen } from "../state/decks.ts";

/** The folder a canvas keeps its files in, as the harness serves it: `canvases/plan/`, or a friend's `shared/canvases/ana/trip/`. */
const folderOf = (canvas: string) => {
	const shared = /^shared\/([^/]+)\/([^/]+)$/.exec(canvas);
	return shared ? `shared/canvases/${shared[1]}/${shared[2]}/` : `canvases/${canvas}/`;
};

/**
 * A ticket for one canvas's folder (`server/src/auth/tickets.ts`): the frame reads that canvas's files
 * and pictures on it, and nothing else, since it has no token and no cookie of its own.
 */
export async function canvasTicket(canvas: string): Promise<{ files: string; pictures: string; expires: number }> {
	const path = `/api/board/${folderOf(canvas).split("/").map(encodeURIComponent).join("/")}`;
	const response = await fetch(api("/tickets"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ paths: [path] }) });
	const answer = (await response.json().catch(() => ({}))) as { tickets?: Record<string, string>; folderExpires?: number };
	const ticket = answer.tickets?.[path];
	if (!ticket) throw new Error(`No ticket for the canvas ${canvas}: ${response.status}`);
	const at = (rest: string) => new URL(api(`/t/${ticket}/${rest}`), location.href).href;
	return { files: at("board/"), pictures: at("thumb/"), expires: answer.folderExpires ?? Date.now() + 3_600_000 };
}

/**
 * The harness as the frame reaches it, and a token for the one canvas it shows (`kind: "canvas"`): the
 * frame reads, follows and edits that canvas on it, and this page asks again before it lapses.
 */
export async function canvasBackend(canvas: string): Promise<{ api: string; token: string; idle: number }> {
	const response = await fetch(api("/tokens"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ kind: "canvas", canvas }) });
	const answer = (await response.json().catch(() => ({}))) as { token?: string; idle?: number; error?: string };
	if (!answer.token) throw new Error(`No token for the canvas ${canvas}: ${answer.error ?? response.status}`);
	return { api: new URL(api("/"), location.href).href.replace(/\/$/, ""), token: answer.token, idle: answer.idle ?? 15 * 60_000 };
}

/** A card's calls the page answers (`@decks/canvas`, `frame/card-calls.ts`): the agents, and showing another canvas. */
const FOR_CARDS = new Set(["agent.me", "agent.inbox", "agent.list", "agent.get", "agent.send", "agent.queue", "agent.create", "view.goto"]);
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
