import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { libDir as boardLib } from "@decks/card-host";
import { fileURLToPath } from "node:url";

/**
 * Where the runtime's assets are, resolved once.
 *
 * `runtime/` is what the agents' runtimes read: the page primitives every deck copies (the old
 * boards' stylesheet and runtime, which their pages still load), the skills an agent is taught
 * with, the canvas API, the tool's own words, and the shims that let a runtime outside this
 * process call back.
 *
 * **It is a package so the paths are one module rather than four sums.** Before this, four
 * files worked out the directory for themselves — `agents/context.ts` counted four levels up
 * from `src/agents`, `boards/templates.ts` (now `cards/size.ts`) four from `src/boards`, `app.ts` three, and the
 * opencode shim two from `runtime/opencode/tools` — and each was right about a different
 * depth. Nothing tied any of them to the directory they meant, so moving a file was a silent
 * change to a path that happened to still resolve, or to one that did not.
 *
 * The list below is also the answer to "what does this build ship?", which used to exist only
 * as a convention spread across comments. `installed()` is what a test asserts against, so a
 * partial checkout fails loudly instead of at the first agent turn.
 */
/**
 * `DECKS_RUNTIME_DIR` points the whole module at another copy of `runtime/`. It exists so the
 * words an agent is given (the context template, the tool's description, the guidelines, the
 * skills) can be tried in variants against a throwaway data directory without editing the
 * checkout a running server reads.
 */
const SELF = dirname(fileURLToPath(import.meta.url));
const HERE = process.env.DECKS_RUNTIME_DIR ? resolve(process.env.DECKS_RUNTIME_DIR) : SELF;

/** The asset root: `runtime/` in the repository, and in whatever layout ships it. */
export function runtimeDir(): string {
	return HERE;
}

/** Where Decks itself is installed — the directory `node_modules` sits in. */
export function installDir(): string {
	return resolve(SELF, "..");
}

/** The skills an agent is taught with (`card-authoring`, `card-debug`). */
export function skillsDir(): string {
	return resolve(HERE, "skills");
}

/**
 * The page primitives a deck copies into itself (`lib/`): the stylesheet and runtime the old boards
 * load, and that a card may use.
 *
 * A *copy*, and the copy is refreshed whenever a deck is opened (`deck/lib-sync.ts`) — an old
 * board is a standalone document, so its stylesheet and runtime have to be files beside it
 * rather than a route this server serves.
 */
export function runtimeLib(): string {
	// A variant runtime (`DECKS_RUNTIME_DIR`) may carry its own primitives; otherwise they are @decks/card-host's.
	if (HERE !== SELF && existsSync(resolve(HERE, "lib"))) return resolve(HERE, "lib");
	return boardLib();
}

/** The `decks` command reference, generated from the verb table and given to every agent in its context. */
export function decksCommands(): string {
	return resolve(HERE, "decks-commands.md");
}

/** The guidelines appended to every agent's context, one per line. Optional: the built-in list stands without it. */
export function guidelinesFile(): string {
	return resolve(HERE, "guidelines.txt");
}

/** The base context file, with `{{DECK_NAME}}` and the rest substituted in. */
export function agentsTemplate(): string {
	return resolve(HERE, "AGENTS.md.tmpl");
}

/** opencode's config directory: where its canvas tool and Decks' skills are handed to it. */
export function opencodeConfigDir(): string {
	return resolve(HERE, "opencode");
}

/**
 * OpenCode 2's plugin folder: Decks' canvas and Google Docs tools, as one plugin.
 *
 * Named to the server by absolute path in its inline config, never through
 * `OPENCODE_CONFIG_DIR`: in OpenCode 2 that variable *replaces* the person's own config folder
 * rather than adding to it, as it did in opencode 1.
 */
export function opencode2PluginDir(): string {
	return resolve(HERE, "opencode2", "plugin");
}

/** Antigravity's MCP server, which the CLI spawns for its one tool. */
export function antigravityServer(): string {
	return resolve(HERE, "antigravity", "mcp-server.mjs");
}

/**
 * Everything this build ships, as a path and what it is for.
 *
 * Read by the test beside this file and by nothing else at run time, which is the point:
 * the list is documentation that can fail. Adding an asset means adding it here, and a
 * clone missing one says so rather than starting an agent that cannot read a card.
 */
export const SHIPPED: ReadonlyArray<{ path: string; what: string; dir?: boolean }> = [
	{ path: "skills", what: "what an agent is taught with", dir: true },
	{ path: "AGENTS.md.tmpl", what: "the deck context, with the card list filled in" },
	{ path: "decks-commands.md", what: "the decks command reference, generated from the verb table" },
	{ path: "guidelines.txt", what: "the guidelines appended to every agent's context, one per line" },
	{ path: "opencode", what: "opencode's config directory: its Google Docs tools, the plugin that names a session for decks, and Decks' skills", dir: true },
	{ path: "opencode2/plugin", what: "OpenCode 2's plugin: the Google Docs tools, and the session for decks", dir: true },
	{ path: "antigravity/mcp-server.mjs", what: "antigravity's MCP server for the Google Docs tools" },
];
