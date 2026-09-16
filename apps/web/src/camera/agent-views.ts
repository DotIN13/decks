import type { Camera } from "@decks/protocol";
import type { AgentView } from "./agent-view.ts";

/**
 * The views you have left behind, kept **on this device**.
 *
 * A view is where the camera was for one conversation — position, zoom, and which board was
 * selected. It is a fact about the machine you were looking from, not about the deck or the
 * conversation: a laptop and a phone opened on the same agent want different windows, the same
 * screen at two window sizes wants different windows, and neither of those is anything the
 * server should be told or asked about. The deck's own arrangement is shared
 * (`AgentRecord.positions`); where you were *looking* at it is yours.
 *
 * So `localStorage`, which is exactly that scope: one origin, one browser, gone when the site
 * data is cleared. Keyed by deck as well as by agent, because a browser can be pointed at two
 * data directories and an agent id from one means nothing in the other.
 *
 * It has to be written on the way out and read on the way in, and a reload is the whole point:
 * before this, a view lived in memory and a refresh started you at a fresh fit — which for a
 * conversation you had been working in for an hour is the one thing you did not want.
 */

const PREFIX = "decks.views:";

/** One deck's views, read once and written back on every change. */
export interface AgentViews {
	/** What this conversation was last left looking at, if it has been left yet. */
	of(agentId: string): AgentView | undefined;
	/** Remember it, for this device. */
	keep(agentId: string, view: AgentView): void;
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

const cache = new Map<string, AgentViews>();

/**
 * The views for one deck, as the app asks for them.
 *
 * Cached per path, because the caller asks on every render and a storage read is not something
 * to do per frame — and because two objects over one key would fight over it: each holds the map
 * as it read it, so the second one to write would put back everything the first had dropped.
 */
export function agentViews(deckPath: string): AgentViews {
	const found = cache.get(deckPath);
	if (found) return found;
	const made = createAgentViews(deckPath);
	cache.set(deckPath, made);
	return made;
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
		of: (agentId) => read()[agentId],
		keep: (agentId, view) => {
			read()[agentId] = { camera: { ...view.camera }, ...(view.selected ? { selected: view.selected } : {}) };
			write();
		},
		retain: (agentIds) => {
			const alive = new Set(agentIds);
			const views = read();
			const kept = Object.keys(views).filter((id) => alive.has(id));
			if (kept.length === Object.keys(views).length) return;
			held = Object.fromEntries(kept.map((id) => [id, views[id]!]));
			write();
		},
	};
}

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
