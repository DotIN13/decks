/**
 * The canvas frame held past pass renewals, a dropped line and a restarted server (cases 1, 2, 3a, 3b and 4 below):
 * do the person's edits and undo go on? The pass lives PASS_MS: DECKS_PASS_MS on a restarted server,
 * else its answer shortened on the way to the page. Run: node tools/checks/run.mjs <this file>.
 */
import { API, asPerson, canvasFrame, focusCanvas, open, resetStage, rest, say, settle, socket } from "../harness.mjs";

const PASS_MS = 8000;
const CONTROL = process.env.DECKS_E2E_CONTROL;

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

/** A program restarted by the runner, with variables of its own. */
async function restart(program, env = {}) {
	const answer = await fetch(`${CONTROL}/restart`, { method: "POST", body: JSON.stringify({ program, env }) }).then((r) => r.json());
	if (!answer.ok) throw new Error(`restart ${program}: ${answer.error}`);
}

// The server, with a short pass, before the page opens.

if (CONTROL) await restart("server", { DECKS_PASS_MS: String(PASS_MS) });
await resetStage();

/** What the frame's line and its passes did: renewals asked, lines opened and closed (with their codes). */
const seen = { passes: 0, shortened: false, opened: 0, closes: [] };
/** onRenewal: called while a renewal is in flight, before its answer goes on to the page (case 2). */
const hooks = { onRenewal: undefined };
/** The frame's live line, as routed, so a case can drop it (case 3). */
const lines = [];

const { browser, page, errors } = await open({
	width: 1500,
	height: 950,
	before: async (pg) => {
		await pg.route(/\/api\/passes$/, async (route) => {
			seen.passes += 1;
			if (hooks.onRenewal) await hooks.onRenewal();
			const response = await route.fetch();
			const body = await response.json().catch(() => undefined);
			if (body?.expires && body.expires - Date.now() > 60_000) {
				body.expires = Date.now() + PASS_MS;
				seen.shortened = true;
			}
			await route.fulfill({ response, json: body });
		});
		await pg.routeWebSocket(/\/(api|compat)\/v1\/socket/, (ws) => {
			const server = ws.connectToServer();
			const line = { ws, server, open: true };
			lines.push(line);
			seen.opened += 1;
			ws.onMessage((m) => line.open && server.send(m));
			server.onMessage((m) => line.open && ws.send(m));
			server.onClose((code) => line.open && (seen.closes.push(`server ${code}`), (line.open = false), ws.close({ code }).catch(() => {})));
			ws.onClose((code) => line.open && (seen.closes.push(`frame ${code}`), (line.open = false), server.close({ code }).catch(() => {})));
		});
	},
});
await rest(page, { start: 300 });
const cv = () => canvasFrame(page);

/** The server's drawing, as the page's socket follows it (wire.link, made again after a restart). */
const wire = { link: await socket() };
const agentId = await until(async () => wire.link.last("agents")?.focused);
const onServer = (id) => wire.link.last("stage.pen")?.doc?.children?.find((n) => n.id === id);
const inFrame = (id) => cv().then((c) => c.evaluate((id) => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).find((n) => n.id === id) ?? null, id));
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args }) })).json();
wire.link.send({ type: "stage.pen.get", agentId });

// Two rectangles on bare canvas, at 100%.
const spot = await (await cv()).evaluate(() => ({ x: Math.max(...globalThis.__decksProbes.rust.placedCards.map((b) => b.x + b.w), 0) + 4000, y: 0 }));
for (let i = 0; i < 4; i++) {
	await call("view.move", [{ x: spot.x, y: spot.y, zoom: 1 }]);
	if (await until(() => cv().then((c) => c.evaluate((x) => Math.abs(globalThis.__decksProbes.rust.camera.zoom - 1) < 0.01 && Math.abs(globalThis.__decksProbes.rust.camera.x - x) < 2000, spot.x)), 4000)) break;
}
await settle(page, 600);
const cam = await (await cv()).evaluate(() => globalThis.__decksProbes.rust.camera);
const at = (dx, dy) => ({ x1: Math.round(cam.x + dx), y1: Math.round(cam.y + dy), x2: Math.round(cam.x + dx + 120), y2: Math.round(cam.y + dy + 80) });
wire.link.send({ type: "stage.pen.edit", agentId, ops: [
	{ op: "insert", node: { type: "rectangle", id: "rn-a", fill: "#4c8bf5" }, box: at(-300, -150) },
	{ op: "insert", node: { type: "rectangle", id: "rn-b", fill: "#f5a04c" }, box: at(-300, 50) },
] });
say("two rectangles reach the frame", !!(await until(async () => (await inFrame("rn-a")) && (await inFrame("rn-b")))));
const x0 = { a: onServer("rn-a")?.x, b: onServer("rn-b")?.x };

const select = async (id) => {
	const b = await until(() => cv().then((c) => c.evaluate((id) => globalThis.__decksProbes?.penBox?.(id)?.toJSON(), id)), 4000);
	await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
	await settle(page, 200);
};
const nudge = () => page.keyboard.press("Shift+ArrowRight");
const undo = async () => {
	await focusCanvas(page);
	await page.keyboard.press("Escape");
	await page.keyboard.press("ControlOrMeta+z");
};
const renewalAfter = (count) => until(async () => seen.passes > count, PASS_MS * 2);
const line = () => `renewals ${seen.passes}${seen.shortened ? " (shortened on the way: the server ignores DECKS_PASS_MS)" : ""}, lines opened ${seen.opened}, closed [${seen.closes.join(", ")}]`;

