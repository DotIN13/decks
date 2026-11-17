/**
 * Pictures of the row of tabs in the top bar, for looking at a change to it, not for asserting on:
 * one canvas alone, a few tabs, a tab pointed at, the row folded with its list open and a row of the
 * list pointed at, in light and dark. `LOOK_SHOTS=<dir>` names where they go. Run only when named.
 */
import { mkdirSync } from "node:fs";
import { API, asPerson, card, open, resetStage, rest, say, settle } from "../harness.mjs";

const OUT = process.env.LOOK_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
await call("canvas.create", ["Launch plan"]);
await call("apps.create", ["tracker", { title: "Tracker", starter: "static" }]);
await call("apps.create", ["budget", { title: "Budget", starter: "static" }]);
await call("canvas.create", ["Research notes"]);

const shots = [];
for (const scheme of ["light", "dark"]) {
	for (const width of [1500, 900]) {
		const { browser, page } = await open({ width, height: 700, scheme });
		await rest(page, { start: 0 });
		const bar = { x: 0, y: 0, width, height: 360 };
		const shot = async (name) => {
			await settle(page, 400);
			if (OUT) await page.screenshot({ path: `${OUT}/${scheme}-${width}-${name}.png`, clip: bar });
			shots.push(name);
		};
		await shot("1-alone");
		await call("view.open", ["launch-plan"]);
		await call("view.open", [card("plan")]);
		await call("view.open", ["tracker"]);
		await settle(page, 900);
		await shot("2-tabs");
		const chip = page.locator(".v3-topbar [role='tab']").nth(1);
		if (await chip.count()) {
			await chip.hover();
			await shot("3-tab-hover");
		}
		// More tabs than the bar has room for.
		await call("view.open", ["budget"]);
		await call("view.open", ["research-notes"]);
		await call("view.open", [card("plan")]);
		await settle(page, 900);
		await shot("4-more-than-fit");
		const fold = page.locator(".v3-topbar .tab-fold");
		if (await fold.count()) {
			await fold.click();
			await settle(page, 300);
			await shot("5-list");
			const row = page.locator(".popover .row-act").nth(1);
			if (await row.count()) {
				await row.hover();
				await shot("6-list-row-hover");
				await row.locator(".close").hover();
				await shot("7-list-close-hover");
			}
		}
		await browser.close();
	}
}
say("the pictures were taken", shots.length > 0, String(shots.length));
