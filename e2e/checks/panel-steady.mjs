/**
 * The Agents list under a state change: what a change is allowed to touch.
 *
 * The panel draws every agent it knows about, and an agent's state changes constantly while a
 * turn runs — `streaming`, then `tool`, then `streaming` again, several times a minute. Each
 * of those arrives as a socket frame, and the panel's list is derived from the chats the frame
 * brought. What this check is about is the *work* that derivation does to the DOM: a state
 * change should reach the one row it is about and leave every other row exactly where it was.
 *
 * It was not. `agentSections` builds fresh objects on every call, and `<For>` keys by
 * reference, so one agent moving from `streaming` to `tool` re-created every section, every
 * row, every avatar and every tag chip in the list — the flicker you see while an agent works.
 * Nothing was wrong with what the list *said*; it was re-said from scratch, five or fifteen
 * times a minute.
 *
 * Three assertions, in order of how much they ask for:
 *
 * 1. **Not one node is added or removed.** A state change inside a section is a text and a
 *    colour on one row.
 * 2. **Every row is the same element it was.** The strongest form of the same claim, and the
 *    one a re-render cannot fake: hold the elements, and see whether they are still there.
 * 3. **Nothing that belonged to a row is lost.** Focus, an open popover and the list's own
 *    scroll position all live on the elements, so re-creating a row throws them away — an
 *    arrows-only reader loses their place, a popup they had opened closes under them.
 *
 * And one that a change *is* allowed to cost: an agent that moves to another workspace is one
 * row destroyed and one created, because the sections are different lists. That is the grouping
 * doing its job rather than a bug, so it is asserted too, as a bound rather than as zero.
 *
 * The list is always cut by workspace now, so a *state* change never moves a row between
 * headings; what it may do, in the two-line view, is swap a row's second line between the last
 * thing said and the state. That is bounded too. The one-line view is measured at the end.
 *
 * The socket is driven directly, exactly as `agents-tab.mjs` does and for the same reason:
 * these are states that would otherwise need a dozen real sessions and several minutes each,
 * and the one thing being measured is what the DOM does when they arrive.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 980 });

await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.__sent = [];
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
			const send = this.send.bind(this);
			this.send = (data) => {
				window.__sent.push(String(data));
				return send(data);
			};
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2000);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const chat = (id, name, kind, state, lastLine, ago, extra = {}) => ({
	id,
	name,
	kind,
	state,
	...(lastLine ? { lastLine } : {}),
	lastAt: Date.now() - ago,
	unread: 0,
	identity: { name, color: "#3b5cf6" },
	boards: ["boards/plan.html", "boards/risks.html"],
	inPlay: [],
	...extra,
});

/*
 * Fourteen agents, which is more than one screenful at 264px.
 *
 * The count is not decoration: the scroll assertion needs a list that can scroll, and the
 * churn count is only interesting when there is enough of it to be a flash rather than a
 * repaint. Three workspaces — `irb-84069` for the two waiting, `political-llm` for the eight
 * working, none for the quiet four — so a change that moves an agent across one is available.
 */
const agents = [
	chat("w1", "Iris", "claude", "waiting", "Allow this command?", 90_000),
	chat("w2", "Nell", "pi", "waiting", "Which board?", 40_000),
	chat("k1", "Ada", "claude", "tool", "Reading panel.css", 4_000),
	chat("k2", "Pi", "pi", "streaming", "Writing the report", 20_000),
	chat("k3", "Wren", "pi", "thinking", "Weighing two options", 30_000),
	chat("k4", "Basil", "claude", "tool", "Measuring rows", 60_000),
	chat("k5", "Juno", "pi", "streaming", "Drafting the answer", 70_000),
	chat("k6", "Quill", "claude", "streaming", "Reading four files", 80_000),
	chat("k7", "Rook", "pi", "tool", "Running the suite", 100_000),
	chat("k8", "Sable", "claude", "thinking", "Narrowing the list", 110_000),
	chat("q1", "Mira", "pi", "idle", "Done, 12 boards measured", 900_000),
	chat("q2", "Vale", "claude", "idle", "Nothing to add", 1_000_000),
	chat("q3", "Rune", "pi", "idle", "Waiting for a board", 2_000_000),
	chat("q4", "Kestrel", "claude", "idle", undefined, 7_200_000, { dormant: true }),
];
await feed({ type: "agents", defaultKind: "pi", focused: "k1", chats: agents });
const workspaceOf = (id) => (id.startsWith("w") ? "irb-84069" : id.startsWith("k") ? "political-llm" : undefined);
for (const [id, name] of agents.map((one) => [one.id, one.name])) {
	const workspace = workspaceOf(id);
	await feed({ type: "agent.identity", id, identity: { name, color: "#3b5cf6", tags: [], ...(workspace ? { workspace } : {}) } });
}
await settle(page, 600);

