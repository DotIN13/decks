/**
 * The messages, compiled: one typed function per message in `src/paraglide/`, and the checks that keep
 * every language whole.
 *
 *     node compile.mjs           # write src/paraglide from messages/
 *     node compile.mjs --check   # exit 1 when a language misses a message, a placeholder differs, or
 *                                # src/paraglide is not what messages/ compiles to
 *
 * The messages sit in one folder per area of the app, one file per language in each:
 * `messages/<area>/<locale>.json`. A message's key starts with its area (`settings_title` in
 * `messages/settings/`), so two areas never name the same message and a key says where it lives.
 * The areas are the folders: adding one needs no list changed here, since `project.inlang/settings.json`
 * is written from them on every compile.
 *
 * The compiled code is committed, so the packages that call it (the canvas, the chat, the web app,
 * Decks Studio through its copy of this repo) type-check and build with no step of their own.
 */
import { compile } from "@inlang/paraglide-js";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MESSAGES = join(here, "messages");
const OUT = join(here, "src", "paraglide");
const BASE = "en";
const LOCALES = ["en", "zh-CN"];

const areas = () =>
	readdirSync(MESSAGES)
		.filter((name) => statSync(join(MESSAGES, name)).isDirectory())
		.sort();

/** `project.inlang/settings.json`, from the areas there are. */
function writeProject() {
	const settings = {
		$schema: "https://inlang.com/schema/project-settings",
		baseLocale: BASE,
		locales: LOCALES,
		// From node_modules, not inlang's CDN: the compile works offline and pins the plugin with the lock file.
		modules: ["../../node_modules/@inlang/plugin-message-format/dist/index.js"],
		"plugin.inlang.messageFormat": { pathPattern: areas().map((area) => `./messages/${area}/{locale}.json`) },
	};
	writeFileSync(join(here, "project.inlang", "settings.json"), `${JSON.stringify(settings, null, "\t")}\n`);
}

async function compileTo(outdir) {
	writeProject();
	await compile({
		project: join(here, "project.inlang"),
		outdir,
		// The person's choice in Settings, then a value the page sets (a sandboxed frame, told by its host), then the browser's languages.
		strategy: ["localStorage", "globalVariable", "custom-browser", "baseLocale"],
		localStorageKey: "decks.locale",
		outputStructure: "locale-modules",
		emitTsDeclarations: true,
		emitGitIgnore: false,
		emitPrettierIgnore: false,
		emitReadme: false,
		isDevelopment: "false",
	});
}

/** The placeholders a message uses, whatever form it takes (a sentence, or variants for a plural). */
function placeholders(value) {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	const names = new Set();
	for (const match of text.matchAll(/(?<!\\)\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) names.add(match[1]);
	if (Array.isArray(value)) for (const declaration of value[0]?.declarations ?? []) {
		const input = /^input (\w+)$/.exec(declaration);
		if (input) names.add(input[1]);
	}
	// A variant's local name is not a placeholder the caller passes.
	if (Array.isArray(value)) for (const declaration of value[0]?.declarations ?? []) {
		const local = /^local (\w+) =/.exec(declaration);
		if (local) names.delete(local[1]);
	}
	return [...names].sort().join(",");
}

function problems() {
	const found = [];
	const seen = new Map();
	for (const area of areas()) {
		const files = Object.fromEntries(
			LOCALES.map((locale) => {
				const path = join(MESSAGES, area, `${locale}.json`);
				if (!existsSync(path)) return [locale, null];
				try {
					const { $schema: _, ...messages } = JSON.parse(readFileSync(path, "utf8"));
					return [locale, messages];
				} catch (error) {
					found.push(`${relative(here, path)} is not JSON: ${error.message}`);
					return [locale, {}];
				}
			}),
		);
		for (const locale of LOCALES) if (!files[locale]) found.push(`messages/${area}/${locale}.json is missing`);
		const base = files[BASE] ?? {};
		for (const key of Object.keys(base)) {
			if (!key.startsWith(`${area}_`)) found.push(`${key} in messages/${area}/ should start with "${area}_"`);
			if (seen.has(key)) found.push(`${key} is in messages/${seen.get(key)}/ and messages/${area}/`);
			seen.set(key, area);
		}
		for (const locale of LOCALES) {
			if (locale === BASE || !files[locale]) continue;
			const other = files[locale];
			for (const key of Object.keys(base)) {
				if (!(key in other)) found.push(`${key} has no ${locale} (messages/${area}/${locale}.json)`);
				else if (placeholders(base[key]) !== placeholders(other[key])) found.push(`${key} uses {${placeholders(base[key])}} in ${BASE} but {${placeholders(other[key])}} in ${locale}`);
				else if (typeof other[key] === "string" && other[key].trim() === "") found.push(`${key} is empty in ${locale}`);
			}
			for (const key of Object.keys(other)) if (!(key in base)) found.push(`${key} is in ${locale} but not in ${BASE} (messages/${area}/)`);
		}
	}
	return found;
}

function filesIn(dir, prefix = "") {
	const out = new Map();
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) for (const [key, text] of filesIn(path, `${prefix}${name}/`)) out.set(key, text);
		else out.set(`${prefix}${name}`, readFileSync(path, "utf8"));
	}
	return out;
}

if (process.argv.includes("--check")) {
	const found = problems();
	const scratch = mkdtempSync(join(tmpdir(), "decks-i18n-"));
	try {
		await compileTo(scratch);
		const fresh = filesIn(scratch);
		const committed = existsSync(OUT) ? filesIn(OUT) : new Map();
		const stale = [...new Set([...fresh.keys(), ...committed.keys()])].filter((file) => fresh.get(file) !== committed.get(file));
		if (stale.length) found.push(`packages/i18n/src/paraglide is out of date (${stale.slice(0, 3).join(", ")}${stale.length > 3 ? ", …" : ""}): run npm run compile -w @decks/i18n`);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
	if (found.length) {
		console.error(`i18n: ${found.length} problem${found.length === 1 ? "" : "s"}\n  ${found.join("\n  ")}`);
		process.exit(1);
	}
	console.log(`i18n: ${LOCALES.join(" and ")} complete across ${areas().length} areas`);
} else {
	const found = problems();
	await compileTo(OUT);
	if (found.length) console.warn(`i18n: compiled, with ${found.length} problem${found.length === 1 ? "" : "s"} for --check:\n  ${found.slice(0, 20).join("\n  ")}`);
	else console.log("i18n: compiled");
}
