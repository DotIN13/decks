/**
 * Bundle the document page (`live-doc.ts` beside this) into live-doc.js in `canvas/cards/runtime/lib/`,
 * the one module a `[data-live="doc"]` card loads. Committed output, like the other bundles in `lib/`.
 *
 *     npm run build:live-doc
 */
import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
await build({
	entryPoints: [join(root, "canvas", "documents", "live-doc.ts")],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: ["es2022"],
	outfile: join(root, "canvas", "cards", "runtime", "lib", "live-doc.js"),
	minify: true,
	legalComments: "none",
	logLevel: "error",
});
console.log("[live-doc] canvas/cards/runtime/lib/live-doc.js");
