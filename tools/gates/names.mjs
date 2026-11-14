// Rule 2: one name per thing. A retired word lives only in compat/ and upgrade/.
// The retired words come from protocol/glossary.ts (`retired`, each { word, now }); until it exists, FALLBACK.
// Words inside identifiers count too (boardCamera). A word ending in a dot is a call prefix: apps. matches apps.run.
import { bump, isSource } from "./lib.mjs";

const FALLBACK = ["board", "stage"];
/** Where one word may stay: the Rust engine's crates keep "stage" (DESIGN.md section 5, Words). */
const KEEPS = { stage: /^(engine|packages\/stage)\// };
const TEXT = /\.(ts|tsx|mts|mjs|js|cjs|css|html|md|json|rs|swift)$/;
const EXEMPT = /(^|\/)(compat|upgrade)\/|^protocol\/glossary\.ts$|^AGENTS\.md$|^tools\/gates\/|^docs\/rewrite\//;

export function retiredWords({ exists, read }) {
	if (!exists("protocol/glossary.ts")) return { words: FALLBACK, from: "the fallback list (protocol/glossary.ts does not exist yet)" };
	const text = read("protocol/glossary.ts");
	const block = text.slice(text.indexOf("retired"));
	const words = [...block.matchAll(/word:\s*["'`]([A-Za-z]+\.?)["'`]/g)].map((m) => m[1].toLowerCase());
	return words.length ? { words, from: "protocol/glossary.ts" } : { words: FALLBACK, from: "the fallback list (no `retired` words found)" };
}

/** Lower-case words of a text, with identifiers split at case changes, digits and underscores. */
export function tokens(text) {
	return text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/);
}

export default {
	name: "names",
	rule: "2. One name per thing; a retired word lives only in compat/ and upgrade/.",
	scan(ctx) {
		const { words, from } = retiredWords(ctx);
		const plain = words.filter((w) => !w.endsWith("."));
		const forms = new Map(plain.flatMap((w) => (w.endsWith("s") ? [[w, w]] : [[w, w], [`${w}s`, w]])));
		const dotted = words.filter((w) => w.endsWith(".")).map((w) => ({ w, re: new RegExp(`(?<![\\w.])${w.replace(".", "\\.")}[a-z]`, "g") }));
		const counts = new Map();
		for (const f of ctx.files.filter((f) => isSource(f) && TEXT.test(f) && !EXEMPT.test(f))) {
			const text = ctx.read(f);
			for (const t of tokens(text)) if (forms.has(t) && !KEEPS[forms.get(t)]?.test(f)) bump(counts, `${f}: ${forms.get(t)}`);
			for (const { w, re } of dotted) { const n = (text.match(re) || []).length; if (n) bump(counts, `${f}: ${w}`, n); }
		}
		return { counts, notes: [`Retired words from ${from}: ${words.join(", ")}.`] };
	},
};
