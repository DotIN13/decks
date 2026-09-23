import { INK_LAYER, INK_LAYER_ATTRIBUTES, INK_TITLE, strokeAttributes, strokeFromAttributes, type InkStroke } from "@decks/board-kit";

/**
 * A board document's ink layer: read when the frame loads, and kept in step while drawing.
 *
 * The file is the truth (`@decks/board-kit`, `ink.ts`), and the frame is that file, loaded.
 * A stroke is put into the frame's own DOM here at the moment it is drawn and the `ink` patch
 * is sent beside it, which is the rule every edit in this app follows: the document on screen
 * is already right, so the frame stays pinned and never reloads for a person's own change.
 */

const SVG = "http://www.w3.org/2000/svg";

function layerOf(doc: Document): SVGSVGElement | undefined {
	for (const child of Array.from(doc.body?.children ?? [])) {
		if (child.localName === "svg" && child.hasAttribute(INK_LAYER)) return child as SVGSVGElement;
	}
	return undefined;
}

/** The strokes in a loaded board, in the order they were drawn. */
export function readLayer(doc: Document | null | undefined): InkStroke[] {
	const layer = doc ? layerOf(doc) : undefined;
	if (!layer) return [];
	const strokes: InkStroke[] = [];
	for (const path of Array.from(layer.children)) {
		if (path.localName !== "path") continue;
		const stroke = strokeFromAttributes((name) => path.getAttribute(name));
		if (stroke) strokes.push(stroke);
	}
	return strokes;
}

/**
 * Make the document's layer hold exactly these strokes.
 *
 * Keyed by stroke id, so drawing one more stroke adds one `<path>` and touches nothing else.
 * The layer goes where the server writes it, before the scripts the body ends with, and is
 * taken out when the last stroke goes, so the live DOM and the file keep the same shape.
 */
export function syncLayer(doc: Document | null | undefined, strokes: InkStroke[]): void {
	if (!doc?.body) return;
	let layer = layerOf(doc);
	if (strokes.length === 0) {
		layer?.remove();
		return;
	}
	if (!layer) {
		layer = doc.createElementNS(SVG, "svg") as SVGSVGElement;
		for (const [name, value] of INK_LAYER_ATTRIBUTES) if (name !== "xmlns") layer.setAttribute(name, value);
		const title = doc.createElementNS(SVG, "title");
		title.textContent = INK_TITLE;
		layer.append(title);
		let before: Element | null = null;
		for (let child = doc.body.lastElementChild; child && child.localName === "script"; child = child.previousElementSibling) before = child;
		doc.body.insertBefore(layer, before);
	}
	const held = new Map<string, Element>();
	for (const path of Array.from(layer.children)) {
		const id = path.getAttribute("data-ink");
		if (path.localName === "path" && id) held.set(id, path);
	}
	const wanted = new Set(strokes.map((stroke) => stroke.id));
	for (const [id, path] of held) if (!wanted.has(id)) path.remove();
	let cursor: Element | null = layer.querySelector("title");
	for (const stroke of strokes) {
		let path = held.get(stroke.id);
		const attributes = strokeAttributes(stroke);
		const points = attributes.find(([name]) => name === "data-points")?.[1];
		if (!path) {
			path = doc.createElementNS(SVG, "path");
			for (const [name, value] of attributes) path.setAttribute(name, value);
		} else if (path.getAttribute("data-points") !== points) {
			// A moved stroke: the same id somewhere else. Attributes a fill had and a line has not are cleared.
			for (const name of path.getAttributeNames()) path.removeAttribute(name);
			for (const [name, value] of attributes) path.setAttribute(name, value);
		}
		const next: Element | null = cursor ? cursor.nextElementSibling : layer.firstElementChild;
		if (next !== path) layer.insertBefore(path, next);
		cursor = path;
	}
}
