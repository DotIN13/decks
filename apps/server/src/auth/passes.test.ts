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

test("an app pass held by a canvas works while its token works and the app is on that canvas, with no day to run out", () => {
	let live = true;
	let placed = true;
	const passes = new Passes({ live: () => live, role: () => "edit", appOnCanvas: (name, canvas) => placed && name === "review" && canvas === "main" });
	const pass = passes.appCanvas("review", "main", "k1");
	assert.deepEqual(passes.openApp(pass), { app: "review", holder: "canvas", canvas: "main" });
	assert.deepEqual(passes.openApp(pass, Date.now() + 3 * 24 * 3_600_000)?.holder, "canvas", "no day, unlike a tab's");
	placed = false;
	assert.equal(passes.openApp(pass), undefined, "taken off the canvas, or the canvas no longer yours alone: it stops at once");
	placed = true;
	live = false;
	assert.equal(passes.openApp(pass), undefined, "signed out: it stops");
	live = true;
	assert.equal(passes.openApp(passes.appCanvas("review", "other", "k1")), undefined, "made for a canvas the app is not on");
	assert.equal(new Passes({ live: () => true, role: () => "edit" }).openApp(pass), undefined, "a harness that cannot say where apps are placed takes none");
});

test("a canvas pass may open an app on its canvas, and nothing else of the apps' but reading one", async () => {
	const { canvasMay } = await import("./guard.ts");
	assert.equal(canvasMay("POST", "/api/apps/review/open", "main"), true);
	assert.equal(canvasMay("GET", "/api/apps/review", "main"), true);
	assert.equal(canvasMay("POST", "/api/apps/review/restart", "main"), false);
	assert.equal(canvasMay("POST", "/api/passes", "main"), false);
});
