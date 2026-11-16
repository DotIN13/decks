import assert from "node:assert/strict";
import { test } from "node:test";
import { withComments } from "@decks/canvas/comments";
import { draftForAgent, draftComments, fileMention, type Draft, type DraftMention } from "../draft/model.ts";
import { withoutName } from "../bar/destination.ts";
import { commentPill } from "./about.ts";
import { aboutSent, messageParts, readParts, readSent } from "./sent.ts";
import { card, drawn, handed, item, itemName, longTitle, mine, titleOf } from "./sample-comments.ts";

// A sent message: the parts it goes out with, and read back into its pills.

test("a sent message reads back into the pills it was written with", () => {
	const draft: Draft = [
		{ type: "text", text: "Keep " },
		commentPill(mine),
		{ type: "text", text: " and look at " },
		commentPill(handed),
		{ type: "text", text: " before you move " },
		card,
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
		`card:${card.id}`,
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

test("comments sent with no words, items, whole cards, and plain messages", () => {
	const only = readSent(withComments("", [mine, drawn]))!;
	assert.equal(only.draft.filter((node) => node.type === "mention").length, 2);
	assert.deepEqual(only.comments.get("sent-2")?.items, ["note-4", "arrow-7"]);
	assert.equal(only.comments.get("sent-2")?.quote, "hello");
	const whole = readSent(withComments("Look", [{ id: "w", path: "cards/plan/index.html", quote: "", text: "all of it", at: 0 }]))!;
	assert.equal(whole.comments.get("sent-1")?.text, "all of it");
	assert.equal(whole.comments.get("sent-1")?.quote, "");
	// Words with no pills, a name, an email: the text as it is.
	assert.equal(readSent("Ask @Sable to mail me@x.com"), undefined);
	assert.equal(readSent("1. plain list\n\n2. more"), undefined);
});

test("a sent message keeps its parts: names, who put each in, what its card shows; the agent's text is unchanged", () => {
	const draft: Draft = [
		{ type: "text", text: "@Sable keep " },
		commentPill(mine, titleOf),
		{ type: "text", text: " and " },
		commentPill(handed, titleOf),
		{ type: "text", text: " before you move " },
		{ ...card, name: longTitle },
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
	// A comment the message did not carry (its pill was there, its comment was not sent) is left out.
	assert.equal(messageParts([commentPill(drawn)], notes).length, 0);
});