// --- the panel, on its Agents tab ---------------------------------------------------

const shown = await page.evaluate(() => Boolean(document.querySelector(".panel-shell")));
if (!shown) await page.locator('[aria-label*="boards panel" i]').first().click();
await page.waitForSelector(".panel-shell", { timeout: 5000 });
await page.getByRole("tab", { name: "Agents" }).click();
await settle(page, 400);

/* The workspace cut, which is the only one, in two lines per agent, which is where it opens. */
const opened = await page.evaluate(() => ({
	view: document.querySelector(".panel-view")?.getAttribute("data-view"),
	sections: [...document.querySelectorAll(".panel-section")].map((one) => `${one.querySelector(".panel-meta > span")?.textContent}:${one.querySelectorAll(".agent-row").length}`),
}));
say(
	"the list opens by workspace, in two lines per agent",
	opened.view === "lines-2" && JSON.stringify(opened.sections) === JSON.stringify(["irb-84069:2", "political-llm:8", "No workspace:4"]),
	JSON.stringify(opened),
);

/*
 * The whole measurement happens inside the page, in one place, for one reason: an element is
 * not something that can be handed back over `page.evaluate`. Every question below is about
 * *which* element, so the references stay here and only the verdicts come out.
 */
await page.evaluate(() => {
	const list = document.querySelector(".panel-list");
	/*
	 * The panel's first working face, named as the panel's.
	 *
	 * Unscoped, this finds the face in the corner stack — a different component that does not
	 * re-draw when the list does, and a measurement of the wrong thing that passes.
	 */
	const pulse = () =>
		document.querySelector('.panel-list .agent-face[data-status="working"]')?.getAnimations?.()?.find((one) => one.animationName === "ring-pulse") ?? null;
	window.__hold = (label) => {
		/* What actually moved, not only how much: a count is enough to fail on and useless to
		   debug with, and the next person to break this wants to know *which* node. */
		const named = (node) => (node.nodeType === 1 ? `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(" ")[0]}` : ""}` : `#text:${(node.textContent ?? "").trim().slice(0, 16)}`);
		const notes = () => [...document.querySelectorAll(".panel-section")].map((section) => `${section.dataset.kind}:${section.querySelector(".note")?.textContent ?? ""}`);
		window.__before = { label, rows: new Map(), focused: document.activeElement, scroll: list.scrollTop, churn: { added: 0, removed: 0 }, elements: { added: 0, removed: 0 }, moved: [], notes: notes() };
		for (const row of document.querySelectorAll(".agent-row")) window.__before.rows.set(row.querySelector(".row-label")?.textContent, row);
		window.__before.pulse = pulse();
		window.__before.pulseAt = window.__before.pulse?.currentTime ?? null;
		window.__observer?.disconnect();
		window.__observer = new MutationObserver((records) => {
			for (const record of records) {
				window.__before.churn.added += record.addedNodes.length;
				window.__before.churn.removed += record.removedNodes.length;
				window.__before.elements.added += [...record.addedNodes].filter((one) => one.nodeType === 1).length;
				window.__before.elements.removed += [...record.removedNodes].filter((one) => one.nodeType === 1).length;
				if (record.addedNodes.length > 0 || record.removedNodes.length > 0) {
					window.__before.moved.push({ added: [...record.addedNodes].map(named), removed: [...record.removedNodes].map(named) });
				}
			}
		});
		window.__observer.observe(list, { childList: true, subtree: true });
	};
	window.__verdict = () => {
		const before = window.__before;
		window.__observer.disconnect();
		const still = new Map();
		for (const row of document.querySelectorAll(".agent-row")) still.set(row.querySelector(".row-label")?.textContent, row);
		const kept = [...before.rows].filter(([name, row]) => still.get(name) === row);
		const lost = [...before.rows].filter(([name, row]) => still.get(name) !== row).map(([name, row]) => `${name}${row.isConnected ? "" : " (gone)"}`);
		const state = (name) => {
			const row = still.get(name);
			return row
				? {
						text: row.querySelector(".agent-state")?.textContent?.trim(),
						said: row.querySelector(".agent-said")?.textContent?.trim(),
						status: row.dataset.status,
						section: row.closest(".panel-section")?.querySelector(".panel-meta > span")?.textContent,
					}
				: null;
		};
		const running = pulse();
		return {
			label: before.label,
			churn: before.churn,
			elements: before.elements,
			moved: before.moved,
			rows: before.rows.size,
			kept: kept.length,
			lost,
			focusKept: document.activeElement === before.focused && document.contains(before.focused),
			scrollKept: list.scrollTop === before.scroll,
			// A popover, or the edit window the pen opens — either is a surface somebody has open.
			popover: Boolean(document.querySelector('.popover, [role="dialog"]')),
			pulse: { before: before.pulseAt, after: running === before.pulse ? running?.currentTime : null },
			state: Object.fromEntries([...still.keys()].map((name) => [name, state(name)])),
			notesBefore: before.notes,
			notes: [...document.querySelectorAll(".panel-section")].map((section) => `${section.dataset.kind}:${section.querySelector(".note")?.textContent ?? ""}`),
			sections: [...document.querySelectorAll(".panel-section")].map((section) => section.dataset.kind),
		};
	};
});

