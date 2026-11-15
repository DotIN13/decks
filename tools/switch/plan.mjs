// What the switch-over does, worked out from the tree as it is: deletions with their new home and
// proof, what Loom keeps, renames with counts, checks moved by owner, compat's old names, root files.
// Read only: nothing here writes. run.mjs renders it (--dry) or carries it out.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BY_NAME, KEPT } from "./compat/old.mjs";

export { KEPT };

export const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const RUNS = "/Users/dotin13/Documents/DotGit/dotty-programs/decks/data/decks/canvases/decks-rewrite-build/cards/stop-3-today-s-browser-checks-against-the-new/runs.json";

/** Today's code the new folders replaced, each with its new home and what proves it. */
export const REPLACED = [
	{ old: "apps/server", home: "server/ (Decks-local) and harness/ (agents)", proof: "node tools/check.mjs server, node tools/check.mjs harness; the 76 browser checks of stop 3" },
	{ old: "apps/web", home: "harness/page", proof: "the page checks of stop 3 (shell, panel, chrome, agents-tab, ...)" },
	{ old: "packages/api", home: "protocol/ (calls/, the one table)", proof: "node tools/check.mjs protocol; server/compat/names.test.ts (all 117 old calls)" },
	{ old: "packages/protocol", home: "protocol/ (events, wire)", proof: "node tools/check.mjs protocol; compat's 43 old events" },
	{ old: "packages/sync-protocol", home: "protocol/sync.ts", proof: "node tools/check.mjs protocol" },
	{ old: "packages/hub", home: "server/sharing/hub", proof: "server/sharing tests (node tools/check.mjs server)" },
	{ old: "packages/sync-client", home: "server/sharing/client", proof: "server/sharing/client tests" },
	{ old: "packages/agent-ui", home: "harness/page (chat/, composer/)", proof: "chat-content, slash, voice, working-marks checks" },
	{ old: "packages/sdk", home: "clients/sdk, clients/cli", proof: "node tools/check.mjs clients/sdk, tools/clients/same.test.ts" },
	{ old: "runtime", home: "harness/prompts, harness/runtimes", proof: "node tools/check.mjs harness; running, time-machine checks" },
	{ old: "extension", home: "clients/extension", proof: "a clients/extension folder" },
];

const NEW = ["protocol", "server", "harness", "clients", "tools"];

