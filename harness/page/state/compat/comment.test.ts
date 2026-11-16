import assert from "node:assert/strict";
import { test } from "node:test";
import { loadComments, type CardComment } from "../../markup/comments.ts";
import { commentFromOld } from "./comment.ts";

const comment: CardComment = { id: "c1", path: "canvases/plan/cards/plan/index.html", component: "goal", quote: "Keep it short.", text: "Two sentences, please.", at: 1 };

test("a comment saved with board, before the field was named path, is read with path", () => {
	const { path, ...rest } = comment;
	const store = { getItem: () => JSON.stringify({ a1: [{ ...rest, board: path }] }), setItem: () => {}, removeItem: () => {} };
	assert.deepEqual(loadComments(store), { a1: [comment] });
	assert.deepEqual(commentFromOld({ ...rest, board: path }), comment);
	assert.deepEqual(commentFromOld(comment), comment, "a comment with path is as it was");
});
