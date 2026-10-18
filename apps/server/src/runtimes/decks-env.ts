import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What an agent's shell needs to call Decks: the `decks` command on its PATH, where Decks is, and
 * who is calling (`packages/sdk`).
 *
 * Every runtime puts these in the environment its shell commands run in. Claude and antigravity
 * run a process per agent, so the agent's own variables go in that process's environment. Pi runs
 * every agent in this process, so its bash tool adds them per agent as it spawns
 * (`pi/extension.ts`). opencode runs one server for every agent, so the server gets the shared
 * ones and a plugin adds the session, which Decks maps to its agent (`DECKS_SESSION`).
 */

/** The folder holding the `decks` command. */
export const SDK_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../packages/sdk/bin");
/** The SDK itself, for a node script: `const { decks } = await import(process.env.DECKS_SDK)`. */
export const SDK_FILE = resolve(SDK_BIN, "../src/index.js");

/** The variables every caller on this server shares: where Decks is, and the node to run `decks` with. */
export function decksServerEnv(port: number, path = process.env.PATH ?? ""): Record<string, string> {
	return {
		DECKS_URL: `http://127.0.0.1:${port}`,
		DECKS_NODE: process.execPath,
		DECKS_SDK: SDK_FILE,
		PATH: path.split(delimiter).includes(SDK_BIN) ? path : `${SDK_BIN}${delimiter}${path}`,
	};
}

/** All of them, for one agent's own shell. */
export function decksEnv(port: number, agentId: string, path?: string): Record<string, string> {
	return { ...decksServerEnv(port, path), DECKS_AGENT: agentId };
}
