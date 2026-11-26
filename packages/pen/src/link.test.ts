import assert from "node:assert/strict";
import { test } from "node:test";
import { chipLink, chipTitle, deckLinkOf, deckLinkTo, isDeckLink, linkChip } from "./link.ts";

test("a deck link is the window's address for a tab, and reads back as what it names", () => {
	assert.equal(deckLinkTo("canvas", "launch-plan"), "#canvas/launch-plan");
	assert.equal(deckLinkTo("document", "docs/the brief.md"), "#doc/docs/the%20brief.md");
	assert.equal(deckLinkTo("card", "shared/canvases/ada/plan/cards/q3/index.html"), "#card/shared/canvases/ada/plan/cards/q3/index.html");
	for (const [kind, target] of [["canvas", "研究笔记"], ["card", "canvases/a/cards/b c/index.html"], ["document", "docs/the brief.md"], ["app", "budget"]] as const) {
		assert.deepEqual(deckLinkOf(deckLinkTo(kind, target)), { kind, target });
	}
});

test("a web address, an anchor in a page and a path are not deck links", () => {
	for (const href of ["https://example.com/#app/x", "#section", "#", "cards/plan/index.html", "#nothing/known", "mailto:a@b.c"]) {
		assert.equal(deckLinkOf(href), undefined, href);
	}
	// What the canvas hands its host is anything shaped like one; the host says when it names nothing.
	assert.ok(isDeckLink("#canvas/x") && isDeckLink(" #nothing/known ") && !isDeckLink("#section") && !isDeckLink("https://example.com/#app/x"));
});

test("a link chip is a pill of plain pen items tagged with its address, and says what it shows", () => {
	const chip = linkChip({ to: "#app/budget", kind: "app", title: "Budget" });
	assert.equal(chip.type, "frame");
	assert.deepEqual(chip.metadata, { type: "decks.link", to: "#app/budget" });
	assert.equal(chipLink(chip), "#app/budget");
	assert.equal(chipTitle(chip as never), "Budget");
	assert.equal(chip.opacity, undefined);
	assert.equal(linkChip({ to: "#canvas/gone", kind: "canvas", title: "gone", gone: true }).opacity, 0.45);
	// Any other frame is no chip, and neither is one whose tag holds something that is no address.
	assert.equal(chipLink({ metadata: { type: "decks.shape", kind: "rounded" } }), undefined);
	assert.equal(chipLink({ metadata: { type: "decks.link", to: "https://example.com" } }), undefined);
});

test("an item's address names its canvas and id, slashes and all, and says how it opens", async () => {
	const { deckLinkOf, itemLinkOf, itemLinkTo, linkOpenFor, linkOpenOf, withLinkOpen } = await import("./link.ts");
	const address = itemLinkTo("shared/ana/plan", "card-1/label");
	assert.equal(address, "#item/shared%2Fana%2Fplan/card-1%2Flabel");
	assert.deepEqual(itemLinkOf(address), { canvas: "shared/ana/plan", id: "card-1/label" });
	assert.deepEqual(deckLinkOf(address), { kind: "item", target: "shared/ana/plan/card-1/label" });
	// Unsaid: an item or a card on the canvas, the rest in a tab.
	assert.equal(linkOpenFor(address), "canvas");
	assert.equal(linkOpenFor("#card/canvases/x/cards/a/index.html"), "canvas");
	assert.equal(linkOpenFor("#canvas/x"), "tab");
	assert.equal(linkOpenFor("#app/notes"), "tab");
	// Said, it wins, and the address still names the same thing.
	const tab = withLinkOpen(address, "tab");
	assert.equal(tab, `${address}?open=tab`);
	assert.equal(linkOpenOf(tab), "tab");
	assert.equal(linkOpenFor(tab), "tab");
	assert.deepEqual(itemLinkOf(tab), { canvas: "shared/ana/plan", id: "card-1/label" });
	assert.deepEqual(deckLinkOf("#canvas/x?open=canvas"), { kind: "canvas", target: "x" });
	assert.equal(withLinkOpen(tab, undefined), address);
});
