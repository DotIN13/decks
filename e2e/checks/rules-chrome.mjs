/**
 * The rules, per device: the chrome (`packages/canvas/src/device/rules.json`), on a desk, an iPad Mini
 * and an iPhone 13 in turn.
 *
 * The tools are a column on a desk and a tablet and a row on a phone; the properties of a selection
 * are a floating panel open with the selection on a desk, a popover by the selection on a tablet and a
 * sheet from the bottom on a phone, both opened from the pill; the zoom bar is off a phone.
 */
import { say } from "../harness.mjs";
import { FORMS, notes, openForm, ROOM, rule, sleep, until } from "../rules-kit.mjs";

const only = process.env.DECKS_RULES_FORMS?.split(",");
for (const f of FORMS.filter((one) => !only || only.includes(one.form))) {
	const t = await openForm(f);
	const tag = (s) => `${f.form}: ${s}`;
	const tools = rule("tools", f.form, f.os);
	const row = await t.canvas.evaluate(() => !!document.querySelector(".frame-tool-row"));
	say(tag(`the tools are a ${tools}`), row === (tools === "row"));
	const zoomBar = await t.canvas.evaluate(() => {
		const bar = document.querySelector(".v3-zoom");
		if (!bar) return false;
		const r = bar.getBoundingClientRect();
		const style = getComputedStyle(bar);
		return style.display !== "none" && style.visibility !== "hidden" && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
	});
	say(tag(rule("zoom-bar", f.form, f.os) ? "the zoom bar shows" : "no zoom bar"), zoomBar === rule("zoom-bar", f.form, f.os));

	await notes(t.canvas, [{ id: "props", x: 0, y: 0, w: 240, h: 150 }]);
	await t.look({ x: ROOM.x + 120, y: ROOM.y + 75 }, 1, { x: t.view.w / 2, y: t.view.h * 0.3 });
	const panel = () => t.canvas.evaluate(() => {
		const el = document.querySelector(".props-panel");
		return el ? { sheet: el.dataset.sheet === "true", popover: el.hasAttribute("data-popover") && el.dataset.popover !== "undefined" } : undefined;
	});
	const opens = rule("properties.opens", f.form, f.os);
	const kind = rule("properties", f.form, f.os);
	if (opens === "with-selection") {
		await t.select(["props"]);
		const p = await until(panel, 3000);
		say(tag("selecting opens the properties as a floating panel"), !!p && !p.sheet && !p.popover, JSON.stringify(p));
	} else {
		await t.fingers.tap(await t.middle("props"));
		await sleep(300);
		const before = await panel();
		say(tag("selecting alone does not open the properties"), !before, JSON.stringify(before));
		const button = t.canvas.locator('button[aria-label="Properties"]').first();
		const box = await button.boundingBox().catch(() => null);
		if (box) await t.fingers.tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
		const p = await until(panel, 3000);
		say(tag(`the pill's Properties opens them as a ${kind}`), !!p && (kind === "sheet" ? p.sheet : p.popover), JSON.stringify(p) + (box ? "" : " (no Properties button on the pill)"));
	}
	say(tag("no errors on the page"), t.errors.length === 0, t.errors.slice(0, 2).join(" | "));
	await t.close();
}
