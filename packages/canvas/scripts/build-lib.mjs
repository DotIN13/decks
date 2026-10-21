/**
 * Build `dist/lib/`: the package as JavaScript for npm, one file per source file at the same path.
 *
 * TypeScript is stripped (`.ts` imports become `.js`) and JSX compiled to Solid's DOM calls, and
 * nothing is bundled: the render worker is still `new Worker(new URL("./render.worker.js", …))` and
 * the engine still `import("@decks/stage")`, so a host's bundler sees what it would see in the
 * sources and handles them the same way. Types come from tsc, beside each file.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const babel = require("@babel/core");
const solid = require("babel-preset-solid");

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(pkg, "src");
const out = join(pkg, "dist", "lib");
rmSync(out, { recursive: true, force: true });

const files = [];
const walk = (dir) => {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full);
		else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name)) files.push(full);
	}
};
walk(src);

for (const file of files) {
	const tsx = file.endsWith(".tsx");
	const stripped = ts.transpileModule(readFileSync(file, "utf8"), {
		fileName: file,
		compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, verbatimModuleSyntax: true, rewriteRelativeImportExtensions: true, sourceMap: false },
	}).outputText;
	// The worker's address is a string, not an import: name the compiled file.
	const named = stripped.replace(/new URL\((["'])(\.{1,2}\/[^"']+)\.tsx?\1/g, "new URL($1$2.js$1");
	const code = tsx ? babel.transformSync(named, { filename: file.replace(/\.tsx$/, ".jsx"), presets: [[solid, { generate: "dom" }]], babelrc: false, configFile: false, compact: false }).code : named;
	const dest = join(out, relative(src, file)).replace(/\.tsx?$/, ".js");
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, code);
}

// Types beside the files.
const config = join(pkg, "tsconfig.lib.json");
writeFileSync(config, JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: false, emitDeclarationOnly: true, declaration: true, outDir: "dist/lib", rootDir: "src", rewriteRelativeImportExtensions: true, skipLibCheck: true }, include: ["src"], exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"] }, null, 2));
try {
	execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", config], { stdio: "inherit", cwd: pkg });
} finally {
	rmSync(config);
}
console.log(`[canvas] dist/lib: ${files.length} modules`);
