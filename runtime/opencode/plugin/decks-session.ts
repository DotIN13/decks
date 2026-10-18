import type { Plugin } from "@opencode-ai/plugin"

/**
 * The session a shell command runs for, as `DECKS_SESSION`.
 *
 * Every agent on this deck shares one opencode server, so the server's environment cannot say which
 * agent a `decks` command comes from. The session can: Decks made it for one agent, and maps it back
 * when the command calls (`apps/server/src/verbs/router.ts`). Where Decks is and the command itself
 * are already in the server's environment (`runtimes/decks-env.ts`).
 */
export const DecksSession: Plugin = async () => ({
  "shell.env": async (input, output) => {
    if (input.sessionID) output.env.DECKS_SESSION = input.sessionID
  },
})
