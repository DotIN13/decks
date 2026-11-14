import type { Context, Item } from "../kernel/index.ts";
import type * as S from "./shapes.ts";
import { cardPath, placedCard, type Machine } from "./machine.ts";
import { noteOf, PRESS, READ, type Reading, type Views } from "./reading.ts";

// card.fit (rule 4): the card's page at its width on the canvas, measured,
// its controls pressed, its height written by item.update.

export type Measured = { reading: Reading; views: Views | undefined; errors: string[] };

/** Load a card's page at a width and read it. */
export async function measure(m: Machine, card: string, canvas: string, width: number): Promise<Measured> {
	const page = m.cardPage(card, canvas);
	const tab = await m.browser.page({ width, height: 800, scale: 1, scheme: "light" });
	try {
		await tab.goto(page.url);
		await tab.evaluate(`void (document.body.style.width = "${width}px")`);
		const reading = await tab.evaluate<Reading>(READ);
		const views = await tab.evaluate<Views>(PRESS).catch(() => undefined);
		return { reading, views, errors: [...tab.errors] };
	} finally {
		await tab.close();
		page.done();
	}
}

/** Fit a card on a canvas: answers its placement as it now is, and notes what was read. */
export async function fit(ctx: Context, m: Machine, args: { card: string; margin?: number; canvas?: string }): Promise<S.Placement> {
	const card = cardPath(args.card);
	const canvas = ctx.canvasName(args.canvas);
	const item = placedCard(ctx, card, canvas);
	const width = Math.round(item.box.x2 - item.box.x1);
	const found = await measure(m, card, canvas, width);
	const h = Math.ceil(found.reading.h + (args.margin ?? 0));
	const now = await ctx.call<Item>("item.update", { id: item.id, size: { h }, canvas });
	ctx.note(noteOf({ ...found.reading, h }, width, found.views, found.errors));
	const box = now.box ?? { ...item.box, y2: item.box.y1 + h };
	return { card, canvas, box };
}
