/**
 * The agent list is the only place an agent's state is shown, so this is what says it (§7).
 *
 * There used to be a peek above the input bar, pills in the corner the panel came out of,
 * and a chat list in a left panel with a line of the last message under every name. All
 * three are gone. What replaced them is two surfaces with one division of labour, from
 * `boards/the-agent-stack-comes-back`: **the dropdown is what exists, the corner is what is
 * happening.** So this checks the dropdown's rows, the corner's faces, and the property that
 * makes the corner trustworthy.
 *
 * That property is *not* "the corner empties itself" any more, and getting it wrong is how
 * this rewrite failed its first run. Idle agents were once excluded and now are not — three
 * idle agents and an empty corner reads as broken rather than as quiet, so **urgency survives
 * as a ring and an order rather than as membership**. What clears is the green: a face stays,
 * unringed, once you have looked at it.
 *
 * This file was written against `.chat-row`, `.avatar` and `.last`, in a panel that the
 * frontend rewrite deleted. It is agent-gated, so nothing ran it and nothing said so; it
 * would have failed on its first selector. Rewritten against what is there, and the
 * assertions are the same claims about the same feature.
 *
 * Needs a model: what is being checked is a row *changing* as a turn runs, which no fixture
 * can stage.
 */
import { idle, newAgent, open, openAgents, say, settle, useModel } from "../harness.mjs";

const { browser, page, errors } = await open();

/**
 * Every agent row in the dropdown, as the list draws it.
 *
 * `.lb` is the name and `.meta` is the state — `rowWords` in `agent-order.ts` decides the
 * words, and `data-status` is the same fact as a machine-readable value, which is what the
 * ring on the face is drawn from. Both are read because they can disagree: the status is
 * derived and the words are written, and a row that says "idle" while its face is green is
 * two claims about one agent.
 */
const rows = () =>
	page.evaluate(() =>
		[...document.querySelectorAll('.popover [data-row][data-agent="true"]')].map((row) => ({
			name: row.querySelector(".lb")?.textContent?.trim() ?? "",
			words: row.querySelector(".meta")?.textContent?.trim() ?? "",
			status: row.dataset.status ?? "",
			current: row.dataset.current === "true",
			/* A last line would be a `.nt`. There is deliberately none: a 264px row with a
			   truncated sentence in it is the chat list, which is what the hover card is for. */
			lines: row.querySelectorAll(".nt").length,
			face: Boolean(row.querySelector(".agent-face")),
		})),
	);

/**
 * The faces in the corner — every agent except the one whose window this is.
 *
 * `ringed` is read from the computed outline rather than from a class, because that is the
 * whole mechanism: `.agent-face[data-status]:not([data-status="idle"])` is what draws the
 * ring, so a face with a status and no ring is the app saying "nothing is happening here"
 * in the one way the design has left for saying it.
 */
const faces = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".agent-stack .agent-facebtn")].map((button) => {
			const face = button.querySelector(".agent-face");
			return {
				label: button.getAttribute("aria-label") ?? "",
				status: face?.dataset.status ?? "",
				ringed: face ? getComputedStyle(face).outlineStyle !== "none" : false,
			};
		}),
	);

const current = (list) => list.find((row) => row.current);

// A second agent, so there is somewhere to switch *to* — and so the corner has a chance to
// draw a face, which it never does for the agent you are already in.
await newAgent(page);
await settle(page, 1200);
await page.mouse.move(800, 500);

await openAgents(page);
const fresh = await rows();
say("the dropdown lists every agent, including the idle ones", fresh.length >= 2, `${fresh.length} rows`);
say("…each with a face and a name", fresh.every((row) => row.face && row.name.length > 0), JSON.stringify(fresh.map((r) => r.name)));
say("…and no line of the last message under it", fresh.every((row) => row.lines === 0));
say(
	"a fresh agent's row says it has never run",
	current(fresh)?.words === "never run" && current(fresh)?.status === "idle",
	JSON.stringify(current(fresh)),
);
/*
 * Every agent but the focused one, up to the cap — and *not* "one", which is what this said
 * on its first pass and what made it the only check in the suite that failed in a full run
 * and passed on its own. The checks share one server, so the agents that `tiers`,
 * `deleted-board` and `agent-close` created are still on the list by the time this runs.
 * `STACK_CAP` is 3, after which the stack says `+n`.
 */
