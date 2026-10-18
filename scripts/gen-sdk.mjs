// Write the SDK's generated parts from the verb table (packages/api):
//   packages/sdk/src/index.js   the list of verbs, between its <generated:verbs> markers
//   packages/sdk/src/index.d.ts the types: every named shape, and every verb as a method
//   packages/sdk/src/verbs.json what the decks command and the MCP server read: summaries, signatures, JSON Schemas
// Run: node --import tsx scripts/gen-sdk.mjs        Check only: node --import tsx scripts/gen-sdk.mjs --check
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandOf, jsonSchemaOf, namesIn, signature, tsOf, VERBS } from "../packages/api/src/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const sdk = `${root}packages/sdk/src/`;
const HEADER = "// Generated from packages/api by scripts/gen-sdk.mjs. Edit the table there, then run the script.\n";

/** A doc comment, wrapped at about 100 columns. */
function doc(text, indent) {
	const words = text.split(/\s+/);
	const lines = [];
	let line = "";
	for (const word of words) {
		if (line && line.length + word.length > 96) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(line);
	return lines.length === 1 ? `${indent}/** ${lines[0]} */\n` : `${indent}/**\n${lines.map((one) => `${indent} * ${one}`).join("\n")}\n${indent} */\n`;
}

const method = (verb, indent) => {
	const short = verb.name.split(".").pop();
	const params = verb.params.map((param) => `${param.name}${param.optional ? "?" : ""}: ${tsOf(param.schema)}`).join(", ");
	return `${doc(verb.summary, indent)}${indent}${short}(${params}): Promise<${verb.result ? tsOf(verb.result) : "void"}>;\n`;
};

export function declarations() {
	const named = new Map();
	for (const verb of VERBS) {
		for (const param of verb.params) namesIn(param.schema, named);
		if (verb.result) namesIn(verb.result, named);
	}
	let out = HEADER;
	for (const [name, schema] of named) out += `${schema.description ? doc(schema.description, "") : ""}export type ${name} = ${tsOf(schema, true)};\n`;
	out += "\n/** Every verb Decks answers. */\nexport interface Verbs {\n";
	const groups = new Map();
	for (const verb of VERBS) {
		if (verb.name.includes(".")) {
			const group = verb.name.split(".")[0];
			groups.set(group, [...(groups.get(group) ?? []), verb]);
		} else out += method(verb, "\t");
	}
	for (const [group, verbs] of groups) out += `\t${group}: {\n${verbs.map((verb) => method(verb, "\t\t")).join("")}\t};\n`;
	out += `}

/** Something Decks said went wrong: a refused call, a verb that threw, or no Decks at all. */
export declare class DecksError extends Error {
	/** The HTTP status Decks answered with, when it answered. */
	status?: number;
	/** The notes the verb added before it failed. */
	notes: string[];
}

export interface ConnectOptions {
	/** Decks' address, as in http://127.0.0.1:4329. Default: \`DECKS_URL\`, or a page's own. */
	url?: string;
	/** The agent the calls are for, by id or name. Default: \`DECKS_AGENT\`. */
	agent?: string;
	/** The app the calls are from. Default: \`DECKS_APP\`, or the page's app. */
	app?: string;
	/** Where the notes a verb adds go. Default: stderr in Node, nowhere in a page. */
	notes?: (lines: string[]) => void;
	/** A fetch to use instead of the global one. */
	fetch?: typeof fetch;
}

export type AgentSpec = Exclude<Parameters<Verbs["send"]>[0], string>;
export type Work = Parameters<Verbs["send"]>[1];

export interface Decks extends Verbs {
	/** Where this connection reaches Decks. (\`url\` is the verb that gives a board's address.) */
	readonly address: string;
	/** Call a verb by its name in the table, and get its value, notes and pictures. */
	call(verb: string, args?: unknown[]): Promise<{ value: unknown; notes: string[]; images?: Array<{ data: string; mimeType: string }> }>;
	/** The same verbs, for code written when they lived under \`stage\`. */
	readonly stage: Verbs;
	/** Hand work to the agent with this name, making it from the spec first when there is none. */
	sendTo(agent: AgentSpec, work: Work | string): Promise<{ queued: true; position: number; name: string; made: boolean; agent?: string }>;
}

/** A connection to Decks; with nothing passed, the one the environment or the page names. */
export declare function connect(options?: ConnectOptions): Decks;

/** A connection from the environment, made on first use. */
export declare const decks: Decks;

/** Every verb's name and its parameters, \`?\` for optional and \`...\` for a list of paths. */
export declare const VERBS: ReadonlyArray<readonly [string, readonly string[]]>;
`;
	return out;
}

export function verbList() {
	const rows = VERBS.map((verb) => `\t[${JSON.stringify(verb.name)},[${verb.params.map((param) => JSON.stringify(`${param.name}${param.variadic ? "..." : param.optional ? "?" : ""}`)).join(",")}]],`);
	return `export const VERBS = [\n${rows.join("\n")}\n];`;
}

export function verbsJson() {
	return `${JSON.stringify(
		VERBS.map((verb) => ({
			name: verb.name,
			command: commandOf(verb),
			group: verb.group,
			effect: verb.effect,
			summary: verb.summary,
			signature: signature(verb),
			returns: verb.result ? tsOf(verb.result) : "void",
			params: verb.params.map((param) => ({
				name: param.name,
				...(param.optional ? { optional: true } : {}),
				...(param.variadic ? { variadic: true } : {}),
				type: tsOf(param.schema),
				schema: jsonSchemaOf(param.schema),
			})),
		})),
		null,
		1,
	)}\n`;
}

function withList(js) {
	return js.replace(/(\/\/ <generated:verbs>[^\n]*\n)[\s\S]*?(\n\/\/ <\/generated:verbs>)/, (_all, open, close) => `${open}${verbList()}${close}`);
}

const files = [
	[`${sdk}index.js`, withList(readFileSync(`${sdk}index.js`, "utf8"))],
	[`${sdk}index.d.ts`, declarations()],
	[`${sdk}verbs.json`, verbsJson()],
];

if (process.argv.includes("--check")) {
	const stale = files.filter(([file, wanted]) => {
		try {
			return readFileSync(file, "utf8") !== wanted;
		} catch {
			return true;
		}
	});
	if (stale.length) {
		console.error(`Out of date: ${stale.map(([file]) => file.slice(root.length)).join(", ")}. Run node --import tsx scripts/gen-sdk.mjs`);
		process.exit(1);
	}
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
	for (const [file, text] of files) writeFileSync(file, text);
	console.log(`wrote ${files.map(([file]) => file.slice(root.length)).join(", ")}`);
}
