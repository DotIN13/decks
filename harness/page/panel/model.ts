// The side panel's rules, with no store and no DOM: its tabs, the tab it opens
// on, and the workspace folders kept folded.

export type PanelTab = "recent" | "canvas" | "agents" | "apps";
export const PANEL_TABS: PanelTab[] = ["recent", "canvas", "agents", "apps"];
export const TAB_KEY = "decks.panelTab";
export const FOLDED_KEY = "decks.foldedWorkspaces";

/** The tab kept, or Recent when none is kept or it is not a tab. */
export const tabOf = (kept: string | null | undefined): PanelTab => (PANEL_TABS.includes(kept as PanelTab) ? (kept as PanelTab) : "recent");

/** The folders kept folded: the strings of a kept JSON list, nothing else. */
export function foldedOf(kept: string | null | undefined): Set<string> {
	try {
		const raw = JSON.parse(kept ?? "[]") as unknown;
		return new Set(Array.isArray(raw) ? raw.filter((one): one is string => typeof one === "string") : []);
	} catch {
		return new Set();
	}
}

/** The folded set with one folder opened or shut. */
export function toggled(folded: ReadonlySet<string>, id: string): Set<string> {
	const next = new Set(folded);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

/** The tab one step left or right of this one, round the ends. */
export const tabBeside = (tab: PanelTab, step: 1 | -1): PanelTab => PANEL_TABS[(PANEL_TABS.indexOf(tab) + step + PANEL_TABS.length) % PANEL_TABS.length] ?? tab;
