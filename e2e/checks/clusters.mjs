/**
 * The two top clusters, which is what the title bar became.
 *
 * There is no `.titlebar` any more: a canvas app should not spend a strip of every window
 * on a logo, and its seven buttons went where they belonged. This check is the record of
 * where — because "the header is gone" is easy to assert and useless, while "the tools are
 * in the pill and the conversation is in the corner" is the thing that would break.
 *
 * The clusters are addressed by `data-inset="top"` rather than by class, and that is
 * deliberate: the attribute is load-bearing — `lib/insets.ts` measures what carries it, and
 * the camera frames boards into what is left — so a cluster that lost it would break the
 * camera silently. Asserting on it here means the selector and the behaviour cannot drift
 * apart.
 */
import { open, say } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 900 });
try {
	say("no title bar", (await page.locator(".titlebar").count()) === 0);
	say("no zoombar", (await page.locator(".zoombar").count()) === 0);

	const clusters = await page.evaluate(() =>
		[...document.querySelectorAll("[data-inset='top']")].map((el) => {
			const r = el.getBoundingClientRect();
			return {
				side: r.x < innerWidth / 2 ? "left" : "right",
				top: Math.round(r.y),
				height: Math.round(r.height),
				buttons: [...el.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.title ?? ""),
				tools: el.querySelectorAll(".palette button").length,
			};
		}),
	);
	say("two clusters, both declaring themselves as top insets", clusters.length === 2, JSON.stringify(clusters.map((c) => c.side)));

	const pill = clusters.find((c) => c.side === "left");
	const corner = clusters.find((c) => c.side === "right");
	say("both are 40px pills at the same height", pill?.height === 40 && corner?.height === 40 && pill?.top === corner?.top, `${pill?.height}/${corner?.height} at ${pill?.top}/${corner?.top}`);

	// The five tools moved *into* the left cluster. They were a free-standing float before,
	// which is why notices had to dodge them; top centre is empty now.
	say("the five tools are inside the left cluster", pill?.tools === 5, String(pill?.tools));
	say("nothing floats at top centre", await page.evaluate(() => {
		const at = document.elementFromPoint(innerWidth / 2, 32);
		return at === null || at.closest("[data-inset='top']") === null;
	}));

	// One button, and it is the panel's only handle — proximity is gone.
	say("the left cluster opens the boards panel", pill?.buttons.some((label) => /board/i.test(label)), JSON.stringify(pill?.buttons));
	say("the right cluster holds the zoom, the conversation and the overflow",
		corner?.buttons.some((l) => /^Zoom/.test(l)) && corner?.buttons.some((l) => /conversation/i.test(l)) && corner?.buttons.includes("More"),
		JSON.stringify(corner?.buttons));

	// The three secondary controls are menu rows at every width, rather than three more
	// buttons in a corner that already has three.
	await page.locator('.pill button[aria-label="More"]').click();
	await page.waitForSelector(".popover", { timeout: 4000 });
	/*
	 * The *visible* rows. Two more live in this menu on a phone — a new board and clearing
	 * the canvas, which leave the corner's line under 520px — and `allTextContents` reads
	 * them whether they are displayed or not, which is the same trap that had this suite
	 * counting five tools on a screen showing none.
	 */
	const rows = await page.evaluate(() =>
		[...document.querySelectorAll(".popover [data-row]")]
			.filter((row) => row.offsetParent !== null)
			.map((row) => row.querySelector(".lb")?.textContent?.trim() ?? ""),
	);
	say(
		"the overflow holds the cheat sheet, the settings and the theme",
		rows.length === 3 && /canvas/i.test(rows[0]) && /settings/i.test(rows[1]) && /light|dark/i.test(rows[2]),
		rows.join(" | "),
	);
	await page.keyboard.press("Escape");

	/*
	 * Nothing here is touch-only. The panel toggle used to be, on the argument that a cursor
	 * summoned the panel from the left edge and a second way to do a working thing is
	 * clutter. Proximity went, so these buttons are the only handles either surface has —
	 * and being the only handle, they are drawn for everyone.
	 */
	const hidden = await page.evaluate(() =>
		[...document.querySelectorAll("[data-inset='top'] .touch-only")].map((el) => getComputedStyle(el).display),
	);
	say("no touch-only controls in either cluster", hidden.length === 0, hidden.join(","));

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
