/** The title bar: the mark, the name, and a theme toggle that is an icon. */
import { open, say } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1200, height: 800 });

const bar = await page.evaluate(() => {
	const titlebar = document.querySelector(".titlebar");
	const brand = titlebar.querySelector(".brand");
	const button = titlebar.querySelector(".icon-button");
	return {
		text: titlebar.textContent.trim(),
		brandX: Math.round(brand.getBoundingClientRect().x),
		brandHasMark: Boolean(brand.querySelector("svg")),
		wordmark: titlebar.querySelector(".wordmark").textContent,
		buttonHasIcon: Boolean(button.querySelector("svg")),
		buttonText: button.textContent.trim(),
		fromRightEdge: Math.round(innerWidth - button.getBoundingClientRect().right),
	};
});
say("the bar says only Decks", bar.text === "Decks", JSON.stringify(bar.text));
say("the mark is on the left, before the wordmark", bar.brandHasMark && bar.brandX < 40, `x=${bar.brandX}`);
say("the wordmark reads Decks", bar.wordmark === "Decks");
say("no directory is shown", !bar.text.includes("/"), bar.text);
say("the toggle is an icon, not a word", bar.buttonHasIcon && bar.buttonText === "", `text=${JSON.stringify(bar.buttonText)}`);
say("the toggle sits on the right", bar.fromRightEdge <= 16, `${bar.fromRightEdge}px from the edge`);

const shape = () =>
	page.evaluate(() => ({
		// The sun has a circle in it and the moon does not, which is enough to tell them apart.
		sun: Boolean(document.querySelector(".titlebar .icon-button svg circle")),
		label: document.querySelector(".titlebar .icon-button").getAttribute("aria-label"),
	}));
// `colorScheme` is the attribute the toggle writes immediately. `theme` is a separate
// one, set only once a board has been painted, so waiting on it here hung.
const theme = () => page.evaluate(() => document.documentElement.dataset.colorScheme);

const before = await shape();
const wasDark = await theme();
await page.locator(".titlebar .icon-button").click();
await page.waitForFunction((was) => document.documentElement.dataset.colorScheme !== was, wasDark, { timeout: 5000 });
const after = await shape();
say("clicking it switches the theme", (await theme()) !== wasDark, `${wasDark} -> ${await theme()}`);
say("…and the icon changes with it", before.sun !== after.sun, `sun: ${before.sun} -> ${after.sun}`);
say("…and the label says what it will do", before.label !== after.label, `${before.label} -> ${after.label}`);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
