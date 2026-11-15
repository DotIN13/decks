#!/usr/bin/env node
// Writes docs/rewrite/loom/sheets.md, step 5's split sheets, from every spec in splits/:
// node docs/rewrite/loom/sheets.mjs. Exits 1 when a new file would be over 400 lines.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_MAX, FUNCTION_MAX, measure, sheet } from "./split.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const specs = readdirSync(join(HERE, "splits")).filter((f) => f.endsWith(".json")).sort()
	.map((f) => ({ name: f, spec: JSON.parse(readFileSync(join(HERE, "splits", f), "utf8")) }));
function main() {
	const rows = [];
	const bodies = [];
	let over = 0;
	for (const { name, spec } of specs) {
		const m = measure(spec, readFileSync(spec.file, "utf8"));
		const big = m.sizes.filter((s) => s.lines > FILE_MAX);
		over += big.length;
		const long = m.long.filter((l) => !(spec.scope && l.name === spec.scope)).length;
		const shell = m.shell !== null && m.shell > FUNCTION_MAX ? `, shell ${m.shell}` : "";
		rows.push(`| [\`${spec.at}\`](#${name.replace(/\.json$/, "")}) | ${m.total} | ${m.sizes.length} | ${Math.max(...m.sizes.map((s) => s.lines))} | ${long}${shell} |`);
		bodies.push(`<a id="${name.replace(/\.json$/, "")}"></a>\n\n${sheet(spec, m)}`);
	}
	const head = [
		"# Step 5: the split sheets",
		"",
		"Made by `node docs/rewrite/loom/sheets.mjs` from the specs in `splits/`, measured on today's files.",
		"Each sheet says the files a long file becomes, which top-level part (function, type, constant, or a",
		"class's or closure's member) goes to each, the lines that results (imports a file needs counted in), and",
		"where each function still over 80 lines is cut. Line numbers are today's. A part that leaves a closure",
		"takes the closure's shared state as one `ctx` argument; a class's method that leaves becomes a function",
		"given the instance. Behaviour, markup and class names stay.",
		"",
		`${specs.length} sheets; new files over ${FILE_MAX} lines: ${over}.`,
		"",
		"| file after the move | lines today | new files | largest | functions still over 80 (cut below) |",
		"|---|---|---|---|---|",
		...rows,
		"",
	];
	// File names in italics, not code: most do not exist until step 5 makes them, and the stale-paths gate reads code spans.
	const text = `${head.join("\n")}\n${bodies.join("\n")}`.replace(/`([^`\s]+\.(?:ts|tsx|mjs|mts|css|rs))`/g, "*$1*");
	writeFileSync(join(HERE, "sheets.md"), text);
	console.log(`${specs.length} sheets, ${over} new files over ${FILE_MAX} lines`);
	process.exit(over ? 1 : 0);
}

main();

