import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { containedIn, PathRefused, realPathOf, resolveFileRequest, resolveInDeck, resolveRoots, fileUrl } from "./roots.ts";

/**
 * The guard is the security boundary of the app, so these tests are about what it
 * refuses rather than what it allows. The symlink cases matter most: a link inside
 * a directory the agent can write is not hypothetical, and a string comparison
 * that happens before the link is resolved passes it.
 */
function fixture() {
	const base = realPathOf(mkdtempSync(join(tmpdir(), "decks-guard-")));
	const deck = join(base, "deck");
	const outside = join(base, "outside");
	const shared = join(base, "shared");
	mkdirSync(join(deck, "boards"), { recursive: true });
	mkdirSync(outside, { recursive: true });
	mkdirSync(shared, { recursive: true });
	writeFileSync(join(deck, "boards", "a.html"), "<title>a</title>");
	writeFileSync(join(deck, "note.md"), "in deck");
	writeFileSync(join(outside, "secret.txt"), "not yours");
	writeFileSync(join(shared, "report.html"), "<p>shared</p>");
	symlinkSync(outside, join(deck, "escape"));
	symlinkSync(join(outside, "secret.txt"), join(deck, "boards", "linked.txt"));
	return { base, deck, outside, shared };
}

test("a board resolves inside the deck, whatever the URL looked like", () => {
	const { deck } = fixture();
	assert.equal(resolveInDeck(deck, "boards/a.html"), join(deck, "boards", "a.html"));
	assert.equal(resolveInDeck(deck, "/boards/a.html"), join(deck, "boards", "a.html"));
	assert.equal(resolveInDeck(deck, "boards\\a.html"), join(deck, "boards", "a.html"));
});

test("a board path that climbs out is refused", () => {
	const { deck } = fixture();
	assert.throws(() => resolveInDeck(deck, "../outside/secret.txt"), PathRefused);
	assert.throws(() => resolveInDeck(deck, "boards/../../outside/secret.txt"), PathRefused);
	assert.throws(() => resolveInDeck(deck, ""), PathRefused);
	assert.throws(() => resolveInDeck(deck, "boards/a\0.html"), PathRefused);
});

test("a symlink out of the deck is refused, directory or file", () => {
	const { deck } = fixture();
	// Both of these are inside the deck by string and outside it in fact.
	assert.throws(() => resolveInDeck(deck, "escape/secret.txt"), PathRefused);
	assert.throws(() => resolveInDeck(deck, "boards/linked.txt"), PathRefused);
});

test("a file request resolves relative to the board that asked", () => {
	const { deck, shared } = fixture();
	const roots = resolveRoots(deck, [{ path: shared, writable: false }]);

	// `../../shared/report.html` from `boards/sources.html` means what it would
	// mean in an <img src> on that board: up out of `boards/`, up out of the deck,
	// then down into the sibling directory a root declared.
	assert.equal(
		resolveFileRequest(roots, { path: "../../shared/report.html", from: "boards/sources.html" }),
		join(shared, "report.html"),
	);
	// One `..` fewer stays inside the deck and therefore resolves to a file that is
	// not there — which is a 404, not a way out.
	assert.equal(
		resolveFileRequest(roots, { path: "../shared/report.html", from: "boards/sources.html" }),
		join(deck, "shared", "report.html"),
	);
	// Without a `from`, a relative path is deck-relative, which is what the
	// agent's own tools use.
	assert.equal(resolveFileRequest(roots, { path: "note.md" }), join(deck, "note.md"));
	assert.equal(resolveFileRequest(roots, { path: join(shared, "report.html") }), join(shared, "report.html"));
});

test("a file outside the deck and every root is refused, with a reason", () => {
	const { deck, outside, shared } = fixture();
	const roots = resolveRoots(deck, [{ path: shared, writable: false }]);
	assert.throws(() => resolveFileRequest(roots, { path: join(outside, "secret.txt") }), (error: unknown) => {
		assert.ok(error instanceof PathRefused);
		assert.match(error.message, /outside the deck and every declared root/);
		return true;
	});
	assert.throws(() => resolveFileRequest(roots, { path: "/etc/passwd" }), PathRefused);
});

test("a root that does not exist cannot satisfy a request", () => {
	const { deck, base } = fixture();
	const missing = join(base, "not-there");
	const roots = resolveRoots(deck, [{ path: missing, writable: false }]);
	assert.equal(roots.roots[0]?.exists, false);
	assert.throws(() => resolveFileRequest(roots, { path: join(missing, "x.md") }), PathRefused);
});

test("duplicate roots collapse, and ~ is expanded", () => {
	const { deck, shared } = fixture();
	const roots = resolveRoots(deck, [
		{ path: shared, writable: false },
		{ path: shared, writable: true },
		{ path: "~", writable: false },
	]);
	assert.equal(roots.roots.filter((root) => root.path === shared).length, 1);
	assert.ok(roots.roots.some((root) => root.path === realPathOf(process.env.HOME ?? "~")));
});

test("containment is by path segment, not by prefix", () => {
	assert.ok(containedIn("/a/b", "/a/b/c"));
	assert.ok(containedIn("/a/b", "/a/b"));
	// The classic prefix bug: /a/bc is not inside /a/b.
	assert.equal(containedIn("/a/b", "/a/bc"), false);
	assert.equal(containedIn("/a/b", "/a"), false);
});

test("a canonical file URL has no dot segments for a browser to eat", () => {
	assert.equal(fileUrl("/Users/x/papers/a b.pdf"), "/api/f/Users/x/papers/a%20b.pdf");
	assert.ok(!fileUrl("/Users/x/papers/a.pdf").includes(".."));
});
