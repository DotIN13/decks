import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { describe, migrated, migrateStandalone, planStandalone } from "./2026-10-20-standalone-canvases.ts";

const board = (path: string, id = path) => ({ type: "browser", id, name: id, url: `../../${path}`, width: 600, height: 400, x: 0, y: 0, metadata: { type: "decks.board", path } });
const write = (deck: string, path: string, text: string) => {
	mkdirSync(dirname(join(deck, path)), { recursive: true });
	writeFileSync(join(deck, path), text);
};
const read = (deck: string, path: string) => readFileSync(join(deck, path), "utf8");
const json = (deck: string, path: string) => JSON.parse(read(deck, path));
const hash = (path: string) => createHash("sha1").update(path).digest("hex").slice(0, 16);

/** A deck as it was before: boards in boards/, canvases placing them by deck path, a frame in frames/. */
function oldDeck() {
	const data = mkdtempSync(join(tmpdir(), "decks-standalone-"));
	const deck = join(data, "decks");
	write(deck, "lib/board.css", "/* css */");
	write(deck, "assets/photo.png", "png");
	write(deck, "exports/cut.mp4", "mp4");
	write(deck, "docs/notes.md", "# notes");
	write(deck, "boards/lesson.css", "body{}");
	write(deck, "boards/plan.html", '<link rel="stylesheet" href="../lib/board.css"><link href="lesson.css"><img src="../assets/photo.png"><video src="../exports/cut.mp4"></video><a href="shared.html">shared</a><a href="free.html">free</a><a href="../docs/notes.md">notes</a>');
	write(deck, "boards/shared.html", '<link rel="stylesheet" href="../lib/board.css"><img src="../assets/photo.png"><a href="plan.html">plan</a>');
	write(deck, "boards/free.html", "<p>on no canvas</p>");
	write(deck, "boards/apps/review.html", '<link rel="stylesheet" href="../../lib/board.css"><div data-app="review"></div>');
	write(deck, "frames/card.pen", JSON.stringify({ version: "2.14", children: [{ type: "frame", id: "card", reusable: true, children: [] }] }));
	write(deck, "canvases/alpha/canvas.json", JSON.stringify({ title: "Alpha", boards: ["boards/plan.html"] }));
	write(deck, "canvases/alpha/canvas.pen", JSON.stringify({ version: "2.14", children: [board("boards/plan.html", "plan"), board("boards/shared.html", "shared"), board("boards/apps/review.html", "review"), { type: "ref", id: "c1", ref: "frames/card" }] }));
	write(deck, "canvases/beta/canvas.pen", JSON.stringify({ version: "2.14", children: [board("boards/shared.html", "shared"), board("canvases/beta/boards/kept.html", "kept")] }));
	write(deck, "canvases/beta/boards/kept.html", '<link rel="stylesheet" href="../../../lib/board.css">');
	write(deck, ".decks/authors.json", JSON.stringify({ "boards/plan.html": { who: "you", at: 1 }, "boards/shared.html": { who: "a1", at: 2 } }));
	write(deck, ".decks/revisions/index.json", JSON.stringify({ "boards/shared.html": [{ sha: "abc", at: 1 }] }));
	write(deck, `.decks/thumbs/${hash("boards/plan.html")}-1-light-400-whole-l3.webp`, "pic");
	write(deck, ".decks/agents/a1/meta.json", JSON.stringify({ id: "a1", stage: "beta", context: ["boards/shared.html"], inPlay: ["boards/shared.html"], positions: { "boards/shared.html": { x: 1, y: 2 } } }));
	write(data, "board-eval.json", JSON.stringify({ allowed: ["boards/plan.html"] }));
	return { data, deck };
}

test("a dry run lists every move and writes nothing", () => {
	const { deck } = oldDeck();
	const before = read(deck, "canvases/alpha/canvas.pen");
	const lines: string[] = [];
	const { ran } = migrateStandalone(deck, { dryRun: true, log: (line) => lines.push(line) });
	assert.equal(ran, false);
	assert.equal(read(deck, "canvases/alpha/canvas.pen"), before);
	assert.ok(!existsSync(join(deck, ".decks", "backups")));
	assert.ok(!migrated(deck));
	const text = lines.join("\n");
	assert.match(text, /move {5}boards\/plan\.html → canvases\/alpha\/boards\/plan\.html/);
	assert.match(text, /copy {5}boards\/shared\.html → canvases\/alpha\/boards\/shared\.html/);
	assert.match(text, /move {5}boards\/shared\.html → canvases\/beta\/boards\/shared\.html/);
	assert.match(text, /file {5}assets\/photo\.png → canvases\/alpha\/files\/photo\.png/);
	assert.match(text, /frame {4}frames\/card\.pen → canvases\/alpha\/frames\/card\.pen/);
	assert.match(text, /2 canvases, 4 boards placed on them: 2 moved, 2 copied/);
});

