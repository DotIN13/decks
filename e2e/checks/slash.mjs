/**
 * The `/` menu: sixty commands, ranked, and a keyboard that does what the hints promise.
 *
 * Two things changed and this file is about both. The **list** used to be seven names
 * written into `claude/backend.ts`; it is now whatever the runtime declares — the CLI's
 * builtins, its skills, the project's own `commands/` — merged under the five Decks
 * interprets itself. And the **menu** used to be a list with no selection in it, under a
 * hint row that said `↑ ↓ to choose` and `Tab to complete`: three keys that did nothing.
 *
 * The socket is driven directly, for the reason `agents-tab.mjs` drives it. What is under
 * test is the browser's half — ranking, highlight, completion — and a real runtime would
 * make the list whatever that machine's Claude install happens to declare, which is not a
 * fixture. The merge itself is unit-tested in `agents/slash.test.ts`.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 900 });

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

/*
 * A list the shape a real one is: the deck's five first, then the runtime's — including a
 * pair whose names are prefixes of each other, which is the case that broke Enter.
 */
const commands = [
	{ name: "login", hint: "Sign in with a subscription or an API account", source: "deck" },
	{ name: "logout", hint: "Sign out of Claude", source: "deck" },
	{ name: "status", hint: "Model, mode and auth state", source: "deck" },
	{ name: "cost", hint: "Open the usage panel", source: "deck", aliases: ["usage", "stats"] },
	{ name: "help", hint: "The commands Decks understands", source: "deck" },
	{ name: "usage-credits", hint: "Credits on this account", source: "runtime" },
	{ name: "compact", hint: "Compress the conversation", arg: "[notes]", source: "runtime" },
	{ name: "doctor", hint: "Check the install", source: "runtime" },
	{ name: "review", hint: "Review the branch", source: "skill" },
	{ name: "board-authoring", hint: "How to write a board", source: "skill" },
	...Array.from({ length: 40 }, (_, index) => ({ name: `extra-${index}`, hint: `Filler ${index}`, source: "runtime" })),
	{ name: "zebra", hint: "Last in the list", source: "prompt" },
];

await feed({
	type: "agents",
	defaultKind: "claude",
	focused: "s1",
	chats: [
		{
			id: "s1",
			name: "Ada",
			kind: "claude",
			state: "idle",
			lastAt: Date.now(),
			unread: 0,
			contextCount: 0,
			capabilities: { modes: [] },
			commands,
		},
	],
});
await settle(page, 400);

const field = page.locator(".dockfield");
const menu = page.locator('[role="listbox"][aria-label="Commands"]');
const rows = () => page.locator('[role="listbox"][aria-label="Commands"] [data-row]');

