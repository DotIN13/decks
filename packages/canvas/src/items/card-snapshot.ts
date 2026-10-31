/**
 * A card as it stands, written out as a page the server's Chrome draws the same way (`boards/snapshot.ts`
 * on the server): what an agent's `decks canvas screenshot` of a card shows, so it has what the person
 * did in it. Boards had this as `snapshotOf` while the canvas ran their pages; a card is the same rules
 * over its shadow root.
 *
 * The card's markup after every script has run is most of it; what a fresh load would lose is written
 * in: what was typed into fields, which boxes were scrolled and how far (`data-decks-scroll`, put back by
 * the server), and each canvas's pixels, as a picture in its place. Scripts are taken out, so a chart
 * drawn by one is not drawn a second time. Styles a script made without markup (a sheet built in script
 * and adopted, rules inserted into an empty `<style>`) are written out as `<style>`.
 *
 * The page is shaped as the server's own page of a card (`cardPage`, `boards/cards.ts`): card.css from
 * the canvas's `lib/`, `body.board` at the card's width, the card in `#decks-card`. It is loaded at the
 * card's own address, so the card's relative addresses resolve as they do there.
 *
 * Sizes are read from layout (`offsetWidth`), never from `getBoundingClientRect`: the card sits under the
 * camera's zoom, and a box read on screen is the zoomed one.
 */
export interface CardShotOptions {
	/** The card's width, in its own pixels. */
	w: number;
	/** At least this tall: the card's box on the canvas. */
	h: number;
	scheme: "light" | "dark";
	/** The card's address: absolute addresses on its origin are made relative to the site, for the server's Chrome. */
	url: string;
	/** A sheet not to write out: the card sheet every card adopts (card.css as `:host`), which the page loads as card.css. */
	skip?: (sheet: CSSStyleSheet) => boolean;
}

export interface CardShot {
	html: string;
	w: number;
	h: number;
	scheme: "light" | "dark";
}

export function snapshotOfCard(root: ShadowRoot, options: CardShotOptions): CardShot | undefined {
	const body = Array.from(root.children).find((child) => child.classList.contains("card-body")) as HTMLElement | undefined;
	if (!body) return undefined;
	const copy = body.cloneNode(true) as HTMLElement;
	const head: string[] = [];
	// What the card's root holds beside its body: a stylesheet a part put in (KaTeX's), a `<style>`.
	for (const child of Array.from(root.children)) {
		if (child === body) continue;
		if (child.localName === "link" || child.localName === "style") head.push(withRules(child).outerHTML);
	}
	for (const sheet of Array.from(root.adoptedStyleSheets ?? [])) {
		if (options.skip?.(sheet)) continue;
		const rules = rulesOf(sheet);
		if (rules) head.push(`<style>${rules}</style>`);
	}
	writeLive(body, copy);
	copy.querySelectorAll("script").forEach((script) => script.remove());
	copy.className = "card-body";
	copy.id = "decks-card";
	copy.removeAttribute("style");
	const h = Math.max(1, Math.ceil(options.h), Math.ceil(body.scrollHeight));
	const w = Math.max(1, Math.round(options.w));
	let origin = "";
	try {
		origin = new URL(options.url).origin;
	} catch {
		origin = "";
	}
	const html = siteRelative(
		`<!doctype html>
<html lang="en" data-theme="${options.scheme}">
<head>
<meta charset="utf-8" />
<meta name="board" content='${JSON.stringify({ w })}' />
<link rel="stylesheet" href="../../lib/card.css" />
${head.join("\n")}
</head>
<body class="board" style="width:${w}px">
${copy.outerHTML}
</body>
</html>`,
		origin,
	);
	return { html, w, h, scheme: options.scheme };
}

/** Into `copy`, what `live` has that its markup does not: typed values, choices, scroll, canvases' pixels, scripted rules. */
function writeLive(live: HTMLElement, copy: HTMLElement): void {
	const from = [live, ...Array.from(live.querySelectorAll("*"))];
	const to = [copy, ...Array.from(copy.querySelectorAll("*"))];
	const canvases: Array<[HTMLCanvasElement, Element]> = [];
	for (let i = 0; i < from.length; i++) {
		const a = from[i]!;
		const b = to[i];
		if (!b) break;
		// By tag, not `instanceof`: a card's custom registry or another window would make it false.
		const tag = a.localName;
		if (tag === "input") {
			const input = a as HTMLInputElement;
			if (input.type === "checkbox" || input.type === "radio") b.toggleAttribute("checked", input.checked);
			else if (input.type !== "file" && input.type !== "password") b.setAttribute("value", input.value);
		} else if (tag === "textarea") b.textContent = (a as HTMLTextAreaElement).value;
		else if (tag === "select") {
			Array.from((a as HTMLSelectElement).options).forEach((option, k) => (b as HTMLSelectElement).options[k]?.toggleAttribute("selected", option.selected));
		} else if (tag === "canvas") canvases.push([a as HTMLCanvasElement, b]);
		else if (tag === "style") withRules(a, b);
		else if (tag === "details") b.toggleAttribute("open", (a as HTMLDetailsElement).open);
		if (a.scrollTop || a.scrollLeft) b.setAttribute("data-decks-scroll", `${a.scrollLeft},${a.scrollTop}`);
	}
	for (const [a, b] of canvases) {
		let pixels: string;
		try {
			pixels = a.toDataURL();
		} catch {
			continue; // A canvas holding another site's picture cannot be read; it stays empty.
		}
		const img = b.ownerDocument.createElement("img");
		for (const attribute of Array.from(b.attributes)) img.setAttribute(attribute.name, attribute.value);
		img.setAttribute("src", pixels);
		img.style.width = `${a.offsetWidth || a.width}px`;
		img.style.height = `${a.offsetHeight || a.height}px`;
		b.replaceWith(img);
	}
}

/** A `<style>` with rules put in by script (its markup empty) given them as text; into `to`, or a copy. */
function withRules(element: Element, to: Element = element.cloneNode(true) as Element): Element {
	if (element.localName === "style" && !(element.textContent ?? "").trim()) {
		const rules = rulesOf((element as HTMLStyleElement).sheet);
		if (rules) to.textContent = rules;
	}
	return to;
}

/** A sheet's rules as text, or nothing when it cannot be read (another site's sheet). */
function rulesOf(sheet: CSSStyleSheet | null | undefined): string {
	if (!sheet) return "";
	try {
		return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
	} catch {
		return "";
	}
}

/**
 * Addresses absolute to the card's own origin made relative to the site: the server draws the page at
 * its own address (`127.0.0.1`), which is not the one the browser used, and a link to the browser's would
 * be another site to it. A card's addresses were all made absolute when it was put in its root (`card.ts`),
 * in attributes and in its styles' `url()`s alike, so the whole text is rewritten.
 */
function siteRelative(html: string, origin: string): string {
	if (!origin || origin === "null") return html;
	return html.split(`${origin}/`).join("/");
}
