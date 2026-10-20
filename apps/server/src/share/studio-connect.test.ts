import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";

const KEY = "dsk_abcdefghijklmnopqrstuvwxyz012345";
const STUDIO = { origin: "https://studio.test", "sec-fetch-site": "cross-site", "content-type": "application/json" };

/** A harness on a free port, with the pairing code made a must or not. */
async function open(required: boolean) {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-studio-connect-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	const before = process.env.DECKS_REQUIRE_PAIR_CODE;
	if (required) process.env.DECKS_REQUIRE_PAIR_CODE = "1";
	else delete process.env.DECKS_REQUIRE_PAIR_CODE;
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	if (before === undefined) delete process.env.DECKS_REQUIRE_PAIR_CODE;
	else process.env.DECKS_REQUIRE_PAIR_CODE = before;
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
	const post = async (path: string, body: unknown, headers: Record<string, string> = STUDIO) => {
		const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
		const text = await response.text();
		let answer: Record<string, unknown>;
		try {
			answer = JSON.parse(text) as Record<string, unknown>;
		} catch {
			answer = { text };
		}
		return { status: response.status, body: answer };
	};
	const linked = () => existsSync(join(deck, ".decks", "studio.json"));
	return {
		app,
		base,
		post,
		linked,
		deck,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

/** Run with `DECKS_STUDIO_ORIGINS` set, as the owner of a Studio on another site would. */
async function listing<T>(origins: string, run: () => Promise<T>): Promise<T> {
	const before = process.env.DECKS_STUDIO_ORIGINS;
	process.env.DECKS_STUDIO_ORIGINS = origins;
	try {
		return await run();
	} finally {
		if (before === undefined) delete process.env.DECKS_STUDIO_ORIGINS;
		else process.env.DECKS_STUDIO_ORIGINS = before;
	}
}

test("a Studio listed in DECKS_STUDIO_ORIGINS connects with its key alone, and the token it gets back opens the harness's verbs", () => listing("https://other.test, https://studio.test/", async () => {
	const { base, post, linked, deck, cleanup } = await open(false);
	try {
		assert.equal(((await (await fetch(`${base}/hello`, { headers: STUDIO })).json()) as { needsCode: boolean }).needsCode, false);
		const done = await post("/studio/connect", { url: "https://studio.test/anything", key: KEY });
		assert.equal(done.status, 200);
		assert.equal(done.body.url, "https://studio.test");
		assert.ok(linked());
		assert.deepEqual(JSON.parse(readFileSync(join(deck, ".decks", "studio.json"), "utf8")), { url: "https://studio.test", key: KEY });
		const refused = await post("/v1/now", { args: [] }, { ...STUDIO, "x-decks-person": "studio" });
		assert.equal(refused.status, 401, "without the token, another site is refused");
		const allowed = await post("/v1/now", { args: [] }, { ...STUDIO, "x-decks-person": "studio", authorization: `Bearer ${done.body.token}` });
		assert.equal(allowed.status, 200);
		writeFileSync(join(deck, "boards", "a.html"), "<p>a</p>");
		const board = await fetch(`${base}/board/boards/a.html?decks_token=${String(done.body.token)}`, { headers: { origin: STUDIO.origin, "sec-fetch-site": "cross-site" } });
		assert.equal(board.status, 200);
		assert.equal(board.headers.get("referrer-policy"), "no-referrer", "its address, token and all, is not sent on as a Referer");
	} finally {
		cleanup();
	}
}));

test("without a code, only a Studio beside the harness or a listed one connects; any other site is asked for one", async () => {
	const { app, post, linked, cleanup } = await open(false);
	try {
		const elsewhere = await post("/studio/connect", { url: "https://studio.test", key: KEY });
		assert.equal(elsewhere.status, 403, "an unlisted site");
		assert.equal(elsewhere.body.needsCode, true);
		assert.ok(!linked());
		assert.equal(app.pairing.list().length, 0);

		const json = { "content-type": "application/json" };
		const local = await post("/studio/connect", { url: "http://localhost:4800", key: KEY }, { ...json, origin: "http://localhost:4800", "sec-fetch-site": "same-site" });
		assert.equal(local.status, 200, "a Studio on this machine");
		const tailnet = await post("/studio/connect", { url: "https://mac.tail1.ts.net:8444", key: KEY }, { ...json, origin: "https://mac.tail1.ts.net:8444", "x-forwarded-host": "mac.tail1.ts.net:8443", "sec-fetch-site": "same-site" });
		assert.equal(tailnet.status, 200, "a Studio on the name the harness was reached at, another port");
		const noOrigin = await post("/studio/connect", { url: "https://studio.test", key: KEY }, json);
		assert.equal(noOrigin.status, 200, "no page at all, from this machine");
		const proxied = await post("/studio/connect", { url: "https://studio.test", key: KEY }, { ...json, "x-forwarded-for": "100.101.102.103" });
		assert.equal(proxied.status, 403, "no page, passed on by a proxy");
	} finally {
		cleanup();
	}
});

test("a malformed key is refused before any token is given", () => listing("https://studio.test", async () => {
	const { app, post, linked, cleanup } = await open(false);
	try {
		const bad = await post("/studio/connect", { url: "https://studio.test", key: "nope" });
		assert.equal(bad.status, 400);
		assert.ok(!linked());
		assert.equal(app.pairing.list().length, 0);
	} finally {
		cleanup();
	}
}));

test("with the code required, every connect and pairing without one is refused, even from this machine, and decks pair code makes one that works once", async () => {
	const { app, base, post, linked, cleanup } = await open(true);
	try {
		assert.equal(((await (await fetch(`${base}/hello`, { headers: STUDIO })).json()) as { needsCode: boolean }).needsCode, true);
		const without = await post("/studio/connect", { url: "https://studio.test", key: KEY });
		assert.equal(without.status, 403);
		assert.equal(without.body.needsCode, true);
		assert.ok(!linked());
		assert.equal((await post("/pair", { label: "Other" })).status, 403, "the old pairing route asks for it too");

		const agent = app.agents.focused();
		const passedOn = await post("/v1/pair.code", { args: [] }, { "content-type": "application/json", "x-decks-agent": agent.id, "x-forwarded-for": "100.101.102.103" });
		assert.equal(passedOn.status, 403, "a call a proxy passed on, as tailscale serve does, is not from this machine");
		const made = await post("/v1/pair.code", { args: [] }, { "content-type": "application/json", "x-decks-agent": agent.id });
		assert.equal(made.status, 200);
		const code = (made.body.value as { code: string }).code;
		assert.match(code, /^\d{6}$/);
		assert.ok(!JSON.stringify(app.pairingMessage()).includes(code), "the code never goes to a browser");

		const wrong = await post("/studio/connect", { url: "https://studio.test", key: KEY, code: code === "000000" ? "111111" : "000000" });
		assert.equal(wrong.status, 403);
		assert.ok(!linked());
		const right = await post("/studio/connect", { url: "https://studio.test", key: KEY, code });
		assert.equal(right.status, 200);
		assert.ok(typeof right.body.token === "string");
		assert.ok(linked());
		assert.equal((await post("/studio/connect", { url: "https://studio.test", key: KEY, code })).status, 403, "spent");
	} finally {
		cleanup();
	}
});

test("a board's own button cannot make a pairing code", async () => {
	const { app, post, cleanup } = await open(true);
	try {
		const tool = app.agents.focused().stageTool();
		assert.ok(tool);
		const board = await post("/v1/pair.code", { args: [] }, { "content-type": "application/json", "x-decks-board": encodeURIComponent("boards/x.html") });
		assert.notEqual(board.status, 200);
	} finally {
		cleanup();
	}
});
