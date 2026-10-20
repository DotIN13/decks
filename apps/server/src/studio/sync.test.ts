import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HarnessSync, landingFor, safeCanvasFolder, safeCanvasName, safeSyncPath, secretLooking } from "./sync.ts";

test("a canvas name from Studio is one plain folder name", () => {
	for (const name of ["plan", "Plan-2", "a.b_c", "x".repeat(100)]) assert.ok(safeCanvasName(name), name);
	for (const name of [".", "..", "", ".hidden", "x/../../.ssh", "a/b", "a\\b", "a b", "x".repeat(101), "-x", undefined, 3]) assert.ok(!safeCanvasName(name), String(name));
	assert.ok(safeCanvasFolder("my plan"), "a hand-made folder with a space still syncs");
	for (const name of [".", "..", "", "a/b", "a\\b", "a\0b"]) assert.ok(!safeCanvasFolder(name), name);
});

test("a file path from Studio stays under boards/ or assets/", () => {
	for (const path of ["boards/a.html", "assets/img/x.png", "boards/apps/x.html"]) assert.ok(safeSyncPath(path), path);
	for (const path of ["boards", "boards/", "lib/x.css", ".decks/studio.json", "canvases/x/canvas.pen", "boards/../x", "boards/./x", "boards//x", "assets/a\\..\\..\\x", "assets/a\0", "/boards/x", "../boards/x"]) assert.ok(!safeSyncPath(path), path);
});

test("secrets and dependencies never sync", () => {
	for (const path of ["assets/.env", "assets/.env.local", "assets/server.pem", "assets/tls.key", "assets/a.p12", "assets/a.pfx", "assets/id_rsa", "assets/id_rsa.pub", "assets/id_ed25519", "assets/id_ecdsa", "assets/release.keystore", "assets/credentials.json", "assets/node_modules/x/index.js"]) assert.ok(secretLooking(path), path);
	for (const path of ["assets/keys.png", "assets/monkey.html", "boards/env.html", "assets/credentials.md"]) assert.ok(!secretLooking(path), path);
});

test("a download lands inside the deck and never through a symbolic link", () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-sync-path-"));
	const away = mkdtempSync(join(tmpdir(), "decks-sync-away-"));
	try {
		mkdirSync(join(deck, "boards"));
		mkdirSync(join(deck, "assets"));
		assert.deepEqual(landingFor(deck, "boards/new/a.html"), { full: join(deck, "boards", "new", "a.html") });
		symlinkSync(away, join(deck, "assets", "out"));
		const refused = landingFor(deck, "assets/out/x.png");
		assert.ok("refused" in refused && /symbolic link/.test(refused.refused));
		symlinkSync(join(away, "f"), join(deck, "boards", "f.html"));
		assert.ok("refused" in landingFor(deck, "boards/f.html"), "the file itself a link");
		assert.ok("refused" in landingFor(deck, "boards/../../x"));
	} finally {
		rmSync(deck, { recursive: true, force: true });
		rmSync(away, { recursive: true, force: true });
	}
});

/** A Studio with nothing in it, which records what it is told about apps; `inventory: 404` plays an older one. */
async function emptyStudio(inventory: 200 | 404) {
	const told: unknown[] = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			const reply = (status: number, value: unknown) => {
				res.writeHead(status, { "content-type": "application/json" });
				res.end(JSON.stringify(value));
			};
			if (req.url === "/sync/v1/hello") return reply(200, { harness: { id: "h1", name: "mac" }, user: { id: "u1", email: "a@b.test" } });
			if (req.url === "/sync/v1/canvases") return reply(200, { canvases: [] });
			if (req.url === "/sync/v1/files") return reply(200, { files: [] });
			if (req.url === "/sync/v1/inventory" && req.method === "PUT") {
				if (inventory === 404) return reply(404, { error: "no such route" });
				told.push(JSON.parse(body));
				return reply(200, { ok: true });
			}
			reply(404, { error: "not here" });
		});
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, told, close: () => server.close() };
}

test("the app list goes to Studio once on connecting, then only when it changes, and an older Studio's 404 is no failure", async () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-sync-inventory-"));
	const studio = await emptyStudio(200);
	const old = await emptyStudio(404);
	const oldDeck = mkdtempSync(join(tmpdir(), "decks-sync-old-"));
	try {
		let apps = [{ name: "trip", title: "Trip", kind: "server", board: "boards/apps/trip.html", status: "running" }];
		const lines: string[] = [];
		const sync = new HarnessSync({ deck, studio: studio.url, key: "dsk_x", inventory: () => apps, log: (line) => lines.push(line) });
		await sync.sync();
		await sync.sync();
		assert.deepEqual(studio.told, [{ apps: [{ name: "trip", title: "Trip", kind: "server", board: "boards/apps/trip.html" }] }], "only the four fields, and once");
		apps = [...apps, { name: "notes", title: "Notes", kind: "static", board: "boards/apps/notes.html", status: "running" }];
		await sync.sync();
		assert.equal(studio.told.length, 2);
		apps[0]!.status = "asleep";
		await sync.sync();
		assert.equal(studio.told.length, 2, "a change of status is not a change of the list");
		assert.equal(statSync(join(deck, ".decks", "studio-sync.json")).mode & 0o777, 0o600);

		const again = new HarnessSync({ deck, studio: studio.url, key: "dsk_x", inventory: () => apps, log: () => {} });
		await again.sync();
		assert.equal(studio.told.length, 3, "told again by a new connection, though unchanged");

		const older = new HarnessSync({ deck: oldDeck, studio: old.url, key: "dsk_x", inventory: () => apps, log: (line) => lines.push(line) });
		await older.sync();
		assert.ok(!lines.some((line) => /failed|not taken/.test(line)), lines.join("\n"));
	} finally {
		studio.close();
		old.close();
		rmSync(deck, { recursive: true, force: true });
		rmSync(oldDeck, { recursive: true, force: true });
	}
});
