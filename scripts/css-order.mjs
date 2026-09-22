/**
 * The cascade gate: the order of the app's own CSS rules, flattened and hashed.
 *
 * Step one of the stylesheet restructure, and it comes first because nothing else is safe
 * without it. The app's 13 sheets all declare inside `@layer components`, so a rule of equal
 * specificity is decided by *position* and by nothing else — which means every later step (a
 * comment moved out, a file split, a class renamed) can change which rule wins while leaving
 * the rendered page identical in whatever the e2e checks happen to look at.
 *
 * **What this hashes is the flattened cascade, not the files.** The `@import` graph starting
 * at `apps/web/src/index.css` is inlined in place, exactly as a bundler resolves it, and each
 * rule becomes a signature: its at-rule chain (`@media (pointer: coarse) ▸ :root`), its
 * selector, and its declarations in the order they are written. The hash is taken over those
 * signatures **without the file each came from**. That is the one property that makes this
 * usable for the split: moving `.board-node`'s 44 blocks from `index.css` into `canvas.css`
 * changes no tie, so the hash must not move — and if the move lands one of them on the wrong
 * side of another rule that matches the same element, it does.
 *
 * Deliberately not part of the signature: comments and whitespace (they are the 3,572 lines
 * of prose the second step removes, and a red build for deleting a comment would be a gate
 * people learn to bypass). Deliberately part of it: the order of properties inside a block,
 * because `background` after `background-color` is a different rule from the reverse.
 *
 * The baseline in `apps/web/src/styles/cascade-order.json` is the committed reference. It is
 * stamped by a person and reviewed in the diff, so an order change is a decision that shows
 * up in review rather than a hash nobody reads:
 *
 *     npm run css:order            # check; exit 1 and say what moved when it changed
 *     npm run css:order -- --update   # re-stamp after an intended change
 *     npm run css:order -- --list     # print every rule, in cascade order
 *
 * The baseline also records how much the order can bite: 976 rules over 13 sheets, and only
 * **three** selector-and-property pairs written more than once. The app is not riddled with
 * the same selector defined twice — the duplicated *classes* live inside different compound
 * selectors — so a redefinition cannot be found by reading a file, which is the other reason
 * the order is guarded by a hash rather than by a lint rule.
 *
 * When a rule moves, the report names the *ties* it changed — a selector-and-property pair
 * that two rules both set, whose winner moved — because that is the kind of move that changes
 * the page, and it is worth saying out loud next to the moves that cannot. What no static
 * check can settle is a tie between two *different* selectors of equal specificity; that is
 * what the e2e checks and a pair of eyes are for.
 *
 *     node scripts/css-order.mjs
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");
/** The one stylesheet the browser is given: everything else is reached through its imports. */
export const ENTRY = "apps/web/src/index.css";
/** Where the re-stampable reference lives, under the sheets it describes. */
export const BASELINE = "apps/web/src/styles/cascade-order.json";

/** At-rules whose body holds rules, so their prelude belongs on every rule inside them. */
const NESTING = new Set(["@media", "@supports", "@layer", "@container", "@scope", "@document"]);
/** At-rules whose body is a rule list of its own, kept whole rather than parsed as declarations. */
const OPAQUE = new Set(["@keyframes", "@-webkit-keyframes", "@-moz-keyframes", "@font-feature-values"]);

const collapse = (s) => s.replace(/\s+/g, " ").trim();
/** `a, b` and `a,b` are the same selector list; say so once, here. */
const normPrelude = (s) => collapse(s.replace(/\s*,\s*/g, ","));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ");

/* ------------------------------------------------------------------ reading the sheets */

/** Line lookups, so a moved rule can be reported as `styles/panel.css:412` and not as an offset. */
function lineCounter(text) {
	const starts = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
	return (offset) => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};
}

function skipString(text, i) {
	const quote = text[i];
	i++;
	while (i < text.length && text[i] !== quote) i += text[i] === "\\" ? 2 : 1;
	return i + 1;
}

