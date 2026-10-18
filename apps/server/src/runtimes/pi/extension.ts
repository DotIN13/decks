import { createBashTool, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StageAgentHooks } from "../../stage/tool.ts";
import { GDOCS_TOOLS, type GdocsCall } from "../../google/agent-tools.ts";

/**
 * `decks-stage`: what Pi needs from Decks besides the deck context.
 *
 * The canvas is reached with the `decks` command in the agent's shell, so this registers Pi's
 * bash again with the agent's variables in it, the Google Docs tools, and the revision hook below.
 *
 * Inline rather than a file on disk, for the reason Picone builds its permission layer
 * inline: Pi hands a factory only `ExtensionAPI`, so an extension found on disk could not
 * close over this agent's hooks and variables.
 */

export function decksStage(deps: {
	agent: StageAgentHooks;
	gdocs?: GdocsCall;
	/** The agent's shell: where it runs, and the variables that put `decks` in it (`runtimes/decks-env.ts`). */
	shell?: { cwd: string; env: Record<string, string> };
}): InlineExtension {
	const { agent, gdocs, shell } = deps;

	return {
		name: "decks-stage",
		factory: (pi: ExtensionAPI) => {
			/*
			 * Pi's own bash, with this agent's `decks` in it.
			 *
			 * Every Pi agent shares this process, so its environment cannot say which agent a
			 * command comes from. The bash tool is registered again with a spawn hook that adds this
			 * agent's variables as each command starts, which is Pi's way to adjust a command's env.
			 */
			if (shell) {
				const bash = createBashTool(shell.cwd, {
					spawnHook: (context) => ({ ...context, env: { ...context.env, ...shell.env, PATH: shell.env.PATH ?? context.env.PATH ?? "" } }),
				});
				pi.registerTool({ ...bash, execute: (id, params, signal, onUpdate) => bash.execute(id, params, signal, onUpdate) });
			}
			// Google Docs, read and edited as markdown (`google/docs.ts`); a failure is thrown, so Pi marks it as one.
			for (const t of gdocs ? GDOCS_TOOLS : []) {
				pi.registerTool({
					name: t.name,
					label: t.name === "gdocs_read" ? "Read Google Doc" : "Edit Google Doc",
					description: t.description,
					parameters: Type.Object(Object.fromEntries(Object.entries(t.parameters).map(([key, about]) => [key, Type.String({ description: about })]))),
					async execute(_toolCallId, params) {
						const outcome = await gdocs!(t.name, params as Record<string, unknown>);
						if (outcome.isError) throw new Error(outcome.text);
						return { content: [{ type: "text", text: outcome.text }], details: {} };
					},
				});
			}

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
			 * say *when* in the conversation the file was written. It names no author: who
			 * wrote a board is what the agent says through the stage tool (`worked`), and
			 * nothing ever read a `by` from here.
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
				if (sha) pi.appendEntry("board-rev", { path: board, sha });
			});
		},
	};
}
