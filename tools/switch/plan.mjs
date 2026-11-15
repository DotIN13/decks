// What the switch-over does, worked out from the tree as it is: deletions with their new home and
// proof, what Loom keeps, renames with counts, checks moved by owner, compat's old names, root files.
// Read only: nothing here writes. run.mjs renders it (--dry) or carries it out.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BY_NAME, KEEP_IN_WEB, KEPT } from "./compat/old.mjs";

export { KEPT };

export const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const RUNS = "/Users/dotin13/Documents/DotGit/dotty-programs/decks/data/decks/canvases/decks-rewrite-build/cards/stop-3-today-s-browser-checks-against-the-new/runs.json";

/** Today's code the new folders replaced, each with its new home and what proves it. */
export const REPLACED = [
	{ old: "apps/server", home: "server/ (Decks-local) and harness/ (agents)", proof: "node tools/check.mjs server, node tools/check.mjs harness; the 76 browser checks of stop 3" },
	{ old: "apps/web", home: "harness/page", proof: "the page checks of stop 3 (shell, panel, chrome, agents-tab, ...)", keep: KEEP_IN_WEB },
	{ old: "packages/api", home: "protocol/ (calls/, the one table)", proof: "node tools/check.mjs protocol; server/compat/names.test.ts (all 117 old calls)" },
	{ old: "packages/protocol", home: "protocol/ (events, wire)", proof: "node tools/check.mjs protocol; compat's 43 old events" },
	{ old: "packages/sync-protocol", home: "protocol/sync.ts", proof: "node tools/check.mjs protocol" },
	{ old: "packages/hub", home: "server/sharing/hub", proof: "server/sharing tests (node tools/check.mjs server)" },
	{ old: "packages/sync-client", home: "server/sharing/client", proof: "server/sharing/client tests" },
	{ old: "packages/agent-ui", home: "harness/page (chat/, composer/)", proof: "chat-content, slash, voice, working-marks checks" },
	{ old: "packages/sdk", home: "clients/sdk, clients/cli", proof: "node tools/check.mjs clients/sdk, tools/clients/same.test.ts" },
	{ old: "runtime", home: "harness/prompts, harness/runtimes", proof: "node tools/check.mjs harness; running, time-machine checks", keep: { "runtime/live-doc.ts": "the source of packages/card-host/lib/live-doc.js, built by scripts/live-doc.mjs; Loom's step 4d moves it into canvas/" } },
	{ old: "extension", home: "clients/extension", proof: "a clients/extension folder" },
	{ old: "e2e", home: "tools/checks (the runner, the harness, the fake model and agent) and the features' checks/ folders", proof: "every check moved first and started by node tools/checks/run.mjs" },
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
		// e2e goes once its checks have moved (the first commit); its files are not imported by name.
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

/** What tools/checks/checks.json says of each check: timed, agent, named, bench. */
export const traits = () => JSON.parse(readFileSync(join(ROOT, "tools/checks/checks.json"), "utf8")).checks;

/** Every check moves: stop 3's to their owners' features; the others too, agent checks and benches to tools/checks. */
function checkMoves() {
	const stop3 = readFileSync(join(ROOT, ".scratch/Mason/checks.txt"), "utf8").split(/\s+/).filter(Boolean);
	const owners = existsSync(RUNS) ? JSON.parse(readFileSync(RUNS, "utf8")).owners ?? {} : {};
	const all = git("ls-files", "e2e/checks").split("\n").filter(Boolean).map((f) => f.slice("e2e/checks/".length).replace(/\.mjs$/, ""));
	const t = traits();
	const home = (c) => (t[c]?.agent ? "tools/checks/agent" : t[c]?.bench ? "tools/checks/bench" : undefined);
	const moved = [...stop3, ...all.filter((c) => !stop3.includes(c))].map((c) => {
		const owner = ownerFor(c, owners);
		return { check: c, owner, to: `${home(c) ?? HOME_OF[owner] ?? HOME_OF.Warden}/${c}.mjs`, owned: c in owners, stop3: stop3.includes(c), traits: t[c] ?? {} };
	});
	return { moved, left: [] };
}

/** A specifier of one package name in code or a package.json, not a longer name that starts with it. */
export const specifier = (name) => new RegExp(`(["'])${name.replace("/", "\\/")}(?=["'/])`, "g");

/**
 * A kept old package whose name a new one takes at the rename (@decks/protocol): two workspaces cannot
 * share a name, so the old one is called <name>-old until Loom moves it, and every surviving file that
 * names it gets that specifier, nothing else changed.
 */
function clashes(files, renamed, deleted) {
	const gone = (f) => deleted.some((d) => f === d || f.startsWith(`${d}/`));
	const survivors = files.filter((f) => !gone(f) && /\.(ts|tsx|mjs|mts|js|json)$/.test(f) && !f.endsWith("package-lock.json") && !f.startsWith("docs/"));
	return renamed.flatMap((r) => {
		const old = files.filter((f) => f.endsWith("/package.json") && !gone(f) && f !== `${r.dir}/package.json` && nameOf(f.replace(/\/package\.json$/, "")) === r.to).map((f) => f.replace(/\/package\.json$/, ""));
		return old.map((dir) => {
			const users = survivors.filter((f) => specifier(r.to).test(readFileSync(join(ROOT, f), "utf8")));
			return { dir, name: r.to, to: `${r.to}-old`, files: users };
		});
	});
}

export function plan() {
	const files = tracked();
	const dels = deletions(files);
	const rens = renames(files);
	return { deletions: dels, kept: KEPT.filter((k) => existsSync(join(ROOT, k))), renames: rens, clashes: clashes(files, rens, dels.filter((d) => d.delete).map((d) => d.old)), checks: checkMoves() };
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

/** Root scripts the kept packages still need, each with what uses it. */
/** Files under scripts/ the kept packages build with; scripts/ itself is not deleted by the switch. */
export const KEPT_FILES = { "scripts/vendor.mjs": "fills packages/card-host/lib (Loom's step 4c moves it)", "scripts/live-doc.mjs": "builds lib/live-doc.js from runtime/live-doc.ts (Loom's step 4d moves it)" };

export const KEPT_SCRIPTS = {
	vendor: "copies d3, KaTeX, pdf.js and the bundles into packages/card-host/lib",
	"build:live-doc": "builds packages/card-host/lib/live-doc.js",
	"build:packages": "builds the public @decks packages (canvas, pen, ui, the engine, card-host, hub) for Studio and npm",
	"test:packages": "packs and installs those packages to prove they run outside the repo",
};

/** The path prefixes each switch commit writes, for the one job's lanes. */
export function lanesNeeded(p) {
	const moves = p.checks.moved.flatMap((m) => [`e2e/checks/${m.check}.mjs`, m.to.replace(/\/[^/]+$/, "/")]);
	const renamed = git("ls-files").split("\n").filter((f) => /\.(ts|tsx|mjs|mts|js|json|md)$/.test(f) && !f.endsWith("package-lock.json") && existsSync(join(ROOT, f)) && p.renames.some((r) => readFileSync(join(ROOT, f), "utf8").includes(r.from)));
	const top = (f) => {
		const segs = f.split("/");
		const n = /^(harness\/page|server|clients)\//.test(f) ? (f.startsWith("harness/page/") ? 3 : 2) - 0 : 1;
		return segs.length > n ? `${segs.slice(0, n).join("/")}/` : f;
	};
	const covered = (list) => list.filter((x) => !list.some((y) => y !== x && y.endsWith("/") && x.startsWith(y)));
	return {
		move: covered([...new Set([...moves.filter((x) => x.endsWith("/")), "e2e/", "tools/checks/"])]).sort(),
		delete: p.deletions.filter((d) => d.delete).map((d) => `${d.old}/`),
		rename: covered([...new Set(renamed.map(top))]).sort(),
		root: ["package.json", "package-lock.json", ".github/workflows/"],
	};
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
	// The kept packages still build and publish through these until Loom moves them (map step 4c and the last step).
	for (const [k, why] of Object.entries(KEPT_SCRIPTS)) if (pkg.scripts[k]) scripts[k] = pkg.scripts[k];
	return { workspaces, scripts, kept: KEPT_SCRIPTS, removedScripts: Object.keys(pkg.scripts).filter((k) => !(k in scripts)), ci: ".github/workflows/test.yml: npm run test:e2e runs tools/checks/run.mjs; the typecheck and test steps stay" };
}