/** Run one change and say what it cost. */
const change = async (label, message) => {
	await page.evaluate((name) => window.__hold(name), label);
	await feed(message);
	await settle(page, 500);
	return page.evaluate(() => window.__verdict());
};

/*
 * Take the reader's place before changing anything. A row's focus, an open popup and the
 * list's scroll position all live on the elements, so a re-render throws all three away: an
 * arrows-only reader loses their place, and a popup closes under the person who opened it.
 *
 * Programmatic clicks and focus calls, not Playwright's: the row's two buttons are revealed by
 * hover, and something that is not painted cannot be clicked by a mouse. The question here is
 * what happens to the *elements*, and an invisible button is still an element.
 */
await page.evaluate(() => {
	const list = document.querySelector(".panel-list");
	const rowFor = (name) => [...document.querySelectorAll(".agent-row")].find((row) => row.querySelector(".row-label")?.textContent === name);
	window.__rowFor = rowFor;
	list.scrollTop = 140;
	rowFor("Ada")?.querySelector("[data-row]")?.focus();
});

// --- a change that stays inside its section --------------------------------------------

const inside = await change("Basil: tool → streaming", { type: "agent.state", id: "k4", state: "streaming" });

say("a state change adds no node and removes none", inside.churn.added === 0 && inside.churn.removed === 0, JSON.stringify(inside.churn) + JSON.stringify(inside.moved));
say("…every row is the element it was", inside.kept === inside.rows, `${inside.kept} of ${inside.rows} kept${inside.lost.length ? ` (lost ${inside.lost.join(", ")})` : ""}`);
say("…and the row it was about says so, on its second line", inside.state.Basil?.text === "Typing…" && inside.state.Basil?.status === "working", JSON.stringify(inside.state.Basil));
/* A quiet agent's second line is not a state but the last thing it said, as a chat list's is. */
say("an idle agent's second line is the last thing it said", inside.state.Vale?.said === "Nothing to add" && inside.state.Vale?.text === undefined, JSON.stringify(inside.state.Vale));
say("…with a keyboard reader still on their row", inside.focusKept, "focus moved, or went to the body");
say("…and the list still scrolled where it was", inside.scrollKept, "the scroll position was reset");
/*
 * The ring is the visible half of a state, and a remount restarts its 2.4s breath from zero:
 * a jump on a face that was already pulsing, which is what the flicker looked like.
 */
