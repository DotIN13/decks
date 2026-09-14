/**
 * While a turn runs: the composer offers stop, the working sign moves and says what it is
 * doing, and the conversation stays shut.
 *
 * Needs a model. That is the whole reason the working sign is asserted *here*, in a file that
 * costs tokens to run: the sign only exists mid-turn, so a check that does not start one has
 * nothing to look at. It went unguarded through a rewrite that replaced picone's two moving
 * marks with the still mark scaled and faded on a loop — which is a flower opening and
 * closing, and nobody found out until it was on screen.
 */
import { newAgent, open, say, settle, socket, useModel } from "../harness.mjs";

const { browser, page, errors } = await open();

// A fresh agent: whatever ran before may have left the focused one mid-conversation.
await newAgent(page);
await settle(page, 1200);
await page.mouse.move(800, 500);

// The model this run is allowed to spend, before anything is sent. `ask` does this for the
// other checks; this one types into the box itself, because it has to watch the turn start.
await useModel(page);
await page.locator(".dockfield").fill("Read boards/plan.html and say its title, nothing else.");
await page.locator(".dockfield").press("Enter");

/*
 * Polled while the turn runs: every one of these has to be seen *during* it, not after.
 *
 * The sign is sampled in the same loop rather than waited for separately, because the states
 * it draws — thinking, streaming, running tools — are each a moment long on a short turn, and
 * a second pass would be looking after the turn had ended.
 */
let sawDockSign = false;
let sawBusyComposer = false;
/** The working sign, as it was at the busiest moment we caught it. */
let sign = null;
for (let i = 0; i < 300; i += 1) {
	const now = await page.evaluate(() => {
		const mark = document.querySelector(".statusline[data-working='true'] .mark");
		const moving = mark?.querySelector("text, rect");
		return {
			/*
			 * The dock's chip, which is where a running turn shows while the conversation is
			 * shut. It replaced the spine — this check used to count
			 * `.stream-roll .turn[data-state="running"]`, and the spine was deleted in the
			 * rewrite, so the count was of nothing and could only ever be zero.
			 */
			dock: document.querySelectorAll('.statusline[data-working="true"]').length,
			// One control, two meanings: `data-stop` is on it exactly while the agent is not idle.
			busy: document.querySelector('.sendbtn[data-stop="true"]') !== null,
			row: Math.round(document.querySelector(".statusrow")?.getBoundingClientRect().height ?? -1),
			sign: mark
				? {
						agent: mark.dataset.agent,
						busy: mark.dataset.busy === "",
						// Ten either way: ten glyph frames for Claude, ten character cells for Pi.
						parts: mark.querySelectorAll("text, rect").length,
						animation: moving ? getComputedStyle(moving).animationName : "none",
						// Staggered, or the ten would step in unison and there would be no build.
						delays: new Set([...mark.querySelectorAll("text, rect")].map((n) => getComputedStyle(n).animationDelay)).size,
						colour: getComputedStyle(mark).color,
						words: mark.parentElement?.textContent?.trim(),
					}
				: null,
		};
	});
	if (now.dock > 0) sawDockSign = true;
	if (now.busy) sawBusyComposer = true;
	if (now.sign) sign = now.sign;
	if (sawDockSign && sawBusyComposer && sign) break;
	await settle(page, 100);
}
say("a running turn shows in the dock while the conversation is shut", sawDockSign);
say("the send button turns into the stop button while working", sawBusyComposer);

// --- the working sign ---------------------------------------------------------------
say("the working sign appears while the turn runs, with words for the state", Boolean(sign?.words), JSON.stringify(sign?.words));
say("…and the mark it shows is the moving one, not the still symbol", sign?.busy === true, JSON.stringify(sign?.agent));
say(
	"…drawn as ten staggered parts — Claude's ten glyph frames, or Pi's ten character cells",
	sign?.parts === 10 && sign?.delays === 10,
	`${sign?.parts} parts, ${sign?.delays} distinct delays`,
);
say(
	"…and they are animated by name, so a stopped animation cannot pass as a moving mark",
	sign?.animation === (sign?.agent === "claude" ? "claude-cycle" : "pi-build"),
	String(sign?.animation),
);
/*
 * The runtime's colour, and *not* the agent's.
 *
 * `StatusLine` used to set `--mark` from `Identity.color`, so an agent that had been given
 * green got a green mark pulsing over the input bar. The mark is a drawing of the runtime;
 * whose turn it is, is what the words beside it say.
 */
