/**
 * The title bar: the mark, the name, the conversation, and a theme toggle that is an icon.
 *
 * The theme toggle is addressed as `.icon-button.theme` rather than as "the first icon
 * button", because it is not one: four surfaces have a button before it — the agents, the
 * boards they are holding, every board in the deck, and the conversation.
 *
 * **Nothing in the bar is `.touch-only` any more**, and that is what is asserted here.
 * The panel toggle used to be, on the argument that a cursor summoned the panel from the
 * left edge and a second way to do a working thing is clutter. Proximity is gone
 * (`lib/panels.ts`), so these buttons are the only handle the panels have — and being the
 * only handle they are drawn for everyone.
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
		touchOnly: [...titlebar.querySelectorAll(".touch-only")].map((element) => getComputedStyle(element).display),
		/** The four surfaces, each with a handle here and nowhere else. */
		surfaces: ["The agents", "Boards this agent is holding", "Every board in the deck", "The conversation"].map((title) => {
			const element = titlebar.querySelector(`.icon-button[title="${title}"]`);
			return element ? { title, display: getComputedStyle(element).display, touchOnly: element.classList.contains("touch-only") } : { title, missing: true };
		}),
	};
});
say("the bar says only Decks", bar.text === "Decks", JSON.stringify(bar.text));
say("the mark is on the left, before the wordmark", bar.brandHasMark && bar.brandX < 40, `x=${bar.brandX}`);
say("the wordmark reads Decks", bar.wordmark === "Decks");
say("no directory is shown", !bar.text.includes("/"), bar.text);
say("the toggle is an icon, not a word", bar.buttonHasIcon && bar.buttonText === "", `text=${JSON.stringify(bar.buttonText)}`);
say("the toggle sits on the right", bar.fromRightEdge <= 16, `${bar.fromRightEdge}px from the edge`);
say("nothing in the bar is hidden from a cursor any more", bar.touchOnly.length === 0, JSON.stringify(bar.touchOnly));
say(
	"all four surfaces have a button, drawn at every width",
	bar.surfaces.every((entry) => !entry.missing && entry.display !== "none" && entry.touchOnly === false),
	JSON.stringify(bar.surfaces),
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
