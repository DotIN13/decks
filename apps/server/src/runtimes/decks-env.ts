import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What an agent's shell needs to call Decks: the `decks` command on its PATH, where Decks is, and the
 * agent's own token (`DECKS_TOKEN`), which is who is calling (`auth/tokens.ts`, `packages/sdk`).
 * `DECKS_AGENT` is the agent's id, for a script that wants to say whose it is; it proves nothing.
 *
 * Every runtime puts these in the environment its shell commands run in. Claude and antigravity
 * run a process per agent, so the agent's own variables go in that process's environment. Pi runs
 * every agent in this process, so its bash tool adds them per agent as it spawns
 * (`pi/extension.ts`). opencode runs one server for every agent, so the server gets the shared
 * ones, and its plugin trades the session a command runs for for that session's agent token before
 * the command runs (`runtime/opencode/plugin`, `POST /api/tokens/session`).
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

/** All of them, for one agent's own shell: its token among them, when it has one. */
export function decksEnv(port: number, agentId: string, token: string | undefined, path?: string): Record<string, string> {
	return { ...decksServerEnv(port, path), DECKS_AGENT: agentId, ...(token ? { DECKS_TOKEN: token } : {}) };
}
