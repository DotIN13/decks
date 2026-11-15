import { layout, Refused } from "../../protocol/index.ts";
import type * as S from "./shapes.ts";
import { toDeckPath, type Bytes, type Context } from "../kernel/index.ts";
import { compose, factorFor, type Of } from "./compose.ts";
import { cardPath, keep, type Machine } from "./machine.ts";

// canvas.screenshot (rules 7 to 9): a composed page of the drawing and its
// cards, or one card's own page, pictured and written to the deck.

export type ShotArgs = { of?: Of; scale?: number; format?: "png" | "jpeg" | "pdf"; to?: string; scheme?: "light" | "dark"; live?: boolean; canvas?: string };

const decoder = new TextDecoder();
const extOf = (format: string) => (format === "jpeg" ? "jpg" : format);

/** Where a picture is kept: to, else exports/screenshots/<canvas>-<time>.<ext>. */
export function shotPath(canvas: string, format: string, to: string | undefined, now: number): string {
	if (to) return toDeckPath(to);
	const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
	return toDeckPath(`exports/screenshots/${canvas.replace(/[^\w-]+/g, "-")}-${stamp}.${extOf(format)}`);
}

const isCard = (of: Of): of is string => typeof of === "string" && /\/cards\//.test(of);

async function drawingText(ctx: Context, canvas: string): Promise<string> {
	try {
		return decoder.decode(await ctx.deck.read(toDeckPath(`${layout.canvasFolder(canvas)}/canvas.pen`)));
	} catch {
		throw new Refused("not_found", `The canvas ${canvas} has no drawing to picture.`, "canvas.list");
	}
}

export type Taken = { bytes: Bytes; size: S.Size; box?: S.Box };

/** A PNG's size from its header, else the box's. */
function sizeOf(bytes: Bytes, box: S.Box | undefined): S.Size {
	const png = bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50;
	if (png) return { w: Buffer.from(bytes).readUInt32BE(16), h: Buffer.from(bytes).readUInt32BE(20) };
	return box ? { w: Math.round(box.x2 - box.x1), h: Math.round(box.y2 - box.y1) } : { w: 0, h: 0 };
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
	return { bytes: new Uint8Array(Buffer.from(seen.data, "base64")), how: `the person's browser: ${seen.how}` };
}

/** One card's own page at its width on the canvas, or 1000 when it is not there. */
async function cardShot(ctx: Context, m: Machine, card: string, canvas: string, args: ShotArgs): Promise<Taken> {
	const on = ctx.canvas(canvas).read().find((item) => item.type === "card" && item.card === card);
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
export async function canvasShot(ctx: Context, m: Machine, canvas: string, args: ShotArgs): Promise<Taken> {
	const passes: { done(): void }[] = [];
	const cardUrl = (path: string) => {
		const page = m.cardPage(path, canvas);
		passes.push(page);
		return page.url;
	};
	const made = compose(await drawingText(ctx, canvas), canvas, args.of, { cardUrl, ...(args.scale ? { scale: args.scale } : {}), ...(args.scheme ? { scheme: args.scheme } : {}) });
	const tab = await m.browser.page({ width: made.w, height: made.h, scale: made.factor, scheme: args.scheme ?? "light" });
	try {
		await tab.show(made.html);
		const clip = { x: 0, y: 0, width: made.w, height: made.h };
		const bytes = args.format === "pdf" ? await tab.pdf({ width: made.w, height: made.h }) : await tab.screenshot({ type: args.format === "jpeg" ? "jpeg" : "png", clip });
		return { bytes, size: { w: Math.round(made.w * made.factor), h: Math.round(made.h * made.factor) }, box: made.box };
	} finally {
		await tab.close();
		for (const pass of passes) pass.done();
	}
}

/** Take the picture and keep nothing: its bytes, size, box and how it was made. */
export async function take(ctx: Context, m: Machine, args: ShotArgs): Promise<Taken & { canvas: string; how: string; card: boolean }> {
	const canvas = ctx.canvasName(args.canvas);
	const card = isCard(args.of) ? cardPath(args.of) : undefined;
	if (card && args.format !== "pdf") {
		const seen = await seenCard(ctx, card, canvas);
		const on = seen ? ctx.canvas(canvas).read().find((item) => item.type === "card" && item.card === card) : undefined;
		if (seen) return { bytes: seen.bytes, size: sizeOf(seen.bytes, on?.box), ...(on?.box ? { box: on.box } : {}), canvas, card: true, how: seen.how };
	}
	const taken = card ? await cardShot(ctx, m, card, canvas, args) : await canvasShot(ctx, m, canvas, args);
	return { ...taken, canvas, card: !!card, how: card ? "chromium: the card's page" : "chromium: composed from the drawing's file" };
}

/** Take the picture, keep it in the deck, answer where and how big. */
export async function screenshot(ctx: Context, m: Machine, args: ShotArgs, now = Date.now()): Promise<S.Screenshot> {
	const taken = await take(ctx, m, args);
	const { canvas, card } = taken;
	const file = await keep(ctx, shotPath(canvas, args.format ?? "png", args.to, now), taken.bytes);
	if (card && !taken.how.startsWith("the person")) ctx.note("Only the card, from its file as the server loads it: the drawing round it is not in this picture, and nothing the person did on the page is.");
	if (args.live === false) ctx.note("Every picture here is the browser's; the engine's native tool is not used yet.");
	return { file, size: taken.size, ...(taken.box ? { box: taken.box } : {}), how: taken.how };
}
