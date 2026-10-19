/**
 * The names an icon can be found by, for the insert panel's search (`Insert.tsx`).
 *
 * Every library the canvas draws from (`icons.ts`) publishes a list of its icons beside the icons
 * themselves: Lucide its names with search words, Phosphor its catalogue with tags, Material
 * Symbols and Feather their names. Each list is fetched the first time its library is searched,
 * from the same CDN the icons come from, and kept for the page's life. Without a network nothing
 * new can be found, and icons already drawn stay drawn.
 */
export interface IconEntry {
	name: string;
	/** Search words the library gives it, beside its name. */
	tags: string[];
}

export interface IconLibrary {
	/** The `library` a pen `icon` item names (`icons.ts`, `iconUrl`). */
	id: string;
	label: string;
	load: () => Promise<IconEntry[]>;
}

const CDN = "https://cdn.jsdelivr.net/npm";

export const ICON_LIBRARIES: readonly IconLibrary[] = [
	{
		id: "lucide",
		label: "Lucide",
		load: async () => {
			const tags = (await (await fetch(`${CDN}/lucide-static@latest/tags.json`)).json()) as Record<string, string[]>;
			return Object.entries(tags).map(([name, words]) => ({ name, tags: words }));
		},
	},
	{
		id: "phosphor",
		label: "Phosphor",
		load: async () => {
			const catalogue = (await import(/* @vite-ignore */ `${CDN}/@phosphor-icons/core@latest/dist/index.mjs`)) as { icons: Array<{ name: string; tags?: string[] }> };
			return catalogue.icons.map((icon) => ({ name: icon.name, tags: (icon.tags ?? []).filter((tag) => !tag.startsWith("*")) }));
		},
	},
	{
		id: "Material Symbols Outlined",
		label: "Material",
		load: async () => {
			const versions = (await (await fetch(`${CDN}/@material-symbols/metadata@latest/versions.json`)).json()) as Record<string, number>;
			return Object.keys(versions).map((name) => ({ name, tags: name.split("_") }));
		},
	},
	{
		id: "feather",
		label: "Feather",
		load: async () => {
			const icons = (await (await fetch(`${CDN}/feather-icons@latest/dist/icons.json`)).json()) as Record<string, string>;
			return Object.keys(icons).map((name) => ({ name, tags: name.split("-") }));
		},
	},
];

const loaded = new Map<string, Promise<IconEntry[]>>();

/** A library's icons, fetched once. A failed fetch is forgotten, so the next search tries again. */
export function iconsOf(library: string): Promise<IconEntry[]> {
	let hit = loaded.get(library);
	if (!hit) {
		const source = ICON_LIBRARIES.find((one) => one.id === library);
		if (!source) return Promise.resolve([]);
		hit = source.load().catch((error: unknown) => {
			loaded.delete(library);
			throw error;
		});
		loaded.set(library, hit);
	}
	return hit;
}

/**
 * The icons a query finds, best first: a name that is the query, then names that start with it, then
 * names that hold it, then icons tagged with it. Every word of the query has to be found.
 */
export function searchIcons(icons: readonly IconEntry[], query: string, limit = 120): IconEntry[] {
	const words = query.toLowerCase().trim().split(/[\s_-]+/).filter(Boolean);
	if (words.length === 0) return icons.slice(0, limit);
	const scored: Array<{ icon: IconEntry; score: number }> = [];
	const joined = words.join("-");
	for (const icon of icons) {
		const name = icon.name.toLowerCase();
		let score = 0;
		let all = true;
		for (const word of words) {
			if (name === word || name.replace(/_/g, "-") === joined) score += 100;
			else if (name.startsWith(word)) score += 40;
			else if (name.includes(word)) score += 20;
			else if (icon.tags.some((tag) => tag.toLowerCase().includes(word))) score += 5;
			else {
				all = false;
				break;
			}
		}
		if (all) scored.push({ icon, score: score - name.length / 100 });
	}
	return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((one) => one.icon);
}

const RECENT = "decks.icons.recent";

/** Icons picked lately, newest first, by library and name: what the panel shows before a search. */
export function recentIcons(): Array<{ library: string; name: string }> {
	try {
		const list = JSON.parse(localStorage.getItem(RECENT) ?? "[]") as Array<{ library: string; name: string }>;
		return Array.isArray(list) ? list.filter((one) => one && typeof one.library === "string" && typeof one.name === "string") : [];
	} catch {
		return [];
	}
}

export function noteRecentIcon(pick: { library: string; name: string }): void {
	const list = [pick, ...recentIcons().filter((one) => one.library !== pick.library || one.name !== pick.name)].slice(0, 28);
	try {
		localStorage.setItem(RECENT, JSON.stringify(list));
	} catch {
		// Private mode: the list lasts for this page.
	}
}
