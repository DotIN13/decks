import type { Plugin } from "@opencode-ai/plugin"

/**
 * The agent token a shell command runs with, as `DECKS_TOKEN`.
 *
 * Every agent on this deck shares one opencode server, so the server's environment cannot hold an
 * agent's token. The session a command runs for can name one: Decks made the session for one agent.
 * So before a command runs, this plugin trades the server's own secret (`DECKS_OPENCODE_SECRET`, which
 * proves the call is the process Decks spawned) and the session id for that agent's token
 * (`POST /api/tokens/session`), once per session, and gives the command the agent's token and not the
 * secret: a command holding the secret could ask for any session's token. Where Decks is and the
 * command itself are already in the server's environment (`runtimes/decks-env.ts`).
 */
const tokens = new Map<string, Promise<string | undefined>>()

async function tokenFor(session: string): Promise<string | undefined> {
  const url = process.env.DECKS_URL
  const secret = process.env.DECKS_OPENCODE_SECRET
  if (!url || !secret) return undefined
  const response = await fetch(`${url}/api/tokens/session`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ sessionID: session }),
  }).catch(() => undefined)
  if (!response?.ok) return undefined
  return ((await response.json()) as { token?: string }).token
}

export const DecksSession: Plugin = async () => ({
  "shell.env": async (input, output) => {
    // The secret is the server's, never a command's.
    output.env.DECKS_OPENCODE_SECRET = ""
    if (!input.sessionID) return
    let held = tokens.get(input.sessionID)
    if (!held) {
      held = tokenFor(input.sessionID)
      tokens.set(input.sessionID, held)
    }
    const token = await held
    // Asked again next time: a session registered a moment after its first command still gets one.
    if (!token) tokens.delete(input.sessionID)
    else output.env.DECKS_TOKEN = token
    output.env.DECKS_SESSION = input.sessionID
  },
})
