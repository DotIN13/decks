import assert from "node:assert/strict";
import { request } from "node:http";
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
		const done = await post("/pair", { studio: "https://studio.test/anything", key: KEY });
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
		assert.equal(board.status, 401, "a token in an address is no longer taken: a frame gets a ticket");
	} finally {
		cleanup();
	}
}));

test("without a code, only a Studio beside the harness or a listed one connects; any other site is asked for one", async () => {
	const { app, post, linked, cleanup } = await open(false);
	try {
		const elsewhere = await post("/pair", { studio: "https://studio.test", key: KEY });
		assert.equal(elsewhere.status, 403, "an unlisted site");
		assert.equal(elsewhere.body.needsCode, true);
		assert.ok(!linked());
		assert.equal(app.tokens.paired().length, 0);

		const json = { "content-type": "application/json" };
		const local = await post("/pair", { studio: "http://localhost:4800", key: KEY }, { ...json, origin: "http://localhost:4800", "sec-fetch-site": "same-site" });
		assert.equal(local.status, 200, "a Studio on this machine");
		const tailnet = await post("/pair", { studio: "https://mac.tail1.ts.net:8444", key: KEY }, { ...json, origin: "https://mac.tail1.ts.net:8444", "x-forwarded-host": "mac.tail1.ts.net:8443", "sec-fetch-site": "same-site" });
		assert.equal(tailnet.status, 200, "a Studio on the name the harness was reached at, another port");
		const noOrigin = await post("/pair", { studio: "https://studio.test", key: KEY }, json);
		assert.equal(noOrigin.status, 200, "no page at all, from this machine");
		const proxied = await post("/pair", { studio: "https://studio.test", key: KEY }, { ...json, "x-forwarded-for": "100.101.102.103" });
		assert.equal(proxied.status, 403, "no page, passed on by a proxy");
	} finally {
		cleanup();
	}
});

test("a malformed key is refused before any token is given", () => listing("https://studio.test", async () => {
	const { app, post, linked, cleanup } = await open(false);
	try {
		const bad = await post("/pair", { studio: "https://studio.test", key: "nope" });
		assert.equal(bad.status, 400);
		assert.ok(!linked());
		assert.equal(app.tokens.paired().length, 0);
	} finally {
		cleanup();
	}
}));

test("with the code required, every connect and pairing without one is refused, even from this machine, and decks pair code makes one that works once", async () => {
	const { app, base, post, linked, cleanup } = await open(true);
	try {
		assert.equal(((await (await fetch(`${base}/hello`, { headers: STUDIO })).json()) as { needsCode: boolean }).needsCode, true);
		const without = await post("/pair", { studio: "https://studio.test", key: KEY });
		assert.equal(without.status, 403);
		assert.equal(without.body.needsCode, true);
		assert.ok(!linked());
		assert.equal((await post("/pair", { label: "Other" })).status, 403, "the old pairing route asks for it too");

		const agent = { "content-type": "application/json", authorization: `Bearer ${app.bridge.issue(app.agents.focused().id)}` };
		const passedOn = await post("/v1/pair.code", { args: [] }, { ...agent, "x-forwarded-for": "100.101.102.103" });
		assert.equal(passedOn.status, 403, "a call a proxy passed on, as tailscale serve does, is not from this machine");
		assert.equal((await post("/v1/pair.code", { args: [] }, { "content-type": "application/json" })).status, 401, "from this machine, but with no token");
		const made = await post("/v1/pair.code", { args: [] }, agent);
		assert.equal(made.status, 200);
		const code = (made.body.value as { code: string }).code;
		assert.match(code, /^\d{6}$/);
		assert.ok(!JSON.stringify(app.pairingMessage()).includes(code), "the code never goes to a browser");

		const wrong = await post("/pair", { studio: "https://studio.test", key: KEY, code: code === "000000" ? "111111" : "000000" });
		assert.equal(wrong.status, 403);
		assert.ok(!linked());
		const right = await post("/pair", { studio: "https://studio.test", key: KEY, code });
		assert.equal(right.status, 200);
		assert.ok(typeof right.body.token === "string");
		assert.ok(linked());
		assert.equal((await post("/pair", { studio: "https://studio.test", key: KEY, code })).status, 403, "spent");
	} finally {
		cleanup();
	}
});

test("the old second door is gone: Studio pairs at /api/pair", async () => {
	const { post, cleanup } = await open(true);
	try {
		assert.equal((await post("/studio/connect", { url: "https://studio.test", key: KEY })).status, 401, "not a door any more");
	} finally {
		cleanup();
	}
});

test("a request addressed to a name that is not this server's is refused before anything answers it", async () => {
	const { base, cleanup } = await open(false);
	const port = Number(new URL(base).port);
	const ask = (host: string, path: string) =>
		new Promise<{ status: number; text: string }>((done, fail) => {
			const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
				let text = "";
				res.on("data", (chunk) => (text += chunk));
				res.on("end", () => done({ status: res.statusCode ?? 0, text }));
			});
			req.on("error", fail);
			req.end();
		});
	try {
		for (const path of ["/api/hello", "/app/x/", "/"]) {
			const refused = await ask(`rebound.evil.test:${port}`, path);
			assert.equal(refused.status, 403, path);
			assert.match(refused.text, /DECKS_HOSTS/);
		}
		assert.equal((await ask(`localhost:${port}`, "/api/hello")).status, 200);
		assert.equal((await ask(`mac.tail1.ts.net`, "/api/hello")).status, 200);
	} finally {
		cleanup();
	}
});