say("the working face keeps the pulse it had running", inside.pulse.before !== null && inside.pulse.after !== null && inside.pulse.after > inside.pulse.before, JSON.stringify(inside.pulse));

// --- the row message, which is what a prompt and a finished turn send now ------------------

/*
 * A prompt used to republish the whole chat list to say that one row's preview line had
 * changed. `agent.row` says it about the one chat, and it has to reach the DOM without
 * costing what a list costs — and it has to be read as a *complete* statement of the four
 * fields it carries, or a chat that has just woken stays marked dormant for ever.
 */
const said = await change("Mira: a fresher line", { type: "agent.row", id: "q1", lastLine: "Finished, 14 boards measured", lastAt: Date.now() });
say("a row message adds no node and removes none", said.churn.added === 0 && said.churn.removed === 0, JSON.stringify(said.churn));
say("…every row is the element it was", said.kept === said.rows, `${said.kept} of ${said.rows} kept${said.lost.length ? ` (lost ${said.lost.join(", ")})` : ""}`);
const line = await page.evaluate(() => window.__rowFor("Mira")?.querySelector(".agent-said")?.textContent);
say("…and the line it carried is on the row", line === "Finished, 14 boards measured", String(line));

const woke = await change("Kestrel: woken by a prompt", { type: "agent.row", id: "q4", lastLine: "Right, starting", lastAt: Date.now() });
const dormant = await page.evaluate(() => window.__rowFor("Kestrel")?.dataset.dormant ?? "none");
say("a row with no dormant mark on it wakes the chat", dormant === "none" && woke.kept === woke.rows, `${dormant}, ${woke.kept} of ${woke.rows} kept`);

// --- a window somebody has open ------------------------------------------------------------

/* The pen opens the edit window now, in a portal of its own: the row it belongs to is the
   component that draws it, so a list redraw that re-created that row would take it with it. */
await page.evaluate(() => window.__rowFor("Sable")?.querySelector(".agent-tagbtn")?.click());
await page.waitForSelector('[role="dialog"]', { timeout: 4000 });
await settle(page, 300);

const popup = await change("Rook: tool → thinking", { type: "agent.state", id: "k7", state: "thinking" });

say("an open window survives the list being redrawn", popup.popover, "the window went with its row");
say("…with nothing added or removed behind it", popup.churn.added === 0 && popup.churn.removed === 0, JSON.stringify(popup.churn));

await page.keyboard.press("Escape");
await settle(page, 300);

// --- a state change that swaps a row's second line ------------------------------------------

/*
 * Mira goes from idle to working. Under the workspace cut she stays where she is, in `No
 * workspace`; what changes is her second line — the last thing she said gives way to the state
 * — and the heading, which starts saying somebody in it is working.
 */
const swapped = await change("Mira: idle → working", { type: "agent.state", id: "q1", state: "streaming" });

say("a state change moves no row between headings", swapped.kept === swapped.rows && swapped.state.Mira?.section === "No workspace", `${swapped.kept} of ${swapped.rows} kept · ${JSON.stringify(swapped.state.Mira)}`);
say("…and swaps only her second line, and the heading's note", swapped.elements.added <= 2 && swapped.elements.removed <= 2, `${JSON.stringify(swapped.elements)} · ${JSON.stringify(swapped.moved)}`);
say("…which now says what she is doing", swapped.state.Mira?.status === "working" && Boolean(swapped.state.Mira?.text) && swapped.state.Mira?.said === undefined, JSON.stringify(swapped.state.Mira));

