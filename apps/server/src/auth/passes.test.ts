import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { passCovers, Passes, passSecret, splitPathPass } from "./passes.ts";

const checks = (live = true) => ({ live: () => live, role: (canvas: string) => (canvas === "main" ? ("edit" as const) : undefined) });

test("the pass secret is kept in the data folder, so a pass made before a restart works after it", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-pass-secret-"));
	try {
		const before = new Passes(checks(), passSecret(dir));
		const { pass } = before.canvas("main", "edit", "k1");
		assert.equal(statSync(join(dir, "ticket-secret")).mode & 0o777, 0o600, "readable by this user alone");
		// A restart: the secret read back from the file.
		assert.equal(new Passes(checks(), passSecret(dir)).openCanvas(pass)?.canvas, "main");
		assert.ok(passSecret(dir).equals(passSecret(dir)), "made once, the same every time after");
		// A spoilt file is made again, and what was made on the old secret ends.
		writeFileSync(join(dir, "ticket-secret"), "nonsense");
		assert.equal(new Passes(checks(), passSecret(dir)).openCanvas(pass), undefined);
		assert.equal(new Passes(checks()).openCanvas(pass), undefined, "a secret kept nowhere is another server's");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("one pass kind for one use: a canvas pass is no app pass, and an app pass no canvas pass", () => {
	const passes = new Passes({ ...checks(), appRun: () => "r1" });
	const canvas = passes.canvas("main", "edit", "k1").pass;
	const app = passes.appServer("notes", "r1");
	assert.equal(passes.openApp(canvas), undefined);
	assert.equal(passes.openCanvas(app), undefined);
	// The same body under the other prefix: the mac covers the prefix.
	assert.equal(passes.openApp(`dk_ap_${canvas.slice("dk_cp_".length)}`), undefined);
	assert.equal(passes.openCanvas(`dk_cp_${app.slice("dk_ap_".length)}`), undefined);
});

test("a pass in the path reaches its canvas's folder and pictures, every part plain", () => {
	assert.deepEqual(splitPathPass("/api/t/dk_cp_a.b/board/canvases/main/x.png?v=1"), { pass: "dk_cp_a.b", rest: "/api/board/canvases/main/x.png?v=1" });
	assert.ok(passCovers("main", "/api/board/canvases/main/cards/a/index.html"));
	assert.ok(passCovers("main", "/api/thumb/canvases/main/cards/a/index.html"));
	assert.ok(!passCovers("main", "/api/board/canvases/other/a.html"));
	assert.ok(!passCovers("main", "/api/board/canvases/main/.decks/x"));
	assert.ok(!passCovers("main", "/api/f/canvases/main/a.png"));
	assert.ok(passCovers("shared/ana/trip", "/api/board/shared/canvases/ana/trip/a.html"));
	assert.ok(passCovers("main", "/api/board/boards/a.html", (path) => path === "boards/a.html"), "a board placed on it from elsewhere");
});
