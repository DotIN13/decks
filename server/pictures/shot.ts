import { layout, Refused } from "../../protocol/index.ts";
import type * as S from "./shapes.ts";
import { toDeckPath, type Bytes, type Context, type Item } from "../kernel/index.ts";
import { compose, factorFor, type Composed, type Of } from "./compose.ts";
import { drawNatively } from "./native-shot.ts";
import { cardPath, cardPicture } from "./picture.ts";
import type { PictureTools } from "./tools.ts";
import type { Writer } from "./marks.ts";

// canvas.screenshot (rules 7 to 9): a composed page of the drawing and its
// cards, or one card's own page, pictured and written to the deck.

export type ShotArgs = { of?: Of; scale?: number; format?: "png" | "jpeg" | "pdf"; to?: string; scheme?: "light" | "dark"; live?: boolean; canvas?: string };
export type Taken = { bytes: Bytes; size: S.Size; box?: S.Box; how?: string };

// Keeping the picture in the deck.
/** Take the picture, keep it in the deck, answer where and how big. */
export async function screenshot(ctx: Context, m: PictureTools, args: ShotArgs, now = Date.now()): Promise<S.Screenshot> {
	const taken = await take(ctx, m, args);
	const { canvas, card } = taken;
	const file = await keep(ctx, shotPath(canvas, args.format ?? "png", args.to, now), taken.bytes);
	if (card && !taken.live) ctx.note("Only the card, from its file as the server loads it: the drawing round it is not in this picture, and nothing the person did on the page is.");
	return { file, size: taken.size, ...(taken.box ? { box: taken.box } : {}), how: taken.how };
}

const extOf = (format: string) => (format === "jpeg" ? "jpg" : format);

/** Where a picture is kept: to, else exports/screenshots/<canvas>-<time>.<ext>. */
export function shotPath(canvas: string, format: string, to: string | undefined, now: number): string {
	if (to) return toDeckPath(to);
	const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
	return toDeckPath(`exports/screenshots/${canvas.replace(/[^\w-]+/g, "-")}-${stamp}.${extOf(format)}`);
}

/** Writes bytes to a deck path as the caller, answering the path. */
export async function keep(ctx: Context, path: string, bytes: Bytes): Promise<string> {
	const at = toDeckPath(path);
	await ctx.deck.write(at, bytes, ctx.caller);
	return at;
}

// Taking it: a card as a screen has it, a card's own page, or the composed drawing.
/** Take the picture and keep nothing: its bytes, size, box and how it was made. */
export async function take(ctx: Context, m: PictureTools, args: ShotArgs): Promise<Taken & { canvas: string; how: string; card: boolean; live?: boolean }> {
	const canvas = ctx.canvasName(args.canvas);
	// A card's PDF is the card on its canvas with paper round it, as today; its picture its own page.
	const card = isCard(args.of) && args.format !== "pdf" ? cardPath(args.of) : undefined;
	if (card) {
		const seen = await seenCard(ctx, card, canvas);
		const on = seen ? placedOn(ctx, canvas, card) : undefined;
		if (seen) return { bytes: seen.bytes, size: sizeOf(seen.bytes, on?.box), ...(on?.box ? { box: on.box } : {}), canvas, card: true, live: true, how: seen.how };
	}
	const taken = card ? await cardShot(ctx, m, card, canvas, args) : await canvasShot(ctx, m, canvas, args);
	return { ...taken, canvas, card: !!card, how: taken.how ?? (card ? "chromium: the card's page" : "chromium: composed from the drawing's file") };
}

const isCard = (of: Of): of is string => typeof of === "string" && /\/cards\//.test(of);

/** The card's item on the canvas, when it is there. */
function placedOn(ctx: Context, canvas: string, card: string): Item | undefined {
	return ctx.canvas(canvas).read().find((item) => item.type === "card" && item.card === card);
}

type Seen = { how: string; data: string; mime: string };

const SEEN_MS = 4_000;

/** The card as a screen showing it has it now (view.screenshot), or undefined when none can say. */
export async function seenCard(ctx: Context, card: string, canvas: string): Promise<{ bytes: Bytes; how: string } | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<undefined>((done) => (timer = setTimeout(() => done(undefined), SEEN_MS)));
	const asked = ctx.call<Seen>("view.screenshot", { card, canvas }).catch(() => undefined);
	const seen = await Promise.race([asked, late]).finally(() => clearTimeout(timer));
	if (!seen || (seen.how !== "canvas" && seen.how !== "snapshot") || typeof seen.data !== "string") return undefined;
	return { bytes: new Uint8Array(Buffer.from(seen.data, "base64")), how: seen.how };
}

/** A PNG's size from its header, else the box's. */
function sizeOf(bytes: Bytes, box: S.Box | undefined): S.Size {
	const png = bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50;
	if (png) return { w: Buffer.from(bytes).readUInt32BE(16), h: Buffer.from(bytes).readUInt32BE(20) };
	return box ? { w: Math.round(box.x2 - box.x1), h: Math.round(box.y2 - box.y1) } : { w: 0, h: 0 };
}

