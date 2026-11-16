// Rule 10: nothing built is in git, and styles are scoped to their part.
// Built: engine binaries (.wasm, pkg/), bundles, minified files, dist/ and the generated tables (dist-gen/).
// Styles: in harness/page a .css file sits beside a part's view.tsx. Not checked: that style order decides nothing elsewhere.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { bump } from "./lib.mjs";

const BUILT = /\.wasm$|(^|\/)(pkg|pkg-gl|dist|dist-gen|dist-packages|target)\/|\.(bundle|min)\.(js|css)$/;

export default {
	name: "built",
	rule: "10. Nothing built is in git; styles are scoped to their part.",
	scan({ root, files, exists }) {
		const counts = new Map();
		for (const f of tracked(root, files).filter((f) => BUILT.test(f))) bump(counts, `${f}: built file in git`);
		for (const f of files.filter((f) => f.startsWith("harness/page/") && f.endsWith(".css"))) {
			if (!exists(`${dirname(f)}/view.tsx`)) bump(counts, `${f}: style outside a part`);
		}
		return { counts, notes: ["Not checked: style order outside harness/page; today's scripts/css-order.mjs still orders the old sheets."] };
	},
};

function tracked(root, files) {
	if (!existsSync(join(root, ".git"))) return files;
	return execFileSync("git", ["-c", "core.quotePath=false", "ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean);
}
