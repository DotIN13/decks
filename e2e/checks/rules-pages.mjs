/**
 * The rules, per device: pages and pictures (`packages/canvas/src/device/rules.json`), on a desk, an
 * iPad Mini and an iPhone 13 in turn.
 *
 * At or above the live zoom no more items are awake than the system's budget allows, besides the one
 * selected; below it none are; and the picture sizes a card can have are the table's.
 */
import { rest, say } from "../harness.mjs";
import { FORMS, openForm, rule, sleep, until } from "../rules-kit.mjs";

const only = process.env.DECKS_RULES_FORMS?.split(",");
for (const f of FORMS.filter((one) => !only || only.includes(one.form))) {
	const t = await openForm(f, { edit: false });
	const tag = (s) => `${f.form}: ${s}`;
	// Fit by the editor itself: the Fit button is under a phone's dock.
	await t.canvas.evaluate(() => globalThis.__decksFrameHandle.fit());
	await rest(t.page);
	const budget = rule("awake", f.form, f.os);
	const most = budget.live.card + budget.live.app + budget.live.document + 1;
	const live = rule("live.zoom", f.form, f.os);
	const cam = await t.camera();
	await t.look({ x: cam.x, y: cam.y }, Math.max(live + 0.2, 0.7));
	const awake = await until(() => t.canvas.evaluate(() => globalThis.__decksAwake?.()), 4000);
	say(tag(`above the live zoom at most ${most} items are awake`), !!awake && awake.live.length <= most, `${awake?.live?.length} awake`);
	await t.look({ x: cam.x, y: cam.y }, live * 0.6);
	await sleep(800);
	const asleep = await t.canvas.evaluate(() => globalThis.__decksAwake?.());
	say(tag(`below ${Math.round(live * 100)}% none is`), !!asleep && asleep.live.length === 0, `${asleep?.live?.length} awake`);
	const read = await t.read();
	say(tag("the picture ladders are the table's"), JSON.stringify(read?.rules?.pictures) === JSON.stringify(rule("pictures", f.form, f.os)));
	say(tag("no errors on the page"), t.errors.length === 0, t.errors.slice(0, 2).join(" | "));
	await t.close();
}
