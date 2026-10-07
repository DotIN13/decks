/**
 * Bundle the document page into `runtime/lib/live-doc.js`, the one module a `[data-live="doc"]`
 * board loads (`runtime/live-doc.ts`). Committed output, like the other bundles in `lib/`.
 *
 *     npm run build:live-doc
 */
import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
	entryPoints: [join(root, "runtime", "live-doc.ts")],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: ["es2022"],
	outfile: join(root, "runtime", "lib", "live-doc.js"),
	minify: true,
	legalComments: "none",
	logLevel: "error",
});
console.log("[live-doc] runtime/lib/live-doc.js");
