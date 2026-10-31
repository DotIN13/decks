#!/usr/bin/env node
/**
 * Every Decks verb as an MCP tool, for an agent that can only call tools.
 *
 * JSON-RPC 2.0 over stdio, no dependencies: the protocol is small enough to hold in one file.
 * Each call in the table is a tool named `decks_<noun>_<verb>` (`decks_canvas_insert`), whose input
 * is an object keyed by the call's parameter names; a call is one `POST /api/v1/<name>` through
 * the SDK, as whoever `DECKS_TOKEN` is (an agent's shell has its own; `decks login` keeps the person's). `DECKS_TOOLS` narrows the list to some groups
 * (`canvas,card,view`; `board`, the card group's old name, still means it until 2026-11-30), since
 * sixty tools is more than most agents want to read. The old names are not listed, but a tool named
 * for one (`decks_pen_edit`) still answers, until 2026-11-30.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connect, DecksError } from "../src/index.js";

const VERBS = JSON.parse(readFileSync(new URL("../src/verbs.json", import.meta.url), "utf8"));
// `board` is the card group's old name, kept until 2026-11-30.
const wanted = (process.env.DECKS_TOOLS ?? "").split(",").map((one) => one.trim()).filter(Boolean).map((one) => (one === "board" ? "card" : one));
const current = VERBS.filter((verb) => !verb.alias);
const shown = wanted.length ? current.filter((verb) => wanted.includes(verb.group) || wanted.includes(verb.name)) : current;

export const toolName = (verb) => `decks_${verb.name.replace(/\./g, "_")}`;

export const TOOLS = shown.map((verb) => ({
	name: toolName(verb),
	description: `${verb.summary}\n\n${verb.signature}: ${verb.returns}`,
	inputSchema: {
		type: "object",
		properties: Object.fromEntries(verb.params.map((param) => [param.name, param.schema])),
		...(verb.params.some((param) => !param.optional) ? { required: verb.params.filter((param) => !param.optional).map((param) => param.name) } : {}),
		additionalProperties: false,
	},
}));

let decks;
async function callTool(name, input) {
	const verb = shown.find((one) => toolName(one) === name) ?? VERBS.find((one) => one.alias && toolName(one) === name);
	if (!verb) throw new Error(`There is no tool called ${name}.`);
	decks ??= connect({ notes: () => {} });
	const args = verb.params.map((param) => input?.[param.name]);
	const { value, notes, images } = await decks.call(verb.name, args);
	const text = [value === undefined ? "(done)" : typeof value === "string" ? value : JSON.stringify(value, null, 2), ...notes].join("\n");
	return [{ type: "text", text }, ...(images ?? []).map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }))];
}

function send(result, id) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

async function handle(message) {
	if (message.method === "initialize") {
		send({ protocolVersion: message.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "decks", version: "0.2.0" } }, message.id);
		return;
	}
	if (message.method === "notifications/initialized") return;
	if (message.method === "tools/list") {
		send({ tools: TOOLS }, message.id);
		return;
	}
	if (message.method === "tools/call") {
		const { name, arguments: input } = message.params ?? {};
		try {
			send({ content: await callTool(name, input), isError: false }, message.id);
		} catch (error) {
			const text = [error instanceof DecksError || error instanceof Error ? error.message : String(error), ...(error?.notes ?? [])].join("\n");
			send({ content: [{ type: "text", text }], isError: true }, message.id);
		}
		return;
	}
	// Anything else answers null rather than leaving the caller waiting: JSON-RPC wants an answer.
	if (message.id !== undefined) send(null, message.id);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	let buffer = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk) => {
		buffer += chunk;
		let newline;
		while ((newline = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (!line.trim()) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			void handle(message);
		}
	});
}
