// Write the SDK's generated parts from the verb table (packages/api):
//   packages/sdk/src/index.js   the list of verbs, between its <generated:verbs> markers
//   packages/sdk/src/index.d.ts the types: every named shape, and every verb as a method
//   packages/sdk/src/verbs.json what the decks command and the MCP server read: summaries, signatures, JSON Schemas
//   runtime/decks-commands.md   the command reference every agent is given in its context
// Run: node --import tsx scripts/gen-sdk.mjs        Check only: node --import tsx scripts/gen-sdk.mjs --check
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALIASES, ALL_VERBS, commandOf, jsonSchemaOf, namesIn, signature, tsOf, VERBS } from "../packages/api/src/index.ts";

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
	const said = verb.alias ? `${verb.summary} @deprecated Use ${verb.alias}.` : verb.summary;
	return `${doc(said, indent)}${indent}${short}(${params}): Promise<${verb.result ? tsOf(verb.result) : "void"}>;\n`;
};

export function declarations() {
	const named = new Map();
	for (const verb of ALL_VERBS) {
		for (const param of verb.params) namesIn(param.schema, named);
		if (verb.result) namesIn(verb.result, named);
	}
	let out = HEADER;
	for (const [name, schema] of named) out += `${schema.description ? doc(schema.description, "") : ""}export type ${name} = ${tsOf(schema, true)};\n`;
	out += "\n/** Every call Decks answers: the new names, and the old ones kept for one release (marked deprecated). */\nexport interface Verbs {\n";
	const groups = new Map();
	for (const verb of ALL_VERBS) {
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
	/** Set when a pairing door refused for want of a (working) pairing code. */
	needsCode?: true;
}

export interface ConnectOptions {
	/** Decks' address, as in http://127.0.0.1:4329. Default: \`DECKS_URL\`, or a page's own. */
	url?: string;
	/**
	 * Who is calling: a token from Decks, sent as \`Authorization: Bearer\`. Default: \`DECKS_TOKEN\`
	 * (set in an agent's shell and an app server's environment), else the token \`decks login\` kept for
	 * this address in \`~/.decks/token\`, else none.
	 */
	token?: string | (() => string | undefined);
	/** For the person: the canvas they are acting on (\`X-Decks-Stage\`). A parameter, not who is calling. */
	stage?: string | (() => string | undefined);
	/** For the person: the agent they are talking to (\`X-Decks-Agent\`). A parameter, not who is calling. */
	agent?: string | (() => string | undefined);
	/** Where the notes a verb adds go. Default: stderr in Node, nowhere in a page. */
	notes?: (lines: string[]) => void;
	/** A fetch to use instead of the global one. */
	fetch?: typeof fetch;
	/** More headers for every call. */
	headers?: Record<string, string>;
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
	/**
	 * Any other door the harness has, with the token: \`path\` from its root, as in \`/api/harness\`. A Blob
	 * or bytes go as they are, with their type; any other body as JSON. Answers with the JSON sent back,
	 * or the body \`as\` a Blob, text, or the Response itself. A refusal throws a DecksError.
	 */
	request<T = any>(path: string, options?: RequestOptions & { as?: "json" }): Promise<T>;
	request(path: string, options: RequestOptions & { as: "blob" }): Promise<Blob>;
	request(path: string, options: RequestOptions & { as: "text" }): Promise<string>;
	request(path: string, options: RequestOptions & { as: "response" }): Promise<Response>;
	/** Whether a Decks answers here, and what it says of itself; open to anyone. */
	hello(): Promise<Hello>;
	/** Pair a page on another site (\`POST /api/pair\`): a site token bound to the page's origin. \`needsCode\` on the error wants a code. */
	pairSite(options?: { code?: string; label?: string }): Promise<{ token: string; name: string }>;
	/** Decks Studio connecting this harness (\`POST /api/studio/connect\`): Studio's address and its key, and a site token back. */
	connectStudio(options: { studio: string; key: string; code?: string; label?: string }): Promise<{ token: string; name: string; [key: string]: unknown }>;
	/** A board's own token for its frame, on canvas \`stage\`: its calls act as that board. */
	boardToken(path: string, stage?: string): Promise<string>;
	/**
	 * Put a file into the deck's \`assets/\`, for an agent to read, or with \`canvas\` into that canvas's own
	 * \`files/\` (a friend's canvas you may edit included, which syncs it back to them): its deck path. In
	 * the canvas's drawing it is \`files/<name>\`. A canvas shared with you to view refuses.
	 */
	upload(file: Blob, options?: { name?: string; canvas?: string }): Promise<string>;
	/** Five-minute tickets for pages a frame or tab opens, by decoded request path (\`/api/board/boards/a.html\`, \`/api/f/…\`, \`/app/<name>/\`). Held by this connection too. */
	tickets(paths: string[]): Promise<{ tickets: Record<string, string>; expires: number }>;
	/** The ticket held for a page, while it has a little time left. */
	ticketFor(path: string): string | undefined;
	/** A page's address on the harness, with \`ticket\` (default: the one held) in it. */
	pageUrl(path: string, ticket?: string): string;
	/** A page's address with a fresh ticket, for a tab about to open it. */
	ticketedUrl(path: string): Promise<string>;
	/** Keep tickets for pages that stay shown: asked at once when wanted, again every four minutes and when the page comes back into view. */
	keepTickets(onChange?: (tickets: Record<string, string>) => void, options?: { every?: number }): { want(paths: string[]): void; stop(): void };
	/**
	 * Every change as Decks broadcasts it (\`GET /api/v1/events\`), as in \`{ type: "board.changed", path, board }\`.
	 * \`types\` keeps only some. With \`reconnect\` it is opened again after it ends or fails, until a
	 * refusal, which calls \`refused\`. \`done\` settles when the stream ends for good; \`close\` stops it.
	 */
	events(onEvent: (event: { type: string; [key: string]: any }) => void, options?: { types?: string[]; reconnect?: boolean; refused?: () => void }): { close(): void; done: Promise<void> };
}

export interface RequestOptions {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

/** What \`GET /api/hello\` says. */
export interface Hello {
	decks: boolean;
	name?: string;
	/** Whether the token sent still works. */
	paired?: boolean;
	/** Whether pairing from here will want a code. */
	needsCode?: boolean;
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
	const rows = ALL_VERBS.map((verb) => `\t[${JSON.stringify(verb.name)},[${verb.params.map((param) => JSON.stringify(`${param.name}${param.variadic ? "..." : param.optional ? "?" : ""}`)).join(",")}]],`);
	return `export const VERBS = [\n${rows.join("\n")}\n];`;
}

export function verbsJson() {
	return `${JSON.stringify(
		ALL_VERBS.map((verb) => ({
			name: verb.name,
			command: commandOf(verb),
			group: verb.group,
			touches: verb.touches,
			effect: verb.effect,
			...(verb.alias ? { alias: verb.alias } : {}),
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

const GROUP_TITLES = {
	canvas: "Canvas: every call takes { canvas }; left out, it is decks.here()",
	board: "Cards and the deck: files in the deck folder",
	agent: "Agent: you, or another agent",
	view: "View: what the person is looking at, moved only on purpose (no file changes)",
	apps: "Apps: folders in apps/ that Decks serves, builds or runs",
	web: "The person's shared Chrome tab",
	misc: "Ports and the clock",
};

/**
 * The reference an agent reads: each verb as its command and its TypeScript signature, by group,
 * with the shared types first. The person's Chrome is between markers, so a deck where nobody is
 * sharing a tab can leave it out (`agents/context.ts`).
 */
export function commandsMarkdown() {
	const named = new Map();
	for (const verb of VERBS) {
		for (const param of verb.params) namesIn(param.schema, named);
		if (verb.result) namesIn(verb.result, named);
	}
	const lines = ["<!-- Generated from packages/api by scripts/gen-sdk.mjs. Edit the table there, then run the script. -->", ""];
	lines.push("```ts");
	for (const [name, schema] of named) lines.push(`type ${name} = ${tsOf(schema, true)};`);
	lines.push("```", "");
	const groups = new Map();
	for (const verb of VERBS) groups.set(verb.group, [...(groups.get(verb.group) ?? []), verb]);
	for (const [group, verbs] of groups) {
		if (group === "web") lines.push("<!-- web -->");
		lines.push(`**${GROUP_TITLES[group] ?? group}**`, "");
		for (const verb of verbs) lines.push(`- \`decks ${commandOf(verb).join(" ")}\` · \`decks.${signature(verb)}: ${verb.result ? tsOf(verb.result) : "void"}\`. ${verb.summary}`);
		lines.push("");
		if (group === "web") lines.push("<!-- /web -->", "");
	}
	lines.push("**Old names**, kept for one release; each answer through one names its new call:", "");
	lines.push(ALIASES.map((verb) => `\`${verb.name}\` → ${verb.alias}`).join("; ") + ".", "");
	return `${lines.join("\n").trimEnd()}\n`;
}

function withList(js) {
	return js.replace(/(\/\/ <generated:verbs>[^\n]*\n)[\s\S]*?(\n\/\/ <\/generated:verbs>)/, (_all, open, close) => `${open}${verbList()}${close}`);
}

const files = [
	[`${sdk}index.js`, withList(readFileSync(`${sdk}index.js`, "utf8"))],
	[`${sdk}index.d.ts`, declarations()],
	[`${sdk}verbs.json`, verbsJson()],
	[`${root}runtime/decks-commands.md`, commandsMarkdown()],
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
