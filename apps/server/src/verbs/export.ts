import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { iconsIn, toHtml, type HtmlIcon, type MeasureText, type PenDocument, type PenNode } from "@decks/pen";
import { iconUrl, parseIcon } from "../../../../packages/canvas/src/render/icons.ts";

/**
 * Frames written out as one HTML page in the deck (`decks.canvas.export`): `@decks/pen`'s `toHtml`,
 * with what only the server has: the icons fetched from the sets the stage draws them from, image
 * fills and boards addressed from where the page is written, and the file itself.
 */

/** Icons fetched once each while the server runs, by library, name and weight. */
const fetched = new Map<string, HtmlIcon | null>();
const FETCH_MS = 10_000;

async function iconShape(library: string, name: string, weight: number): Promise<HtmlIcon | undefined> {
	const key = `${library}|${name}|${weight}`;
	if (fetched.has(key)) return fetched.get(key) ?? undefined;
	const url = iconUrl(library, name, weight);
	let shape: HtmlIcon | undefined;
	if (url) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
			if (response.ok) shape = parseIcon(await response.text(), weight);
		} catch {
			/* no network, or no such icon: left out, and said in the notes */
		}
	}
	fetched.set(key, shape ?? null);
	return shape;
}

/** A path as the disk spells it, when it is there. */
function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		const up = dirname(path);
		return up === path ? path : resolve(real(up), basename(path));
	}
}

/** A path the page reads, from the folder it is written in: forward slashes, each part escaped. */
const fromPage = (page: string, file: string) =>
	relative(dirname(page), file)
		.split(sep)
		.map((part) => encodeURIComponent(part))
		.join("/");

export interface ExportRequest {
	/** The document, with its imports in place, laid out as the canvas lays it out. */
	doc: PenDocument;
	ids: string[];
	format: "html" | "tailwind";
	/** The deck's root, and the page's absolute path inside it. */
	deck: string;
	page: string;
	/** The folder the drawing's image fills are read against. */
	folder: string;
	measure: MeasureText;
	title?: string;
	/** A board item's deck path. */
	boardOf: (node: PenNode) => string | undefined;
}

/** Write the page: answers its deck path, and a note for each icon that could not be fetched. */
export async function exportPage(asked: ExportRequest): Promise<{ file: string; notes: string[] }> {
	// One spelling of every path (a temporary folder is /var and /private/var on a Mac), so the relative ones are right.
	const request = { ...asked, deck: real(asked.deck), folder: real(asked.folder), page: resolve(real(dirname(asked.page)), basename(asked.page)) };
	const notes: string[] = [];
	const icons = new Map<string, HtmlIcon>();
	for (const icon of iconsIn(request.doc, request.ids)) {
		const shape = await iconShape(icon.library, icon.name, icon.weight);
		if (shape) icons.set(`${icon.library}|${icon.name}|${icon.weight}`, shape);
		else notes.push(`The ${icon.library} icon "${icon.name}" could not be fetched, so it is left out of the page.`);
	}
	const html = toHtml(request.doc, request.ids, {
		format: request.format,
		measure: request.measure,
		...(request.title ? { title: request.title } : {}),
		icons: (library, name, weight) => icons.get(`${library}|${name}|${weight}`),
		// An address with a scheme (https:, data:) or from the root stays; a relative one is read from the page's folder.
		url: (url) => (/^[a-z][\w+.-]*:/i.test(url) || url.startsWith("/") ? url : fromPage(request.page, isAbsolute(url) ? url : resolve(request.folder, url))),
		board: (node) => {
			const path = request.boardOf(node);
			return path ? fromPage(request.page, resolve(request.deck, path)) : undefined;
		},
	});
	mkdirSync(dirname(request.page), { recursive: true });
	writeFileSync(request.page, html);
	return { file: relative(request.deck, request.page).split(sep).join("/"), notes };
}
