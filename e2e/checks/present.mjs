/**
 * Fullscreen, for every kind of board — and the frame it is drawn in.
 *
 * This was decks only. The gate was `format === "slides"` in three places, and the reason
 * fullscreen existed for exactly one format was that nobody had looked at what `Present.tsx`
 * actually needs: an overlay and a second frame of the same board URL. Neither is
 * slide-specific.
 *
 * What differs per format is **how big the frame is** and **who owns the keyboard**, so both
 * are asserted here — and both are asserted on boards of every format, because the fixture
 * before this check had component boards and nothing else, which is exactly how a
 * slides-only gate sat in the app unnoticed.
 *
 * The keyboard half is the one worth being careful about. A deck's overlay takes the focus,
 * because an iframe that has it receives the keystrokes itself and nothing would page. A
 * document is the other way round: it has its own scroll position, so the arrows have to
 * reach *it* — and Escape then has to work from inside a board's document, which it can only
 * do because the overlay listens there too (same origin) rather than only on this window.
 */
import { WEB, deckState, editMode, open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1440, height: 900 });

const formats = await page.evaluate(async () => {
	const deck = await (await fetch("/api/deck")).json();
	return deck.deck.boards.map((board) => ({ path: board.path, format: board.format, live: board.live ?? null }));
});
const pick = (format) => formats.find((board) => board.format === format)?.path;

/** Press the board's own fullscreen button — the affordance, not a keyboard route. */
const present = (path) =>
	page.evaluate((wanted) => {
		const node = document.querySelector(`.board-node[data-path="${wanted}"]`);
		const button = node?.querySelector(".chrome .present-open");
		if (!button) return false;
		button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
		button.click();
		return true;
	}, path);

const overlay = () =>
	page.evaluate(() => {
		const el = document.querySelector(".present");
		if (!el) return null;
		const frame = el.querySelector(".present-frame");
		const box = frame.getBoundingClientRect();
		return {
			format: el.dataset.format,
			bar: (el.querySelector(".present-bar")?.textContent ?? "").trim(),
			frame: { w: Math.round(box.width), h: Math.round(box.height) },
			pointer: getComputedStyle(frame).pointerEvents,
			overflow: getComputedStyle(el).overflow,
			focused: document.activeElement?.className ?? document.activeElement?.tagName,
			window: { w: innerWidth, h: innerHeight },
		};
	});

const leave = async () => {
	await page.keyboard.press("Escape");
	await settle(page, 300);
	return page.evaluate(() => Boolean(document.querySelector(".present")));
};

/*
 * 1. The button is on every board that can be shown, and says which thing it does.
 *
 * A **live** board is the exception and it is the point of the rule rather than an oversight:
 * a mirror draws itself from what the app posts into it, so a second frame of it is the same
 * view twice — and its bar is narrow enough that the extra button lands where its title is.
 */
const buttons = await page.evaluate(() =>
	[...document.querySelectorAll(".board-node")].map((node) => ({
		path: node.dataset.path,
		label: node.querySelector(".chrome .present-open")?.getAttribute("aria-label") ?? null,
	})),
);
const live = formats.filter((board) => board.live);
const plain = formats.filter((board) => !board.live);
const labelOf = (board) => buttons.find((button) => button.path === board.path)?.label ?? null;
const formatsWithButtons = new Set(plain.map((board) => board.format));
say(
	"every board that can be shown has a fullscreen button, whatever its format",
	plain.length > 0 && plain.every((board) => labelOf(board) !== null) && formatsWithButtons.size >= 3,
	`${plain.length} boards, formats ${[...formatsWithButtons].join("/")}`,
);
say(
	"…and a live board offers none, because there is nothing to fill a window with",
	live.length > 0 && live.every((board) => labelOf(board) === null),
	`${live.length} live board(s): ${live.map((board) => `${board.path} (${board.live})`).join(", ")}`,
);
/*
 * 2. And every board that can be shown has an address of its own to open.
 *
 * The address matters as much as the affordance: it is the board's own URL with **no
 * `?rev=`**, so a tab opened now shows the board as it is rather than as it was when the
 * canvas last loaded it — and what arrives there is browse-only, which is asserted by
 * loading it rather than by reading the attribute and hoping.
 */
