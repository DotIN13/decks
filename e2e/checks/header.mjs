/**
 * The title bar: the mark, the name, and a theme toggle that is an icon.
 *
 * The toggle is addressed as `.icon-button.theme` rather than as "the first icon button",
 * because it no longer is one: two panel toggles sit before it and they are there only
 * where the pointer cannot hover (`index.css`). That they are *absent* at this width is
 * asserted below — a desktop title bar with three buttons on it would be a regression.
 */
import { open, say } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1200, height: 800 });

const bar = await page.evaluate(() => {
	const titlebar = document.querySelector(".titlebar");
	const brand = titlebar.querySelector(".brand");
	const button = titlebar.querySelector(".icon-button.theme");
	return {
		text: titlebar.textContent.trim(),
		brandX: Math.round(brand.getBoundingClientRect().x),
		brandHasMark: Boolean(brand.querySelector("svg")),
		wordmark: titlebar.querySelector(".wordmark").textContent,
		buttonHasIcon: Boolean(button.querySelector("svg")),
		buttonText: button.textContent.trim(),
		fromRightEdge: Math.round(innerWidth - button.getBoundingClientRect().right),
		// Present in the markup, and not drawn: the panels are reached by hovering here.
		touchOnly: [...titlebar.querySelectorAll(".touch-only")].map((element) => getComputedStyle(element).display),
	};
});
say("the bar says only Decks", bar.text === "Decks", JSON.stringify(bar.text));
say("the mark is on the left, before the wordmark", bar.brandHasMark && bar.brandX < 40, `x=${bar.brandX}`);
say("the wordmark reads Decks", bar.wordmark === "Decks");
say("no directory is shown", !bar.text.includes("/"), bar.text);
say("the toggle is an icon, not a word", bar.buttonHasIcon && bar.buttonText === "", `text=${JSON.stringify(bar.buttonText)}`);
say("the toggle sits on the right", bar.fromRightEdge <= 16, `${bar.fromRightEdge}px from the edge`);
say(
	"the touch-only panel toggles are not drawn where there is a cursor",
	bar.touchOnly.length === 2 && bar.touchOnly.every((display) => display === "none"),
	JSON.stringify(bar.touchOnly),
);

const shape = () =>
	page.evaluate(() => ({
		// The sun has a circle in it and the moon does not, which is enough to tell them apart.
		sun: Boolean(document.querySelector(".titlebar .icon-button.theme svg circle")),
		label: document.querySelector(".titlebar .icon-button.theme").getAttribute("aria-label"),
	}));
// `colorScheme` is the attribute the toggle writes immediately. `theme` is a separate
// one, set only once a board has been painted, so waiting on it here hung.
const theme = () => page.evaluate(() => document.documentElement.dataset.colorScheme);

const before = await shape();
const wasDark = await theme();
await page.locator(".titlebar .icon-button.theme").click();
await page.waitForFunction((was) => document.documentElement.dataset.colorScheme !== was, wasDark, { timeout: 5000 });
const after = await shape();
say("clicking it switches the theme", (await theme()) !== wasDark, `${wasDark} -> ${await theme()}`);
say("…and the icon changes with it", before.sun !== after.sun, `sun: ${before.sun} -> ${after.sun}`);
say("…and the label says what it will do", before.label !== after.label, `${before.label} -> ${after.label}`);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
