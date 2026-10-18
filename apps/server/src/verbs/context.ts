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
	/** Lines a verb adds beside its value: where a board went, what `fit` measured. */
	notes: string[];
	/** Pictures a verb produced, which go back beside its value. */
	images: Array<{ data: string; mimeType: string }>;
	asList(path: string | string[]): string[];
	viewport(): ReturnType<StageService["viewport"]>;
	needPens(): NonNullable<StageService["pens"]>;
	needStage(): string;
	itemBox(id: string): { x: number; y: number; w: number; h: number } | undefined;
	needWeb(): NonNullable<StageService["web"]>;
	needTarget(value: unknown, sentence: string): WebTarget;
	isolated(): boolean;
	here(): ReturnType<StageService["boards"]>;
	cornerOf(at: unknown): { x: number; y: number } | undefined;
	reportPlace(path: string, named: { x: number; y: number } | undefined, before?: { x: number; y: number }): void;
	notWhileIsolated(what: string): never;
	askedWorkspace(raw: unknown): string;
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
	/**
	 * Where a drawn item is on this stage, or nothing when there is no item by that id.
	 *
	 * What makes `show` work on the drawing as well as on the boards. An id is looked up in the
	 * layout rather than in the file, because the layout is the only thing that knows where a
	 * note inside a frame ends up, and "fly to it" is a question about the stage, not the JSON.
	 */
	const itemBox = (id: string): { x: number; y: number; w: number; h: number } | undefined => {
		const name = agent.stageName?.();
		if (!service.pens || !name) return undefined;
		const box = service.pens.placedOf(name).get(id)?.box;
		return box ? { x: box.x, y: box.y, w: box.w, h: box.h } : undefined;
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
	 * The boards as **this agent** sees them: its own stage, which is the one `stage.move` writes
	 * to. Every read in this file goes through here, so a verb cannot quietly answer for somebody
	 * else's arrangement.
	 */
	const isolated = () => agent.isolated?.() === true;
	/*
	 * Isolated mode (`agents/isolation.ts`): the stage is all there is. Every read goes through
	 * `here`, so filtering it is what keeps the rest of the deck out of every verb at once.
	 */
	const here = () => {
		const all = service.boards(agent.id);
		if (!isolated()) return all;
		const mine = new Set(agent.inPlay());
		return all.filter((board) => mine.has(board.path));
	};
	/**
	 * Where a board goes, as an agent writes it: its top-left corner, `{ x1, y1 }` (`{ x, y }` is
	 * taken too, the shape `move` uses). Nothing when it was not given; a sentence when it is not
	 * two numbers, rather than a board quietly placed somewhere else.
	 */
	const cornerOf = (at: unknown): { x: number; y: number } | undefined => {
		if (at === undefined || at === null) return undefined;
		const raw = at as { x1?: unknown; y1?: unknown; x?: unknown; y?: unknown };
		const x = raw.x1 ?? raw.x;
		const y = raw.y1 ?? raw.y;
		if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error("at is the board's top-left corner on the stage, as in at: { x1: 1160, y1: 0 }.");
		}
		return { x: Math.round(x), y: Math.round(y) };
	};
	/**
	 * Say where a board that just joined the stage went, when the agent needs telling.
	 *
	 * The agent is asked to say where every board goes, so the two cases worth a sentence are the
	 * two where it did not get what it should want: it gave no place, and one was chosen for it;
	 * or it gave one that sits on something already there. A place given and clear says nothing.
	 */
	const reportPlace = (path: string, named: { x: number; y: number } | undefined, before?: { x: number; y: number }) => {
		const board = here().find((one) => one.path === path);
		if (!board) return;
		const box = { x: board.x, y: board.y, w: board.w, h: board.h };
		const corner = `x1 ${box.x}, y1 ${box.y}`;
		// A board shown again that came back to the place it had: nothing was chosen for it.
		if (!named && before && before.x === box.x && before.y === box.y) return;
		if (!named) {
			notes.push(`No at was given, so ${path} went beside your newest board, at ${corner}. Say where each board goes with at: { x1, y1 }: decks pen read lists what is on your stage and where.`);
			return;
		}
		const hits = (other: { x: number; y: number; w: number; h: number }) =>
			box.x < other.x + other.w && other.x < box.x + box.w && box.y < other.y + other.h && other.y < box.y + box.h;
		const onStage = new Set(agent.inPlay());
		const under = here()
			.filter((one) => one.path !== path && onStage.has(one.path) && hits(one))
			.map((one) => one.path);
		const name = agent.stageName?.();
		let drawn = 0;
		try {
			if (service.pens && name) drawn = service.pens.drawn(name).filter(hits).length;
		} catch {
			// A stage file that does not parse has no drawing to overlap.
		}
		if (under.length || drawn) {
			const what = [...under, ...(drawn ? [`${drawn} drawn item${drawn === 1 ? "" : "s"}`] : [])].join(", ");
			notes.push(`${path} is at ${corner}, as asked, and sits on ${what}. Move it with stage.move if that was not meant.`);
		}
	};
	const notWhileIsolated = (what: string): never => {
		throw new Error(`Isolated mode: ${what} is not available while this agent can see only its own stage.`);
	};
	/** A workspace a caller named, cleaned as the store cleans it, or a sentence. */
	const askedWorkspace = (raw: unknown): string => {
		const clean = typeof raw === "string" ? cleanWorkspace(raw) : null;
		if (!clean) throw new Error('workspace is a project name, as in { workspace: "political-llm" }.');
		return clean;
	};
	return { service, agent, port, notes, images, asList, viewport, needPens, needStage, itemBox, needWeb, needTarget, isolated, here, cornerOf, reportPlace, notWhileIsolated, askedWorkspace };
}

/** A board with its box as both corners, beside `x`, `y`, `w`, `h`, so a reader never adds a width. */
export function withBox<B extends { x: number; y: number; w: number; h: number }>(board: B): B & { box: { x1: number; y1: number; x2: number; y2: number } } {
	return { ...board, box: { x1: board.x, y1: board.y, x2: board.x + board.w, y2: board.y + board.h } };
}

export function escapeXml(text: string): string {
	return text.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
