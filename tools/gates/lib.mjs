// What every gate shares: the files it reads, old and new folders, and the baseline rule.
// A baseline maps a key (a file, or a file and a name) to how many breaks it had. A key may fall or go.
// A new key, or a count above its baseline, fails the gate and is named.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const ROOT = resolve(new URL("../..", import.meta.url).pathname);

/** Folders of today's code. Their breaks are in the baselines; every other folder starts at zero. */
export const OLD = ["apps/", "packages/", "runtime/", "e2e/", "scripts/", "examples/", "docs/"];
export const NEW = ["protocol/", "server/", "harness/", "clients/", "tools/", "canvas/", "engine/", "pen/", "ui/"];
const NOT_SOURCE = /(^|\/)(node_modules|dist|dist-gen|dist-packages|pkg|pkg-gl|target|\.scratch|fixtures|baseline)\/|^canvas\/cards\/runtime\/lib\/|^runtime\/lib\/|\.(bundle|min)\.|\.d\.ts$|package-lock\.json$/;

export const isOld = (f) => OLD.some((p) => f.startsWith(p));
export const isSource = (f) => !NOT_SOURCE.test(f);
export const CODE = /\.(ts|tsx|mts|mjs|js|cjs)$/;

function walk(root, dir = root) {
	const out = [];
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === ".git") continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...walk(root, path));
		else out.push(relative(root, path));
	}
	return out;
}

/** Every file in the tree, tracked or new, that git does not ignore; a plain walk when root has no git. */
export function listFiles(root) {
	if (!existsSync(join(root, ".git"))) return walk(root).sort();
	const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
	return out.split("\n").filter((f) => f && existsSync(join(root, f))).sort();
}

export function context(root = ROOT) {
	const files = listFiles(root);
	const cache = new Map();
	const read = (f) => {
		if (!cache.has(f)) cache.set(f, readFileSync(join(root, f), "utf8"));
		return cache.get(f);
	};
	return { root, files, read, exists: (f) => existsSync(join(root, f)) };
}

export const lineCount = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

export function bump(counts, key, by = 1) { counts.set(key, (counts.get(key) || 0) + by); }

export const baselinePath = (root, name) => join(root, "tools/gates/baseline", `${name}.json`);

export function readBaseline(root, name) {
	const p = baselinePath(root, name);
	return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}

/** Breaks above the baseline, and keys the baseline holds that are now lower (to shrink it). */
export function compare(counts, baseline) {
	const over = [];
	for (const [key, n] of counts) if (n > (baseline[key] || 0)) over.push({ key, n, was: baseline[key] || 0 });
	const fixed = Object.keys(baseline).filter((k) => (counts.get(k) || 0) < baseline[k]);
	return { over, fixed };
}

const CUT = "c669a67f";

/** Root files as the branch was cut: they count as today's code. */
function filesAtCut(root) {
	try { return new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", CUT], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\n")); }
	catch { return new Set(); }
}

/** Whether a key names today's code: an old folder, a file that existed at the cut, or a commit. */
export function oldKey(key, atCut) {
	if (/^[0-9a-f]{8}: /.test(key)) return true;
	const path = key.replace(/^(dead-exports|dead-css|stale-paths|surface-gate): /, "").split(":")[0];
	return isOld(path) || isOld(`${path}/`) || (atCut.has(path) && !NEW.some((p) => path.startsWith(p)));
}

/** Folders moved whole from today's code (DESIGN.md section 9): their breaks may be adopted once, under the new path. */
export const MOVED = ["harness/page/", "harness/runtimes/", "harness/prompts/", "harness/accounts/", "harness/sessions/"];

/** Records today's counts for keys under one moved folder, leaving every other key as it was. */
export function adoptBaseline(root, name, counts, prefix) {
	const next = { ...readBaseline(root, name) };
	const under = (key) => { const k = key.replace(/^(dead-exports|dead-css|stale-paths|surface-gate): /, ""); return k.startsWith(prefix) || k.startsWith(`${prefix.slice(0, -1)}:`); };
	for (const key of Object.keys(next)) if (under(key)) delete next[key];
	for (const [key, n] of counts) if (under(key)) next[key] = n;
	const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(baselinePath(root, name), `${JSON.stringify(sorted, null, "\t")}\n`);
}

/** Writes a baseline. With shrinkOnly it can lower or drop keys and never add or raise one; a first one holds old code only. */
export function writeBaseline(root, name, counts, shrinkOnly) {
	const old = readBaseline(root, name);
	const atCut = shrinkOnly ? null : filesAtCut(root);
	const next = {};
	for (const [key, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
		if (!shrinkOnly) { if (oldKey(key, atCut)) next[key] = n; }
		else if (old[key] !== undefined) next[key] = Math.min(n, old[key]);
	}
	writeFileSync(baselinePath(root, name), `${JSON.stringify(next, null, "\t")}\n`);
}
