#!/usr/bin/env node
/**
 * Decks as an MCP server over stdio: what `claude mcp add decks -- decks-mcp` starts.
 *
 * The door itself is `core.mjs` (tools, things to read, skills, the brief); this file is what a
 * local client needs around it. It finds this user's Decks through the address file and starts it
 * when none is running (`../src/server.js`), signs in as the person the way `decks login` does on
 * the server's own machine, and joins the canvas as an agent of its own (`agent.attach`): named for
 * the client and the folder it was started in, so the same project comes back as the same agent,
 * with its cards and the mail that waited. Every call is then made as that agent.
 *
 * `DECKS_TOKEN` skips all of that: the calls are made as whoever that token is (an agent's shell has
 * one). `DECKS_TOOLS` chooses the tools listed: unset, the everyday ones and `decks_call` for the
 * rest; "all"; or groups and names ("canvas,card").
 */
import { readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../src/index.js";
import { ensureServer, personToken } from "../src/server.js";
import { createMcp, toolName, toolsFor } from "./core.mjs";

export { toolName };
const VERBS = JSON.parse(readFileSync(new URL("../src/verbs.json", import.meta.url), "utf8"));
export const TOOLS = toolsFor(VERBS, process.env.DECKS_TOOLS);

/** A client's own name for itself, as a person would write it. */
const CLIENTS = { "claude-code": "Claude Code", "claude-ai": "Claude", claude: "Claude", codex: "Codex", "codex-mcp-client": "Codex", cursor: "Cursor", "cursor-vscode": "Cursor", windsurf: "Windsurf", zed: "Zed" };
const clientLabel = (client) => client?.title || CLIENTS[String(client?.name ?? "").toLowerCase()] || client?.name || "MCP client";

/** The connection the session calls through, made on first need, and how to make it again. */
let decks;
let rejoin;
let client;
let joining;

/** Find Decks, sign in, and join as this session's agent. Answers the line the brief ends with. */
async function join() {
	if (process.env.DECKS_TOKEN) {
		decks = connect({ notes: () => {} });
		return undefined;
	}
	const { url } = await ensureServer();
	const person = await personToken(url);
	if (!person) throw new Error(`Decks is at ${url}, but this user is not signed in to it. Run decks login once in a terminal (decks login <code> with a code from decks pair code, when Decks runs on another machine).`);
	const asPerson = connect({ url, token: person, notes: () => {} });
	const label = clientLabel(client);
	const folder = process.cwd();
	let token;
	const attach = async () => {
		const { value } = await asPerson.call("agent.attach", [{ key: `${client?.name ?? "mcp"}:${folder}`, client: label, name: `${label} · ${basename(folder) || "home"}`, workspace: basename(folder) || "home" }]);
		token = value.token;
		return value;
	};
	const joined = await attach();
	decks = connect({ url, token: () => token, notes: () => {} });
	rejoin = attach;
	return `You are on this deck as "${joined.name}"${joined.canvas ? `, and your home canvas is "${joined.canvas}"` : ""}. ${joined.made ? "This is your first time here: say who you are with decks_agent_update." : "You have been here before: your name, your cards and your mail are as you left them."}`;
}
const joinOnce = () => (joining ??= join().catch((error) => {
	joining = undefined;
	throw error;
}));

async function call(name, args) {
	await joinOnce();
	try {
		return await decks.call(name, args);
	} catch (error) {
		// The server no longer takes the session's token (it was restarted on another deck, or the agent was removed): join again, once.
		if (error?.status !== 401 || !rejoin) throw error;
		await rejoin();
		return decks.call(name, args);
	}
}

const mcp = createMcp({
	verbs: VERBS,
	tools: process.env.DECKS_TOOLS,
	news: !process.env.DECKS_TOKEN,
	call,
	joined: async (info) => {
		client = info;
		try {
			return await joinOnce();
		} catch (error) {
			// The session still opens: the model is told what is wrong, and a tool call tries again.
			return `Decks could not be reached just now: ${error?.message ?? error} The tools try again when called.`;
		}
	},
});

/** Speak MCP on stdin and stdout until stdin ends: what `decks-mcp` and `decks mcp` run. */
export function serve() {
	let buffer = "";
	let answering = Promise.resolve();
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
			// One at a time, in the order they came: an answer never overtakes the one before it.
			answering = answering.then(() => mcp.handle(message)).then((answer) => answer && process.stdout.write(`${JSON.stringify(answer)}\n`), () => {});
		}
	});
	process.stdin.on("end", () => process.exit(0));
	// Held open by stdin: the caller has nothing more to do.
	return new Promise(() => {});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) void serve();
