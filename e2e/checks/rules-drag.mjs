/**
 * The rules, per device: drag, handles and snap (`packages/canvas/src/device/rules.json`), on a desk,
 * an iPad Mini and an iPhone 13 in turn.
 *
 * A selection's handles are the form's (eight squares on a desk, four corner dots on touch, at the
 * table's size); the size label and the arrow anchors show only on a desk; and a drag snaps to its
 * neighbour's edge whatever the pointer, a finger too, with the guide drawn while it is held.
 */
import { say } from "../harness.mjs";
import { FORMS, itemBox, notes, openForm, ROOM, rule, sleep, until } from "../rules-kit.mjs";

const only = process.env.DECKS_RULES_FORMS?.split(",");
for (const f of FORMS.filter((one) => !only || only.includes(one.form))) {
	const t = await openForm(f);
	const tag = (s) => `${f.form}: ${s}`;
	const touch = f.form !== "desk";

	// Handles, as the engine is told to draw them.
	await notes(t.canvas, [{ id: "handles", x: 0, y: 0, w: 240, h: 150 }]);
	await t.look({ x: ROOM.x + 120, y: ROOM.y + 75 });
	await t.select(["handles"]);
	const overlay = await until(async () => {
		const json = await t.canvas.evaluate(() => globalThis.__decksOverlay);
		return json ? JSON.parse(json) : undefined;
	}, 4000);
	const dots = (overlay?.dots ?? []).filter((dot) => dot.kind === "handle" || dot.kind === "handle-round");
	const which = rule("handle.which", f.form, f.os);
	const shape = rule("handle.shape", f.form, f.os);
	say(tag(`a selection has ${which === "eight" ? "eight" : "four corner"} handles`), dots.length === (which === "eight" ? 8 : 4), `${dots.length} drawn`);
	say(tag(`drawn as ${shape === "round" ? "dots" : "squares"} of ${rule("handle.size-px", f.form, f.os)} px`), dots.every((dot) => dot.kind === (shape === "round" ? "handle-round" : "handle") && dot.px === rule("handle.size-px", f.form, f.os)), JSON.stringify(dots[0]));
	const shown = (selector) => t.canvas.evaluate((selector) => [...document.querySelectorAll(selector)].some((el) => getComputedStyle(el).display !== "none"), selector);
	say(tag(rule("handle.size-label", f.form, f.os) ? "the size label shows under it" : "no size label"), (await shown(".pen-size")) === rule("handle.size-label", f.form, f.os));
	const anchors = (overlay?.dots ?? []).filter((dot) => dot.kind === "anchor").length + (await t.canvas.evaluate(() => [...document.querySelectorAll(".pen-anchor")].filter((el) => getComputedStyle(el).display !== "none").length));
	say(tag(rule("arrow.anchors", f.form, f.os) ? "arrow anchors show round it" : "no arrow anchors"), (anchors > 0) === rule("arrow.anchors", f.form, f.os), `${anchors}`);
	// A handle answers a press as far as the table says: the hit zone the overlay gives it.
	const reach = await t.canvas.evaluate(() => {
		const handle = document.querySelector('.pen-handle[data-handle="se"]');
		return handle ? parseFloat(getComputedStyle(handle).getPropertyValue("--hit")) : undefined;
	});
	const want = rule("handle.reach-px", f.form, f.os);
	say(tag(`a handle answers ${want} px across`), reach !== undefined && Math.abs(reach * 2 + rule("handle.size-px", f.form, f.os) - want) <= 4, `hit ${reach}`);

	// snap.by-pointer: a drag that leaves its right edge 3 px short of a neighbour's left edge lands on it.
	await notes(t.canvas, [{ id: "snap-a", x: 0, y: 600, w: 200, h: 120 }, { id: "snap-b", x: 400, y: 600, w: 200, h: 120 }]);
	await t.look({ x: ROOM.x + 300, y: ROOM.y + 660 });
	await t.select(["snap-a"]);
	const from = await t.middle("snap-a");
	const to = { x: from.x + 197, y: from.y };
	const guided = { seen: false };
	if (touch) {
		await t.fingers.touch("touchStart", [from]);
		for (let i = 1; i <= 14; i++) {
			await t.fingers.touch("touchMove", [{ x: from.x + (197 * i) / 14, y: from.y }]);
			await sleep(16);
		}
		await sleep(120);
		guided.seen = await t.canvas.evaluate(() => /"guide"/.test(globalThis.__decksOverlay ?? ""));
		await t.fingers.touch("touchEnd", []);
	} else {
		await t.mouse.move(from);
		await t.page.mouse.down();
		for (let i = 1; i <= 14; i++) await t.mouse.move({ x: from.x + (197 * i) / 14, y: from.y });
		await sleep(120);
		guided.seen = await t.canvas.evaluate(() => /"guide"/.test(globalThis.__decksOverlay ?? ""));
		await t.page.mouse.up();
	}
	const landed = await until(async () => {
		const box = await itemBox("snap-a");
		return box && box.x !== ROOM.x ? box : undefined;
	}, 4000);
	say(tag(`a ${touch ? "finger's" : "mouse's"} drag 3 px short of a neighbour snaps to its edge`), landed && Math.abs(landed.x + landed.w - (ROOM.x + 400)) < 0.6, `right edge ${landed ? landed.x + landed.w - ROOM.x : "?"}, want 400`);
	say(tag("and the guide is drawn while it is held"), guided.seen);

	if (touch) {
		// touch.carry-min-px: a finger on an item it has not selected carries it, and a hold that opened the menu carries it once it moves.
		const drag = async (id, holdMs) => {
			const from = await t.middle(id);
			await t.fingers.touch("touchStart", [from]);
			if (holdMs) await sleep(holdMs);
			for (let i = 1; i <= 10; i++) {
				await t.fingers.touch("touchMove", [{ x: from.x + 12 * i, y: from.y + 6 * i }]);
				await sleep(16);
			}
			await t.fingers.touch("touchEnd", []);
		};
		await notes(t.canvas, [{ id: "free-a", x: 0, y: 1100, w: 200, h: 120 }, { id: "free-b", x: 0, y: 1360, w: 200, h: 120 }]);
		await t.look({ x: ROOM.x + 100, y: ROOM.y + 1290 });
		await t.select([]);
		await drag("free-a", 0);
		const a = await until(async () => { const box = await itemBox("free-a"); return box && box.x !== ROOM.x ? box : undefined; }, 3000);
		say(tag("a finger drag on an item not selected moves it"), !!a && a.x > ROOM.x + 60, `x ${a ? Math.round(a.x - ROOM.x) : "?"}`);
		await t.select([]);
		await drag("free-b", rule("hold.ms", f.form, f.os) + 250);
		const b = await until(async () => { const box = await itemBox("free-b"); return box && box.x !== ROOM.x ? box : undefined; }, 3000);
		say(tag("a hold that opened the menu carries the item once the finger moves"), !!b && b.x > ROOM.x + 60, `x ${b ? Math.round(b.x - ROOM.x) : "?"}`);
		const menu = await t.canvas.evaluate(() => !!document.querySelector(".hold-menu"));
		say(tag("and its menu is closed"), !menu);
	}
	say(tag("no errors on the page"), t.errors.length === 0, t.errors.slice(0, 2).join(" | "));
	await t.close();
}