test("a page on another site cannot pair with a harness on this machine without a code; this machine's pages, listed ones and the iOS app still can", async () => {
	const { post, base, cleanup } = await open(false);
	try {
		const evil = { origin: "https://evil.test", "sec-fetch-site": "cross-site", "content-type": "application/json" };
		const refused = await post("/pair", { label: "x" }, evil);
		assert.equal(refused.status, 403, "any site the person opens reaches 127.0.0.1, so it is asked for a code");
		assert.equal(refused.body.needsCode, true);
		assert.equal(refused.body.token, undefined);
		assert.equal(((await (await fetch(`${base}/hello`, { headers: evil })).json()) as { needsCode: boolean }).needsCode, true, "hello tells that page a code is needed");
		assert.equal((await post("/pair", {}, { origin: "null", "content-type": "application/json" })).status, 403, "a sandboxed page is not trusted either");

		const local = await post("/pair", { label: "Decks at localhost:4329" }, { origin: "http://localhost:4329", "sec-fetch-site": "same-site", "content-type": "application/json" });
		assert.equal(local.status, 200, "another Decks page on this machine");
		assert.ok(local.body.token);
		assert.equal((await post("/pair", { label: "iPad" }, { "content-type": "application/json" })).status, 200, "no Origin: not a web page");
		assert.equal(await listing("https://evil.test", async () => (await post("/pair", {}, evil)).status), 200, "unless its owner listed it");
	} finally {
		cleanup();
	}
});

test("Studio trades its token for a canvas pass, and a frame from Studio reads that canvas's files by the pass alone, and only them", () => listing("https://studio.test", async () => {
	const { app, base, post, deck, cleanup } = await open(false);
	try {
		const done = await post("/pair", { studio: "https://studio.test", key: KEY });
		assert.equal(done.status, 200);
		const token = String(done.body.token);
		const pens = app.stage.pens!;
		const one = pens.claim("One");
		const two = pens.claim("Two");
		for (const name of [one, two]) {
			mkdirSync(join(deck, "canvases", name, "files"), { recursive: true });
			writeFileSync(join(deck, "canvases", name, "files", "a.txt"), name);
		}
		assert.equal((await post("/passes", { canvas: one })).status, 401, "another site without a token");
		const made = await post("/passes", { canvas: one }, { ...STUDIO, authorization: `Bearer ${token}` });
		assert.equal(made.status, 200);
		const pass = String(made.body.pass);
		assert.ok(Number(made.body.expires) > Date.now());

		// A frame's reads: another site, and no Origin.
		const frame = { "sec-fetch-site": "cross-site", "sec-fetch-dest": "image" };
		const a = await fetch(`${base}/t/${pass}/board/canvases/${one}/files/a.txt`, { headers: frame });
		assert.equal(a.status, 200);
		assert.equal(await a.text(), one);
		assert.equal(a.headers.get("referrer-policy"), "no-referrer", "the pass in its address is not sent on");
		assert.equal((await fetch(`${base}/board/canvases/${one}/files/a.txt`, { headers: frame })).status, 401, "no pass");
		assert.equal((await fetch(`${base}/t/${pass}/board/canvases/${two}/files/a.txt`, { headers: frame })).status, 401, "one's pass, for two");
		assert.equal((await fetch(`${base}/t/${pass}/v1/events`, { headers: frame })).status, 401, "a pass in an address reads files, not the API");

		// Revoking the token ends its passes.
		app.tokens.revoke(app.tokens.idOf(token)!);
		assert.equal((await fetch(`${base}/t/${pass}/board/canvases/${one}/files/a.txt`, { headers: frame })).status, 401);
	} finally {
		cleanup();
	}
}));

test("a token works only from the site it was given to, or from a caller that sends no Origin", () => listing("https://studio.test", async () => {
	const { post, base, cleanup } = await open(false);
	try {
		const done = await post("/pair", { studio: "https://studio.test", key: KEY });
		const token = String(done.body.token);
		const evil = { origin: "https://evil.test", "sec-fetch-site": "cross-site", "content-type": "application/json" };
		const stolen = await post("/v1/now", { args: [] }, { ...evil, authorization: `Bearer ${token}` });
		assert.equal(stolen.status, 401);
		assert.match(String(stolen.body.text), /another site/);
		assert.equal((await post("/tickets", { paths: ["boards/a.html"] }, { ...evil, authorization: `Bearer ${token}` })).status, 401, "no tickets for it either");
		assert.equal((await fetch(`${base}/v1/events?decks_token=${encodeURIComponent(token)}`, { headers: evil })).status, 401, "nor in the address");
		assert.equal((await post("/v1/now", { args: [] }, { ...STUDIO, "x-decks-person": "studio", authorization: `Bearer ${token}` })).status, 200, "from Studio's own page");
		assert.equal((await post("/v1/now", { args: [] }, { "content-type": "application/json", "x-decks-person": "studio", authorization: `Bearer ${token}` })).status, 200, "a program, with no Origin");
		const hello = (await (await fetch(`${base}/hello`, { headers: { ...evil, authorization: `Bearer ${token}` } })).json()) as { paired: boolean };
		assert.equal(hello.paired, false, "hello does not call the copied token paired");
	} finally {
		cleanup();
	}
}));
