/**
 * The rules, per device: the camera (`packages/canvas/src/device/rules.json`), on a desk, an iPad
 * Mini and an iPhone 13 in turn.
 *
 * On touch a flick coasts on after the lift, and the coast is the canvas's own: a pinch begun
 * mid-coast zooms at once. On a desk Ctrl and the wheel zoom about the pointer.
 */
import { say } from "../harness.mjs";
import { FORMS, openForm, ROOM, rule, sleep } from "../rules-kit.mjs";

const only = process.env.DECKS_RULES_FORMS?.split(",");
for (const f of FORMS.filter((one) => !only || only.includes(one.form))) {
	const t = await openForm(f, { edit: false });
	const tag = (s) => `${f.form}: ${s}`;
	await t.look({ x: ROOM.x, y: ROOM.y });
	if (rule("coast.by", f.form, f.os) === "ours") {
		// A flick: 280 px in 70 ms, lifted while still moving.
		const a = { x: t.view.w * 0.7, y: t.view.h * 0.5 };
		await t.fingers.touch("touchStart", [a]);
		for (let i = 1; i <= 7; i++) {
			await t.fingers.touch("touchMove", [{ x: a.x - 40 * i, y: a.y }]);
			await sleep(10);
		}
		await t.fingers.touch("touchEnd", []);
		const atLift = await t.camera();
		await sleep(120);
		const later = await t.camera();
		const coasted = Math.abs(later.x - atLift.x) * later.zoom;
		say(tag("a flick coasts on after the lift"), coasted > 20, `${Math.round(coasted)} px after 120 ms`);
		// A pinch while it coasts: two fingers spread 60 → 180 px.
		const before = later.zoom;
		await t.fingers.pinch({ x: t.view.w / 2, y: t.view.h / 2 }, 30, 90);
		await sleep(400);
		const after = await t.camera();
		say(tag("a pinch begun mid-coast zooms at once"), after.zoom > before * 1.8, `zoom ${before.toFixed(2)} → ${after.zoom.toFixed(2)}`);
		await sleep(600);
		const settled = await t.camera();
		await sleep(300);
		const still = await t.camera();
		say(tag("and the coast it caught is over"), Math.abs(still.x - settled.x) * still.zoom < 1, `${Math.round(Math.abs(still.x - settled.x) * still.zoom)} px`);
	} else {
		// One small Ctrl-wheel step, which Chrome sends for a trackpad pinch: e to the power of 16 / pinch.travel-px.
		const before = (await t.camera()).zoom;
		const box = await t.page.locator("iframe.canvas-frame").first().boundingBox();
		await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await t.page.keyboard.down("Control");
		await t.page.mouse.wheel(0, -16);
		await t.page.keyboard.up("Control");
		await sleep(500);
		const after = (await t.camera()).zoom;
		const want = Math.exp(16 / rule("pinch.travel-px", f.form, f.os));
		say(tag(`a trackpad pinch step of 16 zooms ×${want.toFixed(3)}`), Math.abs(after / before - want) / want < 0.03, `×${(after / before).toFixed(3)}`);
	}
	say(tag("no errors on the page"), t.errors.length === 0, t.errors.slice(0, 2).join(" | "));
	await t.close();
}
