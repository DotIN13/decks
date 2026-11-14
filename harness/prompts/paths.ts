import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Where what an agent is told lives, resolved once. DECKS_RUNTIME_DIR points it
// all at another copy, to try other words without editing this checkout.

const SELF = dirname(fileURLToPath(import.meta.url));
const HERE = process.env.DECKS_RUNTIME_DIR ? resolve(process.env.DECKS_RUNTIME_DIR) : SELF;
const REPO = resolve(SELF, "../..");

/** The prompts folder: the template, guidelines, skills and the runtimes' shims. */
export const runtimeDir = (): string => HERE;
/** The repository, where node_modules sits: what DECKS_APP_DIR names for an agent's scripts. */
export const installDir = (): string => REPO;
/** The skills an agent is taught with. */
export const skillsDir = (): string => resolve(HERE, "skills");
/** The calls reference, generated from the protocol by tools/gen (npm run gen). */
export const decksCommands = (): string => process.env.DECKS_REFERENCE ?? resolve(REPO, "dist-gen/reference.md");
/** The guidelines appended to every agent's context, one per line. */
export const guidelinesFile = (): string => resolve(HERE, "guidelines.txt");
/** The base context, with {{DECK_NAME}} and the rest filled in. */
export const agentsTemplate = (): string => resolve(HERE, "AGENTS.md.tmpl");
/** The Google Docs tools' words. */
export const gdocsTools = (): string => resolve(HERE, "gdocs-tools.json");
/** opencode's config folder: its tools, plugin and skills. */
export const opencodeConfigDir = (): string => resolve(HERE, "opencode");
/** OpenCode 2's plugin folder, named to its server by absolute path. */
export const opencode2PluginDir = (): string => resolve(HERE, "opencode2", "plugin");
/** Antigravity's MCP server, spawned by its CLI. */
export const antigravityServer = (): string => resolve(HERE, "antigravity", "mcp-server.mjs");

/** Everything this folder ships, checked by the test beside it. */
export const SHIPPED: ReadonlyArray<{ path: string; what: string; dir?: boolean }> = [
	{ path: "skills", what: "what an agent is taught with", dir: true },
	{ path: "AGENTS.md.tmpl", what: "the deck context, with the card list filled in" },
	{ path: "guidelines.txt", what: "the guidelines appended to every agent's context, one per line" },
	{ path: "gdocs-tools.json", what: "the Google Docs tools' words" },
	{ path: "opencode", what: "opencode's config folder", dir: true },
	{ path: "opencode2/plugin", what: "OpenCode 2's plugin", dir: true },
	{ path: "antigravity/mcp-server.mjs", what: "antigravity's MCP server" },
];