/** The offset just past the `}` matching the `{` at `open`, skipping strings and comments. */
function matchBrace(text, open) {
	let depth = 0;
	let i = open;
	while (i < text.length) {
		const c = text[i];
		if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end < 0 ? text.length : end + 2;
			continue;
		}
		if (c === '"' || c === "'") {
			i = skipString(text, i);
			continue;
		}
		if (c === "{" || c === "(") depth++;
		else if (c === "}" || c === ")") {
			depth--;
			if (depth === 0) return i;
		}
		i++;
	}
	return text.length;
}

/** A block's declarations, one `prop:value` per entry, in the order written. */
function declarations(body) {
	const out = [];
	for (const raw of stripComments(body).split(";")) {
		const part = collapse(raw);
		if (!part) continue;
		const at = part.indexOf(":");
		if (at < 0) {
			out.push(part.toLowerCase());
			continue;
		}
		out.push(`${part.slice(0, at).trim().toLowerCase()}:${collapse(part.slice(at + 1))}`);
	}
	return out;
}

/**
 * One stylesheet, in cascade order.
 *
 * `file` is only ever used in the report — the hash drops it, so a rule that changes sheets
 * without changing its neighbours is the same rule (see the header).
 */
function flattenSheet(text, file, at, out, resolveImport, stack, base = 0, lineAt = lineCounter(text)) {
	/*
	 * `base` is where this text starts **inside its file**. Recursing into a `@layer` body
	 * passes a slice, so without it every rule inside a layer is reported a few hundred lines
	 * early — the count restarts at the brace. An imported sheet is a whole file of its own,
	 * so it starts again at zero with a line counter of its own.
	 */
	const lineOf = (offset) => lineAt(base + offset);
	let buf = "";
	let start = 0;
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end < 0 ? text.length : end + 2;
			continue;
		}
		if (c === '"' || c === "'") {
			/*
			 * Copied whole into the prelude rather than skipped: `@import "./styles/x.css"`
			 * is *made* of its string, and a value like `[data-k="a;b"]` must not end a rule.
			 */
			const end = skipString(text, i);
			if (buf.trim() === "") start = i;
			buf += text.slice(i, end);
			i = end;
			continue;
		}
		if (c === "{") {
			const prelude = collapse(buf);
			const from = start;
			buf = "";
			const end = matchBrace(text, i);
			const body = text.slice(i + 1, end);
			const kind = /^@/.test(prelude) ? prelude.split(/[\s(]/)[0].toLowerCase() : "";
			if (kind && NESTING.has(kind)) {
				flattenSheet(body, file, at.concat(normPrelude(prelude)), out, resolveImport, stack, base + i + 1, lineAt);
			} else if (kind && OPAQUE.has(kind)) {
				out.push({ file, line: lineOf(from), sel: at.concat(normPrelude(prelude)).join(" ▸ "), decls: [`{${collapse(stripComments(body))}}`] });
			} else {
				/*
				 * Everything else is declarations, including the at-rules that hold them: the
				 * `@theme`, `@property` and `@font-face` blocks are `prop:value` bodies, and
				 * their own prelude is what a later block of the same name would lose to.
				 */
				out.push({
					file,
					line: lineOf(from),
					sel: at.concat(normPrelude(prelude)).join(" ▸ "),
					decls: declarations(body),
				});
			}
			i = end + 1;
			continue;
		}
		if (c === ";") {
			const statement = collapse(buf);
			const from = start;
			buf = "";
			if (statement) {
				/*
				 * A relative `@import` is inlined where it stands, which is what decides the
				 * order of everything the file brings in. A bare one (`tailwindcss`) is a
				 * package and cannot be read from here, but its *position* still decides a
				 * tie for us — a utility is only stronger than the components layer because
				 * Tailwind's import comes first — so it takes a slot in the order as itself.
				 */
				const target = /^@import\s+(?:url\()?["']?([^"')]+)["']?\)?/.exec(statement);
				if (target && /^\.{1,2}\//.test(target[1])) {
					const nested = resolveImport(file, target[1]);
					if (nested) flattenSheet(nested.text, nested.path, at, out, resolveImport, stack, 0, lineCounter(nested.text));
					else out.push({ file, line: lineOf(from), sel: `@import "${target[1]}" (missing)`, decls: [] });
				} else {
					out.push({ file, line: lineOf(from), sel: statement, decls: [] });
				}
			}
			i++;
			continue;
		}
		if (buf.trim() === "") start = i;
		buf += c;
		i++;
	}
	return out;
}