say(
	"…in the runtime's own colour rather than the agent's identity colour",
	sign?.colour === (sign?.agent === "claude" ? "rgb(217, 119, 87)" : "rgb(59, 92, 246)"),
	String(sign?.colour),
);
// It is opened deliberately or not at all — a turn arriving is what the dock's peek is for.
/*
 * `data-shown`, which is what the panel actually publishes. It was `data-open` here, an
 * attribute nothing sets — so the assertion read `undefined ?? "false"` and passed by
 * default, which is the worst way for a check to pass: it would have gone on passing if the
 * conversation had thrown itself open on every turn.
 */
say(
	"and the conversation still did not open itself",
	(await page.evaluate(() => document.querySelector(".stream")?.dataset.shown ?? "false")) === "false",
);

/*
 * And the row it lives in never changes height.
 *
 * This is the reason the sign is a `<Show>` inside a fixed-height wrapper rather than a
 * component that renders nothing: in picone's first draft the sign *was* the row, so
 * finishing a turn removed it and the composer slid down by its height — at the exact moment
 * the reader starts reading the answer.
 */
const rowAfter = await page.evaluate(() => Math.round(document.querySelector(".statusrow")?.getBoundingClientRect().height ?? -1));
say("the sign's row is reserved, so the input bar does not move when a turn ends", rowAfter === 28, `${rowAfter}px with nothing in it`);

/*
 * A slash command is not a turn, and it must not leave the sign up.
 *
 * The state the row and the send button read is set when a prompt is *sent* — a prediction, so
 * the row lights up on the press rather than on the runtime's first frame. A turn takes it back
 * (`agent_start` claims the agent, `agent_end` hands it back). A command runs no turn and so
 * emits neither, and the prediction used to stand for ever: `/help`, `/compact`, `/name` and
 * every runtime's own `/status` left the chat list saying "working" about an agent that had
 * finished — and, because the queue's clock starts on the return to idle, stranded work another
 * agent had handed over until somebody pressed stop.
 *
 * `/help` rather than `/compact`, which is where this was found: a compaction needs a whole
 * conversation behind it (Pi answers "Nothing to compact (session too small)" and emits nothing),
 * and the two take the same path out of `prompt()` — a slash command that runs nothing at all.
 *
 * **Read off the socket, not the DOM.** The state frames are the server's own answer, so this
 * cannot pass because the field never sent: the prediction has to be *seen* going up. It is read
 * for the agent the server names as focused, which is how `resetStage` names it too.
 */
const link = await socket();
let focused;
for (let i = 0; i < 60 && !focused; i += 1) {
	focused = link.last("agents")?.focused;
	if (!focused) await settle(page, 100);
}
const states = () => link.received.filter((message) => message.type === "agent.state" && message.id === focused).map((message) => message.state);

await settle(page, 300);
const before = states().length;
await page.locator(".dockfield").fill("/help");
await page.locator(".dockfield").press("Enter");
let after = [];
for (let i = 0; i < 60; i += 1) {
	after = states().slice(before);
	if (after.at(-1) === "idle") break;
	await settle(page, 100);
}
say(
	"a command that runs no turn hands the working state back",
	after.at(-1) === "idle" && after.includes("thinking"),
	after.join(" → ") || "no state at all — the prompt never reached the agent",
);

const signAfterCommand = await page.evaluate(() => ({
	stop: document.querySelector('.sendbtn[data-stop="true"]') !== null,
	working: document.querySelectorAll('.statusline[data-working="true"]').length,
}));
say(
	"…so the row stops working and the send button stops offering stop",
	!signAfterCommand.stop && signAfterCommand.working === 0,
	JSON.stringify(signAfterCommand),
);
link.close();

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
