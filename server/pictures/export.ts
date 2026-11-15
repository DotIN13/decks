import { parse, PenError, toHtml, type PenNode } from "@decks/pen";
import type * as S from "./shapes.ts";
import { layout, Refused } from "../../protocol/index.ts";
import { toDeckPath, type Context } from "../kernel/index.ts";

// canvas.export (rule 10): pen's page of the items, written to the deck, with
// each card an iframe of its page addressed from where the page is written.

export type ExportArgs = { of: string | string[]; format?: "html" | "tailwind"; to?: string; canvas?: string; frame?: string };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Write the page and answer it as a file. */
export async function exportItems(ctx: Context, args: ExportArgs): Promise<S.File> {
	const canvas = ctx.canvasName(args.canvas);
	const ids = typeof args.of === "string" ? [args.of] : args.of;
	const source = toDeckPath(sourceOf(canvas, args.frame));
	let text: string;
	try {
		text = decoder.decode(await ctx.deck.read(source));
	} catch {
		throw new Refused("not_found", `There is no drawing at ${source}.`, args.frame ? "frame.list" : "canvas.list");
	}
	const page = toDeckPath(args.to ?? `exports/${(ids[0] ?? "page").replace(/[^\w-]+/g, "-")}.html`);
	const html = pageOf(text, ids, { format: args.format ?? "html", canvas, page });
	const rev = await ctx.deck.write(page, encoder.encode(html), ctx.caller);
	return { path: page, size: encoder.encode(html).length, rev: rev.rev, by: rev.by, at: rev.at };
}

/** The drawing's file for a canvas, or for a frame file in its frames/. */
export function sourceOf(canvas: string, frame: string | undefined): string {
	const folder = layout.canvasFolder(canvas);
	if (!frame) return `${folder}/canvas.pen`;
	const name = frame.replace(/^frames\//, "").replace(/\.pen$/, "");
	return `${folder}/frames/${name}.pen`;
}

/** The page's HTML for a drawing's text, the items ids, written at page. */
export function pageOf(text: string, ids: string[], options: { format: "html" | "tailwind"; canvas: string; page: string }): string {
	try {
		return toHtml(parse(text), ids, {
			format: options.format,
			url: (url) => (/^[a-z][\w+.-]*:/i.test(url) || url.startsWith("/") ? url : fromPage(options.page, `${layout.canvasFolder(options.canvas)}/${url}`)),
			board: (node: PenNode) => {
				const written = (node.metadata as { path?: unknown } | undefined)?.path;
				if (typeof written !== "string") return undefined;
				const got = layout.resolveReference(options.canvas, written);
				return "path" in got ? fromPage(options.page, got.path) : undefined;
			},
		});
	} catch (error) {
		if (error instanceof PenError) throw new Refused("invalid", error.message, "item.list");
		throw error;
	}
}

/** A path the page reads, from the folder it is written in. */
export function fromPage(page: string, file: string): string {
	const from = page.split("/").slice(0, -1);
	const to = file.split("/");
	let same = 0;
	while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
	return [...from.slice(same).map(() => ".."), ...to.slice(same)].map(encodeURIComponent).join("/");
}

