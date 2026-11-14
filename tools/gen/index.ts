import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PROTOCOL_VERSION } from "../../protocol/index.ts";
import { cliHelp, reference } from "./docs.ts";
import { mcpTools } from "./mcp.ts";
import { OUT } from "./paths.ts";
import { swiftFiles } from "./swift.ts";
import { sdkCallList, sdkTypes } from "./ts.ts";

// node tools/gen/index.ts [--check] [--only <generator>]. Writes dist-gen/;
// with --check writes nothing and fails when a file there is missing or old.

export const GENERATORS: Record<string, () => Record<string, string>> = {
	sdk: () => ({ "sdk/types.ts": sdkTypes(PROTOCOL_VERSION), "sdk/calls.json": sdkCallList() }),
	cli: () => ({ "cli/help.txt": cliHelp(PROTOCOL_VERSION) }),
	mcp: () => ({ "mcp/tools.json": mcpTools() }),
	reference: () => ({ "reference.md": reference(PROTOCOL_VERSION) }),
	swift: () => Object.fromEntries(Object.entries(swiftFiles(PROTOCOL_VERSION)).map(([name, text]) => [`swift/${name}`, text])),
};

/** The files out of date in dir, by generator; empty when all are current. */
export function stale(dir: string, only?: string): string[] {
	const out: string[] = [];
	for (const [name, make] of Object.entries(GENERATORS)) {
		if (only && only !== name) continue;
		for (const [file, text] of Object.entries(make())) {
			const path = `${dir}/${file}`;
			if (!existsSync(path)) out.push(`${file} is missing (${name})`);
			else if (readFileSync(path, "utf8") !== text) out.push(`${file} is out of date (${name})`);
		}
	}
	return out;
}

export function write(dir: string, only?: string): string[] {
	const written: string[] = [];
	for (const [name, make] of Object.entries(GENERATORS)) {
		if (only && only !== name) continue;
		for (const [file, text] of Object.entries(make())) {
			mkdirSync(dirname(`${dir}/${file}`), { recursive: true });
			writeFileSync(`${dir}/${file}`, text);
			written.push(file);
		}
	}
	return written;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
	if (only && !GENERATORS[only]) throw new Error(`No generator called ${only}: ${Object.keys(GENERATORS).join(", ")}.`);
	if (args.includes("--check")) {
		const old = stale(OUT, only);
		for (const line of old) console.error(line);
		console.log(old.length ? `dist-gen is out of date: run node tools/gen/index.ts.` : `dist-gen is current (protocol ${PROTOCOL_VERSION}).`);
		process.exit(old.length ? 1 : 0);
	}
	console.log(`Wrote ${write(OUT, only).length} files to dist-gen/.`);
}
