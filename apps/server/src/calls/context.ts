import { AsyncLocalStorage } from "node:async_hooks";
import { cleanWorkspace } from "../agents/workspaces.ts";
import type { CanvasService, WebTarget } from "../canvas/service.ts";
import type { AgentHooks } from "./tool.ts";

/**
 * What every verb's handler is given: the stage service, the caller's hooks, and the helpers the
 * handlers share. Made once per caller by `createDecksTool` (`calls/tool.ts`). The notes, pictures and
 * canvas of one call are that call's own (`inCall`), though the context is shared by every call of
 * the caller.
 */
export interface VerbContext {
	service: CanvasService;
	agent: AgentHooks;
	port: number;
	/** Lines a verb adds beside its value: what `decks.canvas.fit` measured, a card's width. */
	notes: string[];
	/** Pictures a verb produced, which go back beside its value. */
	images: Array<{ data: string; mimeType: string }>;
	asList(path: string | string[]): string[];
	viewport(): ReturnType<CanvasService["viewport"]>;
	needPens(): NonNullable<CanvasService["pens"]>;
	needStage(): string;
	needWeb(): NonNullable<CanvasService["web"]>;
	needTarget(value: unknown, sentence: string): WebTarget;
	here(): ReturnType<CanvasService["boards"]>;
	askedWorkspace(raw: unknown): string;
	/**
	 * The canvas a call means when it names none: the one the call says it was made on (a person's or a
	 * card's `X-Decks-Stage`), the canvas showing an app, the canvas the person is looking at for their
	 * own calls. None for an agent: an agent has no home canvas, and names the canvas in every call, so
	 * its work lands where it meant whatever the person is looking at.
	 */
	hereCanvas(): string | undefined;
	/** The canvas the camera of the caller's conversation is on (`decks.here()`): where the person is looking in that chat. Told, never a default. */
	cameraCanvas(): string | undefined;
	/** A canvas as a caller names it (folder, title, or `canvases/<name>/canvas.pen`); with none named, `hereCanvas()`, or for an agent a refusal that says to name one. */
	canvasOf(asked?: unknown): string;
	/** A canvas as the `Canvas` type has it: its name, title, who has it open, how many boards. */
	canvasRow(name: string): { name: string; title: string; open: string[]; cards: number };
	/** The canvas the request says it was made on, for this one call (`DecksTool.call`). */
	callOn: { stage?: string };
}

/**
 * What one call collects and means: its notes, its pictures, and the canvas the request says it was
 * made on.
 *
 * A caller's context is shared by all its calls, and the person's by every tab and canvas frame they
 * have open, so two calls run at once. These used to sit on the context itself: one call emptied the
 * other's notes as it started, and could read the other's canvas as its own, or none once the other
 * finished. Each call now runs in a frame of its own, carried through its awaits (`AsyncLocalStorage`),
 * and `notes`, `images` and `callOn` read the frame of the call that is asking.
 */
interface CallFrame {
	notes: string[];
	images: Array<{ data: string; mimeType: string }>;
	stage: string | undefined;
}
const frames = new AsyncLocalStorage<CallFrame>();

/** Run one call in a frame of its own; `work` is handed the frame, to read its notes and pictures after. */
export function inCall<T>(stage: string | undefined, work: (frame: CallFrame) => Promise<T>): Promise<T> {
	const frame: CallFrame = { notes: [], images: [], stage };
	return frames.run(frame, () => work(frame));
}

/** An array that is the asking call's own (`pick` of its frame), or `outside` for work outside any call. */
function perCall<T extends unknown[]>(pick: (frame: CallFrame) => T, outside: T): T {
	const target = () => {
		const frame = frames.getStore();
		return frame ? pick(frame) : outside;
	};
	return new Proxy(outside, {
		get: (_t, key) => {
			const array = target();
			const value = Reflect.get(array, key, array);
			return typeof value === "function" ? value.bind(array) : value;
		},
		set: (_t, key, value) => Reflect.set(target(), key, value),
		has: (_t, key) => Reflect.has(target(), key),
		ownKeys: () => Reflect.ownKeys(target()),
		getOwnPropertyDescriptor: (_t, key) => Reflect.getOwnPropertyDescriptor(target(), key),
	});
}

/** What an agent is told when a canvas call names no canvas. */
const NAME_A_CANVAS =
	"Name the canvas this call works on: --canvas <name or title> (in a script, { canvas }). An agent has no home canvas, so its work lands where it says whatever the person is looking at. decks canvas list names them, decks canvas create makes one, and decks here says which one the person has open beside your chat.";