/** One card's own page at its width on the canvas, or 1000 when it is not there. */
async function cardShot(ctx: Context, m: PictureTools, card: string, canvas: string, args: ShotArgs): Promise<Taken> {
	const on = placedOn(ctx, canvas, card);
	const width = on?.box ? Math.round(on.box.x2 - on.box.x1) : 1000;
	const tall = on?.box ? Math.round(on.box.y2 - on.box.y1) : 800;
	const factor = factorFor(width, tall, args.scale);
	const page = m.cardPage(card, canvas);
	const tab = await m.browser.page({ width, height: tall, scale: factor, scheme: args.scheme ?? "light" });
	try {
		await tab.goto(page.url);
		const clip = { x: 0, y: 0, width, height: tall };
		const bytes = args.format === "pdf" ? await tab.pdf({ width, height: tall }) : await tab.screenshot({ type: args.format === "jpeg" ? "jpeg" : "png", clip });
		return { bytes, size: { w: Math.round(width * factor), h: Math.round(tall * factor) }, ...(on?.box ? { box: on.box } : {}) };
	} finally {
		await tab.close();
		page.done();
	}
}

/** The drawing and its cards, composed in one page. */
export async function canvasShot(ctx: Context, m: PictureTools, canvas: string, args: ShotArgs): Promise<Taken> {
	const passes: { done(): void }[] = [];
	const urls: string[] = [];
	const cardUrl = (path: string) => {
		const page = m.cardPage(path, canvas);
		passes.push(page);
		urls.push(page.url);
		return page.url;
	};
	const writer = await writerOf(ctx, canvas);
	const text = await drawingText(ctx, canvas);
	const made = compose(text, canvas, args.of, { cardUrl, ...(writer ? { writer } : {}), ...(args.scale ? { scale: args.scale } : {}), ...(args.scheme ? { scheme: args.scheme } : {}) });
	const natively = await tryNatively(ctx, m, canvas, args, { text, made, writer });
	if (natively) {
		for (const pass of passes) pass.done();
		return natively;
	}
	const tab = await m.browser.page({ width: made.w, height: made.h, scale: made.factor, scheme: args.scheme ?? "light" });
	try {
		// The cards' pages load their stylesheets, imports and fonts from the server: a card pass goes with them.
		const first = urls[0] ? new URL(urls[0]) : undefined;
		const pass = first?.searchParams.get("pass");
		if (first && pass) await tab.authorize(first.origin, pass);
		await tab.show(made.html);
		const clip = { x: 0, y: 0, width: made.w, height: made.h };
		const bytes = args.format === "pdf" ? await tab.pdf({ width: made.w, height: made.h }) : await tab.screenshot({ type: args.format === "jpeg" ? "jpeg" : "png", clip });
		return { bytes, size: { w: Math.round(made.w * made.factor), h: Math.round(made.h * made.factor) }, box: made.box };
	} finally {
		await tab.close();
		for (const pass of passes) pass.done();
	}
}

/** The composed box drawn by the engine's native tool; undefined, with a note, when the browser must. */
async function tryNatively(ctx: Context, m: PictureTools, canvas: string, args: ShotArgs, drawing: { text: string; made: Composed; writer: Writer | undefined }): Promise<Taken | undefined> {
	const native = !args.live && args.format !== "pdf" ? m.native?.() : undefined;
	if (!native) return undefined;
	const { text, made, writer } = drawing;
	const scheme = args.scheme ?? "light";
	const cardPictureOf = (card: string, px: number) => cardPicture(ctx, m, card, px, scheme, true);
	const drawn = await drawNatively(ctx, native, { canvas, text, box: made.box, factor: made.factor, scheme, format: args.format === "jpeg" ? "jpeg" : "png", ...(writer ? { writer } : {}), cardPicture: cardPictureOf });
	if ("bytes" in drawn) return { bytes: drawn.bytes, size: { w: Math.round(made.w * made.factor), h: Math.round(made.h * made.factor) }, box: made.box, how: "native" };
	ctx.note(`Drawn in the browser: ${drawn.why}.`);
	return undefined;
}

// Reading the drawing.
/** The agent that last wrote the drawing, as its placeholder frames are marked; none for the person. */
async function writerOf(ctx: Context, canvas: string): Promise<Writer | undefined> {
	const by = (await ctx.deck.revisions?.(toDeckPath(`${layout.canvasFolder(canvas)}/canvas.pen`)).catch(() => []))?.at(-1)?.by;
	if (!by || by === "person" || by === "disk") return undefined;
	const agent = await ctx.call<{ name?: string; color?: string }>("agent.get", { agent: by }).catch(() => undefined);
	return agent?.color ? { color: agent.color, ...(agent.name ? { name: agent.name } : {}) } : undefined;
}

const decoder = new TextDecoder();

async function drawingText(ctx: Context, canvas: string): Promise<string> {
	try {
		return decoder.decode(await ctx.deck.read(toDeckPath(`${layout.canvasFolder(canvas)}/canvas.pen`)));
	} catch {
		throw new Refused("not_found", `The canvas ${canvas} has no drawing to picture.`, "canvas.list");
	}
}

