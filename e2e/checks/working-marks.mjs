/**
 * The four working marks: which drawing is in, and what each does while a turn runs.
 *
 * A mark is the smallest thing in this app and the one thing on screen for the whole of a turn,
 * so it is worth its own check rather than a clause in a bigger one. Three questions:
 *
 * 1. **Are the four drawings the four runtimes' own?** opencode's symbol is a frame with a hole
 *    in it and a block in the lower half of that hole, taken from its published vector;
 *    antigravity's is a single arch traced from its published icon. Both are asserted by shape,
 *    not by name: the frame has an `evenodd` ring, the arch is one very long path.
 * 2. **Does each working drawing belong to its own runtime?** Pi builds ten cells, Claude cycles
 *    ten glyphs, opencode draws four walls and fills them, antigravity reveals an arch along its
 *    own centreline and lifts. Four different drawings, four different animations, and the check
 *    fails if any of them starts borrowing another's.
 * 3. **Does each of them still paint when motion is off?** The trap the stylesheet records: an
 *    `animation: none` on an element whose first keyframe is `opacity: 0` or `scale(0)` leaves
 *    nothing at all, and nothing at all is what a mark must never be. So under reduced motion
 *    every mark is asserted twice: no animation is running, and the mark still paints pixels that
 *    are not there when it is hidden.
 *
 * The socket is driven directly, as `agents-tab.mjs` does: four runtimes in one turn each would
 * otherwise be four real sessions and a model.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 950 });

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
const chat = (id, name, kind, state) => ({
	id,
	name,
	kind,
	state,
	lastAt: Date.now() - 4_000,
	lastLine: "Reading the file",
	unread: 0,
	identity: { name, color: "#3b5cf6" },
	boards: ["boards/plan.html"],
	inPlay: [],
});

const KINDS = ["pi", "claude", "opencode", "antigravity"];

// --- the still drawings ---------------------------------------------------------------------

/*
 * The add-agent menu is the one surface that draws all four still marks at once: the panel's rows
 * draw faces, and a face is an avatar rather than a runtime. It opens from the composer's `+`.
 */
await page.locator(".dock-to-new").click();
await page.waitForSelector(".popover [data-row]", { timeout: 4000 });
await settle(page, 300);

const still = await page.evaluate(() =>
	[...document.querySelectorAll(".popover [data-row] svg[data-agent]")].map((svg) => ({
		agent: svg.dataset.agent,
		/* The drawing, and not the definitions a working mark carries: `defs` holds a clip and a
		   mask path, which are not part of what the mark draws. */
		paths: svg.querySelectorAll("g > path").length,
		holes: svg.querySelectorAll("path[fill-rule='evenodd']").length,
		longest: Math.max(0, ...[...svg.querySelectorAll("g > path")].map((one) => (one.getAttribute("d") ?? "").length)),
		first: svg.querySelector("g > path")?.getAttribute("d")?.slice(0, 16) ?? "",
	})),
);

say("the menu draws one still mark per runtime", still.length === 4, JSON.stringify(still.map((one) => one.agent)));
const opencodeStill = still.find((one) => one.agent === "opencode");
const antigravityStill = still.find((one) => one.agent === "antigravity");
/*
 * opencode's symbol: two paths, and the frame is a ring rather than a rectangle, which is the
 * whole of what makes it a frame. The old sign was two solid shapes of 40 and 20 characters; this
 * one starts on the frame's own first corner.
 */
say(
	"…opencode's is its published symbol: a ring with a hole, and a block in it",
	opencodeStill?.paths === 2 && opencodeStill.holes === 1 && opencodeStill.first.startsWith("M384 416H128V96"),
	JSON.stringify(opencodeStill),
);
say(
	"…antigravity's is the arch traced from its icon",
	antigravityStill?.paths === 1 && antigravityStill.longest > 2_000 && (antigravityStill.first ?? "").startsWith("M25.8"),
	JSON.stringify(antigravityStill),
);
say("…and Pi's and Claude's are where they were", still.filter((one) => one.agent === "pi" || one.agent === "claude").every((one) => one.paths >= 1), JSON.stringify(still.map((one) => one.paths)));

await page.keyboard.press("Escape");
await settle(page, 300);

// --- the working drawings --------------------------------------------------------------------

/**
 * Is the mark on screen at all?
 *
 * A picture comparison was tried here and it lies: the mark animates between the two frames, so
 * the shots differ whether or not anything is drawn. What the check can say exactly is that one
 * of the two placements is up, and then the rest-state assertions below say what is inside it,
 * which is where the trap actually lives: an `animation: none` on something whose first keyframe
 * is `scale(0)` or `opacity: 0` leaves a mark that is on screen and empty.
 */
const onScreen = async (selector) => (await page.locator(`${selector}:visible`).count()) > 0;

