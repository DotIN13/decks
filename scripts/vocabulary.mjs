/**
 * The vocabulary gate: the old words, counted across the shipping code, and held so they can only get fewer.
 *
 *     node scripts/vocabulary.mjs             # exit 1 when a count grew
 *     node scripts/vocabulary.mjs --report    # print the count of each area and of each file
 *     node scripts/vocabulary.mjs --update    # write the baseline from the code as it is (after a rename)
 *
 * Boards became cards on 2026-10-30 and the stage became the canvas. Every word of the server, the web
 * app, the packages' sources, the card host's library and the agents' runtime is split at its case
 * changes, hyphens and underscores (`boardPathOf` is `board`, `path`, `of`; `stage-fixed` is `stage`,
 * `fixed`), and each part that is `board`, `boards`, `stage` or `stages` counts, in code, strings and
 * comments alike, tests included. Each area has its own count.
 *
 * Left out: the deck migrations (`apps/server/src/migrations/`), whose subject is the old files and
 * their old words, and `packages/sync-protocol`, whose wire names Decks Studio reads and which moves
 * only with Studio. The count held in `scripts/vocabulary-baseline.json` may only fall. When a rename
 * lowers it, run `--update` and the gate holds the better number.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(root, "scripts", "vocabulary-baseline.json");
const WORDS = ["board", "boards", "stage", "stages"];
/** Each area, and the folders it counts. */
const AREAS = {
	server: ["apps/server/src"],
	web: ["apps/web/src"],
	canvas: ["packages/canvas/src"],
	"agent-ui": ["packages/agent-ui/src"],
	"card-host": ["packages/card-host/src", "packages/card-host/lib"],
	packages: ["packages/api/src", "packages/deck-kit/src", "packages/docs/src", "packages/frame/src", "packages/hub/src", "packages/i18n/src", "packages/ink/src", "packages/pen/src", "packages/protocol/src", "packages/sdk/src", "packages/sdk/bin", "packages/sdk/mcp", "packages/sync-client/src", "packages/ui/src"],
	runtime: ["runtime"],
};
const SHIPPING = /\.(ts|tsx|mts|js|mjs|cjs|css|html|md|tmpl|txt|json)$/;
const LEFT_OUT = /\.d\.ts$|\/node_modules\/|^apps\/server\/src\/migrations\/|\.bundle\.m?js$|\/paraglide\/|\/dist\//;

/** The parts of a word as a reader sees them: `CardService` is `card` and `service`, `IN_PLAY` is `in` and `play`. */
const partsOf = (word) => word.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[\s_$-]+/).filter(Boolean).map((part) => part.toLowerCase());

const counts = {};
const byFile = [];
for (const [area, folders] of Object.entries(AREAS)) {
	const files = execSync(`git ls-files ${folders.join(" ")}`, { cwd: root, encoding: "utf8" }).split("\n").filter((file) => SHIPPING.test(file) && !LEFT_OUT.test(file));
	let total = 0;
	for (const file of files) {
		const mine = Object.fromEntries(WORDS.map((word) => [word, 0]));
		for (const [word] of readFileSync(join(root, file), "utf8").matchAll(/[A-Za-z_$][\w$-]*/g)) {
			for (const part of partsOf(word)) if (Object.hasOwn(mine, part)) mine[part] += 1;
		}
		const sum = WORDS.reduce((s, word) => s + mine[word], 0);
		if (sum) byFile.push([file, sum, mine]);
		total += sum;
	}
	counts[area] = total;
}

if (process.argv.includes("--report")) {
	console.log(JSON.stringify(counts, null, "\t"));
	for (const [file, total, mine] of byFile.sort((a, b) => b[1] - a[1])) console.log(`  ${file}: ${total} (${WORDS.filter((word) => mine[word]).map((word) => `${word} ${mine[word]}`).join(", ")})`);
	process.exit(0);
}

if (process.argv.includes("--update")) {
	writeFileSync(BASELINE, `${JSON.stringify({ counts }, null, "\t")}\n`);
	console.log(`vocabulary: the baseline is the code as it is (${Object.entries(counts).map(([area, n]) => `${area} ${n}`).join(", ")})`);
	process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).counts;
const grew = Object.keys(counts).filter((area) => counts[area] > (baseline[area] ?? 0));
if (grew.length) {
	console.error(`vocabulary: the old words grew: ${grew.map((area) => `${area} ${counts[area]}, where the baseline holds ${baseline[area] ?? 0}`).join("; ")}. Say card for a board and canvas for the stage; node scripts/vocabulary.mjs --report lists them by file.`);
	process.exit(1);
}
const fell = Object.keys(counts).filter((area) => counts[area] < (baseline[area] ?? 0));
console.log(`vocabulary holds (${Object.entries(counts).map(([area, n]) => `${area} ${n}`).join(", ")})${fell.length ? `, and ${fell.map((area) => `${area} fell to ${counts[area]}`).join(", ")}: run node scripts/vocabulary.mjs --update` : ""}`);