const cap = (n) => Math.min(3, n);
const quiet = await faces();
const others = fresh.filter((row) => !row.current).length;
say(
	"the corner draws the other agents even while nothing is happening",
	quiet.length === cap(others) && quiet.length > 0,
	`${quiet.length} faces for ${others} other agents`,
);
say(
	"…every one of them unringed, which is how it says nothing is happening",
	quiet.every((f) => !f.ringed && f.status === "idle"),
	JSON.stringify(quiet),
);

// The prompt is typed by hand rather than through `ask`, because what is being watched is
// the row *during* the turn, and `ask` waits for the turn to be over.
await page.keyboard.press("Escape");
await useModel(page);
await page.locator(".dockfield").fill("Say the single word: uniform. Nothing else.");
await page.locator(".dockfield").press("Enter");
await page.waitForFunction(() => document.querySelector('.sendbtn[data-stop="true"]') !== null, null, { timeout: 20000 });

/*
 * Read with the menu open while the turn runs.
 *
 * The words are `rowWords`' lower-case register — `thinking…`, `typing…`, `running tools…` —
 * and which of the three you catch depends on the moment, so the assertion is that it is one
 * of them and that `data-status` says `working` at the same time.
 */
await openAgents(page);
let during;
for (let i = 0; i < 200; i += 1) {
	const now = current(await rows());
	if (now && (now.status === "working" || /thinking|typing|running tools/.test(now.words))) {
		during = now;
		break;
	}
	if (!(await page.evaluate(() => document.querySelector('.sendbtn[data-stop="true"]') !== null))) break;
	await settle(page, 100);
}
say("the row says it is working while it works", Boolean(during), JSON.stringify(during));
say(
	"…in words and in a status, and they agree",
	during?.status === "working" && /thinking|typing|running tools/.test(during?.words ?? ""),
	`${during?.status} · ${during?.words}`,
);

/*
 * And now the property the whole corner rests on: an agent that answers while you are
 * looking somewhere else goes green, and the green clears by being looked at.
 *
 * Switching agents mid-turn is what makes this a real test of it — the answer arrives with
 * nobody reading it, which is the only way `done` can happen.
 */
const other = (await rows()).findIndex((row) => !row.current);
await page.locator('.popover [data-row][data-agent="true"]').nth(other).click();
await settle(page, 600);
await idle(page);

let answered;
for (let i = 0; i < 200; i += 1) {
	await openAgents(page);
	answered = (await rows()).find((row) => !row.current);
	if (answered?.status === "done") break;
	await page.keyboard.press("Escape");
	await settle(page, 500);
}
say(
	"an agent that answers while you are elsewhere goes green",
	answered?.status === "done" && /^done/.test(answered?.words ?? ""),
	JSON.stringify(answered),
);
const green = await faces();
say(
	"…and its face in the corner is ringed, which is the only thing that says so at a glance",
	green.some((f) => f.status === "done" && f.ringed),
	JSON.stringify(green),
);
const listed = await rows();
say(
	"the agent you are in has no face in the corner — it is top left with its name",
	green.length === cap(listed.filter((row) => !row.current).length),
	`${green.length} faces, ${listed.length} rows`,
);

// Looking at it is what clears it. Nothing else can: there is no "mark all read".
await openAgents(page);
const back = (await rows()).findIndex((row) => !row.current);
await page.locator('.popover [data-row][data-agent="true"]').nth(back).click();
await settle(page, 800);
await openAgents(page);
const read = current(await rows());
say("switching to it is what clears the green", read?.status === "idle", JSON.stringify(read));
/*
 * And nothing in the corner is green any more. Not empty — the agent you just left is a face
 * there now — but nothing ringed, which is the claim that matters: a sign that only clears by
 * being dealt with is a sign you can trust, and there is no "mark all read" anywhere.
 */
const after = await faces();
say(
	"…and nothing is left ringed in the corner",
	after.every((f) => !f.ringed && f.status !== "done"),
	JSON.stringify(after),
);
say("…the row still says when it last ran, not what it said", /^idle · /.test(read?.words ?? "") && read?.lines === 0, JSON.stringify(read?.words));

await page.keyboard.press("Escape");
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
