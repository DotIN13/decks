import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { GDOCS_TOOLS, type GdocsCall } from "../../google/agent-tools.ts";

/**
 * Decks' own tools, for Claude: the Google Docs tools.
 *
 * The canvas is not one of them any more. A Claude agent reaches the canvas with the `decks`
 * command in its shell (`runtimes/decks-env.ts`), as every runtime's agent does, so what is left
 * here is the two Google Docs tools, read and edited as markdown (`google/docs.ts`).
 *
 * "MCP" oversells what this is. The server runs in-process, in this Node process — no
 * subprocess, no socket, no transport. It is a registration shape: `tool()` inside
 * `createSdkMcpServer` is the SDK's only way to add your own tool.
 */

/** The server name, which decides what the model calls the tools. */
const DECKS_SERVER = "decks";

/** The Google Docs tools' names as the model sees them, pre-approved. */
export const gdocsToolNames = () => GDOCS_TOOLS.map((t) => `mcp__${DECKS_SERVER}__${t.name}`);

/**
 * The `decks` command, pre-approved: it is how the agent answers, and a confirm in front of it
 * would be a confirm in front of every reply. A command that does anything else still asks.
 */
export const DECKS_COMMAND_RULES = ["Bash(decks:*)", "Bash(decks *)"];

export function decksMcpServer(gdocs: GdocsCall): McpSdkServerConfigWithInstance {
	return createSdkMcpServer({
		name: DECKS_SERVER,
		version: "0.2.0",
		alwaysLoad: true,
		instructions:
			"Decks is the canvas this session is running inside. Boards are how you answer: put the substance " +
			"on a board and let the chat name it. The decks command in your shell reaches the canvas.",
		tools: GDOCS_TOOLS.map((t) =>
			tool(
				t.name,
				t.description,
				Object.fromEntries(Object.entries(t.parameters).map(([key, about]) => [key, z.string().describe(about)])),
				async (args) => {
					const outcome = await gdocs(t.name, args as Record<string, unknown>);
					return { content: [{ type: "text" as const, text: outcome.text }], ...(outcome.isError ? { isError: true } : {}) };
				},
			),
		),
	});
}
