/**
 * While a turn runs: the composer offers stop, the working sign moves and says what it is
 * doing, and a folded conversation stays folded.
 *
 * Needs a model. That is the whole reason the working sign is asserted *here*, in a file that
 * costs tokens to run: the sign only exists mid-turn, so a check that does not start one has
 * nothing to look at. It went unguarded through a rewrite that replaced picone's two moving
 * marks with the still mark scaled and faded on a loop — which is a flower opening and
 * closing, and nobody found out until it was on screen.
 *
 * Where the sign lives changed with the v3 shell (f149de73): a new agent opens its conversation,
 * whose working card draws the moving mark (`signPlacement` gives the column the sign while the
 * history is open); the panel's chat head says the state in words, and folded it is what says a
 * turn is running (the pill over the composer shows only while the panel is closed). The dock's
 * reserved row (`StatusLine`) is no longer mounted, so "the input bar does not move when a turn
 * ends" is asked of the input bar itself.
 */
import { idle, newAgent, open, say, settle, socket, useModel } from "../harness.mjs";

const { browser, page, errors } = await open();

// A fresh agent: whatever ran before may have left the focused one mid-conversation.
await newAgent(page);
await settle(page, 1200);
await page.mouse.move(800, 500);

// The model this run is allowed to spend, before anything is sent. `ask` does this for the
// other checks; this one types into the box itself, because it has to watch the turn start.
await useModel(page);
await page.locator(".dockfield").fill("Read canvases/auth-refresh/cards/plan/index.html and say its title, nothing else.");
await page.locator(".dockfield").press("Enter");

/*
 * Polled while the turn runs: every one of these has to be seen *during* it, not after. The sign
 * is sampled in the same loop, because the states it draws — thinking, streaming, running tools —
 * are each a moment long on a short turn.
 */
let sawBusyComposer = false;
let sign = null;
for (let i = 0; i < 300; i += 1) {
	const now = await page.evaluate(() => {
		const mark = document.querySelector(".stream-working svg[data-agent]");
		const moving = mark?.querySelector("text, rect");
		// The accent, resolved where the mark is drawn: Pi's mark is in it, Claude's in its own orange.
		const probe = document.createElement("span");
		probe.style.color = "var(--color-accent)";
		(mark?.parentElement ?? document.body).append(probe);
		const accent = getComputedStyle(probe).color;
		probe.remove();
		return {
			busy: document.querySelector('.send-button[data-stop="true"]') !== null,
			sign: mark
				? {
						agent: mark.dataset.agent,
						busy: mark.hasAttribute("data-busy"),
						parts: mark.querySelectorAll("text, rect").length,
						animation: moving ? getComputedStyle(moving).animationName : "none",
						delays: new Set([...mark.querySelectorAll("text, rect")].map((n) => getComputedStyle(n).animationDelay)).size,
						colour: getComputedStyle(mark).color,
						accent,
						words: document.querySelector(".stream-working")?.textContent?.trim(),
						head: document.querySelector(".v3-chat-state")?.textContent?.trim(),
					}
				: null,
		};
	});
	if (now.busy) sawBusyComposer = true;
	if (now.sign) sign = now.sign;
	if (sawBusyComposer && sign) break;
	await settle(page, 100);
}
say("the send button turns into the stop button while working", sawBusyComposer);
say("the working sign appears in the open conversation while the turn runs, with words for the state", Boolean(sign?.words), JSON.stringify(sign?.words));
say("…and the panel's chat head says the same state", Boolean(sign?.head) && sign?.head === sign?.words, JSON.stringify(sign?.head));
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
say(
	"…in the runtime's own colour rather than the agent's identity colour",
	sign?.colour === (sign?.agent === "claude" ? "rgb(217, 119, 87)" : sign?.accent),
	`${sign?.colour} (accent ${sign?.accent})`,
);
await idle(page);
await settle(page, 400);

/*
 * Folded: the conversation is shut, and a turn still shows — in the panel's chat head — without
 * the conversation opening itself, and without the input bar moving when the turn ends.
 */
await page.locator(".v3-chat-title").first().click();
await page.waitForFunction(() => document.querySelector(".v3-chat")?.dataset.folded === "true", null, { timeout: 5000 }).catch(() => {});
await page.locator(".dockfield").fill("Say the single word: uniform. Nothing else.");
await page.locator(".dockfield").press("Enter");
let shut = null;
for (let i = 0; i < 300 && !shut; i += 1) {
	const now = await page.evaluate(() => ({
		folded: document.querySelector(".v3-chat")?.dataset.folded === "true",
		head: document.querySelector(".v3-chat-state")?.textContent?.trim() ?? "",
		dock: Math.round(document.querySelector(".dockfield")?.getBoundingClientRect().top ?? -1),
	}));
	if (now.head) shut = now;
	else await settle(page, 100);
}
say("a running turn shows in the panel's chat head while the conversation is folded", Boolean(shut?.head) && shut?.folded === true, JSON.stringify(shut));
await idle(page);
await settle(page, 600);
const after = await page.evaluate(() => ({
	folded: document.querySelector(".v3-chat")?.dataset.folded === "true",
	dock: Math.round(document.querySelector(".dockfield")?.getBoundingClientRect().top ?? -1),
}));
say("and the conversation still did not open itself", after.folded === true);
say("the input bar does not move when a turn ends", shut !== null && after.dock === shut.dock, `${shut?.dock}px → ${after.dock}px`);

/*
 * A slash command that runs no turn still has to hand the working state back.
 *
 * Read from the socket's `agent.state` messages after the command, whichever agent they are for:
 * the socket has a screen of its own since the page moved onto the line, so its `focused` is not
 * the page's agent, and this agent is the only one doing anything.
 */
const link = await socket();
await settle(page, 300);
const before = link.received.length;
const states = () => link.received.slice(before).filter((message) => message.type === "agent.state");
await page.locator(".dockfield").fill("/help");
await page.locator(".dockfield").press("Enter");
let seen = [];
for (let i = 0; i < 60; i += 1) {
	seen = states();
	if (seen.at(-1)?.state === "idle") break;
	await settle(page, 100);
}
say(
	"a command that runs no turn hands the working state back",
	seen.at(-1)?.state === "idle" && seen.some((m) => m.state === "thinking") && new Set(seen.map((m) => m.id)).size === 1,
	seen.map((m) => m.state).join(" → ") || "no state at all — the prompt never reached the agent",
);
const signAfterCommand = await page.evaluate(() => ({
	stop: document.querySelector('.send-button[data-stop="true"]') !== null,
	working: document.querySelectorAll(".stream-working, .v3-status").length,
}));
say(
	"…so the row stops working and the send button stops offering stop",
	!signAfterCommand.stop && signAfterCommand.working === 0,
	JSON.stringify(signAfterCommand),
);
link.close();

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
