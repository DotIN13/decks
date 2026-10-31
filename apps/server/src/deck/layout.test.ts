import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canvasFolder, canvasOfPath, isPagePath, isHidden, referenceFor, resolveReference, servedAs, sharedName, urlFor } from "./layout.ts";
import { PathRefused, realPathOf, resolveFileRequest, resolveRoots, resolveServed } from "./roots.ts";

const path = (r: ReturnType<typeof resolveReference>) => ("path" in r ? r.path : `refused: ${r.refused}`);

test("a canvas's references are its own folder and the deck's assets, docs and apps", () => {
	assert.equal(path(resolveReference("plan", "boards/a.html")), "canvases/plan/boards/a.html");
	assert.equal(path(resolveReference("plan", "frames/card")), "canvases/plan/frames/card");
	assert.equal(path(resolveReference("plan", "files/photo.png")), "canvases/plan/files/photo.png");
	assert.equal(path(resolveReference("plan", "docs/notes.md")), "docs/notes.md");
	assert.equal(path(resolveReference("plan", "assets/a.png")), "assets/a.png");
	assert.equal(path(resolveReference("plan", "apps/review/index.html")), "apps/review/index.html");
	assert.equal(path(resolveReference("plan", "./boards/../boards/a.html")), "canvases/plan/boards/a.html");
});

test("a canvas may not point at another canvas, the library, outside the deck or a hidden folder", () => {
	for (const ref of ["../other/boards/a.html", "../../boards/a.html", "/etc/passwd", "file:///etc/passwd", ".decks/studio.json", "boards/.git/config", "lib/board.css", "canvas.pen", "../../../x", ""]) {
		assert.ok("refused" in resolveReference("plan", ref), `${ref} is refused`);
	}
});

test("a friend's canvas reads the copies that came with it, and none of this deck's apps", () => {
	const name = sharedName("ada", "plan");
	assert.equal(canvasFolder(name), "shared/canvases/ada/plan");
	assert.equal(path(resolveReference(name, "boards/a.html")), "shared/canvases/ada/plan/boards/a.html");
	assert.equal(path(resolveReference(name, "docs/notes.md")), "shared/canvases/ada/plan/docs/notes.md");
	assert.ok("refused" in resolveReference(name, "apps/review/index.html"));
	assert.deepEqual(canvasOfPath("shared/canvases/ada/plan/boards/a.html"), { name, folder: "shared/canvases/ada/plan", rest: "boards/a.html" });
});

test("a deck path is written back as the canvas's own reference, and refused when it is not the canvas's", () => {
	assert.equal(path(referenceFor("plan", "canvases/plan/boards/a.html")), "boards/a.html");
	assert.equal(path(referenceFor("plan", "docs/notes.md")), "docs/notes.md");
	assert.ok("refused" in referenceFor("plan", "boards/a.html"), "the library is copied in first");
	assert.ok("refused" in referenceFor("plan", "canvases/other/boards/a.html"), "another canvas's board is copied in first");
	assert.equal(path(referenceFor(sharedName("ada", "plan"), "shared/canvases/ada/plan/boards/a.html")), "boards/a.html");
	assert.ok("refused" in referenceFor(sharedName("ada", "plan"), "docs/notes.md"), "a friend's canvas has no reach into this deck");
	assert.equal(urlFor("plan", "boards/a.html"), "boards/a.html");
	assert.equal(urlFor("plan", "docs/notes.md"), "../../docs/notes.md");
});

test("lib/ is served beside every canvas's boards, and the deck's parts beside its own canvases'", () => {
	assert.equal(path(servedAs("canvases/plan/lib/board.css")), "lib/card.css", "an old page's board.css is card.css");
	assert.equal(path(servedAs("canvases/plan/assets/a.png")), "assets/a.png");
	assert.equal(path(servedAs("canvases/plan/docs/n.md")), "docs/n.md");
	assert.equal(path(servedAs("shared/canvases/ada/plan/lib/board.js")), "lib/card.js");
	assert.equal(path(servedAs("shared/canvases/ada/plan/assets/a.png")), "shared/canvases/ada/plan/assets/a.png");
	assert.ok("refused" in servedAs("shared/canvases/ada/plan/apps/review/index.html"));
	assert.equal(path(servedAs("canvases/plan/boards/a.html")), "canvases/plan/boards/a.html");
	assert.ok(isPagePath("canvases/plan/boards/a.html"));
	assert.ok(isPagePath("shared/canvases/ada/plan/boards/a.html"));
	assert.ok(!isPagePath("canvases/plan/files/a.html"));
});

test("hidden folders are refused by every file route, by the path asked and the file it is", () => {
	assert.ok(isHidden(".decks/studio.json") && isHidden("a/.git/HEAD") && !isHidden("../a/b") && !isHidden("./a"));
	const deck = join(realPathOf(mkdtempSync(join(tmpdir(), "decks-layout-"))), "deck");
	mkdirSync(join(deck, ".decks", "shots"), { recursive: true });
	mkdirSync(join(deck, "boards"), { recursive: true });
	writeFileSync(join(deck, ".decks", "studio.json"), "{}");
	writeFileSync(join(deck, ".decks", "shots", "plan.png"), "png");
	writeFileSync(join(deck, "boards", "a.html"), "<p>a</p>");
	const roots = resolveRoots(deck, []);
	assert.throws(() => resolveFileRequest(roots, { path: ".decks/studio.json" }), PathRefused);
	assert.throws(() => resolveFileRequest(roots, { path: "../.decks/studio.json", from: "boards/a.html" }), PathRefused);
	assert.throws(() => resolveFileRequest(roots, { path: join(deck, ".decks", "studio.json") }), PathRefused);
	assert.throws(() => resolveServed(deck, ".decks/studio.json"), PathRefused);
	assert.throws(() => resolveServed(deck, "boards/../.decks/studio.json"), PathRefused);
	assert.equal(resolveFileRequest(roots, { path: ".decks/shots/plan.png" }), join(deck, ".decks", "shots", "plan.png"), "the harness's own pictures of canvases are still handed out");
	assert.equal(resolveServed(deck, "boards/a.html"), join(deck, "boards", "a.html"));
});
