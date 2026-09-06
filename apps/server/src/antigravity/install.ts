import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { runtimeDir, skillsDir } from "../agents/context.ts";
import { loadConfig } from "../config.ts";

/**
 * Where the `agy` CLI is, and the HOME Decks hands it when it runs.
 *
 * Separated from the backend for the reason `claude/available.ts` is: "can this run here"
 * is a question the shell asks before it starts anything, and answering it should not mean
 * importing a class that spawns a process.
 *
 * Antigravity is the third runtime that is somebody else's program, and the shape of its
 * integration follows from the measured facts:
 *
 * - The CLI authenticates with the Google sign-in the user already did (`agy login`),
 *   tokens under `~/.gemini/antigravity-cli/`. The Python SDK could not use that sign-in —
 *   it demands `GEMINI_API_KEY` in its Python layer *and* in the Go harness it spawns —
 *   which is the entire reason the CLI replaced it.
 * - The CLI reads a global `~/.gemini/config/mcp_config.json`, and *not* any project-local
 *   `.agents/plugins` in print mode. So Decks does not write into the user's own
 *   `~/.gemini`: it spawns the CLI with `HOME` pointed at a directory it owns, where the
 *   pieces the CLI needs are symlinks to the real ones and an `mcp_config.json` of its own
 *   names the canvas-tool server.
 * - The MCP child inherits the `agy` process's environment, so per-agent identity needs no
 *   per-agent config: `DECKS_STAGE_TOKEN` and `DECKS_AGENT` set on the process arrive in
 *   the tool server, and one shared config serves every agent.
 */

/** The `agy` binary: `DECKS_AGY_BIN`, then the usual install location, then PATH. */
export function agyExecutable(): string | undefined {
	const named = process.env.DECKS_AGY_BIN;
	if (named && existsSync(named)) return named;

	const home = process.env.HOME;
	if (home) {
		const installed = join(home, ".local", "bin", "agy");
		if (existsSync(installed)) return installed;
	}

	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, "agy");
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/** The canvas-tool MCP server `mcp_config.json` names. Node runs it; agy spawns it. */
export function mcpServerPath(): string {
	return resolve(runtimeDir(), "antigravity", "mcp-server.mjs");
}

/** The HOME Decks hands every `agy` it spawns, under the data dir like all its state. */
export function antigravityHomeDir(): string {
	return join(loadConfig().dataDir, "antigravity-home");
}

export interface PreparedHome {
	homeDir: string;
	/** The user's own `.gemini`, whose auth the sandbox reaches through symlinks. */
	realGemini: string;
	/** Whether every piece landed; a partial sandbox must refuse to run agents. */
	ok: boolean;
}

/**
 * Build the sandbox HOME once, and idempotently.
 *
 * The layout is the measured one: `.gemini/antigravity-cli` and the config pieces are
 * symlinks to the user's real ones (auth, settings, projects stay the user's), Decks'
 * own `mcp_config.json` is a real file, and Decks' skills ride along under
 * `.gemini/config/skills` — the global skills root. The MCP server, therefore, is the one
 * thing in the sandbox that is not a link, which is the point: nothing Decks writes lands
 * in the user's `~/.gemini`.
 *
 * A path that is already there is left alone — re-linking would churn the user's inode
 * count for nothing — and a missing *real* piece (no `~/.gemini` at all) is reported
 * rather than hidden, because an agent that starts with three of four links and no token
 * is an agent that fails inside a turn instead of at the desk.
 */
let prepared: PreparedHome | undefined;

export function prepareAntigravityHome(homeDir = antigravityHomeDir(), realGemini = join(homedir(), ".gemini")): PreparedHome {
	if (prepared && prepared.homeDir === homeDir) return prepared;
	if (!existsSync(realGemini) || !existsSync(join(realGemini, "antigravity-cli"))) {
		prepared = { homeDir, realGemini, ok: false };
		return prepared;
	}
	const configDir = join(homeDir, ".gemini", "config");
	mkdirSync(configDir, { recursive: true });
	link(join(configDir, "..", "antigravity-cli"), join(realGemini, "antigravity-cli"), "dir");
	// The config root itself must be Decks' — an `mcp_config.json` of its own is the whole
	// point — so the *pieces* of the user's config are linked rather than the whole dir.
	link(join(configDir, "config.json"), join(realGemini, "config", "config.json"), "file");
	link(join(configDir, "projects"), join(realGemini, "config", "projects"), "dir");
	// Decks' skills as the CLI's global skills. Best effort: a deck without the skill dir
	// still runs, it just does not carry its own documentation.
	if (existsSync(skillsDir())) link(join(configDir, "skills"), skillsDir(), "dir");
	const config = mcpConfig();
	// Only when it has changed — a write per agent start would touch the sandbox for
	// nothing and, worse, cycle the CLI's cache of it.
	if (!existsSync(join(configDir, "mcp_config.json")) || readFileSync(join(configDir, "mcp_config.json"), "utf8") !== config) {
		writeFileSync(join(configDir, "mcp_config.json"), config, "utf8");
	}
	prepared = { homeDir, realGemini, ok: true };
	return prepared;
}

