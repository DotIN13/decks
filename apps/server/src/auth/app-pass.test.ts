import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";

/** The app pass for a tab (`passes.ts`): another site opens one app in a tab with it, for a day, while the token that asked works. */

test("a tab's app pass opens its one app from another site, on the token that asked, and nothing else", async () => {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-app-pass-")));
	const deck = join(dataDir, "decks");
	for (const name of ["notes", "other"]) {
		mkdirSync(join(deck, "apps", name), { recursive: true });
		writeFileSync(join(deck, "apps", name, "app.json"), JSON.stringify({ kind: "static" }));
		writeFileSync(join(deck, "apps", name, "index.html"), `<p>${name}</p>`);
	}
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const studio = { origin: "https://studio.test", "sec-fetch-site": "cross-site" };
	try {
		const site = app.tokens.issue({ kind: "site", label: "Studio", origin: "https://studio.test" });
		const asked = await fetch(`${origin}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${site.token}`, "content-type": "application/json", ...studio }, body: JSON.stringify({ app: "notes" }) });
		const answer = (await asked.json()) as { pass: string; expires: number; url: string };
		assert.match(answer.pass, /^dk_ap_/);
		assert.ok(answer.expires > Date.now() + 23 * 3_600_000, "a day");
		const open = await fetch(`${origin}${answer.url}`, { headers: studio });
		assert.equal(open.status, 200);
		assert.equal(open.headers.get("referrer-policy"), "no-referrer");
		assert.equal((await fetch(`${origin}/app/notes/`, { headers: studio })).status, 403, "without it, another site is refused");
		assert.equal((await fetch(`${origin}/app/other/?decks_pass=${encodeURIComponent(answer.pass)}`, { headers: studio })).status, 403, "another app");
		assert.equal((await fetch(`${origin}/api/v1/boards`, { method: "POST", headers: { authorization: `Bearer ${answer.pass}`, "content-type": "application/json" }, body: "{}" })).status, 401, "it calls nothing");
		app.tokens.revoke(site.id);
		assert.equal((await fetch(`${origin}${answer.url}`, { headers: studio })).status, 403, "the token that asked taken back: the pass with it");
	} finally {
		server.close();
		app.dispose();
		rmSync(dataDir, { recursive: true, force: true });
	}
});
