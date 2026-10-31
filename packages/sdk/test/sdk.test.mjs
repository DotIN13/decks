import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { argsOf, verbOf } from "../bin/decks.mjs";
import { connect, DecksError, VERBS } from "../src/index.js";

const run = promisify(execFile);
const BIN = fileURLToPath(new URL("../bin/decks", import.meta.url));
const MCP = fileURLToPath(new URL("../mcp/server.mjs", import.meta.url));
/** The verb table the SDK and the MCP server are generated from: the counts below come from it, not from a number typed here. */
const TABLE = JSON.parse(readFileSync(new URL("../src/verbs.json", import.meta.url), "utf8"));

/** A stand-in for Decks' /api/v1: records each call and answers from a small table of verbs. */
async function fakeDecks() {
	const seen = [];
	const answers = {
		"card.list": () => ({ ok: true, value: [{ path: "canvases/plan/cards/a/index.html", title: "A" }], notes: [] }),
		"card.create": ([options]) => ({ ok: true, value: { path: `canvases/plan/cards/${options.title.toLowerCase().replace(/\W+/g, "-")}/index.html`, title: options.title }, notes: ["Not placed yet."] }),
		"canvas.batch": ([ops]) => ({ ok: true, value: ops.map((op) => ({ op: op.op, id: op.id ?? "n1" })), notes: [] }),
		"view.focus": (args) => ({ ok: true, value: { canvas: "plan", target: args[0] }, notes: [] }),
		"canvas.fit": () => ({ ok: false, error: "canvases/plan/cards/x/index.html is not on the canvas.", notes: [] }),
	};
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			const sent = JSON.parse(body || "{}");
			// The doors `decks login` and `decks logout` use.
			if (req.url === "/api/login") {
				res.setHeader("content-type", "application/json");
				if (sent.code === "123456") res.end(JSON.stringify({ token: "dk_h_from-login", name: "Test" }));
				else {
					res.statusCode = 403;
					res.end(JSON.stringify({ error: "That code is wrong or has expired." }));
				}
				return;
			}
			if (req.url === "/api/session") {
				seen.push({ verb: `${req.method} session`, token: req.headers.authorization });
				res.end("{}");
				return;
			}
			const verb = decodeURIComponent(req.url.replace(/^\/api\/v1\//, ""));
			seen.push({ verb, args: sent.args, token: req.headers.authorization, agent: req.headers["x-decks-agent"], app: req.headers["x-decks-app"], person: req.headers["x-decks-person"] });
			const answer = answers[verb]?.(sent.args ?? []) ?? { ok: false, error: `There is no verb called ${verb}.`, notes: [] };
			res.statusCode = answer.ok ? 200 : 422;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(answer));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;
	return { url, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("the SDK has every verb in the table, groups nested", () => {
	assert.deepEqual(VERBS.map(([name]) => name), TABLE.map((verb) => verb.name), `the ${TABLE.length} calls of the table`);
	const decks = connect({ url: "http://127.0.0.1:1", token: "dk_h_x" });
	assert.equal(typeof decks.canvas.insert, "function");
	assert.equal(typeof decks.card.create, "function");
	assert.equal(typeof decks.agent.send, "function");
	assert.equal(typeof decks.here, "function");
	assert.equal(typeof decks.apps.build, "function");
	// The names from before cards are gone, and so is the old decks.stage.
	assert.equal(decks.newBoard, undefined);
	assert.equal(decks.board, undefined);
	assert.equal(decks.pen, undefined);
	assert.equal(decks.stage, undefined);
	assert.ok(TABLE.every((verb) => !/^(board\.|newBoard$|boards$|pen\.)/.test(verb.name) && !("alias" in verb)), "no old name in the table");
});

test("a verb posts its arguments with the caller's token, and answers with the value; notes go where asked", async () => {
	const fake = await fakeDecks();
	try {
		const notes = [];
		const decks = connect({ url: fake.url, token: "dk_h_wren", notes: (lines) => notes.push(...lines) });
		assert.deepEqual(await decks.card.list(), [{ path: "canvases/plan/cards/a/index.html", title: "A" }]);
		assert.deepEqual(await decks.card.create({ title: "Q3 revenue" }), { path: "canvases/plan/cards/q3-revenue/index.html", title: "Q3 revenue" });
		assert.deepEqual(notes, ["Not placed yet."]);
		await decks.view.focus("canvases/plan/cards/a/index.html", undefined);
		assert.deepEqual(fake.seen.at(-1), { verb: "view.focus", args: ["canvases/plan/cards/a/index.html"], token: "Bearer dk_h_wren", agent: undefined, app: undefined, person: undefined }, "a trailing undefined stays absent, and no header names the caller");
		await assert.rejects(decks.canvas.fit("canvases/plan/cards/x/index.html"), (error) => error instanceof DecksError && error.status === 422 && /not on the canvas/.test(error.message));
		const refused = connect({ url: fake.url, fetch: async () => new Response("Every request to this harness carries a token.", { status: 401 }) });
		await assert.rejects(refused.card.list(), (error) => error.status === 401 && /carries a token/.test(error.message), "the gate's sentence comes through");
	} finally {
		await fake.close();
	}
});

test("the token comes from the options, else DECKS_TOKEN, else the one decks login kept for this address", async () => {
	const fake = await fakeDecks();
	const home = mkdtempSync(join(tmpdir(), "decks-sdk-home-"));
	const before = { token: process.env.DECKS_TOKEN, home: process.env.DECKS_HOME };
	try {
		process.env.DECKS_HOME = home;
		delete process.env.DECKS_TOKEN;
		writeFileSync(join(home, "token"), JSON.stringify({ [fake.url]: "dk_h_saved", "http://elsewhere:1": "dk_h_other" }));
		await connect({ url: fake.url }).card.list();
		assert.equal(fake.seen.at(-1).token, "Bearer dk_h_saved", "the kept one, for this address");
		process.env.DECKS_TOKEN = "dk_h_env";
		await connect({ url: fake.url }).card.list();
		assert.equal(fake.seen.at(-1).token, "Bearer dk_h_env");
		await connect({ url: fake.url, token: "dk_h_given" }).card.list();
		assert.equal(fake.seen.at(-1).token, "Bearer dk_h_given");
		delete process.env.DECKS_TOKEN;
		await connect({ url: "http://127.0.0.1:1", fetch: async (_url, init) => {
			fake.seen.push({ verb: "none", token: init.headers.authorization });
			return new Response(JSON.stringify({ ok: true, value: 1, notes: [] }));
		} }).card.list();
		assert.equal(fake.seen.at(-1).token, undefined, "no token kept for that address: none sent");
		// The person's acting-on, sent as parameters.
		await connect({ url: fake.url, token: "dk_h_x", agent: () => "a1", stage: "home" }).card.list();
		assert.equal(fake.seen.at(-1).agent, "a1");
	} finally {
		if (before.token === undefined) delete process.env.DECKS_TOKEN;
		else process.env.DECKS_TOKEN = before.token;
		if (before.home === undefined) delete process.env.DECKS_HOME;
		else process.env.DECKS_HOME = before.home;
		await fake.close();
	}
});

test("decks login keeps the person's token for the harness, only this user can read it, and decks logout takes it back", async () => {
	const fake = await fakeDecks();
	const home = mkdtempSync(join(tmpdir(), "decks-login-"));
	const env = { ...process.env, DECKS_URL: fake.url, DECKS_HOME: home, DECKS_TOKEN: "", DECKS_NODE: process.execPath };
	try {
		await assert.rejects(run(BIN, ["login", "000000"], { env }), (error) => error.code === 1 && /wrong or has expired/.test(error.stderr));
		const done = await run(BIN, ["login", "123456"], { env });
		assert.match(done.stderr, /Logged in to Test/);
		assert.deepEqual(JSON.parse(readFileSync(join(home, "token"), "utf8")), { [fake.url]: "dk_h_from-login" });
		assert.equal(statSync(join(home, "token")).mode & 0o777, 0o600);
		await run(BIN, ["card", "list"], { env });
		assert.equal(fake.seen.at(-1).token, "Bearer dk_h_from-login");
		await run(BIN, ["logout"], { env });
		assert.deepEqual(fake.seen.at(-1), { verb: "DELETE session", token: "Bearer dk_h_from-login" });
		assert.deepEqual(JSON.parse(readFileSync(join(home, "token"), "utf8")), {});
	} finally {
		await fake.close();
	}
});

test("the decks command turns words, flags and JSON into the verb's arguments", () => {
	const of = (line) => {
		const { verb, rest } = verbOf(line);
		return [verb.name, argsOf(verb, rest)];
	};
	// Noun then verb, with --canvas for the canvas.
	assert.deepEqual(of(["canvas", "insert", "--type", "card", "--card", "cards/a/index.html", "--beside", "n1", "--canvas", "plan"]), ["canvas.insert", [{ type: "card", card: "cards/a/index.html" }, { beside: "n1", canvas: "plan" }]]);
	assert.deepEqual(of(["canvas", "insert", '{"type":"note","content":"hi"}', "--at.x1", "0", "--at.y1", "160"]), ["canvas.insert", [{ type: "note", content: "hi" }, { at: { x1: 0, y1: 160 } }]]);
	assert.deepEqual(of(["canvas", "fit", "cards/a/index.html", "--canvas", "plan"]), ["canvas.fit", ["cards/a/index.html", { canvas: "plan" }]]);
	// A record takes any key: a variable's light and dark as flags, --canvas still the option.
	assert.deepEqual(of(["canvas", "variables", "--brand.light", "#4f46e5", "--brand.dark", "#818cf8", "--canvas", "plan"]), ["canvas.variables", [{ brand: { light: "#4f46e5", dark: "#818cf8" } }, { canvas: "plan" }]]);
	// --frame points an item call at a frame file instead.
	assert.deepEqual(of(["canvas", "update", "t1", "--set.content", "Hi", "--frame", "frames/card"]), ["canvas.update", ["t1", { set: { content: "Hi" } }, { frame: "frames/card" }]]);
	assert.deepEqual(of(["canvas", "read", "--frame", "frames/card"]), ["canvas.read", [{ frame: "frames/card" }]]);
	assert.deepEqual(of(["agent", "send", "Rune", "--task", "look"]), ["agent.send", ["Rune", { task: "look" }]]);
	assert.deepEqual(of(["view", "goto", "plan"]), ["view.goto", ["plan"]]);
	assert.deepEqual(of(["here"]), ["here", []]);
	assert.deepEqual(of(["card", "create", "--title", "Q3"]), ["card.create", [{ title: "Q3" }]]);
	assert.deepEqual(of(["view", "reload", "--card", "cards/a/index.html"]), ["view.reload", [{ card: "cards/a/index.html" }]]);
	// The names from before cards are not commands now, and the old flag is refused.
	for (const old of [["board", "create"], ["new-board"], ["move"], ["hide"], ["show"], ["pen", "edit"], ["camera"], ["send"]]) assert.equal(verbOf(old), undefined, old.join(" "));
	assert.throws(() => of(["view", "reload", "--board", "boards/a.html"]), /has no flag --board/);
	assert.deepEqual(of(["canvas", "move", "n1", "--at.x1", "10", "--at.y1", "20"]), ["canvas.move", ["n1", { at: { x1: 10, y1: 20 } }]]);
	assert.deepEqual(of(["canvas", "delete", "n1"]), ["canvas.delete", ["n1"]]);
	// A list of cards is several words or one JSON list, for every call that takes one.
	assert.deepEqual(of(["agent", "claim", '["cards/a/index.html","cards/b/index.html"]']), ["agent.claim", [["cards/a/index.html", "cards/b/index.html"]]]);
	assert.deepEqual(of(["agent", "claim", "cards/a/index.html", "cards/b/index.html"]), ["agent.claim", [["cards/a/index.html", "cards/b/index.html"]]]);
	assert.deepEqual(of(["view", "focus", "cards/a/index.html", "cards/b/index.html", "--canvas", "plan"]), ["view.focus", [["cards/a/index.html", "cards/b/index.html"], { canvas: "plan" }]]);
	assert.deepEqual(of(["view", "focus", '["title","p4"]']), ["view.focus", [["title", "p4"]]]);
	assert.deepEqual(of(["view", "focus", "cards/a/index.html"]), ["view.focus", ["cards/a/index.html"]]);
	assert.deepEqual(of(["view", "camera"]), ["view.camera", []]);
	assert.deepEqual(of(["view", "move", "--x", "0", "--y", "0", "--zoom", "1"]), ["view.move", [{ x: 0, y: 0, zoom: 1 }]]);
	assert.deepEqual(of(["canvas", "rename", "Q3 numbers"]), ["canvas.rename", ["Q3 numbers"]]);
	assert.deepEqual(of(["canvas", "move", "--args", '["n1",{"at":{"x1":1,"y1":2}}]']), ["canvas.move", ["n1", { at: { x1: 1, y1: 2 } }]]);
	assert.throws(() => of(["card", "create", "--colour", "red"]), /has no flag --colour/);
});

test("the decks command prints the value to stdout and notes to stderr, and fails with exit 1", async () => {
	const fake = await fakeDecks();
	try {
		const env = { ...process.env, DECKS_URL: fake.url, DECKS_TOKEN: "dk_h_wren", DECKS_NODE: process.execPath };
		const made = await run(BIN, ["card", "create", "--title", "Q3 revenue"], { env });
		assert.deepEqual(JSON.parse(made.stdout), { path: "canvases/plan/cards/q3-revenue/index.html", title: "Q3 revenue" });
		assert.equal(made.stderr, "Not placed yet.\n");

		const listed = await run(BIN, ["card", "list"], { env });
		assert.deepEqual(JSON.parse(listed.stdout), [{ path: "canvases/plan/cards/a/index.html", title: "A" }]);

		const edited = await run("sh", ["-c", `echo '[{"op":"delete","id":"n9"}]' | "${BIN}" canvas batch -`], { env });
		assert.deepEqual(JSON.parse(edited.stdout), [{ op: "delete", id: "n9" }]);

		await assert.rejects(run(BIN, ["canvas", "fit", "canvases/plan/cards/x/index.html"], { env }), (error) => error.code === 1 && /not on the canvas/.test(error.stderr));
		// An old name is no command now: refused with exit 1, pointing at the list, and nothing is sent.
		const calls = fake.seen.length;
		await assert.rejects(run(BIN, ["new-board", "--title", "Q3 revenue"], { env }), (error) => error.code === 1 && /no command "new-board --title"\. decks --help lists them/.test(error.stderr));
		await assert.rejects(run(BIN, ["board", "create", "--title", "Q3"], { env }), (error) => error.code === 1 && /no command "board create"/.test(error.stderr));
		assert.equal(fake.seen.length, calls, "no call reached Decks");
		const help = await run(BIN, ["--help"], { env });
		assert.match(help.stdout, /canvas insert +Add an item to the canvas\./);
		assert.match(help.stdout, /\ncard:\n  card list /, "the card group");
		assert.doesNotMatch(help.stdout, /old name|new-board|\bboard create/i, "no old name is listed");
	} finally {
		await fake.close();
	}
});

test("the MCP server lists each verb as a tool and calls it", async () => {
	const fake = await fakeDecks();
	try {
		const lines = [
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "decks_canvas_batch", arguments: { ops: [{ op: "delete", id: "n2" }] } } },
		];
		const child = execFile(process.execPath, [MCP], { env: { ...process.env, DECKS_URL: fake.url, DECKS_TOKEN: "dk_h_wren" } });
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		for (const line of lines) child.stdin.write(`${JSON.stringify(line)}\n`);
		while (output.trim().split("\n").length < 3) await new Promise((resolve) => setTimeout(resolve, 20));
		child.kill();
		const [init, list, call] = output.trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(init.result.protocolVersion, "2025-06-18");
		assert.equal(list.result.tools.length, TABLE.length, "every call");
		assert.ok(list.result.tools.some((tool) => tool.name === "decks_canvas_insert"));
		assert.ok(!list.result.tools.some((tool) => /^decks_(pen|board)_|^decks_new_board$/.test(tool.name)), "no old name");
		const insert = list.result.tools.find((tool) => tool.name === "decks_canvas_insert");
		assert.deepEqual(insert.inputSchema.required, ["item"]);
		assert.equal(call.result.isError, false);
		assert.deepEqual(JSON.parse(call.result.content[0].text), [{ op: "delete", id: "n2" }]);
		assert.deepEqual(fake.seen.at(-1), { verb: "canvas.batch", args: [[{ op: "delete", id: "n2" }]], token: "Bearer dk_h_wren", agent: undefined, app: undefined, person: undefined });
	} finally {
		await fake.close();
	}
});

test("DECKS_TOOLS narrows the tools to groups; board, the card group's old name, is no group now", async () => {
	const listed = async (groups) => {
		const child = execFile(process.execPath, [MCP], { env: { ...process.env, DECKS_URL: "http://127.0.0.1:1", DECKS_TOKEN: "dk_h_x", DECKS_TOOLS: groups } });
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
		while (!output.includes("\n")) await new Promise((resolve) => setTimeout(resolve, 20));
		child.kill();
		return JSON.parse(output.trim()).result.tools.map((tool) => tool.name).sort();
	};
	const cards = TABLE.filter((verb) => verb.group === "card").map((verb) => `decks_${verb.name.replace(/\./g, "_")}`).sort();
	assert.ok(cards.includes("decks_card_create"));
	assert.deepEqual(await listed("card"), cards);
	assert.deepEqual(await listed("board"), [], "the old group name names nothing");
});

/** A fetch that records each request and answers from `answer(url, init)`, for the doors that are not verbs. */
function fakeFetch(answer) {
	const seen = [];
	const fetch = async (url, init = {}) => {
		seen.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
		return answer(url, init);
	};
	return { fetch, seen };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("a page's doors: hello, a canvas pass and an app's address, a page's address, an upload as it is", async () => {
	const { fetch, seen } = fakeFetch((url, init) => {
		const path = new URL(url).pathname;
		if (path === "/api/hello") return json({ decks: true, name: "Lab", paired: true });
		if (path === "/api/passes") {
			const body = JSON.parse(init.body);
			return json(body.app ? { pass: "dk_ap_x.y", expires: 1, url: `/app/${body.app}/?decks_pass=dk_ap_x.y` } : { pass: "dk_cp_x.y", role: "edit", expires: 2 });
		}
		if (path === "/api/upload") return json({ path: `assets/${new URL(url).searchParams.get("name")}` });
		if (path === "/api/pair") return json({ needsCode: true, error: "This harness asks for a code." }, 403);
		return json({ error: "no" }, 404);
	});
	const decks = connect({ url: "http://127.0.0.1:4830", token: "dk_h_site", fetch });
	assert.equal((await decks.hello()).name, "Lab");
	assert.equal(decks.pageUrl("/api/t/dk_cp_x.y/card/a b/index.html"), "http://127.0.0.1:4830/api/t/dk_cp_x.y/card/a%20b/index.html");
	assert.deepEqual(await decks.canvasPass("plan"), { pass: "dk_cp_x.y", role: "edit", expires: 2 });
	assert.deepEqual(JSON.parse(seen.at(-1).body), { canvas: "plan" });
	assert.equal(await decks.appUrl("notes"), "http://127.0.0.1:4830/app/notes/?decks_pass=dk_ap_x.y");
	const picture = new File([new Uint8Array([1, 2, 3])], "cat.png", { type: "image/png" });
	assert.equal(await decks.upload(picture), "assets/cat.png");
	assert.equal(seen.at(-1).body, picture, "the file itself, not JSON");
	assert.equal(seen.at(-1).headers["content-type"], "image/png");
	for (const one of seen) assert.equal(one.headers.authorization, "Bearer dk_h_site", "the token in the header");
	for (const one of seen) assert.doesNotMatch(one.url, /dk_h_site/, "never in the address");
	await assert.rejects(decks.pairSite({ label: "Studio" }), (error) => error instanceof DecksError && error.needsCode === true && error.status === 403);
});

test("events read with fetch and the token, opened again when the stream ends, until the harness refuses the token", async () => {
	let opened = 0;
	const { fetch, seen } = fakeFetch(() => {
		opened++;
		if (opened > 2) return new Response("no", { status: 401 });
		const body = new ReadableStream({
			start(controller) {
				const bytes = new TextEncoder();
				controller.enqueue(bytes.encode(": decks events\r\n\r\nevent: agent.state\r\ndata: {\"type\":\"agent.state\",\"id\":\"a1\"}\r\n\r\n"));
				controller.close();
			},
		});
		return new Response(body, { headers: { "content-type": "text/event-stream" } });
	});
	const decks = connect({ url: "http://127.0.0.1:4830", token: "dk_h_site", fetch });
	const heard = [];
	let refused = false;
	const stream = decks.events((event) => heard.push(event), { types: ["agent.state"], reconnect: true, refused: () => (refused = true) });
	await stream.done;
	assert.equal(refused, true);
	assert.deepEqual(heard, [{ type: "agent.state", id: "a1" }, { type: "agent.state", id: "a1" }]);
	assert.equal(seen.length, 3);
	assert.equal(seen[0].headers.authorization, "Bearer dk_h_site");
	assert.match(seen[0].url, /\/api\/v1\/events\?types=agent\.state$/);
});

test("a canvas pass kept while shown is asked for again at half its life, and thirty seconds after one that failed", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
	let asked = 0;
	let fail = false;
	const { fetch } = fakeFetch(() => {
		asked++;
		if (fail) return json({ error: "no" }, 500);
		return json({ pass: `dk_cp_${asked}.x`, role: "edit", expires: Date.now() + 3_600_000 });
	});
	const decks = connect({ url: "http://127.0.0.1:4830", token: "dk_h_t", fetch });
	const heard = [];
	const keeper = decks.keepCanvasPass("plan", (got) => heard.push(got.pass));
	const settle = async () => {
		for (let i = 0; i < 10; i++) await Promise.resolve();
		await new Promise((done) => setImmediate(done));
	};
	await settle();
	assert.deepEqual(heard, ["dk_cp_1.x"], "asked at once");
	t.mock.timers.tick(30 * 60_000 - 1);
	await settle();
	assert.equal(asked, 1, "not before half its life");
	t.mock.timers.tick(1);
	await settle();
	assert.deepEqual(heard, ["dk_cp_1.x", "dk_cp_2.x"], "renewed at half its life");
	fail = true;
	t.mock.timers.tick(30 * 60_000);
	await settle();
	assert.equal(asked, 3);
	fail = false;
	t.mock.timers.tick(30_000);
	await settle();
	assert.deepEqual(heard.at(-1), "dk_cp_4.x", "thirty seconds after a failure");
	keeper.stop();
	t.mock.timers.tick(3_600_000);
	await settle();
	assert.equal(asked, 4, "stopped");
});