const tabs = await page.evaluate(() =>
	[...document.querySelectorAll(".board-node")].map((node) => ({
		path: node.dataset.path,
		href: node.querySelector(".chrome .open-tab")?.getAttribute("href") ?? null,
	})),
);
const tabOf = (board) => tabs.find((tab) => tab.path === board.path)?.href ?? null;
say(
	"every board that can be shown has an address of its own",
	plain.length > 0 && plain.every((board) => tabOf(board)?.startsWith("/api/board/")),
	plain.map((board) => tabOf(board)).join(" "),
);
say(
	"…with no revision in it, so a tab shows the board as it is",
	plain.every((board) => tabOf(board) !== null && !tabOf(board).includes("rev=")),
	plain.map((board) => tabOf(board)).join(" "),
);
say(
	"…and a live board has none, because a bare tab has nothing to feed it",
	live.length > 0 && live.every((board) => tabOf(board) === null),
	live.map((board) => `${board.path} (${board.live})`).join(", "),
);

/*
 * Load one, in a tab of its own. No canvas, no camera, no editor — and the board still
 * renders, which is the whole promise of "every board is already served standalone".
 */
const standalone = await page.context().newPage();
const complaints = [];
standalone.on("pageerror", (error) => complaints.push(error.message));
await standalone.goto(new URL(tabOf(plain[0]), WEB).href, { waitUntil: "load" });
await standalone.waitForFunction(() => window.__boardReady === true, null, { timeout: 15000 }).catch(() => {});
const alone = await standalone.evaluate(() => ({
	ready: window.__boardReady === true,
	canvas: document.querySelectorAll(".board-node").length,
	components: document.querySelectorAll("[data-id]").length,
}));
await standalone.close();
say(
	"…and that address is the board on its own: no canvas, and it renders",
	alone.ready && alone.canvas === 0 && alone.components > 0 && complaints.length === 0,
	JSON.stringify({ ...alone, complaints: complaints.join(" | ") }),
);

const deckButton = buttons.find((button) => button.path === pick("slides"));
const flowButton = buttons.find((button) => button.path === pick("flow"));
const componentButton = buttons.find((button) => button.path === pick("component"));
say("…a deck's is named Present", deckButton?.label?.startsWith("Present") === true, String(deckButton?.label));
say(
	"…and a document's and a component board's are named Fullscreen, without the word on the bar",
	flowButton?.label?.startsWith("Fullscreen") === true && componentButton?.label?.startsWith("Fullscreen") === true,
	`${flowButton?.label} / ${componentButton?.label}`,
);
const words = await page.evaluate(() =>
	[...document.querySelectorAll(".board-node .chrome .present-open")].map((button) => button.textContent?.trim() ?? ""),
);
say(
	"…so only a deck's bar carries the word, and the narrow ones are a glyph",
	words.filter((word) => word.length > 0).length === 1,
	JSON.stringify(words),
);

/*
 * 3. A deck: the slide's own shape, letterboxed, and the keys page it.
 */
