import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { landingFor, safeCanvasFolder, safeCanvasName, safeSyncPath, secretLooking } from "./sync.ts";

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
