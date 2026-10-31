import assert from "node:assert/strict";
import { test } from "node:test";
import { commentBlock, withComments } from "../../markup/comments.ts";
import type { WaitingComment } from "../../state/comments.ts";
import { draftForAgent, draftComments, fileMention, type Draft, type DraftMention } from "./draft.ts";
import { withoutName } from "../../app/send-from-bar.ts";
import { aboutAddress, aboutComment, aboutSent, commentName, commentPill, messageParts, pathName, readParts, readSent } from "./pill-about.ts";

const mine: WaitingComment = { id: "c1", board: "canvases/md/cards/sdk/index.html", component: "choices", quote: "Corner only", text: "Use this one.", at: 1 };
const handed: WaitingComment = { id: "c2", board: "canvases/md/cards/sdk/index.html", quote: "SDK; each", text: "test note\nsecond line", at: 2, from: "canvas" };
const drawn: WaitingComment = { id: "c3", board: "canvases/md/canvas.pen", items: ["note-4", "arrow-7"], quote: "hello", text: "", at: 3 };
const board: DraftMention = { type: "mention", kind: "card", id: "canvases/x/boards/the-chrome-choice.html", label: "The chrome choice" };
const item: DraftMention = { type: "mention", kind: "item", id: "rect-9", label: "a square", name: "a square" };

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
	const sent = withComments(draftForAgent(draft), notes);
	const reading = readSent(sent)!;
	assert.ok(reading);
	const shape = (nodes: Draft) => nodes.map((node) => (node.type === "text" ? node.text : `${node.kind}:${node.kind === "comment" ? node.label : node.id}`));
	assert.deepEqual(shape(reading.draft), [
		"Keep ",
		`comment:${commentPill(mine).label}`,
		" and look at ",
		`comment:${commentPill(handed).label}`,
		" before you move ",
		`card:${board.id}`,
		" and ",
		"item:rect-9",
		". The numbers are in ",
		"file:assets/plan.pdf",
		".",
	]);
	// The comment's card: its quote, note and the entry exactly as sent. Who put it in is not in the text.
	const second = reading.draft.find((node) => node.type === "mention" && node.id === "sent-2") as DraftMention;
	const about = aboutSent(reading, second)!;
	assert.equal(about.quote, "SDK; each");
	assert.equal(about.note, "test note\nsecond line");
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

const longTitle = "The chrome choice is who owns the canvas's behaviour rules and the frame's";
const titleOf = (path: string) => (path === board.id ? longTitle : path.endsWith("sdk/index.html") ? "SDK redesign decisions" : undefined);
const itemName = (id: string) => (id === "note-4" ? "Seventeen gaps remain" : undefined);

test("each kind of pill has a name: a comment's board or card, a board's title, an item's name, a file's name", () => {
	assert.equal(commentName(mine, titleOf), "SDK redesign decisions");
	assert.equal(commentName({ ...drawn, items: ["note-4"] }, titleOf, itemName), "Seventeen gaps remain");
	assert.equal(commentName(drawn), "2 items");
	assert.equal(aboutAddress(board, titleOf).name, longTitle);
	assert.equal(aboutAddress(item, undefined, itemName).name, "a square");
	assert.equal(aboutAddress({ ...item, id: "note-4" }, undefined, itemName).name, "Seventeen gaps remain");
	assert.equal(aboutAddress(fileMention("assets/deep/plan.pdf")).name, "plan.pdf");
	// A comment from the canvas is as short as any comment's pill, and says where it came from as data.
	const pill = commentPill({ ...handed, quote: "a long quotation that goes on well past the end of any pill" });
	assert.ok(pill.label.length <= 30, pill.label);
	assert.equal(pill.from, "canvas");
	assert.ok(!pill.label.includes("test note"));
});

test("a sent message keeps its parts: names, who put each in, what its card shows; the agent's text is unchanged", () => {
	const draft: Draft = [
		{ type: "text", text: "@Sable keep " },
		commentPill(mine, titleOf),
		{ type: "text", text: " and " },
		commentPill(handed, titleOf),
		{ type: "text", text: " before you move " },
		{ ...board, name: longTitle },
		{ type: "text", text: " and " },
		item,
		{ type: "text", text: " in " },
		fileMention("assets/plan.pdf"),
	];
	const notes = [mine, handed];
	const agentText = withComments(draftForAgent(draft), notes);
	const parts = messageParts(withoutName(draft, "Sable"), notes, { titleOf, itemName, canvas: "canvases/md" });
	// What the agent gets is what it got before parts were kept: they are only beside it.
	assert.equal(withComments(draftForAgent(draft), notes), agentText);
	assert.deepEqual(parts[0], { type: "text", text: "keep " });
	const mentions = parts.filter((part) => part.type === "mention");
	assert.deepEqual(
		mentions.map((part) => [part.kind, part.name, part.from]),
		[
			["comment", "SDK redesign decisions", "you"],
			["comment", "SDK redesign decisions", "canvas"],
			["card", longTitle, "you"],
			["item", "a square", "you"],
			["file", "plan.pdf", "you"],
		],
	);
	const [first, second, , drawnItem] = mentions;
	assert.equal(second!.quote, "SDK; each");
	assert.equal(second!.note, "test note\nsecond line");
	assert.ok(agentText.includes(first!.exact!) && agentText.includes(second!.exact!));
	assert.equal(drawnItem!.exact, "@item:rect-9");
	assert.equal(drawnItem!.path, "canvases/md");

	// Stored (as JSON, by the server) and read back on any device: the same pills, the canvas's still marked.
	const reading = readParts(JSON.parse(JSON.stringify(parts)))!;
	const pills = reading.draft.filter((node): node is DraftMention => node.type === "mention");
	assert.deepEqual(
		pills.map((node) => [node.kind, node.name, node.from ?? "you"]),
		mentions.map((part) => [part.kind, part.name, part.from]),
	);
	assert.equal(aboutSent(reading, pills[1]!)!.canvas, true);
	assert.equal(aboutSent(reading, pills[1]!)!.exact, second!.exact);
	assert.equal(aboutSent(reading, pills[1]!)!.name, "SDK redesign decisions");
	assert.equal(aboutSent(reading, pills[3]!)!.name, "a square");
	assert.equal(aboutSent(reading, pills[2]!)!.name, longTitle);
	// A message saved before cards says "board" for a card: its pill is a card's.
	const old = readParts([{ type: "mention", kind: "board" as "card", id: "boards/plan.html", name: "The plan", from: "you" }])!;
	assert.equal((old.draft[0] as DraftMention).kind, "card");
	// A comment the message did not carry (its pill was there, its comment was not sent) is left out.
	assert.equal(messageParts([commentPill(drawn)], notes).length, 0);
});
