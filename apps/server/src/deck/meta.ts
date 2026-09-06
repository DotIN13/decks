/**
 * What a board says about itself, read from the top of the file.
 *
 * Deliberately regex and not a parser: this runs for every board on every deck
 * load and on every file change, and the three things it wants are in the head of
 * a document the agent just wrote. `parse5` earns its place where correctness is
 * load-bearing — applying a user's edit to the file (§6.5) — not here, where a
 * missing title costs a heading in the rail.
 */

export interface BoardMeta {
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
 * The board templates write this tag single-quoted, so the JSON inside keeps its own
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
		if (name !== "board") continue;

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
 * The same document with a different size in it.
 *
 * Sizing a board is editing one number in one tag, which is exactly the kind of edit an
 * agent should not be doing by hand: the tag is JSON inside an HTML attribute, the file is
 * the only place the size is written down, and the write has to keep every other byte
 * where it was. So the server does it, and `stage.resize` / `stage.fit` are the two ways
 * to ask.
 *
 * Other keys in the tag — `bg`, `theme`, anything a later version adds — are carried
 * through. A board with no tag at all gets one, because a board written by hand is still
 * a board and refusing to resize it would be a rule about how it was authored.
 */
export function withBoardSize(html: string, size: { w?: number; h?: number }): string {
	const meta = readBoardMeta(html);
	const w = Math.max(1, Math.round(size.w ?? meta.w ?? 1200));
	const h = Math.max(1, Math.round(size.h ?? meta.h ?? 800));

	META.lastIndex = 0;
	for (let tag = META.exec(html); tag; tag = META.exec(html)) {
		if (tag[1]?.toLowerCase() !== "board") continue;
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
			`content='${JSON.stringify({ w, h, ...rest })}'`,
		);
		// Single-quoted, because the JSON inside carries double quotes of its own. If the
		// tag had no `content` at all there is nothing to replace, so one is added.
		const written = replaced === tag[0] ? tag[0].replace(/\s*\/?>$/, ` content='${JSON.stringify({ w, h, ...rest })}'>`) : replaced;
		return html.slice(0, tag.index) + written + html.slice(tag.index + tag[0].length);
	}

	const tag = `<meta name="board" content='${JSON.stringify({ w, h, bg: "grid" })}' />`;
	const title = /<\/title>/i.exec(html);
	if (title) return `${html.slice(0, title.index + title[0].length)}\n\t\t${tag}${html.slice(title.index + title[0].length)}`;
	const head = /<head[^>]*>/i.exec(html);
	if (head) return `${html.slice(0, head.index + head[0].length)}\n\t\t${tag}${html.slice(head.index + head[0].length)}`;
	return `${tag}\n${html}`;
}
