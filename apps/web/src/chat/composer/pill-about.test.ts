import assert from "node:assert/strict";
import { test } from "node:test";
import { commentBlock, withComments } from "../../markup/comments.ts";
import type { WaitingComment } from "../../state/comments.ts";
import { draftForAgent, draftComments, fileMention, type Draft, type DraftMention } from "./draft.ts";
import { aboutAddress, aboutComment, aboutSent, commentPill, pathName, readSent, rememberFromCanvas } from "./pill-about.ts";

const memory = () => {
	const held = new Map<string, string>();
	return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value) };
};
const mine: WaitingComment = { id: "c1", board: "canvases/md/cards/sdk/index.html", component: "choices", quote: "Corner only", text: "Use this one.", at: 1 };
const handed: WaitingComment = { id: "c2", board: "canvases/md/cards/sdk/index.html", quote: "SDK; each", text: "test note\nsecond line", at: 2, from: "canvas" };
const drawn: WaitingComment = { id: "c3", board: "canvases/md/canvas.pen", items: ["note-4", "arrow-7"], quote: "hello", text: "", at: 3 };
const board: DraftMention = { type: "mention", kind: "board", id: "canvases/x/boards/the-chrome-choice.html", label: "The chrome choice" };
const item: DraftMention = { type: "mention", kind: "item", id: "rect-9", label: "a square" };

test("a pill's exact text is what the message carries for it", () => {
	const comments = [mine, handed, drawn];
	const block = commentBlock(comments);
	comments.forEach((comment, index) => assert.ok(block.includes(aboutComment(comment, index + 1).exact), comment.id));
	assert.equal(aboutComment(mine, 2).exact, "2. canvases/md/cards/sdk/index.html, in #choices\n   > Corner only\n   Use this one.");
	assert.equal(aboutAddress(board).exact, "@canvases/x/boards/the-chrome-choice.html");
	assert.equal(aboutAddress(item).exact, "@item:rect-9");
	assert.equal(aboutAddress(fileMention("assets/plan.pdf")).exact, "@assets/plan.pdf");
	assert.equal(aboutAddress(fileMention("assets/plan.pdf")).of, "file");
	assert.equal(aboutComment(handed, 1).canvas, true);
	assert.equal(aboutComment(mine, 1).name, "sdk");
	assert.equal(aboutComment(mine, 1, () => "SDK decisions").name, "SDK decisions");
	assert.equal(pathName("boards/plan.html"), "plan");
});

test("a sent message reads back into the pills it was written with", () => {
	const store = memory();
	const draft: Draft = [
		{ type: "text", text: "Keep " },
		commentPill(mine),
		{ type: "text", text: " and look at " },
		commentPill(handed),
		{ type: "text", text: " before you move " },
		board,
		{ type: "text", text: " and " },
		item,
		{ type: "text", text: ". The numbers are in " },
		fileMention("assets/plan.pdf"),
		{ type: "text", text: "." },
	];
	const notes = draftComments(draft).map((id) => [mine, handed].find((one) => one.id === id)!);
	rememberFromCanvas(store, notes);
	const sent = withComments(draftForAgent(draft), notes);
	const reading = readSent(sent, store)!;
	assert.ok(reading);
	const shape = (nodes: Draft) => nodes.map((node) => (node.type === "text" ? node.text : `${node.kind}:${node.kind === "comment" ? node.label : node.id}`));
	assert.deepEqual(shape(reading.draft), [
		"Keep ",
		`comment:${commentPill(mine).label}`,
		" and look at ",
		`comment:${commentPill(handed).label}`,
		" before you move ",
		`board:${board.id}`,
		" and ",
		"item:rect-9",
		". The numbers are in ",
		"file:assets/plan.pdf",
		".",
	]);
	// The comment's card: its quote, note and the entry exactly as sent; the canvas's still marked.
	const second = reading.draft.find((node) => node.type === "mention" && node.id === "sent-2") as DraftMention;
	const about = aboutSent(reading, second)!;
	assert.equal(about.quote, "SDK; each");
	assert.equal(about.note, "test note\nsecond line");
	assert.equal(about.canvas, true);
	assert.ok(sent.includes(about.exact));
	const first = aboutSent(reading, reading.draft[1] as DraftMention)!;
	assert.equal(first.exact, "1. canvases/md/cards/sdk/index.html, in #choices\n   > Corner only\n   Use this one.");
	assert.equal(first.canvas, undefined);
});

test("comments sent with no words, items, whole boards, and plain messages", () => {
	const only = readSent(withComments("", [mine, drawn]))!;
	assert.equal(only.draft.filter((node) => node.type === "mention").length, 2);
	assert.deepEqual(only.comments.get("sent-2")?.items, ["note-4", "arrow-7"]);
	assert.equal(only.comments.get("sent-2")?.quote, "hello");
	const whole = readSent(withComments("Look", [{ id: "w", board: "boards/plan.html", quote: "", text: "all of it", at: 0 }]))!;
	assert.equal(whole.comments.get("sent-1")?.text, "all of it");
	assert.equal(whole.comments.get("sent-1")?.quote, "");
	// Words with no pills, a name, an email: the text as it is.
	assert.equal(readSent("Ask @Sable to mail me@x.com"), undefined);
	assert.equal(readSent("1. plain list\n\n2. more"), undefined);
});
