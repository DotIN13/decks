/**
 * Build `dist/canvas.css`: the canvas's whole stylesheet for any host, with no Tailwind needed there.
 *
 * Tailwind compiles `styles/standalone.css` with the classes the canvas's sources use. Then every
 * rule is scoped to the canvas: a selector `S` becomes `:where(.decks-canvas, .decks-layer) S`
 * (`.decks-layer` is where the canvas's popovers go, at the end of the page), and `:root`, `html`
 * and `body` become the canvas itself. `:where` adds nothing to a selector's weight, so the
 * canvas's rules rank among themselves as before. Everything sits in one cascade layer, `decks`,
 * which a host orders against its own: `@layer reset, decks;` puts the host's reset under it.
 *
 * Nothing leaks out (the canvas's `.btn`, `--bg` and page reset reach only the canvas), and a host
 * that keeps its own rules in layers below `decks` does not reach in.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import postcss from "postcss";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const entry = join(pkg, "styles", "standalone.css");
const ROOT = ":where(.decks-canvas, .decks-layer)";

const compiler = await compile(readFileSync(entry, "utf8"), { base: dirname(entry), onDependency: () => {} });
const sources = [...compiler.sources, ...(compiler.root && compiler.root !== "none" ? [{ base: compiler.root.base, pattern: compiler.root.pattern, negated: false }] : [])];
const candidates = new Scanner({ sources }).scan();
const built = optimize(compiler.build(candidates), { minify: false }).code;

/** One selector, scoped to the canvas. */
function scope(sel) {
	const s = sel.trim();
	if (s.startsWith(".decks-canvas") || s.startsWith(".decks-layer") || s.startsWith(ROOT)) return s;
	// The page's root stands for the canvas: `:root`, `html`, `body`, `:host`, alone or first.
	const root = s.match(/^(?::root|html|body|:host)(?![\w-])(.*)$/s);
	if (root) {
		const rest = root[1];
		if (!rest.trim()) return ROOT;
		// `:root[data-x]` / `html.dark` stay conditions on the page, above the canvas.
		if (/^[[.:]/.test(rest)) {
			const m = rest.match(/^((?:\[[^\]]*\]|[.:][\w-]+(?:\([^)]*\))?)+)(.*)$/s);
			return `${m[1].startsWith(":") ? `:where(html${m[1]})` : `:where(html${m[1]})`} ${ROOT}${m[2].trim() ? " " + m[2].trim() : ""}`;
		}
		return `${ROOT} ${rest.trim()}`;
	}
	// A colour scheme set on the page (`[data-color-scheme="dark"] .x`): the page, then the canvas.
	const scheme = s.match(/^(\[data-color-scheme[^\]]*\])(.*)$/s);
	if (scheme) return `${scheme[1]} ${ROOT}${scheme[2].trim() ? " " + scheme[2].trim() : ""}, ${ROOT}${scheme[1]}${scheme[2].trim() ? " " + scheme[2].trim() : ""}`;
	return `${ROOT} ${s}`;
}

const root = postcss.parse(built);
const top = [];
root.walkAtRules((at) => {
	// Names and fonts are the page's: they cannot sit in a layer's selectors, so they stay at the top.
	if (/^(-webkit-)?keyframes$|^font-face$|^property$/.test(at.name)) top.push(at);
});
for (const at of top) at.remove();
root.walkRules((rule) => {
	if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
	rule.selectors = rule.selectors.map(scope);
});
const layered = postcss.atRule({ name: "layer", params: "decks" });
layered.append(root.nodes);
const out = postcss.root();
out.append(...top, layered);

mkdirSync(join(pkg, "dist"), { recursive: true });
const banner = "/* @decks/canvas: the canvas's stylesheet, scoped to .decks-canvas in @layer decks. Built by scripts/build-css.mjs; do not edit. */\n";
writeFileSync(join(pkg, "dist", "canvas.css"), banner + out.toString());
console.log(`[canvas] dist/canvas.css: ${candidates.length} classes, ${(out.toString().length / 1024).toFixed(0)} KB`);