await present(pick("slides"));
await settle(page, 700);
const deckOverlay = await overlay();
say(
	"a deck opens fullscreen at the slide's own 16:9",
	deckOverlay?.format === "slides" && Math.abs(deckOverlay.frame.w / deckOverlay.frame.h - 16 / 9) < 0.02,
	JSON.stringify(deckOverlay?.frame),
);
say("…with the overlay holding the keyboard, so the arrows are the deck's", deckOverlay?.focused === "present", String(deckOverlay?.focused));
say("…and the slide itself taking no pointer events", deckOverlay?.pointer === "none", String(deckOverlay?.pointer));
say("…counted from the deck it is showing", /1\s*\/\s*3/.test(deckOverlay?.bar ?? ""), JSON.stringify(deckOverlay?.bar));
await page.keyboard.press("ArrowRight");
await settle(page, 250);
const paged = await overlay();
say("…and ArrowRight pages it", /2\s*\/\s*3/.test(paged?.bar ?? ""), JSON.stringify(paged?.bar));
say("leaving with Escape", (await leave()) === false, "overlay gone");
const afterDeck = await overlay();
say("…and the canvas keeps its own frames behind it", afterDeck === null, "canvas back");

/*
 * 4. A flow document: the window, scrolling inside it, and the document's own keys.
 */
await present(pick("flow"));
await settle(page, 700);
const flowOverlay = await overlay();
say(
	"a document opens fullscreen filling the window",
	flowOverlay?.format === "flow" && flowOverlay.frame.w === flowOverlay.window.w && flowOverlay.frame.h === flowOverlay.window.h,
	`${JSON.stringify(flowOverlay?.frame)} in ${JSON.stringify(flowOverlay?.window)}`,
);
say("…and takes the pointer events, because it is a document", flowOverlay?.pointer !== "none", String(flowOverlay?.pointer));
say("…with the keyboard inside it, so the arrows scroll rather than page", flowOverlay?.focused === "present-frame", String(flowOverlay?.focused));
say("…and Escape still gets out, from inside the frame", (await leave()) === false, "overlay gone");

/*
 * 5. A component board: its own rectangle, at 1:1, and its own buttons reachable.
 */
await present(pick("component"));
await settle(page, 700);
const componentOverlay = await overlay();
const declared = formats.find((board) => board.format === "component");
const size = await page.evaluate(async (path) => {
	const deck = await (await fetch("/api/deck")).json();
	const board = deck.deck.boards.find((candidate) => candidate.path === path);
	return { w: board?.w ?? 0, h: board?.h ?? 0 };
}, declared.path);
say(
	"a component board opens at its own size, not the window's",
	componentOverlay?.format === "component" && Math.abs(componentOverlay.frame.w - size.w) <= 2,
	`${JSON.stringify(componentOverlay?.frame)} for a board of ${size.w}×${size.h}`,
);
say("…centred in a scrollable overlay, so a tall board can be scrolled", componentOverlay?.overflow === "auto", String(componentOverlay?.overflow));
say("…and clickable, which is the one place below half zoom it is", componentOverlay?.pointer !== "none", String(componentOverlay?.pointer));
say("…and Escape leaves it too", (await leave()) === false, "overlay gone");

/*
 * 6. A file inside a box: the inspector's two controls, and where the range goes.
 *
 * An embed has no address of its own — the board has one, the box inside it does not — so the
 * affordance is app-side, in the inspector, next to the page range. The page range is the part
 * that has to be right rather than merely present: the board draws pages 1–2 of the fixture's
 * PDF, and a fullscreen or a tab that opened page 1 of *all* of it would be showing a
 * different document than the box is.
 */
// Editing on, because the inspector is the editor's properties panel: in browse mode a click
// selects nothing and there is no panel to look at (`e2e/checks/modes.mjs`).
await editMode(page);
await page.locator('.board-node[data-path="boards/sources.html"] .chrome').dblclick();
await settle(page, 900);
for (let i = 0; i < 6; i++) {
	const level = await page.evaluate(() =>
		Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")),
	);
	if (level >= 70) break;
	await page.keyboard.press("Control+Equal");
	await settle(page, 250);
}
// The PDF's box, through the editor's own selection: a click on it is what the inspector reads.
const paper = await page.frameLocator('.board-node[data-path="boards/sources.html"] iframe').locator('[data-id="paper"]').boundingBox();
await page.mouse.click(paper.x + 20, paper.y + 20);
await settle(page, 500);

