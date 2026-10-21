/**
 * Build the public @decks packages for npm, into `dist-packages/<name>/`, without touching how this
 * repository runs them (from TypeScript source, through tsx and Vite).
 *
 * Each TypeScript package is compiled by tsc to JavaScript with its types beside it; its
 * package.json is rewritten so every export points at the JavaScript, `private` and the dev parts
 * go, and its `@decks/*` dependencies name this version. Folders a package serves as they are
 * (board-host's `lib/`, stage's wasm builds, canvas's stylesheet) are copied. `npm pack` or
 * `npm publish` runs in each folder.
 *
 *   node scripts/build-packages.mjs            build every public package
 *   node scripts/build-packages.mjs hub pen    build some
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-packages");

/** What is published, in the order they depend on each other. `copy` is shipped as it is. */
const PUBLIC = [
	{ dir: "pen" },
	{ dir: "board-kit" },
	{ dir: "docs" },
	{ dir: "protocol" },
	{ dir: "sync-protocol" },
	{ dir: "hub" },
	{ dir: "sync-client" },
	{ dir: "board-host", copy: ["lib"] },
	// The canvas: its own build (JSX for Solid, one file per module, and the scoped stylesheet).
	{ dir: "canvas", js: false, build: ["scripts/build-css.mjs", "scripts/build-lib.mjs"], copy: ["dist"], exports: (key, target) => (key === "./internal/*" || key.startsWith("./styles") ? undefined : key === "./canvas.css" ? target : { types: target.replace(/^\.\/src\//, "./dist/lib/").replace(/\.tsx?$/, ".d.ts"), default: target.replace(/^\.\/src\//, "./dist/lib/").replace(/\.tsx?$/, ".js") }) },
	{ dir: "stage", js: false, copy: ["pkg", "pkg-gl", "README.md"] },
	{ dir: "sdk", js: false, copy: ["src", "bin", "mcp", "README.md"] },
];

const want = process.argv.slice(2);
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");

for (const p of PUBLIC.filter((p) => !want.length || want.includes(p.dir))) {
	const src = join(root, "packages", p.dir);
	const meta = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
	const dest = join(out, p.dir);
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });

	for (const script of p.build ?? []) execFileSync(process.execPath, [join(src, script)], { stdio: "inherit", cwd: src });
	if (p.js !== false) {
		const config = join(dest, "tsconfig.build.json");
		writeFileSync(config, JSON.stringify({
			extends: relative(dest, join(root, "tsconfig.base.json")),
			compilerOptions: {
				rootDir: relative(dest, join(src, "src")),
				outDir: "dist",
				declaration: true,
				sourceMap: true,
				noEmit: false,
				allowImportingTsExtensions: true,
				rewriteRelativeImportExtensions: true,
				lib: ["ES2023", "DOM", "DOM.Iterable"],
				types: ["node"],
				typeRoots: [join(root, "node_modules", "@types")],
				noUncheckedIndexedAccess: false,
			},
			include: [relative(dest, join(src, "src"))],
			exclude: [relative(dest, join(src, "src", "**", "*.test.ts"))],
		}, null, 2));
		execFileSync(process.execPath, [tsc, "-p", config], { stdio: "inherit", cwd: dest });
		rmSync(config);
	}
	for (const part of p.copy ?? []) if (existsSync(join(src, part))) cpSync(join(src, part), join(dest, part), { recursive: true });

	const js = (path) => path.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, ".js");
	const dts = (path) => path.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, ".d.ts");
	const exports = {};
	for (const [key, target] of Object.entries(meta.exports ?? {})) {
		if (p.exports) {
			const mapped = p.exports(key, target);
			if (mapped !== undefined) exports[key] = mapped;
		} else if (typeof target !== "string" || p.js === false || !/\.tsx?$/.test(target)) exports[key] = target;
		else exports[key] = { types: dts(target), default: js(target) };
	}
	const deps = (list) => list && Object.fromEntries(Object.entries(list).map(([k, v]) => [k, k.startsWith("@decks/") && v === "*" ? `^${version}` : v]));
	const pkg = {
		name: meta.name,
		version,
		description: meta.description,
		license: meta.license ?? "MIT",
		type: "module",
		repository: { type: "git", url: "git+https://github.com/DotIN13/decks.git", directory: `packages/${p.dir}` },
		exports,
		...(meta.bin ? { bin: meta.bin } : {}),
		...(meta.dependencies ? { dependencies: deps(meta.dependencies) } : {}),
		...(meta.peerDependencies ? { peerDependencies: meta.peerDependencies } : {}),
		...(p.dir === "canvas" ? { sideEffects: ["*.css"] } : {}),
		engines: { node: ">=22" },
	};
	writeFileSync(join(dest, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
	console.log(`[packages] ${meta.name}@${version}`);
}
