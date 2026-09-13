import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the runtime's assets are, resolved once.
 *
 * `runtime/` is what the agents' runtimes read: the board primitives every deck copies, the
 * skills an agent is taught with, the shells a new board starts from, the canvas API, the
 * tool's own words, and the two shims that let a runtime outside this process call back.
 *
 * **It is a package so the paths are one module rather than four sums.** Before this, four
 * files worked out the directory for themselves — `agents/context.ts` counted four levels up
 * from `src/agents`, `boards/templates.ts` four from `src/boards`, `app.ts` three, and the
 * opencode shim two from `runtime/opencode/tools` — and each was right about a different
 * depth. Nothing tied any of them to the directory they meant, so moving a file was a silent
 * change to a path that happened to still resolve, or to one that did not.
 *
 * The list below is also the answer to "what does this build ship?", which used to exist only
 * as a convention spread across comments. `installed()` is what a test asserts against, so a
 * partial checkout fails loudly instead of at the first agent turn.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The asset root: `runtime/` in the repository, and in whatever layout ships it. */
export function runtimeDir(): string {
	return HERE;
}

/** Where Decks itself is installed — the directory `node_modules` sits in. */
export function installDir(): string {
	return resolve(HERE, "..");
}

/** The skills an agent is taught with (`board-authoring`, `board-debug`). */
export function skillsDir(): string {
	return resolve(HERE, "skills");
}

/** The shells a new board starts from, one file per kind. */
export function templatesDir(): string {
	return resolve(HERE, "templates");
}

/**
 * The board primitives a deck copies into itself.
 *
 * A *copy*, and the copy is refreshed whenever a deck is opened (`deck/lib-sync.ts`) — a
 * board is a standalone document, so its stylesheet and runtime have to be files beside it
 * rather than a route this server serves.
 */
export function runtimeLib(): string {
	return resolve(HERE, "lib");
}

/** The stage API, injected into an agent's context verbatim (DESIGN §6.3). */
export function stageDts(): string {
	return resolve(HERE, "stage.d.ts");
}

/** The canvas tool's description, shown to a model on every runtime (DESIGN §6.3). */
export function toolDescription(): string {
	return resolve(HERE, "tool-description.txt");
}

/** The base context file, with `{{DECK_NAME}}` and the rest substituted in. */
export function agentsTemplate(): string {
	return resolve(HERE, "AGENTS.md.tmpl");
}

/** opencode's config directory: where its canvas tool and Decks' skills are handed to it. */
export function opencodeConfigDir(): string {
	return resolve(HERE, "opencode");
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
 * clone missing one says so rather than starting an agent that cannot read a board.
 */
export const SHIPPED: ReadonlyArray<{ path: string; what: string; dir?: boolean }> = [
	{ path: "lib", what: "the board primitives, copied into every deck", dir: true },
	{ path: "skills", what: "what an agent is taught with", dir: true },
	{ path: "templates", what: "the shells a new board starts from", dir: true },
	{ path: "AGENTS.md.tmpl", what: "the deck context, with the board list filled in" },
	{ path: "stage.d.ts", what: "the canvas API, injected verbatim" },
	{ path: "tool-description.txt", what: "the canvas tool's words, for every runtime" },
	{ path: "opencode", what: "opencode's config directory: its tool and Decks' skills", dir: true },
	{ path: "antigravity/mcp-server.mjs", what: "antigravity's one-tool MCP server" },
];