// 1. Two edits, a renewal, then both undone.
{
	await select("rn-a");
	await nudge();
	await select("rn-b");
	await nudge();
	const moved = await until(async () => onServer("rn-a")?.x === x0.a + 10 && onServer("rn-b")?.x === x0.b + 10);
	say("1. two nudges land on the server", !!moved, JSON.stringify({ a: onServer("rn-a")?.x, b: onServer("rn-b")?.x, was: x0 }));
	const before = seen.passes;
	const closed = seen.closes.length;
	say("1. a renewal comes", !!(await renewalAfter(before)), line());
	await settle(page, 1000);
	say("1. the frame's line stays open through the renewal", seen.closes.length === closed, line());
	await undo();
	await undo();
	const back = await until(async () => onServer("rn-a")?.x === x0.a && onServer("rn-b")?.x === x0.b);
	say("1. ⌘Z twice after the renewal takes both back on the server", !!back, JSON.stringify({ a: onServer("rn-a")?.x, b: onServer("rn-b")?.x, was: x0 }));
	const shown = await until(async () => (await inFrame("rn-a"))?.x === x0.a && (await inFrame("rn-b"))?.x === x0.b);
	say("1. …and the frame draws them back", !!shown, JSON.stringify({ a: (await inFrame("rn-a"))?.x, b: (await inFrame("rn-b"))?.x }));
}

// 2. A nudge while a renewal is in flight lands once.
{
	await select("rn-a");
	const from = onServer("rn-a")?.x;
	const closed = seen.closes.length;
	let pressed = false;
	hooks.onRenewal = async () => {
		if (pressed) return;
		pressed = true;
		await nudge();
	};
	await until(async () => pressed, PASS_MS * 2);
	hooks.onRenewal = undefined;
	await settle(page, 2500);
	say("2. a nudge made during a renewal lands once on the server", onServer("rn-a")?.x === from + 10, `${from} → ${onServer("rn-a")?.x}; ${line()}`);
	say("2. …and the frame draws it once", (await inFrame("rn-a"))?.x === from + 10, String((await inFrame("rn-a"))?.x));
	say("2. the line stays open", seen.closes.length === closed, line());
}

// 3a. The line dropped and back, nobody else changing the drawing: ⌘Z still takes back the nudge before the drop.
const drop = async () => {
	for (const one of lines.filter((l) => l.open)) {
		one.open = false;
		seen.closes.push("dropped by the check");
		await one.ws.close({ code: 1006 }).catch(() => one.ws.close().catch(() => {}));
		await one.server.close().catch(() => {});
	}
};
{
	await select("rn-b");
	const from = onServer("rn-b")?.x;
	await nudge();
	await until(async () => onServer("rn-b")?.x === from + 10);
	const opened = seen.opened;
	await drop();
	say("3a. the frame opens its line again", !!(await until(async () => seen.opened > opened, 15000)), line());
	await settle(page, 1000);
	await undo();
	const back = await until(async () => onServer("rn-b")?.x === from);
	say("3a. ⌘Z after the drop takes back the nudge made before it", !!back, `${from} → ${onServer("rn-b")?.x}`);
	say("3a. …and the frame draws it back", !!(await until(async () => (await inFrame("rn-b"))?.x === from)), String((await inFrame("rn-b"))?.x));
}

// 3b. An agent changes the drawing after the person's nudge: ⌘Z is refused (server/canvas/log.ts), and the person is told why.
{
	await select("rn-b");
	const from = onServer("rn-b")?.x;
	await nudge();
	await until(async () => onServer("rn-b")?.x === from + 10);
	wire.link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "rn-c", fill: "#5cbf6a" }, box: at(-100, -150) }] });
	say("3b. the agent's rectangle reaches the frame", !!(await until(async () => await inFrame("rn-c"), 10000)));
	await undo();
	await settle(page, 1500);
	say("3b. ⌘Z after an agent's edit leaves the nudge in place", onServer("rn-b")?.x === from + 10, `${from + 10} → ${onServer("rn-b")?.x}`);
	const told = await until(async () => {
		const words = [await page.evaluate(() => document.body.innerText), await (await cv()).evaluate(() => document.body.innerText)].join(" ");
		return /cannot be undone|changed the drawing since/i.test(words) && words.match(/[^.\n]*(cannot be undone|changed the drawing since)[^.\n]*/i)?.[0];
	}, 5000);
	say("3b. …and the person is told why", !!told, told || "no notice with 'cannot be undone' on the page or in the frame");
}

// 4. The server restarted: the frame reads the drawing again and goes on.
if (!CONTROL) say("4. the runner's control is there to restart the server", false, "run under tools/checks/run.mjs");
else {
	wire.link.close();
	await restart("server", { DECKS_PASS_MS: String(PASS_MS) });
	// The person's token is new after a restart, and the harness's helpers keep the first per address: ask by another name for it.
	const api = API.replace("127.0.0.1", "localhost");
	wire.link = await socket(api);
	wire.link.send({ type: "stage.pen.get", agentId });
	await until(async () => wire.link.last("stage.pen"));
	wire.link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "rn-d", fill: "#b05cbf" }, box: at(100, -150) }] });
	const reread = await until(async () => await inFrame("rn-d"), 20000);
	say("4. after a restart the frame draws a change made after it", !!reread, line());
	await select("rn-a");
	const from = onServer("rn-a")?.x;
	await nudge();
	const landed = await until(async () => onServer("rn-a")?.x === from + 10, 8000);
	say("4. …and a nudge after the restart lands", !!landed, `${from} → ${onServer("rn-a")?.x}`);
}

console.log(`seen: ${line()}`);
say("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));
wire.link.close();
await browser.close();
