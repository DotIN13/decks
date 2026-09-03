/**
 * A user's own edit must not reload the board they are editing (DESIGN §7).
 *
 * The marker is the whole test: it lives on the frame's `contentWindow`, so only a real
 * document replacement loses it. Counting network requests cannot tell a reload from a
 * revalidation, and counting DOM nodes cannot see a same-element navigation.
 */
import { boardPath, changed, open, read, say, write } from "../harness.mjs";

const plan = await boardPath("plan.html");
const original = read(plan);
const selector = '.board-node[data-path="boards/plan.html"] iframe';

const { browser, page, errors } = await open();
try {
	await page.locator('.board-node[data-path="boards/plan.html"] .chrome').first().click();
	await page.keyboard.press("1");
	await page.waitForFunction(() => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")) > 40, null, { timeout: 8000 });

	const plant = () => page.evaluate((s) => { document.querySelector(s).contentWindow.__keep = "alive"; }, selector);
	const alive = () => page.evaluate((s) => document.querySelector(s).contentWindow.__keep ?? null, selector);

	// Positions read out of the file, so "did the edit land" is not a guess. An earlier
	// version of this asserted with `|| true` and passed on a drag that moved nothing.
	const positions = () =>
		page.evaluate(async () => {
			const html = await (await fetch(`/api/board/boards/plan.html?t=${Date.now()}`, { cache: "no-store" })).text();
			const doc = new DOMParser().parseFromString(html, "text/html");
			return [...doc.querySelectorAll("[data-id]")].map((el) => `${el.dataset.id}:${el.style.left || "-"},${el.style.top || "-"}`).join(" ");
		});

	const id = "goal";
	const move = async (dx, dy) => {
		const target = page.frameLocator(selector).locator(`[data-id="${id}"]`);
		const first = await target.boundingBox();
		// Select, then drag: the editor takes the selection on pointerdown and the move on
		// the gesture that follows.
		await page.mouse.move(first.x + first.width / 2, first.y + 12);
		await page.mouse.down();
		await page.mouse.up();
		const box = await target.boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + 12);
		await page.mouse.down();
		for (let i = 1; i <= 8; i++) {
			await page.mouse.move(box.x + box.width / 2 + (dx * i) / 8, box.y + 12 + (dy * i) / 8);
		}
		await page.mouse.up();
	};

	const before = await positions();
	await plant();
	await move(90, 70);
	await changed(plan, original);
	const after = await positions();
	say("the drag actually moved the component in the file", before !== after, before === after ? "positions unchanged" : "positions changed");
	say("moving a component does not reload the board", (await alive()) === "alive");

	// The echo-pair bug only bit from the second message on, and the re-pin bug from the
	// second drag, so once is not enough to trust.
	const wasTwice = read(plan);
	await plant();
	await move(-50, -40);
	await move(40, 30);
	await changed(plan, wasTwice);
	say("repeated moves still do not reload it", (await alive()) === "alive");
	say("the file kept up with the moves", (await positions()) !== after);

	// A foreign write must still come through, or pinning has broken the point of reloading.
	await plant();
	write(plan, read(plan).replace("</body>", '<section class="card" data-id="probe-f" style="left:940px;top:80px"><h3>f</h3></section></body>'));
	await page.waitForFunction(
		(s) => Boolean(document.querySelector(s)?.contentDocument?.querySelector('[data-id="probe-f"]')),
		selector,
		{ timeout: 15000 },
	);
	say("an agent's write still reloads the frame", (await alive()) === null);
	say("…and the agent's change is on screen", (await page.frameLocator(selector).locator('[data-id="probe-f"]').count()) === 1);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	write(plan, original);
	await page.waitForTimeout(600);
	await browser.close();
}