/** Where each owner's checks go: the feature folder of that owner's lane. */
const HOME_OF = { Easel: "server/canvas/checks", Depot: "server/pictures/checks", Folio: "server/cards/checks", Roster: "server/people/checks", Pane: "harness/page/checks", Scribe: "harness/page/chat/checks", Helm: "harness/checks", Keel: "server/kernel/checks", Warden: "tools/checks/e2e", Loom: "tools/checks/canvas" };

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const tracked = () => git("ls-files").split("\n").filter(Boolean);
const nameOf = (dir) => (existsSync(join(ROOT, dir, "package.json")) ? JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")).name : undefined);

/** Files that stay after the switch (new folders, Loom's kept packages, the moved checks) and import a package by name. */
function importers(files, name) {
	const word = new RegExp(`["']${name.replace("/", "\\/")}(?:/[^"']*)?["']`);
	const stays = (f) => [...NEW, ...KEPT, "e2e/checks", "e2e/harness.mjs"].some((n) => f === n || f.startsWith(`${n}/`));
	return files.filter((f) => stays(f) && /\.(ts|tsx|mjs|mts|js)$/.test(f) && word.test(readFileSync(join(ROOT, f), "utf8")));
}

function deletions(files) {
	return REPLACED.filter((r) => !KEPT.includes(r.old)).map((r) => {
		const there = existsSync(join(ROOT, r.old));
		const name = nameOf(r.old);
		const users = name ? importers(files, name) : [];
		const homeThere = r.old !== "extension" || existsSync(join(ROOT, "clients/extension"));
		const why = !there ? "already gone" : !homeThere ? "clients/extension does not exist yet" : users.length ? `still imported by ${users.length} file(s) that stay: ${users.slice(0, 4).join(", ")}${users.length > 4 ? ", ..." : ""}` : undefined;
		return { ...r, name, delete: there && !why, why };
	});
}

function renames(files) {
	const dirs = files.filter((f) => /^(protocol|server|harness|harness\/page|clients\/[^/]+|tools)\/package\.json$/.test(f)).map((f) => f.replace(/\/package\.json$/, ""));
	return dirs.map((dir) => {
		const from = nameOf(dir);
		const to = from?.replace(/^@decks-next\//, "@decks/");
		const uses = from ? files.filter((f) => /\.(ts|tsx|mjs|mts|js|json)$/.test(f) && !f.endsWith("package-lock.json") && readFileSync(join(ROOT, f), "utf8").includes(`${from}`)).length : 0;
		return { dir, from, to, files: uses };
	}).filter((r) => r.from?.startsWith("@decks-next/"));
}

/** A check with no owner in runs.json, by what it exercises: the page's, or the canvas library's (Loom's, wave 3). */
const PAGE = ["panel", "chat-content", "slash", "notifications", "shell", "context", "per-agent", "working-marks", "panel-steady", "voice", "canvas-switch", "new-agent-opens"];
const ownerFor = (check, owners) => owners[check] ?? (PAGE.includes(check) ? "Pane" : BY_NAME[check] ?? "Loom");

function checkMoves() {
	const checks = readFileSync(join(ROOT, ".scratch/Mason/checks.txt"), "utf8").split(/\s+/).filter(Boolean);
	const owners = existsSync(RUNS) ? JSON.parse(readFileSync(RUNS, "utf8")).owners ?? {} : {};
	const all = git("ls-files", "e2e/checks").split("\n").filter(Boolean).map((f) => f.slice("e2e/checks/".length).replace(/\.mjs$/, ""));
	const moved = checks.map((c) => {
		const owner = ownerFor(c, owners);
		return { check: c, owner, to: `${HOME_OF[owner] ?? HOME_OF.Warden}/${c}.mjs`, owned: c in owners };
	});
	const left = all.filter((c) => !checks.includes(c));
	return { moved, left };
}

export function plan() {
	const files = tracked();
	return { deletions: deletions(files), kept: KEPT.filter((k) => existsSync(join(ROOT, k))), renames: renames(files), checks: checkMoves() };
}

/** Each old name of compat's table: who in the repo still speaks it after the switch (kept code, the moved checks). */
export function compatNames() {
	const table = readFileSync(join(ROOT, "server/compat/table.ts"), "utf8");
	const calls = [...table.matchAll(/^\t\["([^"]+)", "(agents|person)", "([^"]+)",/gm)].map((m) => ({ old: m[1], now: m[3], kind: "call" }));
	const events = [...table.split("OLD_EVENTS")[1].matchAll(/^\t\["([^"]+)", "([^"]+)"\]/gm)].map((m) => ({ old: m[1], now: m[2], kind: "event" }));
	const speakers = ["e2e/checks", "e2e/harness.mjs", "packages/canvas/src", "packages/card-host/src", "harness/page"];
	const text = speakers.map((s) => git("ls-files", s).split("\n").filter((f) => /\.(ts|tsx|mjs|js)$/.test(f)).map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n")).join("\n");
	const goes = /GOES = "([^"]+)"/.exec(table)?.[1];
	return [...calls, ...events].filter((n) => n.old !== n.now).map((n) => ({ ...n, spoken: text.includes(`"${n.old}"`), goes }));
}

/** The root package.json after the switch: workspaces without the deleted folders, scripts on the new programs. */
export function rootFiles(deleted) {
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	const gone = new Set(deleted);
	const workspaces = pkg.workspaces.filter((w) => !gone.has(w)).flatMap((w) => (w === "packages/*" || w === "apps/*" ? [w] : [w]));
	const scripts = {
		dev: "node --import tsx server/main.ts --deck \"${DECKS_DECK:-$PWD/data}\" & node --import tsx harness/main.ts --deck \"${DECKS_DECK:-$PWD/data}\"",
		start: "node --import tsx server/main.ts --deck \"${DECKS_DECK:-$PWD/data}\"",
		"build:page": "npm run build --workspace @decks/page",
		typecheck: pkg.scripts.typecheck,
		test: "node tools/check.mjs protocol && node tools/check.mjs server && node tools/check.mjs harness && node tools/check.mjs tools",
		gates: "node tools/gates/run.mjs",
		"test:e2e": "node tools/checks/run.mjs",
		check: "node tools/check.mjs",
		heavy: "node tools/heavy.mjs",
	};
	return { workspaces, scripts, removedScripts: Object.keys(pkg.scripts).filter((k) => !(k in scripts)), ci: ".github/workflows/test.yml: npm run test:e2e runs tools/checks/run.mjs; the typecheck and test steps stay" };
}
