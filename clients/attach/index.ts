import { fileURLToPath } from "node:url";
import { connect, type Client } from "../sdk/index.ts";
import { apply, readManifest, undo } from "./files.ts";
import { plan, TOOLS, type Tool } from "./tools.ts";

// decks attach [--tool claude|codex|opencode] [--as name] [--canvas c]
// [--dir folder]: agent.attach trades the person's login for an agent of its
// own, and the tool's files are written in the folder. decks detach undoes it.

const CLI = fileURLToPath(new URL("../cli/main.ts", import.meta.url));
const MCP = fileURLToPath(new URL("../mcp/main.ts", import.meta.url));

function flags(words: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < words.length; i++) {
		const word = words[i]!;
		if (word.startsWith("--")) out[word.slice(2)] = words[++i] ?? "";
	}
	return out;
}

export async function attach(words: string[], client?: Client): Promise<string> {
	const f = flags(words);
	const tool = (f.tool ?? "claude") as Tool;
	if (!TOOLS.includes(tool)) throw new Error(`decks attach knows ${TOOLS.join(", ")}, not ${tool}.`);
	const dir = f.dir ?? process.cwd();
	const decks = client ?? (await connect());
	const { value } = await decks.call("agent.attach", { kind: tool, ...(f.as ? { name: f.as } : {}), ...(f.canvas ? { canvas: f.canvas } : {}) });
	const agent = value as { id: string; name: string; token?: string; color?: string; canvas?: string };
	if (!agent.token) throw new Error(`agent.attach gave ${agent.name} no token.`);
	if (!agent.canvas) throw new Error(`agent.attach gave ${agent.name} no home canvas, so its calls would have no here.`);
	const files = plan(tool, { url: decks.url, token: agent.token, agent: agent.name, cli: CLI, mcp: MCP });
	const manifest = apply(dir, files, { tool, agent: agent.id, url: decks.url });
	return `${agent.name} is attached here as a ${tool} agent${agent.color ? ` in ${agent.color}` : ""}, at home on ${agent.canvas}: wrote ${[...manifest.made, ...Object.keys(manifest.before)].join(", ")}. decks detach undoes it.`;
}

export async function detach(words: string[], client?: Client): Promise<string> {
	const dir = flags(words).dir ?? process.cwd();
	const manifest = readManifest(dir);
	let revoked = "";
	try {
		await (client ?? (await connect({ url: manifest.url }))).call("agent.delete", { agent: manifest.agent });
		revoked = " and its agent removed";
	} catch (error) {
		revoked = `; its agent stays, since agent.delete was refused (${(error as Error).message})`;
	}
	undo(dir, manifest);
	return `Detached: the ${manifest.tool} files are gone${revoked}.`;
}
