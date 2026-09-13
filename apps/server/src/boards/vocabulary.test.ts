import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BOARD_CLASSES, BOX_CLASSES, CALLOUT_TONES, COMPONENT_KINDS } from "@decks/board-kit";
import { runtimeDir } from "../agents/context.ts";
import { applyPatches, mintId } from "./patch.ts";

/**
 * The vocabulary against the two things it cannot own: the stylesheet and the skill.
 *
 * `@decks/board-kit` is the list. What it cannot be is *proof* that the list matches the CSS
 * a board actually loads and the words an agent is actually taught — those live in
 * `runtime/`, are written by hand, and are read here instead.
 *
 * The drift this pins down had already happened once, in both directions at once: `callout`
 * was a box class the palette could not place, and the authoring skill taught `kpi`, `table`
 * and `chip` as though they were box classes. Both were the same failure — one list, copied,
 * with nothing comparing the copies.
 */

const boardCss = () => readFileSync(join(runtimeDir(), "lib", "board.css"), "utf8");
const skill = () => readFileSync(join(runtimeDir(), "skills", "board-authoring", "SKILL.md"), "utf8");

test("board.css styles every class the vocabulary names", () => {
	const css = boardCss();
	for (const entry of BOARD_CLASSES) {
		// A selector line, with the class either alone or in a list.
		const selector = new RegExp(`(^|[,{\\s])\\.${entry.name}(?![\\w-])`, "m");
		assert.ok(selector.test(css), `.${entry.name} is in the vocabulary and has no rule in board.css`);
	}
});

test("board.css reads every tone a callout may carry", () => {
	const css = boardCss();
	for (const tone of CALLOUT_TONES) {
		assert.ok(css.includes(`data-tone="${tone}"`), `board.css has no rule for data-tone="${tone}"`);
	}
});

test("the authoring skill teaches exactly the classes in the vocabulary", () => {
	const text = skill();
	// The list under "Built-in component classes", which is what an agent reads before it
	// writes a board. Every name here has to be real, and every real class has to be here.
	const section = text.slice(text.indexOf("## Built-in component classes"), text.indexOf("**They nest.**"));
	const taught = [...section.matchAll(/^- `([a-z]+)`$/gm)].map((match) => match[1]);
	assert.deepEqual(
		[...taught].sort(),
		BOARD_CLASSES.map((entry) => entry.name).sort(),
	);

	/*
	 * And in the order the paragraph below it claims.
	 *
	 * The skill says "the first four are interchangeable box classes", which is a statement
	 * about *position*: reorder these bullets and that sentence quietly becomes false. The
	 * comparison above would not notice, so this one does.
	 */
	assert.deepEqual([...taught.slice(0, 4)].sort(), [...BOX_CLASSES].sort(), "the four box classes must be the first four listed");
});

test("the four box classes are exactly the ones the vocabulary marks as boxes", () => {
	assert.deepEqual(
		BOARD_CLASSES.filter((entry) => entry.box).map((entry) => entry.name),
		[...BOX_CLASSES],
	);
});

test("every kind the vocabulary names can actually be inserted", () => {
	// The server is where an insert becomes markup, and it has a branch per kind. A kind
	// listed in the vocabulary with no branch is a palette button that writes nothing.
	const board = `<!doctype html><html><body class="board">\n<script src="../lib/board.js"></script>\n</body></html>\n`;
	for (const kind of COMPONENT_KINDS) {
		const { html, summary } = applyPatches(
			board,
			[{ op: "insert", kind, id: "", at: { left: 0, top: 0 }, ...(kind === "embed" || kind === "image" ? { embed: "../assets/a.png" } : {}) }],
			mintId,
		);
		assert.ok(html.includes(`data-id="${kind}-1"`), `inserting a ${kind} wrote nothing`);
		assert.equal(summary.length, 1, `inserting a ${kind} reported nothing`);
	}
});
