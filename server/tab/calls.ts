import { calls, Refused, type Handled } from "../../protocol/index.ts";
import { handleAll, toDeckPath, type Context } from "../kernel/types.ts";
import { pngSize, type Target } from "./driver.ts";
import { labelOf, type TabHub } from "./hub.ts";

// One short handler per tab call. Each action answers the tab as it now is.

const { tab } = calls;
const TAB = { status: tab.status, pair: tab.pair, open: tab.open, read: tab.read, screenshot: tab.screenshot, fill: tab.fill, select: tab.select, click: tab.click, press: tab.press, submit: tab.submit, answer: tab.answer, stop: tab.stop };

const shotPath = (at: number) => toDeckPath(`exports/tab/${new Date(at).toISOString().replace(/[:.]/g, "-")}.png`);

function need(text: string | undefined, why: string): string {
	if (!text?.trim()) throw new Refused("invalid", why, "tab.read");
	return text.trim();
}

/** The tab's calls, against one hub. */
export function tabCalls(hub: TabHub): Handled<Context>[] {
	const after = async () => {
		await hub.refresh();
		return hub.state();
	};
	return handleAll(TAB, {
		status: async () => hub.state(),
		pair: async (_ctx, { fresh }) => ({
			code: await hub.pair(fresh === true),
			expires: 0,
			note: "Paste the Decks address and this code into the Decks extension's popup, then share a tab. It dials /api/web/relay.",
		}),
		open: async (_ctx, { url }) => {
			await hub.driver().open(need(url, "tab.open needs an address."));
			return after();
		},
		read: async () => hub.driver().read(),
		screenshot: async (ctx, { full }) => {
			const png = await hub.driver().screenshot(full === true);
			const path = shotPath(Date.now());
			await ctx.deck.write(path, png, ctx.caller);
			return { file: path, size: pngSize(png), how: "tab" };
		},
		fill: async (_ctx, { field, text }) => {
			await hub.driver().act("fill", field as Target, { text: String(text ?? "") });
			return after();
		},
		select: async (_ctx, { field, option }) => {
			await hub.driver().act("select", field as Target, { option });
			return after();
		},
		click: async (_ctx, { target }) => {
			await hub.driver().act("click", target as Target);
			return after();
		},
		press: async (_ctx, { key }) => {
			await hub.driver().press(need(key, "tab.press needs a key, such as Enter or Tab."));
			return after();
		},
		submit: async (_ctx, { target, ask }) => {
			const driver = hub.driver();
			const run = async () => {
				if (target !== undefined) await driver.act("click", target as Target);
				else await driver.press("Enter");
				await hub.refresh();
			};
			if (ask === false) {
				await run();
				return hub.state();
			}
			const what = target === undefined ? "press Enter to submit" : `press "${labelOf(target as Target)}"`;
			hub.ask(`The agent wants to ${what} on ${hub.state().title || hub.state().url || "the shared tab"}.`, run);
			return hub.state();
		},
		answer: async (_ctx, { id, ok }) => {
			await hub.answer(id, ok);
			return hub.state();
		},
		stop: async () => {
			hub.end();
			return hub.state();
		},
	});
}
