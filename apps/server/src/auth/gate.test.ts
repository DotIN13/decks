import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";

/**
 * The gate, end to end over HTTP: every request carries a token, and who is calling is the token's
 * principal. Nothing else lets a request in: not a header naming the person or an agent, not
 * coming from this machine, not being a page on the harness's own address.
 */

/** A GET with exactly these headers: Node's fetch puts its own `Sec-Fetch-Mode` over the one given. */
function getPage(url: string, headers: Record<string, string>): Promise<{ status: number; html: string; headers: Record<string, string | string[] | undefined> }> {
	return new Promise((done, fail) => {
		get(url, { headers }, (response) => {
			let html = "";
			response.setEncoding("utf8");
			response.on("data", (chunk: string) => (html += chunk));
			response.on("end", () => done({ status: response.statusCode ?? 0, html, headers: response.headers }));
		}).on("error", fail);
	});
}

/** A harness with one board on a free port. */
async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-gate-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	writeFileSync(join(deck, "boards", "a.html"), `<!doctype html><html><head><title>A</title><meta name="board" content='{"w":400,"h":300}' /></head><body></body></html>`);
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const json = { "content-type": "application/json" };
	const post = async (path: string, headers: Record<string, string>, body: unknown = { args: [] }) => {
		const response = await fetch(`${origin}${path}`, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) });
		const text = await response.text();
		let parsed: Record<string, unknown> = {};
		try {
			parsed = JSON.parse(text) as Record<string, unknown>;
		} catch {
			/* a sentence */
		}
		return { status: response.status, text, body: parsed };
	};
	const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
	return {
		app,
		origin,
		post,
		bearer,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("with no token, a command from this machine is refused, and so is a read of the API; a header that names someone is no token", async () => {
	const { origin, post, cleanup } = await open();
	try {
		assert.equal((await post("/api/v1/now", {})).status, 401, "a program on this machine, as curl");
		assert.equal((await fetch(`${origin}/api/deck`)).status, 401);
		assert.equal((await fetch(`${origin}/api/harness`)).status, 401);
		assert.equal((await fetch(`${origin}/api/v1/events`)).status, 401);
		const named: Array<Record<string, string>> = [{ "x-decks-person": "1" }, { "x-decks-agent": "anyone" }, { "x-decks-app": "notes" }, { "x-decks-board": "boards%2Fa.html" }, { "x-decks-session": "ses_1" }, { "x-decks-key": "guess" }];
		for (const header of named) {
			assert.equal((await post("/api/v1/now", header)).status, 401, JSON.stringify(header));
		}
		// As a page on the harness's own address says it is.
		assert.equal((await post("/api/v1/now", { origin, "sec-fetch-site": "same-origin", "x-decks-person": "1" })).status, 401, "same-origin is no one");
		assert.equal((await post("/api/v1/now", { authorization: "Bearer dk_p_made-up" })).status, 401);
		assert.equal((await post("/api/upload?name=a.txt", {}, "x")).status, 401);
	} finally {
		cleanup();
	}
});

test("the doors and the public files are open without a token; no page, file or picture of the deck is, from anywhere", async () => {
	const { origin, cleanup } = await open();
	try {
		const hello = (await (await fetch(`${origin}/api/hello`)).json()) as { decks: boolean; paired: boolean };
		assert.equal(hello.decks, true);
		assert.equal(hello.paired, false);
		assert.equal((await fetch(`${origin}/api/sdk/decks.mjs`)).status, 200);
		for (const site of ["same-origin", "cross-site", "none"]) {
			for (const path of ["/api/card/boards/a.html", "/api/f/boards/a.html", "/api/thumb/boards/a.html", "/api/avatar/a1", "/api/stage-thumb/main", "/api/file?path=boards/a.html"]) {
				assert.equal((await fetch(`${origin}${path}`, { headers: { "sec-fetch-site": site, "sec-fetch-dest": "image" } })).status, 401, `${path} from ${site}: every read carries a pass or a token`);
			}
		}
		assert.equal((await fetch(`${origin}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "123456" }) })).status, 403, "a door, but the code is wrong");
	} finally {
		cleanup();
	}
});

test("decks login trades a code from decks pair code for a person token, which calls as the person; the code works once", async () => {
	const { app, origin, post, bearer, cleanup } = await open();
	try {
		const agent = bearer(app.bridge.issue(app.agents.focused().id));
		const made = await post("/api/v1/pair.code", agent);
		assert.equal(made.status, 200, made.text);
		const code = (made.body.value as { code: string }).code;
		const login = await post("/api/login", {}, { code });
		assert.equal(login.status, 200);
		const token = String(login.body.token);
		assert.match(token, /^dk_h_/);
		assert.equal((await post("/api/login", {}, { code })).status, 403, "spent");
		const now = await post("/api/v1/now", bearer(token));
		assert.equal(now.status, 200);
		assert.equal((await post("/api/session", bearer(token))).body.kind, "person");
		// Taken back by decks logout.
		const out = await fetch(`${origin}/api/session`, { method: "DELETE", headers: bearer(token) });
		assert.deepEqual(await out.json(), { revoked: true });
		assert.equal((await post("/api/v1/now", bearer(token))).status, 401);
	} finally {
		cleanup();
	}
});

test("a board has no token: the routes that made one are gone, and a person's token reads a board's page", async () => {
	const { app, origin, post, bearer, cleanup } = await open();
	try {
		const person = bearer(app.tokens.issue({ kind: "person" }).token);
		assert.equal((await post("/api/tokens", person, { kind: "board", path: "boards/a.html" })).status, 404);
		assert.equal((await post("/api/v1/board-token", person, { path: "boards/a.html" })).status, 404);
		const page = await fetch(`${origin}/api/card/boards/a.html`, { headers: person });
		assert.equal(page.status, 200);
		// An old board's page is its file, sandboxed as a card from someone else is: nothing put in it.
		assert.match(page.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts\b(?!.*allow-same-origin)/);
		assert.equal(await page.text(), `<!doctype html><html><head><title>A</title><meta name="board" content='{"w":400,"h":300}' /></head><body></body></html>`);
		assert.equal((await post("/api/boards/delete", person, { path: "boards/a.html" })).status, 404, "no board delete for another front end");
		// No revision preview: the address falls through to the page, as any unknown one does.
		assert.doesNotMatch((await fetch(`${origin}/api/revision/abc`, { headers: person })).headers.get("cache-control") ?? "", /immutable/, "no revision preview");
		assert.equal((await post("/api/tickets", person, { paths: ["/api/card/boards/a.html"] })).status, 404, "no tickets at all");
	} finally {
		cleanup();
	}
});

test("the harness's own Chromium reads what it draws on a pass it made for no canvas, and nothing else on it", async () => {
	const { app, origin, post, bearer, cleanup } = await open();
	try {
		const { HARNESS_ID } = await import("./passes.ts");
		const own = bearer(app.passes.canvas("", "view", HARNESS_ID).pass);
		assert.equal((await fetch(`${origin}/api/card/boards/a.html`, { headers: own })).status, 200);
		assert.equal((await post("/api/v1/card.list", own)).status, 403, "no verb");
		assert.equal((await fetch(`${origin}/api/deck`, { headers: own })).status, 403, "nothing of the person's");
		// Made by anyone else, a pass for no canvas is nothing.
		const person = app.tokens.issue({ kind: "person" });
		assert.equal((await fetch(`${origin}/api/card/boards/a.html`, { headers: bearer(app.passes.canvas("", "view", person.id).pass) })).status, 401);
	} finally {
		cleanup();
	}
});

test("the opencode plugin trades its server's secret and a session for that session's agent token, and nothing less does", async () => {
	const { app, post, bearer, cleanup } = await open();
	try {
		const agent = app.agents.focused();
		app.bridge.setServerToken("server-secret");
		app.bridge.registerSession("ses_1", agent.id);
		assert.equal((await post("/api/tokens/session", bearer("server-secret"), { sessionID: "ses_2" })).status, 401);
		assert.equal((await post("/api/tokens/session", bearer("wrong"), { sessionID: "ses_1" })).status, 401);
		const traded = await post("/api/tokens/session", bearer("server-secret"), { sessionID: "ses_1" });
		assert.equal(traded.status, 200);
		assert.equal(traded.body.token, app.bridge.issue(agent.id), "the agent's own token");
		assert.equal((await post("/api/v1/agent.me", bearer(String(traded.body.token)))).status, 200);
	} finally {
		cleanup();
	}
});

test("a tab of its own is written a fresh person token, never stored and alone in its window group; a frame and a script are not", async (t) => {
	const dist = new URL("../../../web/dist/index.html", import.meta.url);
	if (!existsSync(dist)) {
		t.skip("no built web app to serve");
		return;
	}
	const { app, origin, post, bearer, cleanup } = await open();
	try {
		const seen = new Set<string>();
		for (const path of ["/", "/index.html", "/some/route"]) {
			const tab = await getPage(`${origin}${path}`, { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" });
			const token = /<meta name="decks-session" content="([^"]+)">/.exec(tab.html)?.[1];
			assert.ok(token, `a tab at ${path} is given a token`);
			assert.match(token, /^dk_h_/);
			seen.add(token);
			assert.equal(tab.headers["cross-origin-opener-policy"], "same-origin");
			assert.equal(tab.headers["cache-control"], "no-store");
			assert.equal((await post("/api/v1/now", bearer(token))).status, 200, "and it calls as the person");
		}
		assert.equal(seen.size, 3, "each tab its own");
		const frame = await getPage(`${origin}/`, { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin" });
		assert.ok(!frame.html.includes("decks-session"), "a frame is not");
		const script = await getPage(`${origin}/`, { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" });
		assert.ok(!script.html.includes("decks-session"), "a script's fetch is not");
		assert.equal(app.tokens.count("person"), 3);
	} finally {
		cleanup();
	}
});
