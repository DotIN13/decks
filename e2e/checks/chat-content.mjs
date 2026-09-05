/**
 * What a card can hold without breaking the column.
 *
 * Two things a reply contains that have no natural width or height of their own. A **table**
 * is as wide as its widest row wants to be, and a chat column is 360px; a **thinking** block
 * is as long as the model felt like being, and it is a disclosure inside a card that is
 * itself inside a scroller. Both used to be unbounded — one was not rendered at all, and the
 * other grew until the reply it belonged to was off the bottom of the screen.
 *
 * So the assertions are geometric rather than about markup: the card is never wider than the
 * column, and the disclosure is never taller than a third of the window.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();
try {
	await page.addInitScript(() => {
		const Real = window.WebSocket;
		window.WebSocket = class extends Real {
			constructor(...args) {
				super(...args);
				window.__ws = this;
			}
		};
	});
	await page.reload({ waitUntil: "load" });
	await settle(page, 2500);

	const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));

	await feed({
		type: "agents",
		defaultKind: "pi",
		focused: "A",
		chats: [{ id: "A", name: "Ada", kind: "claude", state: "idle", lastAt: Date.now(), unread: 0, contextCount: 0, capabilities: { modes: [] }, commands: [] }],
	});

	const table = [
		"Here is the comparison:",
		"",
		"| Option | What it costs | When it is the right answer |",
		"| :--- | ---: | :---: |",
		"| Keep the symlink | one `rename` | switching between accounts already signed in |",
		"| Copy the credentials | a refresh token that goes stale in the copy nobody reads | never, on this evidence |",
		"| Ask every time | a dialog in front of every turn | when there is no default worth having |",
		"",
		"That is the whole table.",
	].join("\n");
	const thinking = Array.from({ length: 120 }, (_, i) => `Line ${i} of reasoning that nobody asked to read in full.`).join("\n");

	await feed({ type: "chat.item", agentId: "A", item: { id: "u1", kind: "user", text: "Compare the three", at: Date.now() - 4000 } });
	await feed({ type: "chat.item", agentId: "A", item: { id: "a1", kind: "assistant", text: table, thinking, at: Date.now(), streaming: false } });
	await settle(page, 300);
	await page.evaluate(() => {
		const button = [...document.querySelectorAll(".pill button")].find((candidate) => /conversation/i.test(candidate.getAttribute("aria-label") ?? ""));
		button?.click();
	});
	await settle(page, 700);

	// --- the table renders, and stays in its box ----------------------------------------

	const drawn = await page.evaluate(() => {
		const table = document.querySelector(".stream-card .md table");
		if (!table) return { table: false };
		const head = [...(table.querySelector("thead tr")?.children ?? [])].map((th) => th.textContent.trim());
		const rows = [...table.querySelectorAll("tbody tr")].map((row) => [...row.children].map((td) => td.textContent.trim()));
		return {
			table: true,
			head,
			rows: rows.length,
			first: rows[0] ?? [],
			align: [...(table.querySelector("thead tr")?.children ?? [])].map((th) => getComputedStyle(th).textAlign),
			code: table.querySelectorAll("code").length,
			/*
			 * The card sets `word-break: break-word` for prose and it inherits into the cells,
			 * where it is the legacy alias for `overflow-wrap: anywhere` — which lets a column
			 * be narrower than its longest word. It read "credential" over "s".
			 */
			wordBreak: getComputedStyle(table.querySelector("td")).wordBreak,
		};
	});
	say("a markdown table becomes a table", drawn.table && drawn.head.length === 3, JSON.stringify(drawn.head));
	say("…with every row", drawn.rows === 3, `${drawn.rows} rows`);
	say("…the alignment the divider asked for", JSON.stringify(drawn.align) === JSON.stringify(["left", "right", "center"]), JSON.stringify(drawn.align));
	say("…and inline markup inside a cell", drawn.code >= 1, `${drawn.code} code spans`);
	say("…with the longest word as a column's floor, not a place to break", drawn.wordBreak === "normal", drawn.wordBreak);

	const box = await page.evaluate(() => {
		const roll = document.querySelector(".stream-roll");
		const card = document.querySelector(".stream-card");
		const wrap = document.querySelector(".stream-card .md-table");
		const table = wrap?.querySelector("table");
		return {
			roll: Math.round(roll.clientWidth),
			card: Math.round(card.getBoundingClientRect().width),
			wrap: Math.round(wrap.clientWidth),
			scrollWidth: Math.round(wrap.scrollWidth),
			overflow: getComputedStyle(wrap).overflowX,
			tableWidth: Math.round(table.getBoundingClientRect().width),
			// "Keep the symlink" is 16 characters: one line unless the column was squeezed.
			rowLines: Math.round(table.querySelector("tbody td").getBoundingClientRect().height / parseFloat(getComputedStyle(table).lineHeight)),
			// The document must not have grown a horizontal scrollbar either.
			pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		};
	});
	say("the card is no wider than the column", box.card <= box.roll, `card ${box.card}px, column ${box.roll}px`);
	/*
	 * The table keeps the width it wants and you scroll to the rest, rather than being
	 * squeezed into the column. Squeezing "fits" — as four words stacked one per line in each
	 * of three columns, which is a table you cannot read a row of, and a comparison is read
	 * across.
	 */
	say("…and the table keeps the width it wants", box.scrollWidth > box.wrap + 8, `${box.scrollWidth}px of table in a ${box.wrap}px box`);
	say("…so a short cell keeps its row", box.rowLines === 1, `${box.rowLines} lines in the first cell`);
	say("…the table's own box is what is clipped", box.wrap <= box.card && box.overflow === "auto", `${box.wrap}px, overflow-x ${box.overflow}`);
	say("…and nothing pushed the page sideways", box.pageOverflow <= 0, `${box.pageOverflow}px`);

	/*
	 * And one that genuinely cannot fit, which is the case the box exists for: six columns,
	 * one of them holding something with nowhere to break.
	 */
	const wide = ["| a | b | c | d | e | f |", "| --- | --- | --- | --- | --- | --- |", `| ${"x".repeat(40)} | two | three | four | five | six |`].join("\n");
	await feed({ type: "chat.item", agentId: "A", item: { id: "u2", kind: "user", text: "And a wide one", at: Date.now() - 1000 } });
	await feed({ type: "chat.item", agentId: "A", item: { id: "a2", kind: "assistant", text: wide, at: Date.now(), streaming: false } });
	await settle(page, 400);
	const widest = await page.evaluate(() => {
		const roll = document.querySelector(".stream-roll");
		const wrap = [...document.querySelectorAll(".stream-card .md-table")].at(-1);
		const card = wrap.closest(".stream-card");
		return {
			roll: Math.round(roll.clientWidth),
			card: Math.round(card.getBoundingClientRect().width),
			wrap: Math.round(wrap.clientWidth),
			content: Math.round(wrap.scrollWidth),
			pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		};
	});
	say("a table too wide for the column scrolls in its box", widest.content > widest.wrap + 8, `${widest.content}px of content in ${widest.wrap}px`);
	say("…and the card it is in does not grow to meet it", widest.card <= widest.roll, `card ${widest.card}px, column ${widest.roll}px`);
	say("…nor does the page", widest.pageOverflow <= 0, `${widest.pageOverflow}px`);

	// --- thinking is a disclosure, not a second transcript --------------------------------

	const collapsed = await page.evaluate(() => document.querySelectorAll(".stream-thinking > .body").length);
	say("thinking is collapsed to begin with", collapsed === 0);

	await page.locator(".stream-thinking > button").first().click();
	await settle(page, 300);
	const opened = await page.evaluate(() => {
		const body = document.querySelector(".stream-thinking > .body");
		const roll = document.querySelector(".stream-roll");
		return {
			height: Math.round(body.clientHeight),
			content: Math.round(body.scrollHeight),
			overflow: getComputedStyle(body).overflowY,
			window: window.innerHeight,
			cardsFit: Math.round(document.querySelector(".stream-card").getBoundingClientRect().height) < roll.clientHeight,
		};
	});
	say("…and opened it is capped rather than as long as the model felt", opened.height <= 340, `${opened.height}px of ${opened.content}px`);
	say("…with the rest reachable by scrolling it", opened.content > opened.height && opened.overflow === "auto", `overflow-y ${opened.overflow}`);
	say("…so the card it is in still fits the column", opened.cardsFit);

	say("no console errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
