/**
 * The title bar: the mark, the name, the conversation, and a theme toggle that is an icon.
 *
 * The theme toggle is addressed as `.icon-button.theme` rather than as "the first icon
 * button", because it is not one: the conversation's button sits before it, and before
 * that the board rail's — which is `.touch-only`, drawn only where the pointer cannot
 * hover (`index.css`), because a cursor summons the rail from the left edge instead.
 *
 * The conversation has no such edge since the transcript sheet went, so its button is
 * drawn at every width. Both facts are asserted below: the rail's toggle absent here, the
 * conversation's present.
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
		// Present in the markup, and not drawn: the rail is reached by hovering here.
		touchOnly: [...titlebar.querySelectorAll(".touch-only")].map((element) => getComputedStyle(element).display),
		chat: (() => {
			const element = titlebar.querySelector('.icon-button[title="The conversation"]');
			return element ? { display: getComputedStyle(element).display, touchOnly: element.classList.contains("touch-only") } : null;
		})(),
	};
});
say("the bar says only Decks", bar.text === "Decks", JSON.stringify(bar.text));
say("the mark is on the left, before the wordmark", bar.brandHasMark && bar.brandX < 40, `x=${bar.brandX}`);
say("the wordmark reads Decks", bar.wordmark === "Decks");
say("no directory is shown", !bar.text.includes("/"), bar.text);
say("the toggle is an icon, not a word", bar.buttonHasIcon && bar.buttonText === "", `text=${JSON.stringify(bar.buttonText)}`);
say("the toggle sits on the right", bar.fromRightEdge <= 16, `${bar.fromRightEdge}px from the edge`);
say(
	"the rail's toggle is the only touch-only one, and is not drawn where there is a cursor",
	bar.touchOnly.length === 1 && bar.touchOnly[0] === "none",
	JSON.stringify(bar.touchOnly),
);
say(
	"the conversation's button is drawn for a cursor too — it has no edge to be summoned from",
	bar.chat !== null && bar.chat.display !== "none" && bar.chat.touchOnly === false,
	JSON.stringify(bar.chat),
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
