/**
 * The vocabulary gate: the server's old words, counted, and held so they can only get fewer.
 *
 *     node scripts/vocabulary.mjs             # exit 1 when a count grew
 *     node scripts/vocabulary.mjs --report    # print the count of each word in each file
 *     node scripts/vocabulary.mjs --update    # write the baseline from the code as it is (after a rename)
 *
 * Boards became cards on 2026-10-30 and the stage became the canvas, but the old words lived on in the
 * server's names and comments. Every word of the server's shipping TypeScript (`apps/server/src`) is
 * split at its case changes (`boardPathOf` is `board`, `path`, `of`), and each part that is `board`,
 * `boards` or `stage` counts, in code, in strings and in comments alike.
 *
 * Left out: the tests, which name the old word to prove it is gone or to drive a wire name that keeps
 * it; and the upgrade scripts (`migrations/`), whose subject is the old files and their old words.
 *
 * Some must stay: what crosses the wire or lands on disk keeps its name (a message type, a JSON field,
 * a header such as `X-Decks-Stage`, a file name such as `board.css` or `stage.json`), and a reader of old
 * files (`agents/old-records.ts`) speaks of them as they were. The count held in
 * `scripts/vocabulary-baseline.json` is those; it may only fall. When a rename lowers it, run `--update`
 * and the gate holds the better number.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(root, "scripts", "vocabulary-baseline.json");
const WORDS = ["board", "boards", "stage"];

const files = execSync("git ls-files apps/server/src", { cwd: root, encoding: "utf8" }).split("\n")
	.filter((file) => /\.ts$/.test(file) && !/\.d\.ts$|\.test\.ts$|\.test-helper\.ts$|\.check\.ts$|\/(test|fixtures?)\/|^apps\/server\/src\/migrations\//.test(file));

/** The parts of a word as a reader sees them: `CardService` is `card` and `service`, `IN_PLAY` is `in` and `play`. */
const partsOf = (word) => word.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[\s_$]+/).filter(Boolean).map((part) => part.toLowerCase());

const counts = Object.fromEntries(WORDS.map((word) => [word, 0]));
const byFile = [];
for (const file of files) {
	const mine = Object.fromEntries(WORDS.map((word) => [word, 0]));
	for (const [word] of readFileSync(join(root, file), "utf8").matchAll(/[A-Za-z_$][\w$]*/g)) {
		for (const part of partsOf(word)) if (Object.hasOwn(mine, part)) mine[part] += 1;
	}
	const total = WORDS.reduce((sum, word) => sum + mine[word], 0);
	if (total) byFile.push([file, total, mine]);
	for (const word of WORDS) counts[word] += mine[word];
}

if (process.argv.includes("--report")) {
	console.log(JSON.stringify(counts, null, "\t"));
	for (const [file, total, mine] of byFile.sort((a, b) => b[1] - a[1])) console.log(`  ${file}: ${total} (${WORDS.filter((word) => mine[word]).map((word) => `${word} ${mine[word]}`).join(", ")})`);
	process.exit(0);
}

if (process.argv.includes("--update")) {
	writeFileSync(BASELINE, `${JSON.stringify({ counts }, null, "\t")}\n`);
	console.log(`vocabulary: the baseline is the code as it is (${WORDS.map((word) => `${counts[word]} ${word}`).join(", ")})`);
	process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).counts;
const grew = WORDS.filter((word) => counts[word] > (baseline[word] ?? 0));
if (grew.length) {
	console.error(`vocabulary: the server's old words grew: ${grew.map((word) => `"${word}" ${counts[word]}, where the baseline holds ${baseline[word] ?? 0}`).join("; ")}. Say card for a board and canvas for the stage; node scripts/vocabulary.mjs --report lists them by file.`);
	process.exit(1);
}
const fell = WORDS.filter((word) => counts[word] < (baseline[word] ?? 0));
console.log(`vocabulary holds (${WORDS.map((word) => `${counts[word]} ${word}`).join(", ")})${fell.length ? `, and ${fell.map((word) => `"${word}" fell to ${counts[word]}`).join(", ")}: run node scripts/vocabulary.mjs --update` : ""}`);
