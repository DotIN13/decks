import { BOARD_W } from "../cards/size.ts";
/**
 * What a card says about itself, read from the top of its file: its title, its size and its poster.
 *
 * Deliberately regex and not a parser: this runs for every card on every deck load and on every
 * file change, and the three things it wants are at the top of a file the agent just wrote. A
 * missing title costs a name in a list, not a wrong edit.
 */

interface BoardMeta {
	title?: string;
	w?: number;
	h?: number;
	bg?: string;
	poster?: string;
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META = /<meta\s+[^>]*name\s*=\s*["']([\w-]+)["'][^>]*>/gi;
const CONTENT = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * An attribute value as the browser would see it.
 *
 * A new board writes this tag single-quoted, so the JSON inside keeps its own
 * double quotes and needs nothing doing to it. But a board written by hand — or by an
 * editor that normalises quotes — arrives double-quoted, and then the only legal way to
 * carry `{"w":800}` is `content="{&quot;w&quot;:800}"`. That parsed as invalid JSON and was
 * swallowed by the `catch` below, so the board silently rendered at the default size and
 * the file looked correct to anyone reading it.
 *
 * Five entities, because those are the five a serialiser may produce in an attribute.
 */
function unescapeAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

export function readBoardMeta(html: string): BoardMeta {
	const meta: BoardMeta = {};

	const title = TITLE.exec(html)?.[1]?.replace(/\s+/g, " ").trim();
	if (title) meta.title = title;

	META.lastIndex = 0;
	for (let tag = META.exec(html); tag; tag = META.exec(html)) {
		const name = tag[1]?.toLowerCase();
		const content = CONTENT.exec(tag[0]);
		const value = content?.[1] ?? content?.[2];
		if (!name || value === undefined) continue;

		if (name === "poster") {
			meta.poster = value;
			continue;
		}
		// A card says its size in `<meta name="card">`, a board in `<meta name="board">`: the same JSON.
		if (name !== "board" && name !== "card") continue;

		// `content` is JSON so a board can grow a field without a new meta tag.
		// Written by hand as often as by an agent, so a broken one is ignored
		// rather than fatal — the board still renders at the default size.
		try {
			const parsed = JSON.parse(unescapeAttribute(value)) as { w?: unknown; h?: unknown; bg?: unknown };
			if (Number.isFinite(Number(parsed.w))) meta.w = Number(parsed.w);
			if (Number.isFinite(Number(parsed.h))) meta.h = Number(parsed.h);
			if (typeof parsed.bg === "string") meta.bg = parsed.bg;
		} catch {
			/* ignored: see above */
		}
	}

	return meta;
}

/**
 * The same card with a different size in it.
 *
 * Sizing a card is editing the one place it keeps its size, the JSON inside its `<meta name="card">`
 * tag, and the write keeps every other byte where it was. Other keys of the tag are carried through.
 * A card with no tag gets one, because a card written by hand is still a card.
 */
export function withBoardSize(_path: string, source: string, size: { w?: number; h?: number }): string {
	return withTagSize(source, size, BOARD_W);
}

/**
 * Whether `after` is `before` with only the size in its `<meta name="board">` tag changed: the write a
 * fit or a person's resize makes. A page showing the board already has it, or is given it, so it is
 * not reloaded for it (`card.changed`'s `sized`).
 */
export function onlySizeChanged(path: string, before: string, after: string): boolean {
	if (before === after) return false;
	const { w, h } = readBoardMeta(after);
	if (w === undefined && h === undefined) return false;
	return withBoardSize(path, before, { ...(w === undefined ? {} : { w }), ...(h === undefined ? {} : { h }) }) === after;
}

/** The HTML half: one number, in the one `<meta name="board">` tag. */
function withTagSize(html: string, size: { w?: number; h?: number }, fallback: number): string {
	const meta = readBoardMeta(html);
	// The same default the loader uses, and it has to be the same one: a file that says nothing
	// about its width would otherwise be given one number on disk and read back as another.
	const w = Math.max(1, Math.round(size.w ?? meta.w ?? fallback));
	/*
	 * A height nobody gave is **left out** rather than invented.
	 *
	 * It used to fall back to 800 and be written like any other number, which was wrong in the
	 * one case that matters: a document board's tag is `{"w":760,"bg":"plain"}` — the width is the
	 * only size it declares, because its height is its content and the browser measures it. A drag
	 * on the width of that board therefore wrote an `h` into the file that said nothing, had never
	 * been asked for, and would have to be kept in step with a measurement that overwrites it.
	 * Caught by `e2e/checks/geometry.mjs`, which asserts that the rest of the tag is untouched.
	 *
	 * Nothing is lost by omitting it: the loader has its own starting height for a board that
	 * declares none, and the browser replaces that with the content's as soon as anybody looks.
	 */
	const h = size.h !== undefined ? Math.max(1, Math.round(size.h)) : meta.h !== undefined ? Math.max(1, Math.round(meta.h)) : undefined;
	const stated = { w, ...(h !== undefined ? { h } : {}) };

	META.lastIndex = 0;
	for (let tag = META.exec(html); tag; tag = META.exec(html)) {
		if (tag[1]?.toLowerCase() !== "board" && tag[1]?.toLowerCase() !== "card") continue;
		const content = CONTENT.exec(tag[0]);
		let rest: Record<string, unknown> = {};
		if (content) {
			try {
				const parsed = JSON.parse(unescapeAttribute(content[1] ?? content[2] ?? "{}")) as Record<string, unknown>;
				const { w: _w, h: _h, ...others } = parsed;
				rest = others;
			} catch {
				/* a broken tag is replaced rather than preserved; it said nothing usable */
			}
		}
		const replaced = tag[0].replace(
			/content\s*=\s*(?:"[^"]*"|'[^']*')/i,
			`content='${JSON.stringify({ ...stated, ...rest })}'`,
		);
		// Single-quoted, because the JSON inside carries double quotes of its own. If the
		// tag had no `content` at all there is nothing to replace, so one is added.
		const written = replaced === tag[0] ? tag[0].replace(/\s*\/?>$/, ` content='${JSON.stringify({ ...stated, ...rest })}'>`) : replaced;
		return html.slice(0, tag.index) + written + html.slice(tag.index + tag[0].length);
	}

	const tag = `<meta name="card" content='${JSON.stringify(stated)}' />`;
	const title = /<\/title>/i.exec(html);
	if (title) return `${html.slice(0, title.index + title[0].length)}\n\t\t${tag}${html.slice(title.index + title[0].length)}`;
	const head = /<head[^>]*>/i.exec(html);
	if (head) return `${html.slice(0, head.index + head[0].length)}\n\t\t${tag}${html.slice(head.index + head[0].length)}`;
	return `${tag}\n${html}`;
}


/**
 * What a card says about itself: `readBoardMeta`, with a title found for a card that has no
 * `<title>`: its first `<h1>`. With neither, nothing, and the caller falls back to its folder's name.
 */
export function readMeta(_path: string, source: string): BoardMeta {
	const meta = readBoardMeta(source);
	if (meta.title) return meta;
	const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(source);
	const title = h1?.[1]?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
	return title ? { ...meta, title } : meta;
}
