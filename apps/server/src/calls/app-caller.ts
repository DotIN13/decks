import type { Identity } from "@decks/protocol";
import type { DeckAgent } from "../agents/session.ts";
import type { Registry } from "../agents/registry.ts";
import type { CanvasService } from "../canvas/service.ts";
import type { CallsHost } from "./host.ts";
import type { AgentHooks } from "../agents/hooks.ts";
import { createDecksTool, type DecksTool } from "./tool.ts";

/**
 * An app as a caller: the calls its own code makes, once the person has let it (`calls/caller.ts`).
 *
 * An app gets the tool an agent gets, with two questions answered rather than inherited.
 *
 * **Whose canvas is it.** Every canvas call is keyed by a conversation, and an app is not one, so it
 * acts for the conversation on a canvas that shows it (`conversationForApp`): what it changes
 * appears on the canvas the person is looking at, and is said in the chat they are reading.
 *
 * **Who it is.** Its identity is the app's own (`app polls`, in a grey no agent has), never a real
 * agent's: a cursor or a notice says which app did it, and `decks.agent.update({ name })` from an
 * app changes only the label it goes by for that call, never a colleague's name. It has no row in
 * the agents list, so tags and a workspace are not stored for it.
 *
 * Everything that is about the conversation (what it holds, where its cards sit, its queue, the
 * agents list) is that conversation's. An app hands work over with `decks.agent.queue`, which queues
 * it and returns: nothing here waits for an answer.
 */

/** A grey that is no agent's: an app is not in the colour rotation. */
const APP_COLOR = "#8a8f98";

type Pens = CanvasService["pens"];
const tagOf = (node: { type?: unknown; metadata?: unknown }) => (node.type === "browser" ? (node.metadata as { type?: unknown } | undefined)?.type : undefined);

/** Whether a canvas shows an app: a top-level item of it (`decks.app`) is on its drawing. */
export function canvasShowsApp(pens: Pens, canvas: string | undefined, name: string): boolean {
	if (!pens || !canvas) return false;
	try {
		return (pens.get(canvas).doc.children ?? []).some((node) => tagOf(node) === "decks.app" && (node.metadata as { name?: unknown }).name === name);
	} catch {
		return false;
	}
}

/** Whether a canvas holds a document item naming this file (`decks.document`, its `metadata.path`): its picture is then the canvas's to read. */
export function canvasShowsDocument(pens: Pens, canvas: string | undefined, file: string): boolean {
	if (!pens || !canvas) return false;
	try {
		return (pens.get(canvas).doc.children ?? []).some((node) => tagOf(node) === "decks.document" && (node.metadata as { path?: unknown }).path === file);
	} catch {
		return false;
	}
}

/**
 * The conversation an app acts for: one on a canvas showing the app, the agent on screen first.
 * An app on no agent's canvas falls back to the focused conversation, made if nobody has spoken
 * yet. Never simply the last agent any browser touched, which may be on another canvas entirely.
 */
export function conversationForApp(host: { agents: Registry; canvas?: Pick<CanvasService, "pens"> }, name: string): DeckAgent {
	const looking = host.agents.looking();
	const all = looking ? [looking, ...host.agents.all().filter((one) => one !== looking)] : [...host.agents.all()];
	return all.find((one) => canvasShowsApp(host.canvas?.pens, one.seat.canvasFolder(), name)) ?? host.agents.focused();
}

/** The tool an app's calls run through, and the conversation it acts for. */
export function appTool(host: Pick<CallsHost, "agents" | "cameras" | "cards" | "canvas" | "port">, name: string): { tool: DecksTool; conversation: DeckAgent } {
	const conversation = conversationForApp(host, name);
	let identity: Identity = { name: `app ${name}`, color: APP_COLOR };
	const actor: AgentHooks = {
		id: conversation.id,
		app: name,
		identity: () => identity,
		// The four identity writers change only this call's label; an app has no row to carry tags or a workspace.
		rename: (to) => {
			const clean = to.trim().slice(0, 40);
			if (clean) identity = { ...identity, name: clean };
		},
		setAvatar: (url) => {
			identity = { ...identity, avatar: url };
		},
		setTags: () => [],
		setWorkspace: () => null,
		context: () => [...conversation.seat.context],
		inPlay: () => [...conversation.seat.inPlay],
		setInPlay: (paths, at) => conversation.seat.setInPlay(paths, { place: true, ...(at ? { at } : {}) }),
		positions: () => conversation.seat.positions(),
		setPosition: (path, x, y) => conversation.seat.setPosition(path, x, y),
		camera: () => host.cameras.answer(conversation.id, conversation.seat.canvasFolder?.()),
		queue: () => conversation.turns.queue(),
		agents: () => host.agents.summaries(),
		// The sender is the conversation: a reply has to find somebody to land in, and an app has no inbox.
		send: (target, spec) => host.agents.send(conversation.id, target, spec),
		deliver: (target, spec) => host.agents.deliver(conversation.id, target, spec),
		wait: (target, timeoutMs) => host.agents.wait(target, timeoutMs),
		// An agent an app asks for is made for the conversation, as a send is: on its runtime, account and workspace unless the call says otherwise.
		create: (spec) => host.agents.createFor(conversation.id, spec),
		// The app's canvas: the conversation's when it shows the app, else any that does.
		here: () => {
			if (canvasShowsApp(host.canvas.pens, conversation.seat.canvasFolder?.(), name)) return conversation.seat.canvasFolder?.();
			const pens = host.canvas.pens;
			return pens?.names().find((canvas) => canvasShowsApp(pens, canvas, name)) ?? conversation.seat.canvasFolder?.();
		},
		recordRevision: (path) => host.cards.recordRevision(path),
		cardPathOf: (file) => host.cards.cardPathOf(file),
	};
	return { tool: createDecksTool({ canvas: host.canvas, agent: actor, port: host.port }), conversation };
}