/**
 * The whole cascade, flattened.
 *
 * `read(path)` answers a stylesheet's text by a path relative to the file that imported it,
 * and `null` when there is no such file; that is the one seam the working tree and `git show`
 * differ behind, so the same flattening can be run over both.
 */
export function flatten(read, entry = ENTRY) {
	const text = read(entry);
	if (text == null) throw new Error(`no such stylesheet: ${entry}`);
	/* A file imported twice is inlined twice, which is what a bundler does; only a cycle stops. */
	const stack = new Set([entry]);
	const resolveImport = (from, spec) => {
		const path = normalize(join(dirname(from), spec));
		if (stack.has(path)) return null;
		const nested = read(path);
		if (nested == null) return null;
		stack.add(path);
		return { path, text: nested };
	};
	return flattenSheet(text, entry, [], [], resolveImport, stack);
}

const normalize = (p) => relative(ROOT, resolve(ROOT, p)).split("\\").join("/");
const webPath = (rel) => join(ROOT, rel);

/** The stylesheets as they are on disk, starting at `index.css`. */
export function fromWorkingTree(entry = ENTRY) {
	const read = (path) => {
		try {
			return readFileSync(webPath(path), "utf8");
		} catch {
			return null;
		}
	};
	return { entries: flatten(read, entry), files: graphFiles(entry, read) };
}

