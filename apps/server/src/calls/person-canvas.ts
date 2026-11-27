import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { Op } from "@decks/pen";
import type { DocService } from "@decks/docs/server";
import type { Registry } from "../agents/registry.ts";
import type { DeckAgent } from "../agents/session.ts";
import type { CardService } from "../cards/service.ts";
import { deleteCanvas, titleCanvas } from "../canvas/admin.ts";
import { putOn } from "../canvas/canvas-ops.ts";
import { penEditBy } from "../canvas/pens.ts";
import type { CanvasService } from "../canvas/service.ts";
import type { Cameras } from "../deck/cameras.ts";
import type { Deck } from "../deck/loader.ts";
import { joinSpot } from "../deck/place.ts";
import type { GoogleDocs } from "../google/docs.ts";
import { personToolOf } from "./agent-tools.ts";
import { personGesture, type PersonCall, type PersonVerbs } from "./person-call.ts";
import { personAgent } from "./person.ts";

/**
 * The person's verbs on a canvas: their hands on its cards (`card.*`), a document put on it, an edit
 * of its drawing, the canvas removed, and where they last looked at it.
 */

/** What the canvas verbs need of the harness: the agents and their canvases, the deck and its cards, the documents, and the cameras. */
export interface CanvasTableHost {
	readonly agents: Registry;
	readonly stage: CanvasService;
	readonly deck: Deck;
	readonly boards: CardService;
	readonly docs: DocService;
	readonly google: GoogleDocs;
	readonly cameras: Cameras;
	/** The agent the harness acts for when a call names none: the focused one. */
	target(): DeckAgent;
	/** The canvas list again, to every page. */
	publishStages(): void;
}

const DOCUMENT_SIZE = { w: 1000, h: 1100 };

export function canvasTable(host: CanvasTableHost): PersonVerbs {
	const agents = host.agents;
	const pens = () => host.stage.pens;
	/** The canvas a call acts on: the one it names, else the one on screen, else the agent's. */
	const stageFor = (asked: unknown, call: PersonCall): { name?: string; agent?: DeckAgent } => {
		const canvas = typeof asked === "string" && pens()?.has(asked) ? asked : call.on.stage && pens()?.has(call.on.stage) ? call.on.stage : undefined;
		const target = host.target();
		const name = canvas ?? target.seat.stageName(true);
		if (!name) return {};
		const agent = target.seat.stageName() === name ? target : agents.looking()?.seat.stageName() === name ? agents.looking() : agents.all().find((one) => one.seat.stageName() === name);
		return { name, ...(agent ? { agent } : {}) };
	};
	/** The canvas a card call acts on: the one its options name, else the one on screen. */
	const onCanvas = (options: unknown, call: PersonCall): { stage?: string } => {
		const canvas = (options as { canvas?: unknown } | undefined)?.canvas;
		const name = typeof canvas === "string" && canvas ? canvas : call.on.stage;
		return name ? { stage: name } : {};
	};

	return {
		"card.move": async ([card, at, options], call) => personGesture(host, onCanvas(options, call), "move", [String(card), at]),
		"card.resize": async ([card, size, options], call) => personGesture(host, onCanvas(options, call), "resize", [String(card), size]),
		"card.hide": async ([card, options], call) => personGesture(host, onCanvas(options, call), "hide", [String(card)]),
		"card.play": async ([card, options], call) => {
			const { name, agent } = stageFor((options as { canvas?: unknown } | undefined)?.canvas, call);
			if (agent) agent.seat.setInPlay([...agent.seat.inPlay, String(card)], { place: true });
			else if (name && pens()) putOn(pens()!, host.deck, name, [String(card)]);
		},
		"card.delete": async ([card], call) => {
			let refused: string | undefined;
			host.boards.deleteCard(String(card), (message) => {
				if (message.type === "harness.notice") refused = message.text;
				else call.tell(message);
			});
			if (refused) throw new Error(refused);
		},
		"doc.place": async ([options], call) => {
			const asked = (options ?? {}) as { document?: string; google?: string; at?: { x: number; y: number }; canvas?: string };
			const { name } = stageFor(asked.canvas, call);
			if (!name) throw new Error("There is no canvas on screen to put the document on.");
			const place = async (file: string, title?: string) => {
				const real = (one: string) => {
					try {
						return realpathSync(one);
					} catch {
						return one;
					}
				};
				const inside = relative(real(host.deck.path), real(file));
				const path = !inside.startsWith("..") && !isAbsolute(inside) ? inside.split("\\").join("/") : file;
				const corner = asked.at && Number.isFinite(asked.at.x) && Number.isFinite(asked.at.y) ? { x1: Math.round(asked.at.x), y1: Math.round(asked.at.y) } : joined();
				const answer = await personToolOf(personAgent({ agents, pens: pens() }, { stage: name }))
					.call("canvas.insert", [{ type: "document", path, ...(title ? { title } : {}) }, { canvas: name, ...(corner ? { at: corner } : {}) }]);
				if (!answer.ok) throw new Error(answer.error ?? "The document could not be put on the canvas.");
				const id = (answer.value as { id?: unknown } | undefined)?.id;
				return { path: typeof id === "string" ? `item:${id}` : "" };
			};
			const joined = () => {
				const held = pens();
				if (!held) return undefined;
				try {
					const boards = held.cards.cards(name);
					const spot = joinSpot(DOCUMENT_SIZE, boards.at(-1), [...boards, ...held.cards.drawn(name)]);
					return { x1: spot.x, y1: spot.y };
				} catch {
					return undefined;
				}
			};
			if (typeof asked.google === "string" && asked.google.trim()) {
				const mirror = await host.google.link(asked.google.trim());
				return place(mirror, host.google.remote(mirror)?.title);
			}
			if (typeof asked.document !== "string" || !asked.document.trim()) throw new Error("Name a document to place: { document } or { google }.");
			return place(host.docs.openable(asked.document.trim()));
		},
		"canvas.edit": async ([ops, options], call) => {
			const asked = (options ?? {}) as { canvas?: string; agent?: string };
			const on = { ...(asked.agent ?? call.on.agent ? { agent: asked.agent ?? call.on.agent } : {}), ...(asked.canvas ?? call.on.stage ? { stage: asked.canvas ?? call.on.stage } : {}) };
			const run = () => personGesture(host, on, "edit", [ops as Op[]]);
			return call.on.edit ? penEditBy.run(call.on.edit, run) : run();
		},
		"canvas.remove": async ([canvas]) => {
			const held = pens();
			if (!held) throw new Error("This server keeps no canvases.");
			deleteCanvas({ deck: host.deck, pens: held, agents: agents.all() }, String(canvas));
			host.publishStages();
		},
		"view.remember": async ([camera, options]) => {
			const asked = (options ?? {}) as { agent?: string; canvas?: string; device?: string };
			if (!agents.get(String(asked.agent))) return;
			host.cameras.report(String(asked.agent), camera as never, { canvas: asked.canvas, device: asked.device });
		},
	};
}

/** A canvas renamed by the person: `canvas.rename` is the table's, for an agent, and this is what the canvas manager's rename runs. */
export function renameCanvas(host: Pick<CanvasTableHost, "agents" | "stage" | "deck" | "publishStages">, name: string, to: string): void {
	const pens = host.stage.pens;
	if (!pens) throw new Error("This server keeps no canvases.");
	titleCanvas({ deck: host.deck, pens, agents: host.agents.all() }, name, to);
	host.publishStages();
}
