import { createBashTool, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { GDOCS_TOOLS, type GdocsCall } from "../shared/gdocs.ts";

/**
 * `decks-stage`: what Pi needs from Decks besides the deck context.
 *
 * The canvas is reached with the `decks` command in the agent's shell, so this registers Pi's
 * bash again with the agent's variables in it, and the Google Docs tools.
 *
 * Inline rather than a file on disk, for the reason Picone builds its permission layer
 * inline: Pi hands a factory only `ExtensionAPI`, so an extension found on disk could not
 * close over this agent's hooks and variables.
 */

export function decksStage(deps: {
	gdocs?: GdocsCall;
	/** The agent's shell: where it runs, and the variables that put `decks` in it (the harness's agent environment). */
	shell?: { cwd: string; env: Record<string, string> };
}): InlineExtension {
	const { gdocs, shell } = deps;

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
					parameters: Type.Object(Object.fromEntries(Object.entries(t.parameters).map(([key, about]) => [key, Type.String({ description: String(about) })]))),
					async execute(_toolCallId, params) {
						const outcome = await gdocs!(t.name, params as Record<string, unknown>);
						if (outcome.isError) throw new Error(outcome.text);
						return { content: [{ type: "text", text: outcome.text }], details: {} };
					},
				});
			}

		},
	};
}
