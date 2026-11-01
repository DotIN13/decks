/**
 * The rules, per device: press, tap and hold (`packages/canvas/src/device/rules.json`), on a desk, an
 * iPad Mini and an iPhone 13 in turn.
 *
 * The frame reads the column of its form; a press that moves less than its pointer's slop does not
 * move what it pressed, and one that moves further does; two taps on bare canvas make a note; a hold on
 * bare canvas on touch starts a marquee that selects what it is dragged over; hover outlines only on a
 * desk. Needs no model: the items go in over the wire.
 */
import { say } from "../harness.mjs";
import { call, FORMS, itemBox, notes, openForm, ROOM, rule, sleep, until } from "../rules-kit.mjs";

const only = process.env.DECKS_RULES_FORMS?.split(",");
for (const f of FORMS.filter((one) => !only || only.includes(one.form))) {
	const t = await openForm(f);
	const tag = (s) => `${f.form}: ${s}`;
	const touch = f.form !== "desk";

	// The column: the frame says which form it is and reads that form's rows.
	const got = await t.read();
	say(tag(`the frame reads the ${f.form} column of the rules`), got?.profile?.form === f.form && got?.profile?.os === f.os, JSON.stringify(got?.profile));
	const column = { holdOnBare: "hold.on-bare", handleSize: "handle.size-px", handleReach: "handle.reach-px", secondTapOnItem: "tap.second-on-item", properties: "properties", pillPlace: "pill.place", coastBy: "coast.by", tools: "tools" };
	const wrong = Object.entries(column).filter(([key, name]) => JSON.stringify(got?.rules?.[key]) !== JSON.stringify(rule(name, f.form, f.os)));
	say(tag("every rule it reads is the table's for its form"), wrong.length === 0, wrong.map(([key]) => `${key}=${JSON.stringify(got?.rules?.[key])}`).join(", "));
	const awake = rule("awake", f.form, f.os);
	say(tag("its live budget is its system's"), JSON.stringify(got?.rules?.awake) === JSON.stringify(awake), JSON.stringify(got?.rules?.awake));

	// press.slop-px: a press that moves less than the slop leaves the item where it was; further, it moves it.
	const slop = rule("press.slop-px", f.form, f.os)[touch ? "touch" : "mouse"];
	await notes(t.canvas, [{ id: "slop", x: 0, y: 0, w: 220, h: 140 }]);
	await t.look({ x: ROOM.x + 110, y: ROOM.y + 70 });
	await t.select(["slop"]);
	const was = await itemBox("slop");
	const mid = await t.middle("slop");
	const pressBy = async (dx) => {
		if (touch) await t.fingers.drag(mid, { x: mid.x + dx, y: mid.y }, { steps: 6 });
		else await t.mouse.drag(mid, { x: mid.x + dx, y: mid.y }, { steps: 6 });
		await sleep(700);
	};
	await pressBy(slop - 2);
	const small = await itemBox("slop");
	say(tag(`a press moved ${slop - 2} px, under the ${slop} px slop, leaves it where it was`), small && was && Math.abs(small.x - was.x) < 0.5, `x ${was?.x} → ${small?.x}`);
	await t.select(["slop"]);
	await pressBy(slop * 5);
	const far = await until(async () => {
		const now = await itemBox("slop");
		return now && Math.abs(now.x - was.x) > slop ? now : undefined;
	}, 4000);
	say(tag(`a press moved ${slop * 5} px carries it`), !!far, `x ${was?.x} → ${far?.x}`);

	// tap.bare-second: two taps on bare canvas, close in time and place, make a note there.
	const before = (await call("canvas.read", [{ depth: 0 }])).value?.items?.length ?? 0;
	// Bare canvas, nothing selected: open canvas well below the item, in the middle of the screen, clear of its pill, the tools and the dock.
	await t.select([]);
	await t.look({ x: ROOM.x + 110, y: ROOM.y + 1200 });
	const bare = await t.screenOf({ x: ROOM.x + 110, y: ROOM.y + 1200 });
	if (touch) {
		// Two taps 160 ms apart, within tap.bare-second-ms (the tap helper waits too long after each).
		for (let i = 0; i < 2; i++) {
			await t.fingers.touch("touchStart", [bare]);
			await sleep(40);
			await t.fingers.touch("touchEnd", []);
			await sleep(120);
		}
	} else await t.mouse.dblclick(bare);
	const made = await until(async () => ((await call("canvas.read", [{ depth: 0 }])).value?.items?.length ?? 0) > before, 5000);
	say(tag("two taps on bare canvas make a note there"), !!made);
	await t.page.keyboard.press("Escape").catch(() => {});
	await sleep(400);

	// hold.on-bare: a hold on bare canvas, then a drag, selects what the drag goes over (touch), or nothing (desk).
	if (rule("hold.on-bare", f.form, f.os) === "marquee") {
		await notes(t.canvas, [{ id: "held-a", x: 0, y: 500, w: 120, h: 90 }, { id: "held-b", x: 200, y: 500, w: 120, h: 90 }]);
		await t.look({ x: ROOM.x + 160, y: ROOM.y + 545 });
		await t.select([]);
		const still = await t.camera();
		const a = await t.screenOf({ x: ROOM.x - 40, y: ROOM.y + 460 });
		const b = await t.screenOf({ x: ROOM.x + 360, y: ROOM.y + 630 });
		await t.fingers.drag(a, b, { wait: rule("hold.ms", f.form, f.os) + 200, steps: 14 });
		await sleep(500);
		const picked = await t.selection();
		say(tag("a hold on bare canvas, then a drag, draws a marquee that selects what it went over"), picked.includes("held-a") && picked.includes("held-b"), JSON.stringify(picked));
		const camera = await t.camera();
		say(tag("and the camera stayed put, the finger being the marquee's"), Math.hypot(camera.x - still.x, camera.y - still.y) < 2, `moved ${Math.round(Math.hypot(camera.x - still.x, camera.y - still.y))}`);
	}

	// hover.outline: a pointer over an item outlines it on a desk; touch has no hover.
	await t.look({ x: ROOM.x + 150, y: ROOM.y + 70 });
	if (rule("hover.outline", f.form, f.os)) {
		await t.select([]);
		const over = await t.middle("slop");
		await t.mouse.move({ x: over.x - 30, y: over.y - 30 });
		await t.mouse.move(over);
		const hovered = await until(() => t.canvas.evaluate(() => globalThis.__decksOverlayRects().hover.length > 0), 3000);
		say(tag("a pointer over an item in edit mode outlines it"), !!hovered);
	} else {
		await t.select([]);
		await t.fingers.tap(await t.middle("slop"));
		const hovered = await t.canvas.evaluate(() => globalThis.__decksOverlayRects().hover.length > 0);
		say(tag("a finger on an item leaves no hover outline"), !hovered);
	}

	say(tag("no errors on the page"), t.errors.length === 0, t.errors.slice(0, 2).join(" | "));
	await t.close();
}
