import { tabTitle } from "./policy.ts";

/**
 * The tab says how much happened while you were away: `(3) Decks` in its title, and an icon with a
 * dot on it. A host names its own title and its two icons (an `href` each, SVG or not); without
 * icons only the title changes.
 */
export function createTabBadge(o: { title: string; plain?: string; badged?: string }): (count: number) => void {
	// Painted on the first call too, so a page that has no icon of its own gets one.
	let current: string | undefined;
	const paint = (href: string | undefined) => {
		if (!href || href === current) return;
		current = href;
		const existing = document.head.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]') ?? document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
		const link = document.createElement("link");
		link.rel = "icon";
		link.type = "image/svg+xml";
		link.href = href;
		existing?.remove();
		document.head.append(link);
	};
	return (count) => {
		paint(count > 0 ? o.badged : o.plain);
		const next = tabTitle(count, o.title);
		// Guarded: assigning the same string still fires a `titlechange` in some extensions.
		if (document.title !== next) document.title = next;
	};
}