// --- a change that moves an agent between sections ----------------------------------------

const across = await change("Vale: into political-llm", { type: "agent.identity", id: "q2", identity: { name: "Vale", color: "#3b5cf6", tags: [], workspace: "political-llm" } });

say("an agent changing workspace costs one row", across.churn.added > 0 && across.churn.added <= 4 && across.churn.removed <= 4, JSON.stringify(across.churn));
say("…and the rows it left behind are the ones that were there", across.kept === across.rows - 1, `${across.kept} of ${across.rows} kept (lost ${across.lost.join(", ")})`);
say("…and it arrived where it belongs", across.state.Vale?.section === "political-llm", JSON.stringify(across.state.Vale));

// --- a change to an agent's tags ------------------------------------------------------------

const tagged = await change("Mira's tags", {
	type: "agent.identity",
	id: "q1",
	identity: { name: "Mira", color: "#3b5cf6", tags: ["panel-css"] },
});

/*
 * Tags are not drawn on a row any more — the search matches them and the edit window shows
 * them — so a tag arriving has nothing to draw. Elements, here and not every node: `Show`
 * inserts its value beside an empty text node, which is a bookmark rather than a thing on screen.
 */
say("a tag arriving adds no element and removes none", tagged.elements.added === 0 && tagged.elements.removed === 0, `${JSON.stringify(tagged.elements)} of ${JSON.stringify(tagged.churn)} · ${JSON.stringify(tagged.moved)}`);
say("…and it is the same row", tagged.kept === tagged.rows, `${tagged.kept} of ${tagged.rows} kept`);

// --- the heading's note ---------------------------------------------------------------------

/*
 * The heading is where this grouping keeps its urgency, so it is what has to move: the section
 * Iris was waiting in said `2 want you` and says `1 wants you` now. Checked as a transition
 * rather than as a value, because a note that was always "1 wants you" would prove nothing
 * about whether the field reaches the DOM at all.
 */
const filed = await change("Iris: waiting → working", { type: "agent.state", id: "w1", state: "streaming" });

say("a waiting agent starting work moves nothing", filed.churn.added === 0 && filed.churn.removed === 0, JSON.stringify(filed.churn) + JSON.stringify(filed.moved));
say("…every row is still the row it was", filed.kept === filed.rows, `${filed.kept} of ${filed.rows} kept (lost ${filed.lost.join(", ")})`);
say(
	"…and the heading says what its group is doing now",
	filed.notesBefore.includes("workspace:2 want you") && filed.notes.includes("workspace:1 wants you"),
	`${JSON.stringify(filed.notesBefore)} → ${JSON.stringify(filed.notes)}`,
);

// --- one line per agent ---------------------------------------------------------------------

/*
 * The square switches every row to one line. That is a prop on the rows, not a new list, so the
 * rows it draws are the rows that were there.
 */
await page.evaluate(() => window.__hold("to one line"));
await page.locator('.panel-view[data-view="lines-2"]').click();
await settle(page, 500);
const toOne = await page.evaluate(() => window.__verdict());
say("switching to one line keeps every row the element it was", toOne.kept === toOne.rows, `${toOne.kept} of ${toOne.rows} kept (lost ${toOne.lost.join(", ")})`);

const oneLine = await change("Pi: streaming → tool, in one line", { type: "agent.state", id: "k2", state: "tool" });
say("in one line, a state change adds no node and removes none", oneLine.churn.added === 0 && oneLine.churn.removed === 0, JSON.stringify(oneLine.churn) + JSON.stringify(oneLine.moved));
say("…every row is the element it was", oneLine.kept === oneLine.rows, `${oneLine.kept} of ${oneLine.rows} kept`);
say("…and the working face keeps its pulse", oneLine.pulse.before !== null && oneLine.pulse.after !== null && oneLine.pulse.after > oneLine.pulse.before, JSON.stringify(oneLine.pulse));

// --- nothing threw -------------------------------------------------------------------------

say("no page errors", errors.length === 0, errors.join(" | "));

await browser.close();
