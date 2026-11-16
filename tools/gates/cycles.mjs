// Import cycles for the imports gate: files that import each other's values, directly or round a loop,
// load in an order that depends on who came first, and read as one story split over several files.
// Only relative imports are followed; type-only imports and dynamic import() are aside (neither runs at load).
import { dirname, posix } from "node:path";

const STATIC = /^\s*(import|export)\s+([^'"`;]*?)\s*from\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
const EXTS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.tsx", "/index.mjs", "/index.js"];

/**
 * Each file standing in a value import cycle, with how many of its imports stay inside that cycle (the
 * count falls as a loop is cut), and the cycles themselves (each a list of files, largest first).
 */
export function importCycles(files, read) {
	const graph = valueGraph(files, read);
	const groups = stronglyConnected(graph).filter((g) => g.length > 1).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
	const counts = new Map();
	for (const group of groups) {
		const inside = new Set(group);
		for (const f of group) counts.set(f, [...graph.get(f)].filter((t) => inside.has(t)).length);
	}
	return { counts, groups };
}

// The graph: each file to the repo files it imports for their values.

/** Each code file to the set of repo files it imports values from. */
function valueGraph(files, read) {
	const known = new Set(files);
	const graph = new Map(files.map((f) => [f, new Set()]));
	for (const f of files) {
		for (const m of read(f).matchAll(STATIC)) {
			const spec = m[3] ?? m[4];
			if (!spec.startsWith(".") || (m[2] !== undefined && typeOnly(m[1], m[2]))) continue;
			const to = resolveFile(known, posix.normalize(posix.join(dirname(f), spec)));
			if (to && to !== f) graph.get(f).add(to);
		}
	}
	return graph;
}

/** Whether an import or export clause brings in types only: `import type …`, or braces whose every name is `type`. */
export function typeOnly(keyword, clause) {
	const c = clause.trim();
	if (/^type\s/.test(c)) return true;
	if (keyword === "export" && c.startsWith("*")) return false;
	const braces = /^\{([^}]*)\}$/.exec(c);
	if (!braces) return false;
	const names = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
	return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

/** The repo file an import names: as written, or with the extension or index file TypeScript would find; .js may name a .ts. */
function resolveFile(known, path) {
	const stems = [path, path.replace(/\.(m?js|jsx)$/, "")];
	for (const stem of stems) for (const ext of EXTS) if (known.has(stem + ext)) return stem + ext;
	return null;
}

// The loops: groups of files each reachable from every other (Tarjan's strongly connected components).

/** The strongly connected groups of the graph, walked without recursion so a long chain cannot overflow the stack. */
function stronglyConnected(graph) {
	const index = new Map(), low = new Map(), onStack = new Set(), stack = [], groups = [];
	let next = 0;
	for (const root of graph.keys()) {
		if (index.has(root)) continue;
		const work = [[root, [...graph.get(root)], 0]];
		index.set(root, next), low.set(root, next++), stack.push(root), onStack.add(root);
		while (work.length) {
			const frame = work.at(-1);
			const [v, edges] = frame;
			if (frame[2] < edges.length) {
				const w = edges[frame[2]++];
				if (!index.has(w)) {
					index.set(w, next), low.set(w, next++), stack.push(w), onStack.add(w);
					work.push([w, [...graph.get(w)], 0]);
				} else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
				continue;
			}
			work.pop();
			if (work.length) low.set(work.at(-1)[0], Math.min(low.get(work.at(-1)[0]), low.get(v)));
			if (low.get(v) !== index.get(v)) continue;
			const group = [];
			let w;
			do (w = stack.pop()), onStack.delete(w), group.push(w);
			while (w !== v);
			groups.push(group.sort());
		}
	}
	return groups;
}
