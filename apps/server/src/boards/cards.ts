import { cardModules, runsInCard } from "@decks/board-host";
import { IMPORT_MAP } from "./templates.ts";

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/**
 * A card: a piece of HTML in a canvas's `cards/`, which the stage puts in a shadow root of its own
 * page instead of a frame (`packages/canvas/src/items/card.ts`). Its scripts run as modules, each served at
 * its own address beside the card (`sales.html.m0.js`), so a relative `import "./sales.js"` resolves
 * from the card's folder and an error names the card's file. A card opened by itself, or pictured by
 * the server's Chrome, is the same piece in a page of its own (`cardPage`).
 */

/** The card with the scripts it runs taken out, for a page that loads them by address instead. */
function withoutModules(source: string): { html: string; srcs: string[] } {
	const srcs: string[] = [];
	const html = source.replace(SCRIPT, (all, attrs: string) => {
		if (!runsInCard(attrs)) return all;
		const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
		if (src) srcs.push(src);
		return "";
	});
	return { html, srcs };
}

/** The boards' import map, with the deck's own names (`assets/importmap.json`) added where the boards' have none. */
function withDeckImports(extra: Record<string, string> | undefined): string {
	if (!extra || !Object.keys(extra).length) return IMPORT_MAP;
	const map = JSON.parse(IMPORT_MAP) as { imports: Record<string, string> };
	for (const [name, address] of Object.entries(extra)) if (!(name in map.imports)) map.imports[name] = address;
	return JSON.stringify(map, null, 2);
}

/** A deck's `assets/importmap.json` read for a card's page: names to addresses, relative ones from the deck's `assets/`. */
export function readDeckImports(text: string | undefined, assetsUrl: string): Record<string, string> {
	if (!text) return {};
	try {
		const given = JSON.parse(text) as { imports?: Record<string, unknown> };
		const out: Record<string, string> = {};
		for (const [name, address] of Object.entries(given.imports ?? {})) {
			if (typeof address !== "string" || !name) continue;
			out[name] = /^https:\/\//.test(address) ? address : `${assetsUrl}${address.replace(/^\.\//, "")}`;
		}
		return out;
	} catch {
		return {};
	}
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A card as a page of its own: for a tab, and for the picture the server's Chrome takes of it. The
 * piece goes in the body as it is, under board.css, and its scripts are called with a card whose
 * root is this page's own document.
 */
export { cardModules };

export function cardPage(input: { path: string; source: string; title: string; w: number; shared: boolean; deckImports?: Record<string, string> }): string {
	const name = input.path.split("/").pop() ?? "card.html";
	const { html, srcs } = withoutModules(input.source);
	const count = cardModules(input.source).length;
	const urls = input.shared ? [] : [...srcs, ...Array.from({ length: count }, (_, n) => `./${name}.m${n}.js`)];
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>${escapeHtml(input.title)}</title>
	<meta name="board" content='${JSON.stringify({ w: input.w })}' />
	<link rel="stylesheet" href="../../lib/board.css" />
	<script type="importmap">
${withDeckImports(input.deckImports)}
	</script>
</head>
<body class="board" style="width:${input.w}px">
<div class="card-body" id="decks-card">${html}</div>
<script type="module">
	const root = document.getElementById("decks-card");
	const card = { root, document, signal: new AbortController().signal, url: location.href.replace(/[?#].*$/, ""), theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light", size: { w: ${input.w}, h: root.offsetHeight }, store: localStorage, page: true };
	for (const url of ${JSON.stringify(urls)}) {
		try {
			const m = await import(new URL(url, location.href).href);
			if (typeof m.default === "function") await m.default(card);
		} catch (error) { console.error(url, error); }
	}
</script>
<script src="../../lib/board.js"></script>
</body>
</html>
`;
}

const escapeTitle = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * A new card's `index.html`: its title, its size, a style for its one block, the block with the title
 * in it, and a module that is handed the card. The agent fills it in with its own tools; what it
 * keeps beside it (a stylesheet, a module, data) goes in the same folder.
 */
export function cardShell(title: string, size: { w: number; h?: number }): string {
	return `<title>${escapeTitle(title)}</title>
<meta name="card" content='${JSON.stringify(size)}' />
<style>
	/* The card is as wide as its item on the canvas (a phone's, a person's resize): a size container named card. */
	.doc { padding: clamp(20px, 5cqi, 48px); font-size: 17px; line-height: 1.5 }
	.doc img, .doc video { max-width: 100%; height: auto }
	/* your design: grids and flex rows that wrap, no fixed block widths, and narrow rules by the card's width:
	@container card (width < 640px) { .cols { grid-template-columns: 1fr } } */
</style>
<div class="doc" data-id="doc">
	<h1>${escapeTitle(title)}</h1>
</div>
<script type="module">
	// Runs each time the card wakes; return a function to stop what it started.
	export default function (card) {
		// card.root is what document is to a page: card.root.querySelector("h1").
	}
</script>
`;
}
