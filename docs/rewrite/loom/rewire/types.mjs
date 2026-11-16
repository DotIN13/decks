#!/usr/bin/env node
// Moves the types that kept their fields from today's @decks/protocol-old to the protocol, by import line only:
// node docs/rewrite/loom/rewire/types.mjs [--dry]. Run again after a rebase: a file already moved is left alone.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SAME = new Set(["Camera", "Presence", "PresenceBy", "ChangeAuthor", "AgentKind"]);
const dry = process.argv.includes("--dry");
const files = execFileSync("git", ["grep", "-l", "@decks/protocol-old", "--", "canvas", "ui", "pen"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const OLD = /^import (type )?\{([^}]*)\} from "@decks\/protocol-old";$/m;
let changed = 0;
for (const file of files) {
	const text = readFileSync(file, "utf8");
	const m = OLD.exec(text);
	if (!m) continue;
	const allType = !!m[1];
	const names = m[2].split(",").map((s) => s.trim()).filter(Boolean);
	const bare = (n) => n.replace(/^type /, "");
	const moving = names.filter((n) => SAME.has(bare(n)));
	if (!moving.length) continue;
	const staying = names.filter((n) => !SAME.has(bare(n)));
	const typed = (list) => list.map((n) => (allType || n.startsWith("type ") ? `type ${bare(n)}` : n));
	const lines = [];
	if (staying.length) lines.push(allType ? `import type { ${staying.map(bare).join(", ")} } from "@decks/protocol-old";` : `import { ${staying.join(", ")} } from "@decks/protocol-old";`);
	lines.push(`import type { ${typed(moving).map(bare).join(", ")} } from "@decks/protocol";`);
	if (!dry) writeFileSync(file, text.replace(OLD, lines.join("\n")));
	changed++;
	console.log(`${dry ? "would move" : "moved"} ${moving.map(bare).join(", ")} in ${file}`);
}
console.log(`${changed} files`);
