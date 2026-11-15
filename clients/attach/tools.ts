import { existsSync, readFileSync } from "node:fs";
import type { Planned } from "./files.ts";

// What each tool needs to work as a Decks agent: the decks command and its
// token in the tool's environment, the Decks skill, and a hook that runs
// decks agent news before each prompt where the tool has one.

export type Tool = "claude" | "codex" | "opencode";
export const TOOLS: readonly Tool[] = ["claude", "codex", "opencode"];
export type Setup = { url: string; token: string; agent: string; cli: string; mcp: string };

const REFERENCE = new URL("../../dist-gen/reference.md", import.meta.url);

export function plan(tool: Tool, s: Setup): Planned[] {
	if (tool === "claude") {
		const command = ".claude/decks";
		const hook = { hooks: [{ type: "command", command: news(command) }] };
		return [
			{ path: command, text: shim(s), mode: 0o700 },
			{ path: ".claude/skills/decks/SKILL.md", text: skill(s, command) },
			{
				path: ".claude/settings.local.json",
				merge: (old) => {
					const hooks = (old.hooks ?? {}) as Record<string, unknown[]>;
					return { ...old, env: { ...((old.env ?? {}) as object), DECKS_URL: s.url, DECKS_TOKEN: s.token }, hooks: { ...hooks, UserPromptSubmit: [...(hooks.UserPromptSubmit ?? []), hook] } };
				},
			},
		];
	}
	if (tool === "codex") {
		const command = ".codex/decks";
		const env = `[shell_environment_policy]\nset = { DECKS_URL = "${s.url}", DECKS_TOKEN = "${s.token}" }\n`;
		return [
			{ path: command, text: shim(s), mode: 0o700 },
			{ path: ".codex/skills/decks/SKILL.md", text: skill(s, command) },
			{ path: ".codex/config.toml", text: `# Written by decks attach for ${s.agent}; decks detach removes it.\n${env}` },
		];
	}
	const command = ".opencode/decks";
	const mcp = { type: "local", command: [process.execPath, s.mcp], environment: { DECKS_URL: s.url, DECKS_TOKEN: s.token } };
	return [
		{ path: command, text: shim(s), mode: 0o700 },
		{ path: ".opencode/skills/decks/SKILL.md", text: skill(s, command) },
		{ path: "opencode.json", merge: (old) => ({ ...old, mcp: { ...((old.mcp ?? {}) as object), decks: mcp } }) },
	];
}

/** A small script that runs the decks command as this agent. */
function shim(s: Setup): string {
	return `#!/bin/sh\n# decks, as ${s.agent}. Written by decks attach; decks detach removes it.\nDECKS_URL='${s.url}' DECKS_TOKEN='${s.token}' exec '${process.execPath}' '${s.cli}' "$@"\n`;
}

/** The Decks skill: how to call, then every call, from the generated reference. */
function skill(s: Setup, command: string): string {
	const reference = existsSync(REFERENCE) ? readFileSync(REFERENCE, "utf8").replace(/^# .*\n/, "") : "Run decks help for every call.\n";
	return [
		"---",
		"name: decks",
		"description: Work on a Decks canvas: read and change items, make cards, hand work to other agents. Use for anything on the canvas.",
		"---",
		"",
		`# Decks, as ${s.agent}`,
		"",
		`Run \`${command} <noun> <verb>\` in the shell: \`${command} help\` lists every call, \`${command} help item.move\` explains one.`,
		"A plain argument is a word; an object's keys are flags, `--at.x 5`. The value comes on stdout, notes on stderr.",
		"",
		reference,
	].join("\n");
}

const news = (command: string) => `${command} agent news`;