const controls = await page.evaluate(() => {
	const panel = document.querySelector(".inspector");
	const tab = panel?.querySelector(".embed-acts .embed-tab");
	const full = panel?.querySelector(".embed-acts [data-act='fullscreen']");
	return { panel: Boolean(panel), tab: tab?.getAttribute("href") ?? null, full: Boolean(full) };
});
say("a selected box holding a file offers both ways to show it", controls.full && controls.tab !== null, JSON.stringify(controls));
say(
	"…and the tab's address is the file, at the first page of the box's range",
	(controls.tab ?? "").includes("sample.pdf") && (controls.tab ?? "").endsWith("#page=1"),
	String(controls.tab),
);

await page.locator(".inspector .embed-acts [data-act='fullscreen']").click();
await settle(page, 900);
const embedded = await page.evaluate(() => {
	const el = document.querySelector(".present.embed-present");
	const frame = el?.querySelector(".present-frame");
	return {
		family: el?.dataset.family ?? null,
		src: frame?.getAttribute("src") ?? null,
		size: frame ? { w: Math.round(frame.getBoundingClientRect().width), h: Math.round(frame.getBoundingClientRect().height) } : null,
		window: { w: innerWidth, h: innerHeight },
	};
});
say("fullscreen shows the file itself, in its own family's frame", embedded.family === "pdf" && (embedded.src ?? "").includes("sample.pdf"), JSON.stringify(embedded));
say("…filling the window rather than a board's rectangle", embedded.size?.w === embedded.window.w && embedded.size?.h === embedded.window.h, JSON.stringify(embedded.size));
/*
 * The address, and the reason it is the address rather than a picture: headless Chromium has
 * no PDF viewer plugin, so a frame on a `.pdf` here is a blank page whatever is in it. What
 * can be asserted is the two things that decide *which* document you get — the file, and the
 * page the box's range starts at. (The board draws its own pages as pictures through
 * `pdf.js`; the overlay hands the file to the browser's viewer, which is a better viewer than
 * we have — search, zoom, print — and takes the range as a fragment.)
 */
say(
	"…and told which page the box starts at, so it is the same document",
	(embedded.src ?? "").endsWith("#page=1"),
	String(embedded.src),
);
say("leaving the embed with Escape", (await leave()) === false, "overlay gone");

/*
 * 7. And the two families whose treatment differs from the PDF's, driven by the key rather
 *    than the button — `f` is "the selection if it is an embed, the board otherwise", so this
 *    is also the assertion that the key and the panel agree.
 */
const pickBox = async (id) => {
	await page.locator('.board-node[data-path="boards/sources.html"] .chrome').dblclick();
	await settle(page, 700);
	const box = await page.frameLocator('.board-node[data-path="boards/sources.html"] iframe').locator(`[data-id="${id}"]`).boundingBox();
	await page.mouse.click(box.x + 16, box.y + 16);
	await settle(page, 400);
};
const embeddedNow = () =>
	page.evaluate(() => {
		const el = document.querySelector(".present.embed-present");
		return {
			family: el?.dataset.family ?? null,
			image: Boolean(el?.querySelector(".present-image")),
			doc: el?.querySelector(".present-doc")?.textContent?.slice(0, 40) ?? null,
			headings: el?.querySelectorAll(".present-doc h1, .present-doc h2, .present-doc p").length ?? 0,
		};
	});

await pickBox("notes");
await page.keyboard.press("f");
await settle(page, 800);
const markdown = await embeddedNow();
say(
	"f on a selected markdown box renders the document rather than showing its text",
	markdown.family === "md" && markdown.headings > 0,
	JSON.stringify(markdown),
);
await leave();

await pickBox("sketch");
await page.keyboard.press("f");
await settle(page, 700);
const image = await embeddedNow();
say("…and an image is the image, fitted", image.family === "image" && image.image, JSON.stringify(image));
await leave();

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
