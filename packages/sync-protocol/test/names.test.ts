import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveEvent, safeCanvasName, safeSyncPath, secretLooking, syncPath, syncRoutes } from "../src/index.ts";

test("paths stay inside a canvas's bundle", () => {
	for (const ok of ["boards/a.html", "files/x/y.png", "assets/a.mp4", ".pictures/canvas.light.jpg"]) assert.ok(safeSyncPath(ok), ok);
	for (const bad of ["../x", "boards/../../x", "boards/.hidden", "apps/a", "boards", "boards//a", "boards\\a", "a\0b"]) assert.ok(!safeSyncPath(bad), bad);
});

test("names are one plain segment", () => {
	assert.ok(safeCanvasName("my-canvas_1.2"));
	// A deck names a canvas from its title, in any script.
	for (const good of ["第二集-v2-旁白录音-片段修改与审片", "café-notes", "Ελληνικά", "हिन्दी-नोट्स"]) assert.ok(safeCanvasName(good), good);
	for (const bad of ["..", ".x", "a/b", "a\\b", "a b", "-x", "a\0b", "", "x".repeat(101)]) assert.ok(!safeCanvasName(bad), bad);
});

test("secrets never sync", () => {
	for (const s of ["assets/.env", "assets/k.pem", "assets/node_modules/a.js", "docs/id_rsa", "assets/credentials.json"]) assert.ok(secretLooking(s), s);
	assert.ok(!secretLooking("assets/photo.png"));
});

test("live events and routes", () => {
	assert.equal(LiveEvent.parse({ type: "canvas", id: "c", rev: 3, base: 2, changes: [{ op: "set", id: "a" }] }).type, "canvas");
	assert.ok(!LiveEvent.safeParse({ type: "canvas", id: "c" }).success);
	assert.equal(syncPath(syncRoutes.edits.path, { id: "a b" }), "/sync/v1/canvases/a%20b/edits");
});
