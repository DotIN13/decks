import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StageAgentHooks, StageTool } from "../stage/tool.ts";

/**
 * `decks-stage`: Pi's adapter for the canvas tool.
 *
 * Inline rather than a file on disk, for the reason Picone builds its permission layer
 * inline: Pi hands a factory only `ExtensionAPI`, so an extension found on disk could only
 * reach the canvas by reading a config file and guessing. Built here, it closes over the
 * tool the shell already made.
 *
 * The tool itself — its description, its guidelines, the `stage` object — is in
 * `stage/tool.ts`, shared with the Claude backend. What is left here is the two things
 * only Pi can do: register a tool with a TypeBox schema, and write a `board-rev` entry
 * into the session tree.
 */

export function decksStage(deps: { tool: StageTool; agent: StageAgentHooks }): InlineExtension {
	const { tool, agent } = deps;

	return {
		name: "decks-stage",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: tool.name,
				label: tool.label,
				description: tool.description,
				promptSnippet: tool.promptSnippet,
				promptGuidelines: tool.guidelines,
				parameters: Type.Object({
					code: Type.String({ description: tool.parameterDescription }),
				}),
				async execute(_toolCallId, params) {
					const outcome = await tool.run(params.code);
					// A failed eval is a failed tool call: thrown, so Pi marks it as an error
					// and the model sees it as one rather than as a result that happens to
					// contain the word "Error".
					if (outcome.isError) throw new Error(outcome.text);
					// `details` is where Pi keeps a tool's structured result. The canvas
					// state is no longer *restored* from it — that is `SnapshotStore`, which
					// both runtimes use — but it costs nothing and is what Pi renders from.
					return { content: [{ type: "text", text: outcome.text }], details: tool.snapshot() };
				},
			});

			/**
			 * Write down which version of a board this turn produced (§6.7).
			 *
			 * A custom entry, so it costs no LLM context and travels in the session tree —
			 * which is what lets the time machine name the exact revision a board was at,
			 * rather than the newest one written before that moment. Claude has no
			 * equivalent and falls back to timestamps (`App.boardsAt`), which is the same
			 * answer except where two writes share a second.
			 *
			 * Keyed off the tool result rather than the watcher because the watcher cannot
			 * say *who* wrote the file or *when* in the conversation.
			 */
			pi.on("tool_result", async (event) => {
				// The event carries the tool's name, its input and whether it failed —
				// flat, not wrapped in a message. Reading it as a message was why no
				// revision was ever recorded into a session.
				const result = event as { toolName?: string; isError?: boolean; input?: Record<string, unknown> };
				if (!result.toolName || result.isError) return;
				if (!["write", "edit", "multi_edit"].includes(result.toolName)) return;

				const args = result.input ?? {};
				const candidate = typeof args.path === "string" ? args.path : typeof args.file === "string" ? args.file : undefined;
				if (!candidate) return;
				const board = agent.boardPathOf(candidate);
				if (!board) return;

				const sha = agent.recordRevision(board);
				if (sha) pi.appendEntry("board-rev", { path: board, sha, by: agent.id });
			});
		},
	};
}
