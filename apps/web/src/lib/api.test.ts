import assert from "node:assert/strict";
import { test } from "node:test";
import { embedFamily, embedUrl, firstPage, pdfUrl } from "./api.ts";

/**
 * The app's half of a rule `lib/board.js` already implements, so the assertions are the
 * board's own cases: a sibling file stays a relative URL, anything going outside the deck
 * goes through `/api/file` with the board named, and an extension is read from the path the
 * board *wrote* rather than from the URL it resolved to.
 */
test("a sibling path resolves the way it would in an img src", () => {
	assert.equal(embedUrl("boards/sources.html", "../papers/sample.pdf"), "/api/file?path=..%2Fpapers%2Fsample.pdf&from=boards%2Fsources.html");
	assert.equal(embedUrl("boards/sources.html", "../../shared/report.html"), "/api/file?path=..%2F..%2Fshared%2Freport.html&from=boards%2Fsources.html");
});

test("a path that is already a URL is left alone", () => {
	assert.equal(embedUrl("boards/a.html", "/api/f/abc"), "/api/f/abc");
	assert.equal(embedUrl("boards/a.html", "/api/file?path=x&from=y"), "/api/file?path=x&from=y");
	assert.equal(embedUrl("boards/a.html", "https://example.org/x.png"), "https://example.org/x.png");
	assert.equal(embedUrl("boards/a.html", "data:image/png;base64,AAA"), "data:image/png;base64,AAA");
});

test("an absolute or home-relative path goes through the deck's roots", () => {
	assert.equal(embedUrl("boards/a.html", "~/shared/x.html"), "/api/file?path=~%2Fshared%2Fx.html&from=boards%2Fa.html");
	assert.equal(embedUrl("boards/a.html", "/etc/hosts"), "/api/file?path=%2Fetc%2Fhosts&from=boards%2Fa.html");
});

test("the family comes from the path the board wrote", () => {
	assert.equal(embedFamily("../papers/sample.pdf"), "pdf");
	assert.equal(embedFamily("../docs/notes.md"), "md");
	assert.equal(embedFamily("../assets/sketch.svg"), "image");
	assert.equal(embedFamily("../../shared/report.html"), "html");
	assert.equal(embedFamily("assets/log.csv"), "text");
	assert.equal(embedFamily("assets/archive.zip"), "file");
	// An out-of-deck path becomes a query string with no extension in it, which is the case
	// that made `board.js` read the extension off the raw path rather than the URL.
	assert.equal(embedFamily("~/notes/whatever.pdf"), "pdf");
	assert.equal(embedFamily("../papers/sample.pdf#page=3"), "pdf");
});

test("a page range yields its first page, and only where there is one", () => {
	assert.equal(firstPage("3-5"), 3);
	assert.equal(firstPage("1,4-6"), 1);
	assert.equal(firstPage("7"), 7);
	assert.equal(firstPage(""), undefined);
	assert.equal(firstPage(undefined), undefined);
	assert.equal(firstPage("all"), undefined);
	assert.equal(firstPage("0"), undefined, "a page number is one-based");
});

test("a PDF's viewer is told where to start", () => {
	assert.equal(pdfUrl("/api/file?path=x", "1-2"), "/api/file?path=x#page=1");
	assert.equal(pdfUrl("/api/file?path=x", undefined), "/api/file?path=x");
});
