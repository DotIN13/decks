// The opencode plugin that gives each shell command its agent's Decks token:
// the one the harness wrote for the session the command runs in.
import type { Plugin } from "@opencode-ai/plugin"
import { sessionToken } from "../../shims/decks-call.ts"

/**
 * Every agent on this deck shares one opencode server, so the server's environment cannot hold an
 * agent's token. The session a command runs for names one: the harness made the session for one
 * agent and wrote its token to DECKS_OPENCODE_SESSIONS/<session>. Read afresh each time, so a
 * session registered a moment after its first command still gets it.
 */
export const DecksSession: Plugin = async () => ({
  "shell.env": async (input, output) => {
    // Which folder holds every session's token is the server's, never a command's.
    output.env.DECKS_OPENCODE_SESSIONS = ""
    output.env.DECKS_OPENCODE_SECRET = ""
    if (!input.sessionID) return
    const token = sessionToken(input.sessionID, process.env.DECKS_OPENCODE_SESSIONS)
    if (token) output.env.DECKS_TOKEN = token
    output.env.DECKS_SESSION = input.sessionID
  },
})
