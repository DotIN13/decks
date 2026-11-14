import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// What an agent's shell needs to call Decks: the decks command on its PATH, the
// server's address, and the agent's own token, which is who is calling.
// DECKS_AGENT is the agent's id for a script that wants it; it proves nothing.

/** The folder holding the decks command (prompts/bin). */
export const DECKS_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../prompts/bin");
/** The SDK, for a node script: const { connect } = await import(process.env.DECKS_SDK). */
export const SDK_FILE = resolve(DECKS_BIN, "../../../clients/sdk/index.ts");

/** The variables every agent's shell shares: where Decks is, and the node to run decks with. */
export function decksServerEnv(url: string, path = process.env.PATH ?? ""): Record<string, string> {
	return {
		DECKS_URL: url,
		DECKS_NODE: process.execPath,
		DECKS_SDK: SDK_FILE,
		PATH: path.split(delimiter).includes(DECKS_BIN) ? path : `${DECKS_BIN}${delimiter}${path}`,
	};
}

/** All of them, for one agent's own shell, its token among them. */
export function decksEnv(url: string, agentId: string, token: string | undefined, path?: string): Record<string, string> {
	return { ...decksServerEnv(url, path), DECKS_AGENT: agentId, ...(token ? { DECKS_TOKEN: token } : {}) };
}
