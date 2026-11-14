// Rule 3: imports go one way (DESIGN.md section 3), through a folder's entry file only.
// Today's packages count as the folder they move to. Inside server/, a feature imports the kernel only.
// protocol/ imports nothing: no package and no node: module (its tests may use node:test).
import { dirname, posix } from "node:path";
import { CODE, bump, isSource } from "./lib.mjs";

export const MAY_IMPORT = {
	protocol: [], pen: ["protocol"], ui: ["protocol"], engine: ["protocol"],
	canvas: ["protocol", "pen", "ui", "engine"], server: ["protocol", "pen", "engine"],
	clients: ["protocol"], harness: ["protocol", "clients", "ui", "canvas"], tools: null,
};
const MOVES_TO = {
	"apps/server": "server", "apps/web": "harness", "packages/agent-ui": "harness", "packages/api": "protocol",
	"packages/protocol": "protocol", "packages/sync-protocol": "protocol", "packages/hub": "server",
	"packages/sync-client": "server", "packages/canvas": "canvas", "packages/card-host": "canvas",
	"packages/ink": "canvas", "packages/docs": "canvas", "packages/pen": "pen", "packages/stage": "engine",
	"packages/ui": "ui", "packages/sdk": "clients", extension: "clients", runtime: "harness",
	scripts: "tools", e2e: "tools",
};
const IMPORT = /^\s*(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/gm;

/** The unit a file belongs to: a package of today's code, or a new folder (clients/<name> for clients). */
export function unitOf(f) {
	const s = f.split("/");
	if (["packages", "apps", "examples", "clients"].includes(s[0])) return s.length > 2 ? `${s[0]}/${s[1]}` : s[0];
	return s.length > 1 ? s[0] : null;
}

export function folderOf(unit) {
	if (!unit) return null;
	if (MOVES_TO[unit]) return MOVES_TO[unit];
	if (unit.startsWith("examples")) return "tools";
	const top = unit.split("/")[0];
	return top in MAY_IMPORT ? top : null;
}

function exportsOf(ctx, unit) {
	const path = `${unit}/package.json`;
	if (!ctx.exists(path)) return null;
	try {
		const pkg = JSON.parse(ctx.read(path));
		const ex = typeof pkg.exports === "string" ? { ".": pkg.exports } : pkg.exports || {};
		const targets = Object.values(ex).map((v) => (typeof v === "string" ? v : v?.import || v?.default)).filter(Boolean);
		return { name: pkg.name, keys: Object.keys(ex), entries: targets.map((t) => posix.join(unit, t)) };
	} catch { return null; }
}

function packages(ctx) {
	const byName = new Map();
	for (const f of ctx.files.filter((f) => f.endsWith("/package.json") && !f.includes("node_modules"))) {
		const unit = dirname(f);
		const ex = exportsOf(ctx, unit);
		if (ex?.name) byName.set(ex.name, { unit, ...ex });
	}
	return byName;
}

const matches = (key, sub) => key === sub || (key.includes("*") && sub.startsWith(key.split("*")[0]));

const bare = (p) => p.replace(/\.[^./]+$/, "");
function sameFile(entry, to) {
	if (!entry.includes("*")) return bare(entry) === bare(to);
	const [head, tail] = bare(entry).split("*");
	return bare(to).startsWith(head) && bare(to).endsWith(tail) && !bare(to).slice(head.length).includes("/");
}

function entryFiles(ctx, unit) {
	const ex = exportsOf(ctx, unit);
	const plain = ["index.ts", "index.tsx", "index.mjs", "main.ts"].map((n) => `${unit}/${n}`);
	return new Set([...(ex?.entries || []), ...plain]);
}

/** One import, judged: null when allowed, else why it is not. */
function judge(ctx, pkgs, f, spec) {
	const from = folderOf(unitOf(f));
	if (from === "protocol" && !spec.startsWith(".") && !/\.test\.[a-z]+$/.test(f)) return `protocol may not import ${spec}`;
	let unit, deep;
	if (spec.startsWith(".")) {
		const to = posix.normalize(posix.join(dirname(f), spec));
		unit = unitOf(to);
		if (!unit || unit === unitOf(f)) return serverFeature(f, to);
		const ends = entryFiles(ctx, unit);
		deep = ![...ends].some((e) => sameFile(e, to));
	} else {
		const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
		const pkg = pkgs.get(name);
		if (!pkg) return null;
		unit = pkg.unit;
		const sub = spec === name ? "." : `.${spec.slice(name.length)}`;
		deep = !pkg.keys.some((k) => matches(k, sub));
	}
	const to = folderOf(unit);
	const allowed = MAY_IMPORT[from];
	if (allowed && to && to !== from && !allowed.includes(to)) return `${from} may not import ${to} (${unit})`;
	return deep ? `reaches past the entry of ${unit}` : null;
}

function serverFeature(f, to) {
	const a = f.split("/"), b = to.split("/");
	if (a[0] !== "server" || a.length < 3 || b.length < 3 || a[1] === b[1] || b[1] === "kernel") return null;
	return `server feature ${a[1]} may not import feature ${b[1]}`;
}

export default {
	name: "imports",
	rule: "3. Imports go one way, through a folder's entry file only.",
	scan(ctx) {
		const pkgs = packages(ctx);
		const counts = new Map();
		for (const f of ctx.files.filter((f) => isSource(f) && CODE.test(f) && folderOf(unitOf(f)))) {
			for (const m of ctx.read(f).matchAll(IMPORT)) {
				const why = judge(ctx, pkgs, f, m[1] || m[2] || m[3] || m[4]);
				if (why) bump(counts, `${f}: ${why}`);
			}
		}
		return { counts, notes: ["Not checked: that harness reaches clients/ only through sdk and canvas/ only through its host entry."] };
	},
};
