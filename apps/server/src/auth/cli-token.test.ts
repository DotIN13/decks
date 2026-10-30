import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";
import { cliTokenFile, readCliToken, writeCliToken } from "./cli-token.ts";

/**
 * `decks login` with no code, on the harness's own machine (`cli-token.ts`): the token the harness
 * writes for its own user at start, traded at `POST /api/login` for a terminal's own.
 */

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

test("decks login with no code trades the token the harness wrote for its own user, and no other person's", async () => {
	const { app, post, bearer, cleanup } = await open();
	try {
		const dataDir = join(app.deck.path, "..");
		const written = writeCliToken(app.tokens, dataDir, "http://127.0.0.1:4830");
		app.cliTokenId = written.id;
		assert.equal(statSync(cliTokenFile(dataDir)).mode & 0o777, 0o600, "only this user reads it");
		const file = readCliToken(dataDir);
		assert.equal(file?.url, "http://127.0.0.1:4830");
		assert.match(String(file?.token), /^dk_h_/);

		assert.equal((await post("/api/login", {}, {})).status, 403, "no code and no token");
		assert.equal((await post("/api/login", bearer(app.tokens.issue({ kind: "person" }, { label: "Decks tab" }).token), {})).status, 403, "a tab's token is not traded");
		const login = await post("/api/login", bearer(file!.token), { label: "decks login on test" });
		assert.equal(login.status, 200, login.text);
		const token = String(login.body.token);
		assert.match(token, /^dk_h_/);
		assert.notEqual(token, file!.token, "the terminal's own, which outlives a restart");
		assert.equal((await post("/api/v1/now", bearer(token))).status, 200);

		// A new start takes the last one back; a stop takes its own back and deletes the file.
		const again = writeCliToken(app.tokens, dataDir, "http://127.0.0.1:4830");
		app.cliTokenId = again.id;
		assert.equal(app.tokens.verify(file!.token).ok, false, "rotated");
		const second = readCliToken(dataDir)!.token;
		assert.equal(app.tokens.verify(second).ok, true);
		again.stop();
		assert.equal(app.tokens.verify(second).ok, false, "revoked on stop");
		assert.equal(existsSync(cliTokenFile(dataDir)), false);
		assert.equal((await post("/api/v1/now", bearer(token))).status, 200, "the terminal's stays");
	} finally {
		cleanup();
	}
});