/** The same thing as of a commit — `HEAD` by default — or `null` outside a repository. */
export function fromGit(rev = "HEAD", entry = ENTRY) {
	const show = (path) => {
		try {
			return execFileSync("git", ["show", `${rev}:${path}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		} catch {
			return null;
		}
	};
	if (show(entry) == null) return null;
	return { entries: flatten(show, entry), files: graphFiles(entry, show) };
}

/** Every sheet the entry reaches, in the order it reaches them, for the baseline's file counts. */
function graphFiles(entry, read) {
	const seen = new Set();
	const walk = (path, text) => {
		if (seen.has(path) || text == null) return;
		seen.add(path);
		for (const m of text.matchAll(/@import\s+(?:url\()?["']?([^"')]+)["']?\)?[^;]*;/g)) {
			if (!/^\.{1,2}\//.test(m[1])) continue;
			const next = normalize(join(dirname(path), m[1]));
			walk(next, read(next));
		}
	};
	walk(entry, read(entry));
	return [...seen];
}

/* --------------------------------------------------------------------- the signature */

/** A rule with no file attached: what a tie is decided by. */
export const signature = (rule) => `${rule.sel}{${rule.decls.join(";")}}`;

/** A rule's identity, whether it came from a stylesheet (with declarations) or the baseline. */
const sigOf = (rule) => rule.sig ?? signature(rule);

/** The selector with its at-rule chain stripped: `.a` out of `@media (…) ▸ .a`. */
const baseOf = (rule) => rule.sel.split(" ▸ ").pop();

/** What a rule says, apart from where it sits: the pair that tells a relayer from an edit. */
const identityOf = (rule) => `${baseOf(rule)}|${declsOf(rule).join(";")}`;

/**
 * A rule as something to compare across commits: its file, its selector, and its signature.
 *
 * `sig` is the identity — two records with the same signature are the same rule, wherever they
 * are — and it is short enough to keep a thousand of them in the baseline. A rule read from a
 * stylesheet carries its declarations and gets its signature computed here; one read back out
 * of the baseline already has one.
 */
export const record = (rule) => ({
	file: rule.file.replace(/^apps\/web\/src\//, ""),
	sel: rule.sel,
	sig: rule.decls ? signature(rule) : rule.sig,
	/* Kept when the rule came from a stylesheet, so a report can name a line; never stored. */
	...(rule.line === undefined ? {} : { line: rule.line }),
});

/**
 * A rule's declarations, whether it was read from a stylesheet or back out of the baseline.
 *
 * The baseline stores each rule's whole signature and not a digest, which costs about a
 * hundred kilobytes and buys two things: a diff of the baseline shows what a rule now says,
 * and the tie alarm still works when the baseline is old.
 */
const declsOf = (rule) => {
	if (rule.decls) return rule.decls;
	const open = typeof rule.sig === "string" ? rule.sig.indexOf("{") : -1;
	return open < 0 ? [] : rule.sig.slice(open + 1, -1).split(";").filter(Boolean);
};

/**
 * The rules that are not in a layer, which in this app is a bug and not a style choice.
 *
 * Unlayered CSS beats every layer, so a component rule written outside `@layer components`
 * cannot be overridden by a utility on the same element and nothing says why. The token blocks
 * are outside deliberately (see the note in `index.css`) and are element or `:root` selectors,
 * so the count is of rules that name a *class* — the ones a component reaches for.
 */
export const outsideLayer = (rules) => rules.filter((rule) => rule.decls?.length && /\./.test(rule.sel) && !rule.sel.includes("@layer"));

export const fingerprint = (rules) => createHash("sha256").update(rules.map(signature).join("\n")).digest("hex");

/**
 * The pairs the order decides: a selector-and-property that more than one rule sets.
 *
 * Three of them today, and **all three are the same block written twice** — the app does not
 * currently depend on the order of any two rules that disagree, which is the useful thing the
 * baseline records. The number can only rise, and it is the count of places where moving one
 * rule past another *could* change what the browser paints.
 */
export function ties(rules) {
	const byPair = new Map();
	rules.forEach((rule, index) => {
		const props = new Set(declsOf(rule).map((d) => d.split(":")[0]));
		for (const prop of props) {
			const key = `${rule.sel}|${prop}`;
			if (!byPair.has(key)) byPair.set(key, []);
			byPair.get(key).push(index);
		}
	});
	return new Map([...byPair].filter(([, at]) => at.length > 1));
}

/** What a rule says about one property, or `""` when it does not set it. */
const valueOf = (rule, property) => declsOf(rule).find((d) => d.startsWith(`${property}:`))?.slice(property.length + 1) ?? "";

/**
 * The rules whose winner moved, which is the whole reason to care about the order.
 *
 * A pair is a tie if two rules set the same property on the same selector. It *changes* when
 * the rules setting it are not the same rules in the same order afterwards: the last one wins,
 * so swapping them, or editing the value the later one writes, is a change to the page. The
 * report carries the value that wins on each side, because that is the thing that decides it —
 * the line numbers alone say nothing when a rule is edited in place.
 */
export function changedTies(before, after) {
	const was = ties(before);
	const now = ties(after);
	const out = [];
	for (const [key, from] of was) {
		const to = now.get(key);
		if (!to) continue;
		const fromRules = from.map((i) => sigOf(before[i]));
		const nowRules = to.map((i) => sigOf(after[i]));
		/*
		 * The rules among themselves, in order. Equal means the same rule still wins: the group
		 * may have moved as a whole, and a group that moves together changes nothing. Indices are
		 * deliberately not compared here — a swap leaves the two positions alone and exchanges
		 * what sits at them, which is exactly the case that has to fire.
		 */
		if (fromRules.join("\n") === nowRules.join("\n")) continue;
		const property = key.slice(key.lastIndexOf("|") + 1);
		const winBefore = before[from.at(-1)];
		const winAfter = after[to.at(-1)];
		/*
		 * Only the value that wins decides the page. Two rules that disagree, swapped, or a rule
		 * edited in place, both land here; two *identical* redefinitions passed over each other
		 * do not, and neither does a group that moved as a whole — the app has three of those
		 * (the same block written twice), and an alarm that fired for them would be noise.
		 */
		const wasValue = valueOf(winBefore, property);
		const nowValue = valueOf(winAfter, property);
		if (wasValue === nowValue) continue;
		out.push({
			selector: key.slice(0, key.lastIndexOf("|")),
			property,
			value: { was: wasValue, now: nowValue },
			was: { file: winBefore.file, line: winBefore.line },
			now: { file: winAfter.file, line: winAfter.line },
			rules: from.length,
		});
	}
	return out;
}

/**
 * The longest common subsequence of two signature lists: which rules stayed put relative to
 * each other.
 *
 * An index-by-index comparison is useless here — one inserted rule shifts every index after it
 * and reports eight hundred moves — so the alignment is what makes the report readable: a rule
 * added in the middle is *one* addition, and a rule dragged past another is one move.
 */
function align(a, b) {
	const n = a.length;
	const m = b.length;
	const width = m + 1;
	const table = new Int32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
		}
	}
	const pairs = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
		else j++;
	}
	return pairs;
}

/** What the check says: moves, arrivals, departures, edits in place, and the ties the moves decided. */
export function describe(before, after) {
	const was = before.map(record);
	const now = after.map(record);
	const kept = align(
		was.map((r) => r.sig),
		now.map((r) => r.sig),
	);
	const heldBefore = new Set(kept.map(([i]) => i));
	const heldAfter = new Set(kept.map(([, j]) => j));

	/*
	 * What the alignment could not keep is one of three things: the same rule somewhere else
	 * (its signature is on both sides), the same selector with different declarations (a rule
	 * edited where it stands), or a rule that arrived or left.
	 */
	const orphans = new Map();
	const bySelector = new Map();
	const byIdentity = new Map();
	const queue = (map, key, i) => {
		if (!map.has(key)) map.set(key, []);
		map.get(key).push(i);
	};
	for (let i = 0; i < before.length; i++) {
		if (heldBefore.has(i)) continue;
		queue(orphans, was[i].sig, i);
		queue(bySelector, was[i].sel, i);
		queue(byIdentity, identityOf(was[i]), i);
	}
	const added = [];
	const moved = [];
	const edited = [];
	const relayered = [];
	const take = (map, key, i) => {
		const list = map.get(key);
		if (list) {
			const at = list.indexOf(i);
			if (at >= 0) list.splice(at, 1);
		}
	};
	for (let j = 0; j < after.length; j++) {
		if (heldAfter.has(j)) continue;
		const same = orphans.get(now[j].sig);
		if (same?.length) {
			const i = same.shift();
			moved.push({ from: was[i], to: now[j], was: i, now: j });
			take(bySelector, was[i].sel, i);
			take(byIdentity, identityOf(was[i]), i);
			continue;
		}
		/* Same selector, same declarations, a different at-rule chain: it entered or left a layer. */
		const twin = byIdentity.get(identityOf(now[j]));
		if (twin?.length) {
			const i = twin.shift();
			relayered.push({ from: was[i], to: now[j], was: i, now: j });
			take(orphans, was[i].sig, i);
			take(bySelector, was[i].sel, i);
			continue;
		}
		const here = bySelector.get(now[j].sel);
		if (here?.length) {
			const i = here.shift();
			edited.push({ from: was[i], to: now[j], was: i, now: j });
			take(orphans, was[i].sig, i);
			take(byIdentity, identityOf(was[i]), i);
			continue;
		}
		added.push({ rule: now[j], at: j });
	}
	const gone = new Set([...orphans.values()].flat());
	const removed = [...gone].map((i) => ({ rule: was[i], at: i }));
	moved.sort((x, y) => x.now - y.now);
	edited.sort((x, y) => x.now - y.now);
	removed.sort((x, y) => x.at - y.at);
	relayered.sort((x, y) => x.now - y.now);
	return { added, removed, moved, edited, relayered, ties: changedTies(before, after) };
}

/* ------------------------------------------------------------------------- the command */

const stamp = (rules) => ({
	note: "The app CSS's cascade order, flattened and hashed, and the rules themselves so a stale baseline can still say what moved. Re-stamp with `npm run css:order -- --update` only when the order is meant to change, and read the diff: a move that changes which rule wins is a change to the page.",
	entry: ENTRY,
	hash: fingerprint(rules),
	rules: rules.length,
	sheets: new Set(rules.map((rule) => rule.file)).size,
	ties: ties(rules).size,
	/*
	 * A ratchet, not a gate of its own: unlayered component rules beat every utility, so the
	 * count is worth seeing. It cannot rise without the hash changing too, which is why the
	 * number is printed at re-stamp time — that is the moment somebody is deciding.
	 */
	outsideLayer: outsideLayer(rules).length,
	files: Object.fromEntries(
		Object.entries(
			rules.reduce((acc, rule) => {
				acc[rule.file] = (acc[rule.file] ?? 0) + 1;
				return acc;
			}, {}),
		).sort(([a], [b]) => (a < b ? -1 : 1)),
	),
	/*
	 * `[file, signature]`, one rule per line, in cascade order. The selector is the head of
	 * the signature, so it is not stored twice — a thousand of these is the whole file, and
	 * the point of keeping them is that a moved rule is a moved *line* in the diff.
	 */
	order: rules.map((rule) => [record(rule).file, signature(rule)]),
});

/**
 * Written by hand rather than by `JSON.stringify`, for one line per rule.
 *
 * Stringified whole, every rule would be a five-line array of indentation, and a diff that
 * moves one rule would be unreadable — which is the only reason the rules are in this file.
 */
function writeBaseline(path, baseline) {
	const { order, ...rest } = baseline;
	const head = JSON.stringify(rest, null, "\t").replace(/\n\}$/, "");
	writeFileSync(path, `${head},\n\t"order": [\n${order.map(([file, sig]) => `\t\t${JSON.stringify([file, sig])}`).join(",\n")}\n\t]\n}\n`);
}

const where = (at) => `${at.file}:${at.line}`;
/** A record's place: a line when it came from a stylesheet, its position when it came from the baseline. */
const spot = (rec, index) => (rec.line === undefined ? `${rec.file}[${index}]` : `${rec.file}:${rec.line}`);
const short = (s, n = 68) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function report(before, after, { json }) {
	const changes = describe(before, after);
	if (json) {
		console.log(JSON.stringify({ hash: fingerprint(after), rules: after.length, ties: ties(after).size, ...changes }, null, 2));
		return;
	}
	const lines = [];
	lines.push(
		`cascade order changed: ${changes.moved.length} moved, ${changes.edited.length} edited in place, ${changes.relayered.length} entered or left a layer, ${changes.added.length} added, ${changes.removed.length} removed, ${changes.ties.length} ties decided differently`,
	);
	for (const pair of changes.relayered.slice(0, 6)) {
		const into = pair.to.sel.includes("@layer") && !pair.from.sel.includes("@layer") ? "into a layer" : "out of a layer";
		lines.push(`  layer ${short(pair.to.sel)}  ${spot(pair.from, pair.was)} → ${spot(pair.to, pair.now)}  (${into}, declarations unchanged)`);
	}
	if (changes.relayered.length > 6) lines.push(`  … and ${changes.relayered.length - 6} more relayered`);
	for (const tie of changes.ties) {
		lines.push(`  TIE  ${short(tie.selector)} { ${tie.property} } — ${tie.rules} rules, the last one wins`);
		lines.push(`       ${tie.property}:${tie.value.was}  at ${where(tie.was)}`);
		lines.push(`    →  ${tie.property}:${tie.value.now}  at ${where(tie.now)}`);
	}
	for (const move of changes.moved.slice(0, 20)) {
		lines.push(`  move ${short(move.from.sel)}  ${spot(move.from, move.was)} → ${spot(move.to, move.now)}`);
	}
	if (changes.moved.length > 20) lines.push(`  … and ${changes.moved.length - 20} more moves`);
	for (const edit of changes.edited.slice(0, 10)) {
		lines.push(`  edit ${short(edit.to.sel)}  ${spot(edit.to, edit.now)}  (declarations changed, the order did not)`);
	}
	if (changes.edited.length > 10) lines.push(`  … and ${changes.edited.length - 10} more edited`);
	for (const add of changes.added.slice(0, 10)) lines.push(`  add  ${short(add.rule.sel)}  ${spot(add.rule, add.at)}`);
	if (changes.added.length > 10) lines.push(`  … and ${changes.added.length - 10} more added`);
	for (const gone of changes.removed.slice(0, 10)) lines.push(`  drop ${short(gone.rule.sel)}  ${spot(gone.rule, gone.at)}`);
	if (changes.removed.length > 10) lines.push(`  … and ${changes.removed.length - 10} more dropped`);
	lines.push(
		changes.ties.length > 0
			? "A tie moved, so the page can look different. If that was the point, re-stamp and say why in the commit."
			: "No tie moved, so nothing painted differently — the order still has to be right for the next rule that is added.",
	);
	lines.push("  npm run css:order -- --update");
	console.log(lines.join("\n"));
}

/**
 * The baseline's own rules, read back as records, so a stale baseline can still be diffed.
 *
 * An older baseline stored `[file, selector, signature]` and this accepts that too: the
 * selector is the head of the signature either way.
 */
const fromBaseline = (baseline) =>
	(baseline?.order ?? []).map(([file, sel, sig]) => (sig === undefined ? { file, sel: sel.slice(0, sel.indexOf("{")), sig: sel } : { file, sel, sig }));

function main(argv) {
	const flags = new Set(argv);
	const update = flags.has("--update");
	const json = flags.has("--json");
	const current = fromWorkingTree();
	const baselinePath = webPath(BASELINE);
	const baseline = (() => {
		try {
			return JSON.parse(readFileSync(baselinePath, "utf8"));
		} catch {
			return null;
		}
	})();

	if (flags.has("--list")) {
		for (const rule of current.entries) console.log(`${where(rule)}  ${signature(rule)}`);
		return 0;
	}

	if (update) {
		const next = stamp(current.entries);
		writeBaseline(baselinePath, next);
		const was = baseline?.outsideLayer;
		console.log(
			`cascade re-stamped: ${next.rules} rules over ${next.sheets} sheets, ${next.ties} ties, ${next.hash.slice(0, 12)}…` +
				(was === undefined ? "" : `, and ${next.outsideLayer} component rules outside the layer (was ${was})`),
		);
		if (was !== undefined && next.outsideLayer > was) {
			console.log("  those rules beat every utility, which is almost never what was meant:");
			for (const rule of outsideLayer(current.entries).slice(0, 8)) console.log(`    ${rule.file}:${rule.line}  ${rule.sel}`);
		}
		return 0;
	}

	const hash = fingerprint(current.entries);
	const before = fromGit();
	if (hash === baseline?.hash) {
		if (before && fingerprint(before.entries) !== baseline.hash) {
			console.log("cascade order unchanged in the working tree, but HEAD does not match the committed baseline — re-stamp it.");
			return 1;
		}
		const loose = outsideLayer(current.entries);
		console.log(`cascade order unchanged: ${current.entries.length} rules over ${current.files.length} sheets, ${ties(current.entries).size} ties, sha256:${hash.slice(0, 12)}…`);
		if (loose.length !== baseline.outsideLayer) console.log(`  (${loose.length} component rules outside the layer, and the baseline says ${baseline.outsideLayer})`);
		return 0;
	}
	if (!baseline) {
		console.log(`no baseline at ${BASELINE}; write one with:\n  npm run css:order -- --update`);
		return 1;
	}
	console.log(`baseline says sha256:${baseline.hash.slice(0, 12)}… (${baseline.rules} rules, ${baseline.ties} ties) for ${baseline.entry}`);
	console.log(`the sheets now say sha256:${hash.slice(0, 12)}… (${current.entries.length} rules, ${ties(current.entries).size} ties)`);
	/*
	 * The baseline carries its own rules, so this diff never depends on git: when eighteen
	 * commits land under a stale baseline, `HEAD` and the working tree are the same thing and
	 * diffing against HEAD says "nothing moved" while the hash says otherwise. That happened.
	 */
	const stored = fromBaseline(baseline);
	if (stored.length > 0) report(stored, current.entries, { json });
	else if (before) report(before.entries, current.entries, { json });
	else console.log("this baseline predates the rule list, so it cannot say what moved — re-stamp it.");
	return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
