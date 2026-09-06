/**
 * Four runtimes, and the two surfaces that have to know about all of them.
 *
 * A Decks agent used to be pi or Claude. It can now be opencode or antigravity as well —
 * both of them somebody else's program, reached through that program's own SDK — and the
 * browser's half of that is small but exact: a **mark** per runtime, told apart at 14px in
 * a list, and a **new-agent menu** that offers every one of them rather than the two that
 * happened to exist when it was written.
 *
 * The socket is driven directly, for the reason `agents-tab.mjs` drives it: four agents on
 * four runtimes is a state that would otherwise need four installs and four sign-ins, and
 * what is under test is the drawing rather than the runtimes.
 */
import { open, openAgents, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 980 });

await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2000);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const chat = (id, name, kind, extra = {}) => ({
	id,
	name,
	kind,
	state: "idle",
	lastAt: Date.now(),
	unread: 0,
	contextCount: 0,
	capabilities: { modes: [] },
	commands: [],
	...extra,
});

await feed({
	type: "agents",
	defaultKind: "opencode",
	focused: "a1",
	chats: [
		chat("a1", "Ada", "claude"),
		chat("a2", "Pim", "pi"),
		chat("a3", "Otto", "opencode"),
		chat("a4", "Grav", "antigravity", { state: "streaming" }),
	],
});
await settle(page, 500);

try {
	// --- the rows name their runtime -----------------------------------------------------

	await openAgents(page);
	// The *set*, not the order: the list is sorted by who needs attention (`agent-order.ts`),
	// so the streaming one comes second whatever order the server sent them in.
	const named = await page.evaluate(() => [...document.querySelectorAll(".popover .kind")].map((el) => (el.textContent ?? "").trim()));
	say("every chat says which runtime it is on", [...named].sort().join(" ") === "antigravity claude opencode pi", JSON.stringify(named));

	// --- the new-agent menu offers all four ----------------------------------------------

	/*
	 * The runtime is behind the pill's own toggle, because it is not a setting on a new
	 * agent — a live session cannot swap the process behind it — so opening it is the
	 * question "which one", asked once.
	 */
	await page.locator('.popover button[aria-label^="Runtime for a new agent"]').click();
	await settle(page, 300);

	const offered = await page.evaluate(() =>
		[...document.querySelectorAll(".popover [role='menuitem']")]
			.map((row) => (row.textContent ?? "").trim())
			.filter((text) => text.startsWith("New ") && text.endsWith(" agent") && text !== "New agent"),
	);
	say("the menu offers every runtime, not the two it was written with", offered.length === 4, JSON.stringify(offered));
	for (const kind of ["claude", "pi", "opencode", "antigravity"]) {
		say(`…including ${kind}`, offered.some((text) => text.includes(kind)), JSON.stringify(offered));
	}

	// --- and each has a mark of its own ---------------------------------------------------

	const marks = await page.evaluate(() =>
		[...document.querySelectorAll(".popover svg[data-agent]")].map((el) => ({
			agent: el.dataset.agent,
			// The drawing itself: how many paths and how long each is. Two runtimes sharing a
			// mark would show up here as identical geometry.
			paths: [...el.querySelectorAll("path")].map((path) => (path.getAttribute("d") ?? "").length).join(","),
			box: Math.round(el.getBoundingClientRect().width),
		})),
	);
	const kinds = [...new Set(marks.map((mark) => mark.agent))].sort();
	say("every runtime draws a mark", kinds.join(" ") === "antigravity claude opencode pi", JSON.stringify(kinds));

	const shapes = new Map(marks.map((mark) => [mark.agent, mark.paths]));
	say("…and no two of them are the same drawing", new Set(shapes.values()).size === shapes.size, JSON.stringify([...shapes]));

	const sizes = [...new Set(marks.map((mark) => mark.box))];
	say("…all drawn at one size, whatever the drawing", sizes.length === 1, JSON.stringify(sizes));

	// Two more rows must not have squeezed the list flat.
	const rows = await page.evaluate(() =>
		[...document.querySelectorAll(".popover [role='menuitem']")]
			.filter((row) => (row.textContent ?? "").trim().startsWith("New "))
			.map((row) => Math.round(row.getBoundingClientRect().height)),
	);
	say("…each a full row high", rows.length >= 5 && rows.every((height) => height >= 26), JSON.stringify(rows));

	// --- creating one ----------------------------------------------------------------------

	await page.evaluate(() => {
		window.__sent = [];
		const send = window.__ws.send.bind(window.__ws);
		window.__ws.send = (data) => {
			window.__sent.push(String(data));
			return send(data);
		};
	});
	await page.locator(".popover [role='menuitem']").filter({ hasText: "New antigravity agent" }).first().click();
	await settle(page, 400);
	const asked = await page.evaluate(() => (window.__sent ?? []).map((line) => JSON.parse(line)).find((message) => message.type === "agent.create"));
	say("picking a runtime creates an agent on it", asked?.kind === "antigravity", JSON.stringify(asked));

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
