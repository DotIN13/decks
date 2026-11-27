/**
 * The canvases on a phone: a drawer, not a panel (`apps/web/src/canvases/CanvasManager.tsx`).
 *
 * The canvas manager is a panel with a margin round it and a wall of pictures, which a phone has no
 * room for: it stood off the screen's right edge and one picture filled it. On a phone it comes up
 * from the foot of the screen at the screen's width, the canvases a list of rows, each with its
 * rename and delete at its end. Here: the bar's title opens it as a drawer that fits the screen;
 * several canvases show at once, none past an edge; naming a new canvas fits; a short drag of the
 * head leaves it up and a long one puts it away, as a press above it does; and a row opens its canvas.
 * `LOOK_SHOTS=<dir>` keeps pictures of it.
 */
import { mkdirSync } from "node:fs";
import { API, asPerson, open, resetStage, rest, say, settle } from "../harness.mjs";

const OUT = process.env.LOOK_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve(test()).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
for (const title of ["Launch plan for the spring", "Notes", "Pricing page", "Onboarding", "Research", "Roadmap"]) await call("canvas.create", [title]);

for (const scheme of OUT ? ["light", "dark"] : ["light"]) {
	const { browser, page, errors } = await open({ device: "iPhone 14 Pro", scheme });
	await rest(page, { start: 0 });
	const view = page.viewportSize();
	const shot = async (name) => {
		if (!OUT) return;
		// With the canvas's own picture in its row, which the server takes on first ask.
		await until(() => page.locator(".canvas-shot[data-loaded]").count());
		await settle(page, 450);
		await page.screenshot({ path: `${OUT}/${scheme}-${name}.png` });
	};
	const chip = page.locator(".v3-topbar .v3-canvas-chip");
	const manager = page.locator(".canvas-manager");
	const box = page.locator(".canvas-manager .canvas-box");
	/** Up and still: the drawer open, its slide over. */
	const up = () =>
		until(async () => {
			const at = await box.boundingBox();
			return at && Math.abs(at.y + at.height - view.height) < 1.5 ? at : undefined;
		});
	const gone = () => until(async () => (await manager.count()) === 0);

	// --- the title opens the canvases as a drawer that fits the screen ---------------------------------------
	await chip.tap();
	const at = await up();
	say(`${scheme}: the bar's title opens the canvases as a drawer`, (await manager.getAttribute("data-form")) === "drawer" && !!at, JSON.stringify(at));
	say("…the screen's width, standing on its foot, with the canvas showing above it", !!at && Math.abs(at.x) < 0.5 && Math.abs(at.width - view.width) < 0.5 && at.y > 56 && at.y < view.height * 0.4, JSON.stringify([at, view]));
	const rows = await page.evaluate(() => {
		const wall = document.querySelector(".canvas-wall").getBoundingClientRect();
		return [...document.querySelectorAll(".canvas-card")].map((card) => {
			const row = card.getBoundingClientRect();
			const parts = [...card.querySelectorAll(".canvas-open, .canvas-foot, .canvas-acts, .canvas-acts .canvas-icon")].map((one) => one.getBoundingClientRect());
			const label = card.querySelector(".row-label");
			return { h: row.height, inView: row.top >= wall.top - 1 && row.bottom <= wall.bottom + 1, inside: parts.every((part) => part.left >= -0.5 && part.right <= innerWidth + 0.5 && part.width > 1), name: label?.textContent ?? "", cut: !!label && (label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1) };
		});
	});
	say("the canvases are a list: every row short, and at least six on the screen at once", rows.length >= 7 && rows.every((row) => row.h <= 80) && rows.filter((row) => row.inView).length >= 6, JSON.stringify(rows.map((row) => [Math.round(row.h), row.inView])));
	say("…each with its picture, name, rename and delete inside the screen, and its name whole", rows.every((row) => row.inside && !row.cut), JSON.stringify(rows.filter((row) => !row.inside || row.cut)));
	const targets = await page.evaluate(() => [...document.querySelectorAll(".canvas-acts .canvas-icon, .canvas-new, .canvas-sort > button")].map((one) => Math.round(one.getBoundingClientRect().height)));
	say("…and every control at least 34 px tall, for a finger", targets.length > 0 && targets.every((height) => height >= 34), JSON.stringify(targets));
	// One centre line a row: the picture, the name over its line, the faces of who is on it, rename and delete.
	const lines = await page.evaluate(() =>
		[...document.querySelectorAll(".canvas-card")].map((card) => {
			const mid = (one) => {
				const box = one.getBoundingClientRect();
				return box.top + box.height / 2;
			};
			const row = mid(card);
			const label = card.querySelector(".row-label").getBoundingClientRect();
			const meta = card.querySelector(".canvas-meta").getBoundingClientRect();
			const marks = [...card.querySelectorAll(".canvas-open, .canvas-faces .agent-face, .canvas-acts .canvas-icon")].map((one) => Math.round((mid(one) - row) * 10) / 10);
			return { marks, words: Math.round(((label.top + meta.bottom) / 2 - row) * 10) / 10, left: Math.round((label.left - meta.left) * 10) / 10, faces: card.querySelectorAll(".canvas-faces .agent-face").length };
		}),
	);
	say("each row keeps one centre line: its picture, its words, the faces on it, rename and delete", lines.some((line) => line.faces > 0) && lines.every((line) => line.marks.every((off) => Math.abs(off) <= 1) && Math.abs(line.words) <= 1.5 && Math.abs(line.left) <= 0.5), JSON.stringify(lines));
	const edges = await page.evaluate(() => {
		const left = (selector) => [...document.querySelectorAll(selector)].map((one) => Math.round(one.getBoundingClientRect().left * 10) / 10);
		const right = (selector) => [...document.querySelectorAll(selector)].map((one) => Math.round(one.getBoundingClientRect().right * 10) / 10);
		return { pictures: left(".canvas-open"), names: left(".row-label"), bins: right(".canvas-acts"), head: [left(".canvas-title")[0], left(".canvas-search")[0]], headRight: [right(".canvas-title-row .canvas-new")[0], right(".canvas-sort")[0]] };
	});
	const same = (list) => list.every((one) => Math.abs(one - list[0]) <= 0.5);
	say("…and the rows share their edges: pictures, names, and rename and delete each in a column, under the head's own edges", same(edges.pictures) && same(edges.names) && same(edges.bins) && same([...edges.head, edges.pictures[0]]) && same(edges.headRight), JSON.stringify(edges));
	await shot("canvases-drawer");

	// --- renaming and deleting keep the row's line ---------------------------------------------------------------
	const second = page.locator(".canvas-card").nth(1);
	const state = () =>
		second.evaluate((card) => {
			const mid = (one) => {
				const box = one.getBoundingClientRect();
				return box.top + box.height / 2;
			};
			const parts = [...card.querySelectorAll(".canvas-rename, .canvas-acts > *")];
			return { h: Math.round(card.getBoundingClientRect().height), off: parts.map((one) => Math.round((mid(one) - mid(card.querySelector(".canvas-open"))) * 10) / 10), inside: parts.every((one) => one.getBoundingClientRect().left >= 0 && one.getBoundingClientRect().right <= innerWidth), words: !!card.querySelector(".canvas-rename") || card.querySelector(".canvas-foot").getBoundingClientRect().width };
		});
	const rowHeight = (await state()).h;
	await second.locator('[title="Delete"]').tap();
	await until(() => second.locator(".canvas-confirm").count());
	const asking = await state();
	say("Delete asks in the row: its two buttons inside the screen, on the row's line, the row no taller, its name still showing", asking.inside && asking.off.every((off) => Math.abs(off) <= 1) && asking.h === rowHeight && asking.words > 60, JSON.stringify(asking));
	await shot("canvases-drawer-delete");
	await second.locator('[aria-label="Keep it"]').tap();
	await second.locator('[title="Rename"]').tap();
	await until(() => second.locator(".canvas-rename").count());
	const naming = await state();
	const renameAt = await second.evaluate((card) => {
		const field = card.querySelector(".canvas-rename").getBoundingClientRect();
		const meta = card.querySelector(".canvas-meta").getBoundingClientRect();
		const acts = card.querySelector(".canvas-acts").getBoundingClientRect();
		const style = getComputedStyle(card.querySelector(".canvas-rename"));
		return { letters: Math.round(field.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) - meta.left), gap: Math.round(acts.left - field.right), over: field.bottom > meta.top + 1 };
	});
	say("Rename edits the name where it is: its letters where they were, the field clear of rename and delete and over its line, the row no taller", naming.inside && naming.h === rowHeight && Math.abs(renameAt.letters) <= 1 && renameAt.gap >= 4 && !renameAt.over, JSON.stringify([naming, renameAt, rowHeight]));
	await shot("canvases-drawer-rename");
	await page.keyboard.press("Escape");

	// --- naming a new canvas fits the drawer's head -----------------------------------------------------------
	await page.locator(".canvas-new").first().tap();
	const form = await until(() => page.locator(".canvas-new-form").boundingBox());
	const field = await page.evaluate(() => {
		const one = document.querySelector(".canvas-new-field");
		const submit = document.querySelector(".canvas-new-form .canvas-new").getBoundingClientRect();
		return { size: parseFloat(getComputedStyle(one).fontSize), w: one.getBoundingClientRect().width, right: submit.right };
	});
	say("New canvas names it in the head, the field wide and its Create inside the screen", !!form && form.x >= 0 && form.x + form.width <= view.width + 0.5 && field.w > 150 && field.right <= view.width, JSON.stringify([form, field]));
	say("…in type iOS does not zoom the page for", field.size >= 16, String(field.size));
	await shot("canvases-drawer-new");
	await page.locator('.canvas-new-form [aria-label="Cancel"]').tap();

	// --- the head is the handle ----------------------------------------------------------------------------------
	const title = await page.locator(".canvas-title").boundingBox();
	const drag = async (by) => {
		const x = title.x + title.width / 2;
		const y = title.y + title.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		for (let step = 1; step <= 8; step++) {
			await page.mouse.move(x, y + (by * step) / 8);
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		const mid = await box.boundingBox();
		await page.mouse.up();
		return mid;
	};
	const pulled = await drag(60);
	say("its head dragged down a little follows the finger", !!pulled && Math.abs(pulled.y - (at.y + 60)) < 3, JSON.stringify([pulled?.y, at.y]));
	say("…and let go, it goes back up", !!(await up()) && (await manager.getAttribute("data-open")) === "true");
	await drag(190);
	say("dragged well down and let go, it is put away", (await gone()) === true);

	// --- a press above it puts it away; a row opens its canvas ------------------------------------------------
	await chip.tap();
	await up();
	// On the bar's title, which is under the drawer's shade: the press is the shade's, and does not go on to open the canvases again.
	const over = await chip.boundingBox();
	await page.touchscreen.tap(over.x + over.width / 2, over.y + over.height / 2);
	say("a press above it puts it away, and it stays away", (await gone()) === true && (await settle(page, 500), (await manager.count()) === 0));
	await chip.tap();
	await up();
	await page.locator('.canvas-card:has-text("Pricing page") .canvas-open').tap();
	say("a row opens its canvas, and the drawer goes", (await gone()) === true && (await until(async () => (await chip.innerText()).includes("Pricing page"))) === true, await chip.innerText());

	say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
	await browser.close();
}
