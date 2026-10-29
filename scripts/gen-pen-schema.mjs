// Write runtime/skills/canvas-design/schema.md, the .pen field reference agents read, from the pen package:
//   packages/pen/src/types.ts   each field's values and its comment (PenNode, Fill, Effect)
//   packages/pen/src/fields.ts  which item type has which field, and what Decks keeps without drawing
// Run: node --import tsx scripts/gen-pen-schema.mjs        Check only: node --import tsx scripts/gen-pen-schema.mjs --check
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { FIELDS, UNDRAWN_EFFECTS, UNDRAWN_FILLS } from "../packages/pen/src/fields.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const typesFile = `${root}packages/pen/src/types.ts`;
const out = `${root}runtime/skills/canvas-design/schema.md`;

const source = ts.createSourceFile(typesFile, readFileSync(typesFile, "utf8"), ts.ScriptTarget.Latest, true);

/** A node's own doc comment, as one line of plain words. */
function docOf(node) {
	const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
	const text = docs.map((one) => (typeof one.comment === "string" ? one.comment : (one.comment ?? []).map((part) => part.text).join(""))).join(" ");
	return text.replace(/\s+/g, " ").trim();
}

/** A type as written in the file, on one line. */
const typeText = (node) => node.getText(source).replace(/\s+/g, " ").replace(/\{ /g, "{ ").trim();

const aliases = new Map();
const members = new Map();
for (const statement of source.statements) {
	if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, { text: typeText(statement.type), doc: docOf(statement) });
	if (ts.isInterfaceDeclaration(statement) && statement.name.text === "PenNode") {
		for (const member of statement.members) {
			if (!ts.isPropertySignature(member) || !member.type) continue;
			const name = member.name.getText(source);
			const doc = docOf(member);
			if (!doc) throw new Error(`PenNode.${name} in types.ts has no doc comment: say in a sentence what it does, for the agents who read schema.md.`);
			members.set(name, { type: typeText(member.type), doc, optional: !!member.questionToken });
		}
	}
}

const cell = (text) => text.replace(/\|/g, "\\|");
const row = (name) => {
	const member = members.get(name);
	if (!member) throw new Error(`fields.ts names "${name}", which PenNode in types.ts does not have: fields.test.ts should have caught this.`);
	return `| \`${name}\` | \`${cell(member.type)}\` | ${cell(member.doc)} |`;
};

const types = Object.keys(FIELDS);
const every = [...FIELDS[types[0]]].filter((name) => types.every((type) => FIELDS[type].has(name)));
const own = (type) => [...FIELDS[type]].filter((name) => !every.includes(name));

const WHAT = {
	frame: "A container. Lays its children out in a row, a column or not at all; a screen, a section, a button, a cell.",
	group: "A container with no layout: its box is its children's.",
	rectangle: "A box.",
	ellipse: "An oval in its box; a ring with `innerRadius`, an arc with `startAngle` and `sweepAngle`.",
	polygon: "A regular polygon in its box.",
	path: "Any outline, from an SVG path.",
	text: "Words.",
	note: "A sticky note.",
	prompt: "A prompt card, with the model it is for.",
	context: "A context card.",
	icon: "An icon from a library: lucide, feather, phosphor or Material Symbols.",
	icon_font: "The older icon item, as some files still have it.",
	script: "A JavaScript file that makes the item's children in pen.dev.",
	browser: "A live web page. On a Decks canvas this is a board.",
	ref: "A copy of an item marked `reusable: true`. Any other field set on it overrides the copy.",
};

const parts = [];
parts.push(`<!-- Generated from packages/pen/src/types.ts and fields.ts by scripts/gen-pen-schema.mjs. Edit those, then run the script. -->

# The .pen format, as Decks reads it

Every item on a canvas is one of the types below, with the fields its type has. A field an item's
type does not have is kept in the file and does nothing; the canvas calls say so in their notes.
Every number, colour, string and boolean can also be a variable, \`"$name"\`, set with
\`decks canvas variables\`.

## Values

| name | values | meaning |
|---|---|---|
${["Variable", "NumberOrVariable", "ColorOrVariable", "SizeValue", "Fills"].map((name) => `| \`${name}\` | \`${cell(aliases.get(name).text)}\` | ${cell(aliases.get(name).doc)} |`).join("\n")}

## Fills

\`fill\` (and \`stroke\`) is one of these, or a list of them drawn in order:

\`\`\`ts
type Fill = ${aliases.get("Fill").text.replace(/ \| \{/g, "\n\t| {").replace(/^\| /, "")};
\`\`\`

## Effects

\`effect\` is one of these, or a list:

\`\`\`ts
type Effect = ${aliases.get("Effect").text.replace(/ \| \{/g, "\n\t| {").replace(/^\| /, "")};
\`\`\`

## Kept, but not drawn by Decks

pen.dev draws these; Decks keeps them in the file, draws nothing for them, and says so in the notes:

- fills: ${[...UNDRAWN_FILLS].map((one) => `\`${one}\``).join(", ")}
- effects: ${[...UNDRAWN_EFFECTS].map((one) => `\`${one}\``).join(", ")}; and an inner \`shadow\` on anything but a frame, a rectangle or a whole ellipse
- \`script\` items: Decks does not run them

## Fields every item has

| field | values | meaning |
|---|---|---|
${every.map(row).join("\n")}

## The item types
`);
for (const type of types) {
	const fields = own(type);
	parts.push(`\n### \`${type}\`\n\n${WHAT[type] ?? ""}\n\n| field | values | meaning |\n|---|---|---|\n${fields.map(row).join("\n")}\n`);
}
const text = parts.join("");

if (process.argv.includes("--check")) {
	let had = "";
	try {
		had = readFileSync(out, "utf8");
	} catch {
		/* missing is drift too */
	}
	if (had !== text) {
		console.error("runtime/skills/canvas-design/schema.md is out of date with packages/pen: run node --import tsx scripts/gen-pen-schema.mjs");
		process.exit(1);
	}
} else {
	writeFileSync(out, text);
	console.log(`wrote ${out.slice(root.length)}: ${types.length} types, ${members.size} fields`);
}
