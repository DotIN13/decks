import { cleanWorkspace } from "../agents/workspaces.ts";
import type { StageService, WebTarget } from "../stage/service.ts";
import type { StageAgentHooks } from "../stage/tool.ts";

/**
 * What every verb's handler is given: the stage service, the caller's hooks, and the helpers the
 * handlers share. Made once per caller by `createStageTool` (`stage/tool.ts`), which also owns the
 * notes and pictures a call collects and empties them before each one.
 */
export interface VerbContext {
	service: StageService;
	agent: StageAgentHooks;
	port: number;
	/** Lines a verb adds beside its value: what `decks.canvas.fit` measured, a card's width. */
	notes: string[];
	/** Pictures a verb produced, which go back beside its value. */
	images: Array<{ data: string; mimeType: string }>;
	asList(path: string | string[]): string[];
	viewport(): ReturnType<StageService["viewport"]>;
	needPens(): NonNullable<StageService["pens"]>;
	needStage(): string;
	needWeb(): NonNullable<StageService["web"]>;
	needTarget(value: unknown, sentence: string): WebTarget;
	here(): ReturnType<StageService["boards"]>;
	askedWorkspace(raw: unknown): string;
	/**
	 * The canvas a call means when it names none (`decks.here()`): the one the call says it was made
	 * on (a person's or a board's `X-Decks-Stage`), else the caller's own: an agent's home canvas, the
	 * canvas holding a board whose button is pressed.
	 */
	hereCanvas(): string | undefined;
	/** A canvas as a caller names it (folder, title, or `canvases/<name>/canvas.pen`), or `here()` when it names none. */
	canvasOf(asked?: unknown): string;
	/** A canvas as the `Canvas` type has it: its name, title, who has it open, how many boards. */
	canvasRow(name: string): { name: string; title: string; open: string[]; cards: number };
	/** The canvas the request says it was made on, for this one call (`StageTool.call`). */
	callOn: { stage?: string };
}

export function verbContext(deps: { stage: StageService; agent: StageAgentHooks; port: number }): VerbContext {
	const { stage: service, agent, port } = deps;
	const notes: string[] = [];
	const images: Array<{ data: string; mimeType: string }> = [];
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
	const callOn: { stage?: string } = {};
	const hereCanvas = (): string | undefined => {
		const pens = service.pens;
		if (callOn.stage && pens?.has(callOn.stage)) return callOn.stage;
		return agent.here?.() ?? agent.stageName?.();
	};
	const canvasOf = (asked?: unknown): string => {
		const pens = needPens();
		if (asked === undefined || asked === null || asked === "") {
			const name = hereCanvas();
			if (!name) throw new Error("There is no canvas here to act on: name one with { canvas }. decks canvas list names them.");
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
			cards = pens.boards(name).length;
		} catch {
			/* a canvas whose file does not parse holds no cards we can count */
		}
		const shared = pens.sharing(name);
		return {
			name,
			title: pens.titleOf(name),
			// A friend's canvas: who shared it, and whether you may change it (`deck/layout.ts`).
			...(shared ? { shared: { owner: shared.ownerName ?? shared.owner, role: shared.role, ...(shared.studio ? { studio: shared.studio } : {}) } } : {}),
			...(!shared && pens.studioId(name) ? { studio: pens.studioId(name) } : {}),
			open: agent
				.agents()
				.filter((other) => (other.id === agent.id && !agent.board ? mine : other.stage) === name)
				.map((other) => other.name),
			cards,
		};
	};
	return { service, agent, port, notes, images, asList, viewport, needPens, needStage, needWeb, needTarget, here, askedWorkspace, hereCanvas, canvasOf, canvasRow, callOn };
}

/** A board with its box as both corners, beside `x`, `y`, `w`, `h`, so a reader never adds a width. */
export function withBox<B extends { x: number; y: number; w: number; h: number }>(board: B): B & { box: { x1: number; y1: number; x2: number; y2: number } } {
	return { ...board, box: { x1: board.x, y1: board.y, x2: board.x + board.w, y2: board.y + board.h } };
}

export function escapeXml(text: string): string {
	return text.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