export function verbContext(deps: { stage: CanvasService; agent: AgentHooks; port: number }): VerbContext {
	const { stage: service, agent, port } = deps;
	const notes = perCall((frame) => frame.notes, [] as string[]);
	const images = perCall((frame) => frame.images, [] as Array<{ data: string; mimeType: string }>);
	const asList = (path: string | string[]) => (Array.isArray(path) ? path : [path]);


	/** The canvas's own size, or nothing if no browser has ever reported one. */
	const viewport = () => service.viewport(agent.id);
	/** The drawing's files, or the sentence that says this server keeps none. */
	const needPens = () => {
		if (!service.pens) throw new Error("This server keeps no stage drawing.");
		return service.pens;
	};
	/** This agent's stage folder, claimed the first time it draws. */
	const needStage = () => {
		const name = agent.stageName?.();
		if (!name) throw new Error("This stage has no drawing: the server keeps no stage files.");
		return name;
	};
	/** The shared Chrome, or the sentence that says this server has none. */
	const needWeb = () => {
		if (!service.web) throw new Error("This server has no shared browser.");
		return service.web;
	};
	/**
	 * A target as the agent wrote it, checked here rather than in the bridge.
	 *
	 * Three forms, and anything else gets the verb's own sentence: a name, a `{ ref }` from
	 * `read`, or a `{ name, nth }`. Checking it here keeps the bridge free to assume a target
	 * it can act on, and keeps the wording beside the verb it belongs to.
	 */
	const needTarget = (value: unknown, sentence: string): WebTarget => {
		if (typeof value === "string") {
			if (!value.trim()) throw new Error(sentence);
			return value.trim();
		}
		if (value && typeof value === "object") {
			const ref = (value as { ref?: unknown }).ref;
			if (typeof ref === "string" && ref.trim()) return { ref: ref.trim() };
			const named = (value as { name?: unknown }).name;
			const nth = (value as { nth?: unknown }).nth;
			if (typeof named === "string" && named.trim()) return { name: named.trim(), ...(typeof nth === "number" ? { nth } : {}) };
		}
		throw new Error(sentence);
	};

	/**
	 * The boards as **this agent** sees them: its own stage, which is the one `decks.canvas.move` writes
	 * to. Every read in this file goes through here, so a verb cannot quietly answer for somebody
	 * else's arrangement.
	 */
	const here = () => service.boards(agent.id);
	/** A workspace a caller named, cleaned as the store cleans it, or a sentence. */
	const askedWorkspace = (raw: unknown): string => {
		const clean = typeof raw === "string" ? cleanWorkspace(raw) : null;
		if (!clean) throw new Error('workspace is a project name, as in { workspace: "political-llm" }.');
		return clean;
	};
	const callOn: { stage?: string } = {
		get stage() {
			return frames.getStore()?.stage;
		},
	};
	const hereCanvas = (): string | undefined => {
		const pens = service.pens;
		if (callOn.stage && pens?.has(callOn.stage)) return callOn.stage;
		if (agent.here) return agent.here();
		// The person acts where they are looking. An agent has no canvas of its own to fall back on: it names one.
		return agent.person ? agent.stageName?.() : undefined;
	};
	const cameraCanvas = (): string | undefined => {
		const pens = service.pens;
		if (callOn.stage && pens?.has(callOn.stage)) return callOn.stage;
		return agent.here?.() ?? agent.stageName?.();
	};
	const canvasOf = (asked?: unknown): string => {
		const pens = needPens();
		if (asked === undefined || asked === null || asked === "") {
			const name = hereCanvas();
			if (!name) throw new Error(NAME_A_CANVAS);
			return name;
		}
		if (typeof asked !== "string") throw new Error('canvas is a canvas\'s name or title, as in { canvas: "launch-plan" }.');
		const raw = asked.trim().replace(/^canvases\//, "").replace(/^shared\/canvases\//, "shared/").replace(/\/canvas(\.pen)?$/, "");
		const names = pens.names();
		const name = names.includes(raw) ? raw : names.find((one) => pens.titleOf(one).toLowerCase() === raw.toLowerCase());
		if (!name) throw new Error(`No canvas is called "${asked}". decks canvas list names them, by name and title.`);
		return name;
	};
	const canvasRow = (name: string) => {
		const pens = needPens();
		const mine = agent.stageName?.();
		let cards = 0;
		try {
			cards = pens.cards.boards(name).length;
		} catch {
			/* a canvas whose file does not parse holds no cards we can count */
		}
		const shared = pens.rights.sharing(name);
		return {
			name,
			title: pens.titleOf(name),
			// A friend's canvas: who shared it, and whether you may change it (`deck/layout.ts`).
			...(shared ? { shared: { owner: shared.ownerName ?? shared.owner, role: shared.role, ...(shared.studio ? { studio: shared.studio } : {}) } } : {}),
			...(!shared && pens.rights.studioId(name) ? { studio: pens.rights.studioId(name) } : {}),
			open: agent
				.agents()
				.filter((other) => (other.id === agent.id && !agent.app ? mine : other.stage) === name)
				.map((other) => other.name),
			cards,
		};
	};
	return { service, agent, port, notes, images, asList, viewport, needPens, needStage, needWeb, needTarget, here, askedWorkspace, hereCanvas, cameraCanvas, canvasOf, canvasRow, callOn };
}

/** A board with its box as both corners, beside `x`, `y`, `w`, `h`, so a reader never adds a width. */
export function withBox<B extends { x: number; y: number; w: number; h: number }>(board: B): B & { box: { x1: number; y1: number; x2: number; y2: number } } {
	return { ...board, box: { x1: board.x, y1: board.y, x2: board.x + board.w, y2: board.y + board.h } };
}

export function escapeXml(text: string): string {
	return text.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
