/**
 * `stage.annotate` — an agent pointing at what it just changed.
 *
 * A bubble with a small arrow, anchored to a component, drawn on the canvas and **never**
 * written to the board. The interesting properties are all ones that would go wrong silently:
 * that the file is untouched, that the arrow follows a component when it moves, that a
 * mistyped `data-id` is reported back rather than drawn as a bubble pointing at nothing, and
 * that clearing takes away this agent's marks and not another's.
 *
 * The op is driven as a `stage.call` frame. Going through a real agent would need a model and
 * a turn per assertion, and `annotate` is the browser's half of the call — the server only
 * checks that the board exists before forwarding it.
 */
import { boardPath, open, read, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

const file = await boardPath("plan.html");
const before = read(file);

const call = (id, args) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify({ type: "stage.call", call: { id, op: "annotate", ...args } }));

await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.__results = [];
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
			const send = this.send.bind(this);
			this.send = (data) => {
				const text = String(data);
				if (text.includes("stage.result")) window.__results.push(JSON.parse(text).result);
				return send(data);
			};
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2500);

const path = "boards/plan.html";
const ids = await page.evaluate(
	(selector) => [...(document.querySelector(selector)?.contentDocument?.querySelectorAll("[data-id]") ?? [])].map((el) => el.dataset.id),
	`.board-node[data-path="${path}"] iframe`,
);
say("the fixture board has components to point at", ids.length >= 2, JSON.stringify(ids.slice(0, 4)));

const marks = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".board-mark")].map((mark) => ({
			say: mark.querySelector(".say")?.textContent,
			tone: mark.dataset.tone,
			side: mark.dataset.side,
			top: mark.style.top,
			lines: Math.round((mark.querySelector(".say")?.getBoundingClientRect().height ?? 0) / 25),
		})),
	);
const lastResult = () => page.evaluate(() => window.__results.at(-1)?.value);

// --- three marks, one of which points at nothing -----------------------------------

await call("c1", {
	args: {
		agentId: "A",
		path,
		marks: [
			{ to: ids[0], label: "rewrote this one" },
			{ to: ids[1], label: "and added this", tone: "ok" },
			{ to: "no-such-component", label: "points at nothing" },
		],
	},
});
await settle(page, 600);

const drawn = await marks();
say("the marks are drawn", drawn.length === 2, JSON.stringify(drawn.map((mark) => mark.say)));
say("…each with its own tone", drawn[0]?.tone === "accent" && drawn[1]?.tone === "ok", JSON.stringify(drawn.map((mark) => mark.tone)));
/*
 * The count reported back is the count *drawn*, not the count asked for. It was the latter,
 * which made "three of three" the answer to a request where one `data-id` did not exist —
 * true about the request and useless about the result. An agent that mistypes an id should
 * be told, or it believes it has pointed at something.
 */
const result = await lastResult();
say("a mistyped data-id is reported rather than drawn", result?.annotated === 2 && result?.of === 3, JSON.stringify(result));
say("…and named, so the agent can fix it", JSON.stringify(result?.notFound) === JSON.stringify(["no-such-component"]), JSON.stringify(result?.notFound));

/*
 * A label is a clause on one line. An absolutely positioned box shrink-wraps against the
 * space between its `left` and the board's right edge, so a mark near that edge laid out in a
 * few dozen pixels and wrapped to three lines *before* the flip moved it back — `width:
 * max-content` is what stops that, and this is the assertion that keeps it.
 */
say("a label does not wrap because its component is near the board's edge", drawn.every((mark) => mark.lines <= 1), JSON.stringify(drawn.map((mark) => mark.lines)));

// --- the board file is untouched -----------------------------------------------------

/*
 * The whole promise of the feature: a board that has been annotated is byte-identical to one
 * that has not, so there is nothing to tidy up and no revision to undo.
 */
say("nothing was written to the board", read(file) === before, "byte-identical");

// --- it follows its component ---------------------------------------------------------

const wasTop = drawn[0]?.top;
await page.evaluate(
	({ selector, id }) => {
		const element = document.querySelector(selector)?.contentDocument?.querySelector(`[data-id="${id}"]`);
		if (element) element.style.top = `${element.offsetTop + 200}px`;
	},
	{ selector: `.board-node[data-path="${path}"] iframe`, id: ids[0] },
);
await settle(page, 500);
const moved = await marks();
/*
 * This is why the anchor is a `data-id` rather than a coordinate: the position is re-read
 * from the board's own DOM on every draw, so a component that is dragged takes its arrow
 * with it instead of leaving it pointing at where it used to be.
 */
say("an arrow follows the component it points at", moved[0]?.top !== wasTop, `${wasTop} → ${moved[0]?.top}`);

// --- clearing is per agent -------------------------------------------------------------

await call("c2", { args: { agentId: "B", path, marks: [{ to: ids[0], label: "another agent's" }] } });
await settle(page, 500);
say("a second agent's mark joins rather than replacing", (await marks()).length === 3, JSON.stringify((await marks()).map((mark) => mark.say)));

await call("c3", { args: { agentId: "A", path, marks: null } });
await settle(page, 500);
const left = await marks();
say("null clears that agent's marks", left.length === 1, JSON.stringify(left.map((mark) => mark.say)));
say("…and leaves the other agent's alone", left[0]?.say === "another agent's", JSON.stringify(left[0]?.say));

await call("c4", { args: { agentId: "B", path, marks: [] } });
await settle(page, 400);
say("an empty list clears too", (await marks()).length === 0);

// --- a board that is not on the canvas --------------------------------------------------

await call("c5", { args: { agentId: "A", path: "boards/not-here.html", marks: [{ to: "x", label: "y" }] } });
await settle(page, 400);
say("a board that is not on the canvas is an error, not a silent no-op", Boolean((await lastResult())?.error), JSON.stringify(await lastResult()));

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
