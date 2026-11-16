#!/usr/bin/env node
/**
 * Step 1's proof: restart the server under an open page, and the page is live again by itself.
 *
 *     npm run build --workspace @decks/web     # the server serves the built page
 *     node scripts/restart-check.mjs            # RESTART_PORT=4560 by default
 *
 * A server of its own on a copy of the fixture deck, never the address file's (`DECKS_ADDRESS=0`).
 * It opens the Decks page, waits for the page's line and the canvas frame's line (both sockets at
 * `/api/v1/socket`), kills the server (SIGKILL: no goodbye), starts it again, and then asks, without
 * touching the page: both lines are open again, a note put on the canvas through the API after the
 * restart reaches the open canvas as a change, and the page shows no notice. Each within `LIMIT_MS`.
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "e2e", "package.json"))("playwright");
const PORT = Number(process.env.RESTART_PORT ?? 4560);
const LIMIT_MS = 5000;
const url = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const data = mkdtempSync(join(tmpdir(), "decks-e2e-restart-"));
cpSync(join(root, "e2e", "fixture"), data, { recursive: true });
/*
 * An agent with a record, on the fixture's canvas: a deck's agents come back from their records, and
 * a brand-new agent nobody has spoken to has none yet, so without this the restart would open on a
 * different agent with no canvas.
 */
const AGENT = "00000000-0000-4000-8000-00000000e2e1";
mkdirSync(join(data, "decks", ".decks", "agents", AGENT), { recursive: true });
writeFileSync(join(data, "decks", ".decks", "agents", AGENT, "meta.json"), JSON.stringify({ id: AGENT, kind: "pi", name: "Agent 1", color: "#3b5cf6", context: [], inPlay: [], stage: "auth-refresh", createdAt: Date.now(), lastAt: Date.now() }));

function startServer() {
	const env = { ...process.env, DECKS_DATA_DIR: data, DECKS_PORT: String(PORT), DECKS_HOST: "127.0.0.1", DECKS_ADDRESS: "0", DECKS_RESUME: "0" };
	for (const name of ["DECKS_URL", "DECKS_TOKEN", "DECKS_AGENT", "DECKS_SDK", "DECKS_HOME"]) delete env[name];
	return spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: join(root, "apps", "server"), env, stdio: "ignore" });
}
async function up(limit = 30_000) {
	const until = Date.now() + limit;
	while (Date.now() < until) {
		try {
			await fetch(`${url}/api/hello`, { signal: AbortSignal.timeout(500) });
			return Date.now();
		} catch {
			await sleep(100);
		}
	}
	throw new Error(`no server at ${url} after ${limit} ms`);
}

let server = startServer();
let browser;
const results = [];
const check = (name, ok, detail) => {
	results.push(ok);
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
try {
	await up();
	browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	/** Every socket the page or its frames open, with when it opened, whether it is open, and what it has heard. */
	const sockets = [];
	page.on("websocket", (socket) => {
		const one = { path: new URL(socket.url()).pathname, opened: Date.now(), open: true, heard: [] };
		sockets.push(one);
		socket.on("framereceived", (frame) => one.heard.push({ at: Date.now(), text: String(frame.payload).slice(0, 4000) }));
		socket.on("close", () => (one.open = false));
	});
	/** The lines open since a moment: the page's own and its canvas frame's are both `/api/v1/socket`. */
	const linesSince = (since) => sockets.filter((one) => one.path === "/api/v1/socket" && one.open && one.opened >= since);
	const waitFor = async (what, limit) => {
		const until = Date.now() + limit;
		while (Date.now() < until) {
			const got = what();
			if (got) return got;
			await sleep(50);
		}
		return undefined;
	};

	// Read at each call: the server writes this machine's token afresh at every start.
	const token = () => JSON.parse(readFileSync(join(data, ".decks", "cli-token"), "utf8")).token;
	const call = async (verb, args, headers = {}) => {
		const answer = await fetch(`${url}/api/v1/${verb}`, { method: "POST", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
		const said = await answer.json().catch(() => ({}));
		return { ok: answer.ok && said.ok !== false, value: said.value, said };
	};
	if (process.env.RESTART_DEBUG) {
		page.on("framenavigated", (frame) => console.log(`   [nav ${Date.now() % 100000}] ${frame.url().slice(0, 90)}`));
		page.on("console", (message) => /error|warn/.test(message.type()) && console.log(`   [${message.type()} ${Date.now() % 100000}] ${message.text().slice(0, 300)}`));
		page.on("pageerror", (error) => console.log(`   [pageerror] ${String(error).slice(0, 300)}`));
		page.on("websocket", (socket) => socket.on("close", () => console.log(`   [ws close ${Date.now() % 100000}]`)));
	}
	await page.goto(url);
	const first = Date.now() - 60_000;
	check("the page's line and the canvas frame's line open", !!(await waitFor(() => linesSince(first).length >= 2, 15_000)), `${linesSince(first).length} open`);
	// Let the first load settle: the frame has greeted and drawn.
	await sleep(1500);
	if (process.env.RESTART_DEBUG) {
		console.log(sockets.map((one) => `${one.path} open=${one.open} heard=${one.heard.length} first=${one.heard[0]?.text.slice(0, 80)}`).join("\n"));
		console.log(page.frames().map((frame) => frame.url().slice(0, 100)).join("\n"));
	}

	server.kill("SIGKILL");
	await new Promise((done) => server.once("exit", done));
	await sleep(700);
	server = startServer();
	const back = await up();

	const bothBack = await waitFor(() => linesSince(back - 50).length >= 2, LIMIT_MS);
	const lines = linesSince(back - 50);
	check("after a restart both lines are open again", !!bothBack, bothBack ? `${Math.max(...lines.map((one) => one.opened)) - back} ms after the server answered` : `${lines.length} of 2 within ${LIMIT_MS} ms`);

	// A change made through the API after the restart reaches the open frame.
	const marker = `restart-${Date.now()}`;
	const asked = Date.now();
	const made = await call("canvas.insert", [{ type: "note", content: marker }, { canvas: "auth-refresh", at: { x1: 40, y1: 40 } }]);
	check("the API takes an edit after the restart", made.ok, made.ok ? undefined : JSON.stringify(made.said).slice(0, 200));
	// The frame's own line is the one greeted as a canvas: it is what draws the canvas the person is looking at.
	const frameLine = () => linesSince(back - 50).find((one) => /"who":"canvas"/.test(one.heard[0]?.text ?? ""));
	const heard = await waitFor(() => frameLine()?.heard.find((frame) => frame.at >= asked && frame.text.includes(marker)), LIMIT_MS);
	check("the canvas frame hears that edit", !!heard, heard ? `${heard.at - asked} ms after it was made` : `not within ${LIMIT_MS} ms`);
	if (process.env.RESTART_DEBUG) for (const one of sockets) console.log(`-- ${one.path} opened ${one.opened - back} ms open=${one.open}\n${one.heard.slice(0, 2).concat(one.heard.slice(-4)).map((frame) => `   ${frame.at - back}: ${frame.text.slice(0, 260)}`).join("\n")}`);
	// And nothing on the page says it lost the server.
	const lost = await page.evaluate(() => /reconnect|disconnected|connection lost|could not reach/i.test(document.body.innerText));
	check("the page shows no lost-connection notice", !lost);
} catch (error) {
	check("the check ran", false, error?.stack ?? String(error));
} finally {
	await browser?.close().catch(() => {});
	server.kill("SIGKILL");
	rmSync(data, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
