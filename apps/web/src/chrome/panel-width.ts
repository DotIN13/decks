/**
 * How wide the sidebar is, when the person has said.
 *
 * Nothing else has to hear about it. The canvas, the composer and the dashboard all read
 * `--inset-left`, and `camera/insets.ts` measures that from the panel's real box, so a
 * panel that is wider is a column that is narrower without a second number anywhere.
 *
 * Kept in the browser, beside the floats: it is a fact about this screen, not the deck.
 */

/** The width it has always had, and the one a double-click on the handle puts back. */
export const PANEL_WIDTH = 264;
/** Under this a board's name is three letters and an ellipsis. */
export const PANEL_MIN = 200;
export const PANEL_MAX = 560;
export const PANEL_WIDTH_KEY = "decks.panel-width";

/**
 * Between the limits, and never more than half the window: the sidebar stands beside the
 * work, and a window dragged narrow must not leave it holding most of the room.
 */
export function clampPanelWidth(width: number, viewport: number): number {
	const most = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.floor(viewport / 2)));
	return Math.round(Math.min(most, Math.max(PANEL_MIN, width)));
}

function store(storage?: Storage): Storage | undefined {
	try {
		return storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
	} catch {
		return undefined;
	}
}

/** The remembered width, or the default when there is none or it is not a number. */
export function loadPanelWidth(storage?: Storage): number {
	try {
		const raw = store(storage)?.getItem(PANEL_WIDTH_KEY);
		const width = raw === null || raw === undefined ? Number.NaN : Number(raw);
		return Number.isFinite(width) ? Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(width))) : PANEL_WIDTH;
	} catch {
		return PANEL_WIDTH;
	}
}

/** The default is stored as nothing, so a later change to it reaches everyone who never chose. */
export function savePanelWidth(width: number, storage?: Storage): void {
	try {
		if (width === PANEL_WIDTH) store(storage)?.removeItem(PANEL_WIDTH_KEY);
		else store(storage)?.setItem(PANEL_WIDTH_KEY, String(Math.round(width)));
	} catch {
		// Not remembered; it is still this wide for now.
	}
}
