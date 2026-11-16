import assert from "node:assert/strict";
import { test } from "node:test";
import { commentBlock } from "@decks/canvas/comments";
import { fileMention } from "../draft/model.ts";
import { aboutAddress, aboutComment, commentName, commentPill, pathName } from "./about.ts";
import { card, drawn, handed, item, itemName, longTitle, mine, titleOf } from "./sample-comments.ts";

// What a pill is about: its exact text, its card, and its name.

test("a pill's exact text is what the message carries for it", () => {
	const comments = [mine, handed, drawn];
	const block = commentBlock(comments);
	comments.forEach((comment, index) => assert.ok(block.includes(aboutComment(comment, index + 1).exact), comment.id));
	assert.equal(aboutComment(mine, 2).exact, "2. canvases/md/cards/sdk/index.html, in #choices\n   > Corner only\n   Use this one.");
	assert.equal(aboutAddress(card).exact, "@canvases/x/cards/the-chrome-choice/index.html");
	assert.equal(aboutAddress(item).exact, "@item:rect-9");
	assert.equal(aboutAddress(fileMention("assets/plan.pdf")).exact, "@assets/plan.pdf");
	assert.equal(aboutAddress(fileMention("assets/plan.pdf")).of, "file");
	assert.equal(aboutComment(handed, 1).canvas, true);
	assert.equal(aboutComment(mine, 1).name, "sdk");
	assert.equal(aboutComment(mine, 1, () => "SDK decisions").name, "SDK decisions");
	assert.equal(pathName("cards/plan/index.html"), "plan");
});

test("each kind of pill has a name: a comment's card, a card's title, an item's name, a file's name", () => {
	assert.equal(commentName(mine, titleOf), "SDK redesign decisions");
	assert.equal(commentName({ ...drawn, items: ["note-4"] }, titleOf, itemName), "Seventeen gaps remain");
	assert.equal(commentName(drawn), "2 items");
	assert.equal(aboutAddress(card, titleOf).name, longTitle);
	assert.equal(aboutAddress(item, undefined, itemName).name, "a square");
	assert.equal(aboutAddress({ ...item, id: "note-4" }, undefined, itemName).name, "Seventeen gaps remain");
	assert.equal(aboutAddress(fileMention("assets/deep/plan.pdf")).name, "plan.pdf");
	// A comment from the canvas is as short as any comment's pill, and says where it came from as data.
	const pill = commentPill({ ...handed, quote: "a long quotation that goes on well past the end of any pill" });
	assert.ok(pill.label.length <= 30, pill.label);
	assert.equal(pill.from, "canvas");
	assert.ok(!pill.label.includes("test note"));
});

