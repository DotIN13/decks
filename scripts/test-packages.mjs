/**
 * The published packages work outside this repository: build them (`build-packages.mjs`), pack
 * them, install the tarballs into an empty folder, and run a sharing site there with plain Node
 * (`examples/share-site/packed/site.mjs`): no tsx, no workspace links. Exits non-zero if not.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SIDE = ["pen", "ink", "docs", "protocol", "sync-protocol", "card-host", "hub", "sync-client"];
execFileSync(process.execPath, [join(root, "scripts", "build-packages.mjs"), ...SERVER_SIDE], { stdio: "inherit" });

const dir = mkdtempSync(join(tmpdir(), "decks-packed-"));
try {
	for (const p of SERVER_SIDE) execFileSync("npm", ["pack", "--silent", "--pack-destination", dir], { cwd: join(root, "dist-packages", p), stdio: ["ignore", "ignore", "inherit"] });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "packed-check", private: true, type: "module" }));
	const tarballs = readdirSync(dir).filter((f) => f.endsWith(".tgz")).map((f) => `./${f}`);
	execFileSync("npm", ["install", "--no-audit", "--no-fund", "--silent", ...tarballs], { cwd: dir, stdio: "inherit" });
	cpSync(join(root, "examples", "share-site", "packed", "site.mjs"), join(dir, "site.mjs"));
	const out = execFileSync(process.execPath, ["site.mjs"], { cwd: dir, encoding: "utf8", timeout: 60_000 });
	const got = JSON.parse(out.trim().split("\n").pop());
	if (got.laptopHas !== "made on the mini" || got.board !== "<h1>Plan</h1>" || got.boardCss[0] !== 200) throw new Error(`The packed site did not sync: ${out}`);
	console.log(`[packages] ${SERVER_SIDE.length} packed packages ran a sharing site under plain Node ${got.node}`);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