/** `mcp_config.json`: the one tool, served by the machine's own Node. */
function mcpConfig(): string {
	// `process.execPath` rather than the literal "node": the server is a Node file and the
	// Node running Decks is by construction the one that can run it.
	return JSON.stringify({ mcpServers: { decks: { command: process.execPath, args: [mcpServerPath()] } } }, null, 2) + "\n";
}

/** A symlink, or a quiet "already there" — two agents starting at once race here. */
function link(at: string, target: string, type: "dir" | "file"): void {
	try {
		symlinkSync(target, at, type);
	} catch (error) {
		if ((error as { code?: string }).code !== "EEXIST") throw error;
	}
}

/** Only for tests, which need to prepare two different homes in one run. */
export function forgetPreparedHome(): void {
	prepared = undefined;
}

export function antigravityAvailability(): { available: boolean; reason: string } {
	if (!agyExecutable()) {
		return {
			available: false,
			reason: "The antigravity CLI is not installed. Put `agy` on PATH, or set DECKS_AGY_BIN to the binary.",
		};
	}
	const home = prepareAntigravityHome();
	if (!home.ok) {
		return { available: false, reason: "Nothing signed in: the antigravity CLI has no ~/.gemini/antigravity-cli to reuse. Run `agy` once in a terminal to sign in with Google." };
	}
	return { available: true, reason: "" };
}

/**
 * The models the CLI can answer on, asked of the CLI itself.
 *
 * `agy models` is the authority and it is cheap, so the picker gets the live list — cached,
 * because the answer does not change while Decks is running and every agent asking for it
 * should not pay a subprocess plus a network round trip. The fallback is the catalogue
 * measured on this machine, so a CLI too old to list models still has a picker with names
 * in it; a name the CLI does not know fails on the first turn with the CLI's own message,
 * which is the failure mode the old written-down list had too.
 */
/** Split `agy models` stdout into rows; a line that is not `slug<TAB>label` is noise (e.g. the fetching notice). */
export function parseModelsOutput(out: string): Array<{ model: string; label: string }> {
	return out
		.split("\n")
		.map((line) => /^(\S+)\t(.+)$/.exec(line.trim()))
		.filter((match): match is RegExpExecArray => Boolean(match))
		.map((match) => ({ model: match[1]!, label: match[2]! }));
}

let models: Array<{ model: string; label: string }> | undefined;

export function agyModels(homeDir = antigravityHomeDir()): Array<{ model: string; label: string }> {
	if (models) return models;
	const executable = agyExecutable();
	if (executable) {
		try {
			const out = execFileSync(executable, ["models"], {
				env: { ...process.env, HOME: homeDir },
				encoding: "utf8",
				timeout: 30_000,
				stdio: ["ignore", "pipe", "ignore"],
			});
			const parsed = parseModelsOutput(out);
			if (parsed.length > 0) {
				models = parsed;
				return parsed;
			}
		} catch {
			/* a CLI that will not list models still runs; the fallback is right here */
		}
	}
	const fallback = ANTIGRAVITY_MODELS;
	models = [...fallback];
	return [...fallback];
}

/** Only for tests, which need to ask twice about different CLIs in one run. */
export function forgetModels(): void {
	models = undefined;
}

/**
 * The catalogue as measured against the CLI that is signed in here.
 *
 * The model slug *is* the reasoning level: there is no plain `gemini-3.8-flash`, only
 * `-low`/`-medium`/`-high`, and effort is baked into the name. That is why the backend
 * never passes `--effort` — asking for a high-effort variant of a model whose name says
 * low is rejected by the CLI, loudly, before a turn.
 */
export const ANTIGRAVITY_MODELS = [
	{ model: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
	{ model: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
	{ model: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
	{ model: "gemini-3.7-flash-high", label: "Gemini 3.7 Flash (High)" },
	{ model: "gemini-3.7-flash-medium", label: "Gemini 3.7 Flash (Medium)" },
	{ model: "gemini-3.7-flash-low", label: "Gemini 3.7 Flash (Low)" },
	{ model: "gemini-3.6-flash-high", label: "Gemini 3.6 Flash (High)" },
	{ model: "gemini-3.6-flash-medium", label: "Gemini 3.6 Flash (Medium)" },
	{ model: "gemini-3.6-flash-low", label: "Gemini 3.6 Flash (Low)" },
	{ model: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
	{ model: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)" },
	{ model: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)" },
	{ model: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)" },
	{ model: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" },
] as const;