import type { Camera } from "@decks/protocol";
import type { AgentView } from "./agent-view.ts";

/**
 * Each conversation's camera, kept per device: what it was last left looking at, per canvas. The
 * rules are `agent-view.ts`; this is where they are kept (`localStorage`, or a store a test passes).
 */
const PREFIX = "decks.views:";

/** One deck's views, read once and written back on every change. */
export interface AgentViews {
	/** What this conversation was last left looking at on this canvas, if it has been left there yet. */
	of(agentId: string, stage: string | undefined): AgentView | undefined;
	/** Remember it, for this agent on this canvas, on this device. */
	keep(agentId: string, stage: string | undefined, view: AgentView): void;
	/** Drop the views of agents that no longer exist, so the key cannot grow forever. */
	retain(agentIds: string[]): void;
}

/**
 * Storage, as four lines of it — so a test can pass its own.
 *
 * `localStorage` itself is what the app passes; the shape is here rather than the global so the
 * rules above can be asserted without a browser, which is where the interesting cases are (a
 * value from an older build, a value that is not a view, a store that refuses to write).
 */
export interface ViewStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export function createAgentViews(deckPath: string, storage: ViewStorage | undefined = globalThis.localStorage): AgentViews {
	const key = `${PREFIX}${deckPath}`;
	let held: Record<string, AgentView> | undefined;

	const read = (): Record<string, AgentView> => {
		if (held) return held;
		held = {};
		try {
			const raw = storage?.getItem(key);
			if (!raw) return held;
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object") return held;
			for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
				const view = viewOf(value);
				if (view) held[id] = view;
			}
		} catch {
			// A browser with storage switched off, or a value some older build wrote. An
			// unreadable view is no view: the conversation then opens where it holds boards,
			// which is the answer a first visit gives.
			held = {};
		}
		return held;
	};

	const write = () => {
		try {
			storage?.setItem(key, JSON.stringify(read()));
		} catch {
			/* Nothing to do about a full or refused store, and nothing worth saying. */
		}
	};

	return {
		/*
		 * Only the key asked for. A view kept before canvases were part of the key is taken once, by the
		 * first canvas this agent is asked about (the one it is on as the upgrade lands), and dropped: it
		 * comes back where it was left and no longer stands in for every canvas.
		 */
		of: (agentId, stage) => {
			const views = read();
			const key = keyOf(agentId, stage);
			if (views[key] || !stage || !views[agentId]) return views[key];
			views[key] = views[agentId]!;
			delete views[agentId];
			write();
			return views[key];
		},
		keep: (agentId, stage, view) => {
			const views = read();
			views[keyOf(agentId, stage)] = { camera: { ...view.camera }, ...(view.selected ? { selected: view.selected } : {}) };
			// The view kept before canvases were part of the key is replaced by this canvas's own.
			if (stage) delete views[agentId];
			write();
		},
		retain: (agentIds) => {
			const alive = new Set(agentIds);
			const views = read();
			const kept = Object.keys(views).filter((key) => alive.has(agentOf(key)));
			if (kept.length === Object.keys(views).length) return;
			held = Object.fromEntries(kept.map((id) => [id, views[id]!]));
			write();
		},
	};
}

/** The key one view is kept under: the agent, and the canvas it was on. */
const keyOf = (agentId: string, stage: string | undefined) => (stage ? `${agentId}@${stage}` : agentId);
/** Which agent a key is for. */
const agentOf = (key: string) => key.split("@")[0]!;

/**
 * A stored view, if that is what it is.
 *
 * Checked field by field rather than trusted: this comes back from storage a build ago wrote,
 * from a hand edit, or from a browser with something else under the same key — and a camera of
 * `NaN` is not a view of nowhere, it is a canvas that cannot be drawn.
 */
function viewOf(raw: unknown): AgentView | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const source = raw as { camera?: unknown; selected?: unknown };
	const camera = source.camera as Partial<Camera> | undefined;
	if (!camera || typeof camera !== "object") return undefined;
	const { x, y, zoom } = camera;
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return undefined;
	if (zoom! <= 0) return undefined;
	return {
		camera: { x: x as number, y: y as number, zoom: zoom as number },
		...(typeof source.selected === "string" && source.selected ? { selected: source.selected } : {}),
	};
}