try {
	// --- the list ---------------------------------------------------------------------

	await field.click();
	await field.type("/");
	await settle(page, 250);
	say("typing / opens the menu", (await menu.count()) === 1);

	/*
	 * Fifty and not fifty-three. The cap is the whole reason an unfiltered menu is usable
	 * at all: two letters reach anything, where a list long enough to hold everything has
	 * a tail nobody scrolls to.
	 */
	const all = await rows().count();
	say("the whole list is offered, capped at fifty", all === 50, `${commands.length} declared, ${all} drawn`);

	const first = await rows().first().innerText();
	say("the deck's own commands lead the list", first.includes("/login"), first.replace(/\n/g, " "));

	const badges = await page.evaluate(() =>
		[...document.querySelectorAll('[role="listbox"][aria-label="Commands"] [data-row]')].slice(0, 8).map((row) => row.lastElementChild?.textContent ?? ""),
	);
	say("a row says who answers it", badges[0] === "decks" && badges.includes("claude"), JSON.stringify(badges));

	// The menu must not grow past its cap, whatever the list length: 50 rows of 30px is
	// 1500px of a 900px window.
	const box = await menu.boundingBox();
	say("a fifty-row menu is capped and scrolls", box.height <= 300, `${Math.round(box.height)}px`);
	const scrolls = await page.evaluate(() => {
		const el = document.querySelector('[role="listbox"][aria-label="Commands"]');
		return el.scrollHeight > el.clientHeight + 1;
	});
	say("…rather than clipping what it cannot show", scrolls);

	// --- the selection ----------------------------------------------------------------

	const active = () =>
		page.evaluate(() => {
			const list = [...document.querySelectorAll('[role="listbox"][aria-label="Commands"] [data-row]')];
			const at = list.findIndex((row) => row.dataset.current === "true");
			return { at, text: (list[at]?.textContent ?? "").trim() };
		});

	const opened = await active();
	say("the first row starts highlighted", opened.at === 0, JSON.stringify(opened));

	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	const moved = await active();
	say("the arrows move the highlight", moved.at === 2, JSON.stringify(moved));

	// One press past the top is the bottom: a fifty-row list is one ArrowUp from its end.
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowUp");
	const wrapped = await active();
	say("…and wrap at the ends", wrapped.at === 49, JSON.stringify(wrapped));

	// Arrowing to the bottom must bring the row into view, or the highlight is somewhere
	// off screen and the keyboard is steering a list nobody can see.
	const inView = await page.evaluate(() => {
		const el = document.querySelector('[role="listbox"][aria-label="Commands"]');
		const row = el.querySelector('[data-current="true"]');
		const a = el.getBoundingClientRect();
		const b = row.getBoundingClientRect();
		return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
	});
	say("…scrolling the highlighted row into view", inView);

	// --- completing -------------------------------------------------------------------

	await field.fill("");
	await field.type("/comp");
	await settle(page, 250);
	await page.keyboard.press("Tab");
	await settle(page, 200);
	say("Tab completes the highlighted command", (await field.inputValue()) === "/compact ", JSON.stringify(await field.inputValue()));
	say("…and the trailing space closes the menu", (await menu.count()) === 0);

	/*
	 * The argument hint stays a hint.
	 *
	 * Completing used to insert `/compact [notes]`, which reads as a form and is not one:
	 * Enter on it sent the seven literal characters as the argument.
	 */
	say("…without pasting the argument placeholder in", !(await field.inputValue()).includes("[notes]"));

	// --- ranking ----------------------------------------------------------------------

	/*
	 * The case this ranking exists for. `usage-credits` is declared before `cost`'s alias
	 * `usage`, so a plain prefix filter put the longer name first and Enter ran a
	 * different command from the one typed out in full.
	 */
	await field.fill("");
	await field.type("/usage");
	await settle(page, 250);
	const ranked = await page.evaluate(() =>
		[...document.querySelectorAll('[role="listbox"][aria-label="Commands"] [data-row]')].map((row) => row.querySelector("span").textContent.trim()),
	);
	say("an exact name outranks a longer one that starts with it", ranked[0] === "/cost", JSON.stringify(ranked));

	await field.fill("");
	await field.type("/doc");
	await settle(page, 250);
	const filtered = await rows().count();
	say("typing filters the list down", filtered === 1, String(filtered));

	await field.fill("");
	await field.type("/zzzz");
	await settle(page, 250);
	say("nothing matching closes the menu rather than drawing an empty one", (await menu.count()) === 0);

	// --- dismissing -------------------------------------------------------------------

	await field.fill("");
	await field.type("/lo");
	await settle(page, 250);
	say("two letters is enough to reach a command", (await rows().count()) === 2);
	await page.keyboard.press("Escape");
	await settle(page, 200);
	say("Escape dismisses the menu", (await menu.count()) === 0);
	say("…by clearing the draft, because a command is the whole message", (await field.inputValue()) === "");

	// --- the hints --------------------------------------------------------------------

	await field.type("/");
	await settle(page, 250);
	const hints = await page.evaluate(() => [...document.querySelectorAll(".hintrow .hint")].map((el) => el.textContent.replace(/\s+/g, " ").trim()));
	say("the hint row says what the keyboard now does", hints.some((hint) => hint.includes("to choose")) && hints.some((hint) => hint.includes("complete")), JSON.stringify(hints));

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