test("each canvas gets its boards, frames and files, and every link and record follows", () => {
	const { data, deck } = oldDeck();
	const { ran, backup } = migrateStandalone(deck, { dataDir: data, now: new Date("2026-10-20T12:00:00Z") });
	assert.ok(ran && backup && existsSync(join(deck, backup)), "backed up first");
	assert.ok(migrated(deck));
	// Boards moved, and copied for the board on two canvases; the one on no canvas stays in the library.
	assert.ok(!existsSync(join(deck, "boards/plan.html")) && existsSync(join(deck, "canvases/alpha/boards/plan.html")));
	assert.ok(existsSync(join(deck, "canvases/alpha/boards/shared.html")) && existsSync(join(deck, "canvases/beta/boards/shared.html")));
	assert.ok(!existsSync(join(deck, "boards/shared.html")));
	assert.ok(existsSync(join(deck, "boards/free.html")));
	assert.ok(existsSync(join(deck, "boards/apps/review.html")) && existsSync(join(deck, "canvases/alpha/boards/apps/review.html")), "an app's board stays the app's, and is copied in");
	assert.ok(existsSync(join(deck, "canvases/alpha/frames/card.pen")) && !existsSync(join(deck, "frames/card.pen")));
	assert.equal(read(deck, "canvases/alpha/files/photo.png"), "png");
	assert.equal(read(deck, "canvases/alpha/files/exports/cut.mp4"), "mp4");
	assert.equal(read(deck, "canvases/alpha/boards/lesson.css"), "body{}");
	// Links: lib and docs unchanged (served beside the boards), assets into files, boards to their new places.
	const plan = read(deck, "canvases/alpha/boards/plan.html");
	assert.match(plan, /href="\.\.\/lib\/board\.css"/);
	assert.match(plan, /href="lesson\.css"/);
	assert.match(plan, /src="\.\.\/files\/photo\.png"/);
	assert.match(plan, /src="\.\.\/files\/exports\/cut\.mp4"/);
	assert.match(plan, /href="shared\.html"/);
	assert.match(plan, /href="\.\.\/\.\.\/\.\.\/boards\/free\.html"/, "a board on no canvas is linked where it stays");
	assert.match(plan, /href="\.\.\/docs\/notes\.md"/);
	assert.match(read(deck, "canvases/beta/boards/shared.html"), /href="\.\.\/\.\.\/alpha\/boards\/plan\.html"/, "a board on another canvas is linked at its new place");
	// The drawings name boards from their own folder.
	const alpha = json(deck, "canvases/alpha/canvas.pen");
	assert.deepEqual(alpha.children[0].metadata, { type: "decks.board", path: "boards/plan.html" });
	assert.equal(alpha.children[0].url, "boards/plan.html");
	const beta = json(deck, "canvases/beta/canvas.pen");
	assert.equal(beta.children[1].metadata.path, "boards/kept.html");
	assert.deepEqual(json(deck, "canvases/alpha/canvas.json").boards, ["canvases/alpha/boards/plan.html"]);
	// Records: re-keyed, copies sharing what the one board had.
	const authors = json(deck, ".decks/authors.json");
	assert.deepEqual(authors["canvases/alpha/boards/plan.html"], { who: "you", at: 1 });
	assert.ok(authors["canvases/alpha/boards/shared.html"] && authors["canvases/beta/boards/shared.html"] && !authors["boards/shared.html"]);
	assert.ok(json(deck, ".decks/revisions/index.json")["canvases/beta/boards/shared.html"]);
	assert.ok(existsSync(join(deck, `.decks/thumbs/${hash("canvases/alpha/boards/plan.html")}-1-light-400-whole-l3.webp`)));
	const agent = json(deck, ".decks/agents/a1/meta.json");
	assert.deepEqual(agent.context, ["canvases/beta/boards/shared.html"], "an agent's records follow the copy on its own canvas");
	assert.deepEqual(Object.keys(agent.positions), ["canvases/beta/boards/shared.html"]);
	assert.ok(json(data, "board-eval.json").allowed.includes("canvases/alpha/boards/plan.html"), "Allow decisions follow the board");
	// Once only.
	assert.equal(migrateStandalone(deck, { dataDir: data }).ran, false);
});

test("a deck with nothing on its canvases is recorded and left alone", () => {
	const data = mkdtempSync(join(tmpdir(), "decks-standalone-empty-"));
	const deck = join(data, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	const plan = planStandalone(deck);
	assert.equal(plan.canvases, 0);
	assert.match(describe(plan).at(-1)!, /^0 canvases/);
	assert.equal(migrateStandalone(deck).ran, true);
	assert.ok(migrated(deck) && !existsSync(join(deck, ".decks", "backups")));
});
