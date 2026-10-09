import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { StageTool } from "../../stage/tool.ts";
import { GDOCS_TOOLS, type GdocsCall } from "../../google/agent-tools.ts";

/**
 * The canvas tool, for Claude (DESIGN §6.3).
 *
 * The same tool the Pi backend registers, in the same words — the wording is the part that
 * matters and it lives in `stage/tool.ts`. Only the plumbing differs, and not by choice:
 * `tool()` inside `createSdkMcpServer` is the SDK's *only* way to add your own tool. The
 * `tools` option looks like a plainer route but is an availability filter over Claude's
 * built-ins, and MCP tools are unaffected by it.
 *
 * "MCP" oversells what this is. The server runs in-process, in this Node process — no
 * subprocess, no socket, no transport. It is a registration shape.
 */

/** The server name, which decides what the model calls the tool. */
const STAGE_SERVER = "decks";

/** What the model sees: `mcp__{server}__{tool}`, not the bare name. */
export function qualifiedToolName(stage: StageTool): string {
	return `mcp__${STAGE_SERVER}__${stage.name}`;
}

/** The Google Docs tools' names as the model sees them, pre-approved like the canvas tool. */
export const gdocsToolNames = () => GDOCS_TOOLS.map((t) => `mcp__${STAGE_SERVER}__${t.name}`);

export function stageMcpServer(stage: StageTool, gdocs?: GdocsCall): McpSdkServerConfigWithInstance {
	return createSdkMcpServer({
		name: STAGE_SERVER,
		version: "0.1.0",
		/*
		 * Tool search is on by default and defers SDK MCP tools: the model would see the
		 * name, then spend a call fetching the schema before it could use it. With one
		 * tool that is pure overhead, and this tool is not an optional extra — it is how
		 * the agent reaches the canvas at all.
		 */
		alwaysLoad: true,
		instructions:
			"Decks is the canvas this session is running inside. Boards are how you answer: put the substance " +
			"on a board and let the chat name it.",
		tools: [
			tool(
				stage.name,
				stage.description,
				{ code: z.string().describe(stage.parameterDescription) },
				async ({ code }) => {
					const outcome = await stage.run(code);
					/*
					 * `isError` rather than a throw, which is the SDK's counterpart of the
					 * Pi adapter's `throw`: either way the model reads a failure as a
					 * failure instead of as a result containing the word "Error". Returning
					 * it lets the message stay the one the eval composed.
					 */
					return {
						content: [
							{ type: "text" as const, text: outcome.text },
							// A screenshot of the shared tab rides beside the text, as an image
							// block the model looks at in the same turn (`stage.web.screenshot`).
							...(outcome.images ?? []).map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
						],
						...(outcome.isError ? { isError: true } : {}),
					};
				},
			),
			// Google Docs, read and edited as markdown (`google/docs.ts`).
			...(gdocs
				? GDOCS_TOOLS.map((t) =>
						tool(
							t.name,
							t.description,
							Object.fromEntries(Object.entries(t.parameters).map(([key, about]) => [key, z.string().describe(about)])),
							async (args) => {
								const outcome = await gdocs(t.name, args as Record<string, unknown>);
								return { content: [{ type: "text" as const, text: outcome.text }], ...(outcome.isError ? { isError: true } : {}) };
							},
						),
					)
				: []),
		],
	});
}
