import { Refused } from "../../protocol/index.ts";
import type { Context, Item } from "../kernel/index.ts";
import type * as S from "./shapes.ts";
import type { PictureTools } from "./tools.ts";
import { cardPath } from "./picture.ts";
import type { Extents } from "./extent.ts";
import { noteOf, PRESS, READ, type Reading, type Views } from "./reading.ts";

// card.fit (rule 4): the card's page at its width on the canvas, measured,
// its controls pressed, its height written by item.update.

export type Measured = { reading: Reading; views: Views | undefined; errors: string[] };

const STILL_MS = 600;
const LONGEST_MS = 3000;

/** Fit a card on a canvas: answers its placement as it now is, and notes what was read. */
export async function fit(ctx: Context, m: PictureTools, args: { card: string; margin?: number; canvas?: string }, extents?: Extents): Promise<S.Placement> {
	const card = cardPath(args.card);
	const canvas = ctx.canvasName(args.canvas);
	const item = placedCard(ctx, card, canvas);
	const width = Math.round(item.box.x2 - item.box.x1);
	const writtenAt = (await ctx.deck.revisions?.(card))?.at(-1)?.at ?? 0;
	const known = extents?.fresh(card, width, writtenAt);
	if (known) ctx.note("Measured by the canvas frame showing the card.");
	const found = known ? { reading: known, views: undefined, errors: [] } : await measure(m, card, canvas, width);
	const h = Math.ceil(found.reading.h + (args.margin ?? 0));
	const now = await ctx.call<Item>("item.update", { id: item.id, size: { h }, canvas });
	ctx.note(noteOf({ ...found.reading, h }, width, found.views, found.errors));
	const box = now.box ?? { ...item.box, y2: item.box.y1 + h };
	return { card, canvas, box };
}

/** Load a card's page at a width and read it. */
export async function measure(m: PictureTools, card: string, canvas: string, width: number): Promise<Measured> {
	const page = m.cardPage(card, canvas);
	const tab = await m.browser.page({ width, height: 800, scale: 1, scheme: "light" });
	try {
		await tab.goto(page.url);
		await tab.evaluate(`void (document.body.style.width = "${width}px")`);
		const reading = await steady(() => tab.evaluate<Reading>(READ));
		const views = await tab.evaluate<Views>(PRESS).catch(() => undefined);
		return { reading, views, errors: [...tab.errors] };
	} finally {
		await tab.close();
		page.done();
	}
}

/** Read until the height has held for STILL_MS, at most LONGEST_MS: a script may grow the card late. */
export async function steady(read: () => Promise<Reading>, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Reading> {
	let last = await read();
	let still = 0;
	for (let spent = 0; still < STILL_MS && spent < LONGEST_MS; spent += 150) {
		await wait(150);
		const now = await read();
		still = now.h === last.h ? still + 150 : 0;
		last = now;
	}
	return last;
}

/** The card item for a path on a canvas, or a refusal that says how to put it there. */
export function placedCard(ctx: Context, card: string, canvas: string): Item & { id: string; box: { x1: number; y1: number; x2: number; y2: number } } {
	const found = ctx.canvas(canvas).read().find((item) => item.type === "card" && item.card === card);
	if (!found || typeof found.id !== "string" || !found.box) {
		throw new Refused("invalid", `${card} is not on the canvas ${canvas}, so there is no width to fit it at.`, "item.insert");
	}
	return found as Item & { id: string; box: { x1: number; y1: number; x2: number; y2: number } };
}
