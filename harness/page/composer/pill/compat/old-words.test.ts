import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftMention } from "../../draft/model.ts";
import { readParts } from "../about.ts";
import { cardKind } from "./old-words.ts";

test("a mention saved as a board reads back as a card's pill", () => {
	assert.equal(cardKind("board"), "card");
	assert.equal(cardKind("item"), "item");
	const old = readParts([{ type: "mention", kind: "board" as "card", id: "cards/plan/index.html", name: "The plan", from: "you" }])!;
	assert.equal((old.draft[0] as DraftMention).kind, "card");
});