const busy = async (kind) => {
	await feed({ type: "agents", defaultKind: "pi", focused: "a1", chats: [chat("a1", "One", kind, "streaming")] });
	await settle(page, 400);
	return page.evaluate(() => {
		const svg = document.querySelector("svg.mark[data-agent][data-busy]");
		if (!svg) return null;
		const animations = svg.getAnimations({ subtree: true });
		return {
			agent: svg.dataset.agent,
			names: [...new Set(animations.map((one) => one.animationName))].sort(),
			running: animations.filter((one) => one.playState === "running").length,
			tiles: svg.querySelectorAll(".pi-tile").length,
			frames: svg.querySelectorAll(".claude-frame").length,
			walls: svg.querySelectorAll(".oc-wall").length,
			fills: svg.querySelectorAll(".oc-fill").length,
			traces: svg.querySelectorAll(".ag-trace").length,
		};
	});
};

const shapes = {};
for (const kind of KINDS) {
	const mark = await busy(kind);
	shapes[kind] = mark;
	say(`a ${kind} turn draws its own working mark`, mark?.agent === kind && mark.running > 0, JSON.stringify(mark));
	/*
	 * The sign is drawn in two places and only one is up, so "it is on screen" is worth saying:
	 * a mark that is animating inside a `display: none` box is a mark nobody will ever see.
	 */
	say(`…and it is the one on screen`, await onScreen(`svg.mark[data-agent="${kind}"]`), "neither placement is visible");
}

say("Pi builds cells", shapes.pi?.tiles === 10 && shapes.pi.names.join(",") === "pi-build", JSON.stringify(shapes.pi));
say("Claude cycles glyphs", shapes.claude?.frames === 10 && shapes.claude.names.join(",") === "claude-cycle", JSON.stringify(shapes.claude));
say(
	"opencode draws a frame and fills it",
	shapes.opencode?.walls === 4 && shapes.opencode.fills === 1 && shapes.opencode.names.join(",") === "oc-cycle,oc-draw-x,oc-draw-y,oc-fill",
	JSON.stringify(shapes.opencode),
);
say(
	"antigravity reveals an arch and lifts it",
	shapes.antigravity?.traces === 1 && shapes.antigravity.names.join(",") === "ag-cycle,ag-draw",
	JSON.stringify(shapes.antigravity),
);
say(
	"four runtimes, four drawings",
	new Set(KINDS.map((kind) => JSON.stringify([shapes[kind]?.tiles, shapes[kind]?.frames, shapes[kind]?.walls, shapes[kind]?.traces]))).size === 4,
	JSON.stringify(KINDS.map((kind) => shapes[kind]?.names.join("+"))),
);

// --- motion off ------------------------------------------------------------------------------

await page.emulateMedia({ reducedMotion: "reduce" });
await settle(page, 300);

for (const kind of KINDS) {
	await busy(kind);
	const at = await page.evaluate(() => {
		const svg = document.querySelector("svg.mark[data-agent][data-busy]");
		if (!svg) return null;
		const style = (selector) => {
			const el = svg.querySelector(selector);
			if (!el) return null;
			const computed = getComputedStyle(el);
			return { opacity: computed.opacity, transform: computed.transform, dash: computed.strokeDashoffset };
		};
		return {
			running: svg.getAnimations({ subtree: true }).filter((one) => one.playState === "running").length,
			tiles: [...svg.querySelectorAll(".pi-tile")].map(() => style(".pi-tile")),
			frames: [...svg.querySelectorAll(".claude-frame")].map((one) => getComputedStyle(one).opacity),
			walls: [...svg.querySelectorAll(".oc-wall")].map((_, index) => style(`.oc-wall:nth-of-type(${index + 1})`)),
			fill: style(".oc-fill"),
			trace: style(".ag-trace"),
			cycle: style(".ag-cycle"),
		};
	});
	say(`a ${kind} mark stops when motion is off`, at?.running === 0, JSON.stringify(at?.running));
	/*
	 * And it stops *finished*, which is the part that regresses silently: Pi's tiles at full
	 * strength, Claude on its widest frame, opencode's walls and block at rest, antigravity's
	 * reveal at zero offset.
	 */
	const rests =
		kind === "pi"
			? at?.tiles.length === 10 && at.tiles.every((one) => one.opacity === "1" && one.transform === "none")
			: kind === "claude"
				? at?.frames.filter((one) => one === "1").length === 1
				: kind === "opencode"
					? at?.walls.length === 4 && at.walls.every((one) => one.transform === "none") && at.fill.transform === "none" && at.fill.opacity === "1"
					: at?.trace.dash === "0px" && at.cycle.opacity === "1";
	say(`…as the complete ${kind} mark rather than an empty one`, rests, JSON.stringify(at));
	say(`…and it is still on screen`, await onScreen(`svg.mark[data-agent="${kind}"]`), "the stopped mark is hidden");
}

say("no page errors", errors.length === 0, errors.join(" | "));

await browser.close();
