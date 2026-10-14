import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { connect, DecksError } from "../src/index.js";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** A stand-in for Decks: checks the token, then runs the code against a small fake `stage`, as Decks would. */
async function fakeDecks(stage, token = "s3cret") {
	const seen = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", async () => {
			const sent = JSON.parse(body);
			seen.push({ auth: req.headers.authorization, ...sent });
			res.setHeader("content-type", "application/json");
			if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 403; res.end(JSON.stringify({ ok: false, error: "That is not this app's stage token." })); return; }
			const logs = [];
			try {
				const value = await new AsyncFunction("stage", "event", "console", sent.code)(stage, { value: sent.value }, { log: (...a) => logs.push(a.join(" ")) });
				res.end(JSON.stringify({ ok: true, value, logs }));
			} catch (error) {
				res.end(JSON.stringify({ ok: false, value: undefined, logs, error: error.message }));
			}
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}/api/apps/demo/stage`;
	return { url, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

const fakeStage = () => {
	const calls = [];
	const agents = [{ id: "a1", name: "Labeler" }];
	return {
		calls,
		stage: {
			boards: async () => [{ path: "boards/a.html" }],
			agents: async (o) => (calls.push(["agents", o]), agents),
			send: async (to, work) => (calls.push(["send", to, work]), { queued: true, position: 1, ...(typeof to === "object" ? { agent: "a2", name: to.name } : {}) }),
			show: async (...args) => (calls.push(["show", args]), { shown: [args[0]] }),
			pen: { read: async (path) => ({ file: path ?? "stage.pen", children: [] }) },
		},
	};
};

test("a verb on decks.stage is called with its arguments, and answers with its result", async () => {
	const { stage, calls } = fakeStage();
	const decks_ = await fakeDecks(stage);
	try {
		const decks = connect({ url: decks_.url, token: "s3cret" });
		assert.deepEqual(await decks.stage.boards(), [{ path: "boards/a.html" }]);
		assert.deepEqual(await decks.stage.pen.read("frames/x"), { file: "frames/x", children: [] }, "a nested verb");
		await decks.stage.show("boards/a.html", undefined);
		assert.deepEqual(calls.at(-1), ["show", ["boards/a.html"]], "a trailing undefined stays absent");
		assert.equal(decks_.seen[0].auth, "Bearer s3cret");
	} finally { await decks_.close(); }
});

test("the connection comes from DECKS_STAGE_URL and DECKS_STAGE_TOKEN when nothing is passed", async () => {
	const { stage } = fakeStage();
	const decks_ = await fakeDecks(stage, "from-env");
	process.env.DECKS_STAGE_URL = decks_.url; process.env.DECKS_STAGE_TOKEN = "from-env";
	try {
		const decks = connect();
		assert.equal(decks.url, decks_.url);
		assert.equal((await decks.agents()).length, 1);
	} finally { delete process.env.DECKS_STAGE_URL; delete process.env.DECKS_STAGE_TOKEN; await decks_.close(); }
});

test("sendTo makes the agent only when there is none by that name", async () => {
	const { stage, calls } = fakeStage();
	const decks_ = await fakeDecks(stage);
	try {
		const decks = connect({ url: decks_.url, token: "s3cret" });
		assert.equal((await decks.sendTo({ name: "Labeler", kind: "claude" }, "label doc-1")).made, false);
		assert.deepEqual(calls.at(-1), ["send", "Labeler", { task: "label doc-1" }]);
		assert.equal((await decks.sendTo({ name: "Checker", kind: "pi" }, { task: "check" })).made, true);
		assert.deepEqual(calls.at(-1), ["send", { name: "Checker", kind: "pi" }, { task: "check" }]);
	} finally { await decks_.close(); }
});

test("code that throws, a wrong token, an unknown verb and no Decks at all are DecksErrors that say why", async () => {
	const { stage } = fakeStage();
	const decks_ = await fakeDecks(stage);
	try {
		const decks = connect({ url: decks_.url, token: "s3cret" });
		await assert.rejects(decks.run("console.log('before'); throw new Error('nope')"), (e) => e instanceof DecksError && e.message === "nope" && e.logs[0] === "before");
		await assert.rejects(decks.stage.nothing.here(), /stage\.nothing\.here is not a stage verb/);
		await assert.rejects(connect({ url: decks_.url, token: "wrong" }).stage.boards(), (e) => e instanceof DecksError && e.status === 403);
		await assert.rejects(connect({ url: "http://127.0.0.1:9/x", token: "t" }).run("return 1"), /Could not reach Decks/);
		assert.throws(() => connect({}), /No Decks to talk to/);
	} finally { await decks_.close(); }
});

test("a decks.stage handle is not mistaken for a promise", async () => {
	const decks = connect({ url: "http://127.0.0.1:9/x", token: "t" });
	assert.equal(decks.stage.then, undefined, "so `await decks.stage` does not try to call it");
});
