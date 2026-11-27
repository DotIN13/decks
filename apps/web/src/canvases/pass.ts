import { m } from "@decks/i18n";
import { api } from "../connections/connection.ts";
import { cardCalls } from "@decks/api";
import { connect } from "@decks/sdk";
import { authHeaders } from "../lib/session.ts";
import type { AppFramePass, CanvasPass } from "@decks/canvas/page";
import { ask } from "../state/confirm.ts";
import { deckAddress, canvasNameOnScreen } from "../state/decks.ts";

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

/**
 * A document pass for the one document a tab shows whole (`server/src/auth/passes.ts`), asked for with
 * this tab's token: its frame says that document's messages on the line with it, and nothing else. It
 * lives an hour; the frame's host asks for the next at half that, each one new.
 */
export async function documentPass(path: string): Promise<Pick<CanvasPass, "api" | "token" | "expires">> {
	const response = await fetch(api("/passes"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ document: path }) });
	const answer = (await response.json().catch(() => ({}))) as { pass?: string; expires?: number; error?: string };
	if (!answer.pass) throw new Error(`No pass for the document ${path}: ${answer.error ?? response.status}`);
	return { api: new URL(api("/"), location.href).href.replace(/\/$/, ""), token: answer.pass, expires: answer.expires ?? Date.now() + 3_600_000 };
}

/**
 * The address an app loads at in a frame of this window, its app pass in the path
 * (`server/src/auth/passes.ts`, a window's): asked for with this tab's token, and good while it works.
 */
export async function appFramePass(name: string): Promise<AppFramePass> {
	const response = await fetch(api("/passes"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ app: name, frame: true }) });
	const answer = (await response.json().catch(() => ({}))) as { pass?: string; url?: string; error?: string; tab?: boolean };
	if (!answer.pass || !answer.url) throw new Error(answer.error ?? `No pass for the app ${name}: ${response.status}`);
	return { api: new URL(api("/"), location.href).href.replace(/\/$/, ""), token: answer.pass, url: new URL(answer.url, new URL(api("/"), location.href)).href, expires: Infinity };
}

/** A card's calls the page answers (`@decks/api`, a verb's `card: "page"`; `@decks/canvas`, `frame/card-calls.ts`): the agents, and showing another canvas. */
const FOR_CARDS = cardCalls("page");
/** The ones that put words in front of an agent, or make one: each waits for your OK. */
const ASKS_FIRST: Record<string, (args: unknown[], card: string) => string> = {
	"agent.send": (args, card) => m.canvases_ask_send({ card, agent: String(args[0] ?? m.canvases_ask_an_agent()), task: clip((args[1] as { task?: unknown } | undefined)?.task) }),
	"agent.queue": (args, card) => m.canvases_ask_queue({ card, agent: String(args[0] ?? m.canvases_ask_an_agent()), task: clip((args[1] as { task?: unknown } | undefined)?.task) }),
	"agent.create": (args, card) => m.canvases_ask_create({ card, name: String((args[0] as { name?: unknown } | undefined)?.name ?? m.canvases_ask_something()) }),
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
		const yes = await ask({ title: m.canvases_ask_title(), body: asking(call.args, call.card), yes: m.canvases_ask_allow(), no: m.canvases_ask_deny() });
		if (!yes) throw new Error(`You did not let ${call.card} ${call.verb === "agent.create" ? "start an agent" : "message an agent"}.`);
	}
	const answer = await connect({ url: deckAddress(), stage: () => canvasNameOnScreen(), notes: () => {}, headers: authHeaders() }).call(call.verb, call.args);
	return inlineAvatars(answer.value);
}

/**
 * An agent's avatar as a picture a card can show. The harness answers `/api/avatar/<id>`, an address on
 * this page's server behind your sign-in, which a card in the sandboxed canvas frame cannot load: it
 * showed as a broken picture. The page fetches it with your sign-in and hands the card the picture
 * itself, as a data address, once per avatar.
 */
const avatars = new Map<string, Promise<string | undefined>>();
const dataAddress = (blob: Blob) =>
	new Promise<string>((done, fail) => {
		const reader = new FileReader();
		reader.onload = () => done(String(reader.result));
		reader.onerror = () => fail(reader.error);
		reader.readAsDataURL(blob);
	});
async function inlineAvatars(value: unknown): Promise<unknown> {
	const one = async (agent: unknown) => {
		const avatar = (agent as { avatar?: unknown } | null)?.avatar;
		if (typeof avatar !== "string" || !avatar.startsWith("/api/avatar/")) return agent;
		let picture = avatars.get(avatar);
		if (!picture) {
			picture = fetch(api(avatar), { headers: authHeaders() })
				.then(async (response) => (response.ok ? dataAddress(await response.blob()) : undefined))
				.catch(() => undefined);
			avatars.set(avatar, picture);
		}
		const inline = await picture;
		return inline ? { ...(agent as object), avatar: inline } : agent;
	};
	return Array.isArray(value) ? Promise.all(value.map(one)) : one(value);
}
