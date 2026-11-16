// What the opencode plugins share: the agent token a session runs as, from the file
// the harness wrote for it, and a protocol call made as that agent.
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** The token of the agent a session belongs to, from DECKS_OPENCODE_SESSIONS/<session>; none when not written yet. */
export function sessionToken(session: string, dir = process.env.DECKS_OPENCODE_SESSIONS): string | undefined {
  if (!dir || !/^[\w.-]+$/.test(session)) return undefined
  try {
    return readFileSync(join(dir, session), "utf8").trim() || undefined
  } catch {
    return undefined
  }
}

/** A call of the protocol as the session's agent; its value, or a thrown error with the refusal's words. */
export async function callDecks(name: string, args: Record<string, unknown>, session: string, url = process.env.DECKS_URL): Promise<unknown> {
  const token = sessionToken(session)
  if (!url || !token) throw new Error("This session was not started by the Decks harness, so it cannot reach Decks.")
  const response = await fetch(`${url}/api/v1/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  })
  const envelope = (await response.json()) as { ok: boolean; value?: unknown; error?: { message: string; hint?: string } }
  if (!envelope.ok) throw new Error([envelope.error?.message ?? `Decks answered ${response.status}.`, envelope.error?.hint ? `Try ${envelope.error.hint}.` : ""].filter(Boolean).join(" "))
  return envelope.value
}

/** A Google Docs tool call (gdocs_read, gdocs_edit) as the protocol's google.read and google.edit, answered as text. */
export async function gdocs(tool: string, args: Record<string, unknown>, session: string): Promise<string> {
  const value = (await callDecks(tool === "gdocs_read" ? "google.read" : "google.edit", args, session)) as { doc: string; title?: string; text: string }
  if (tool === "gdocs_read") return `# ${value.title ?? "Untitled"} (Google Doc ${value.doc})\n\n${value.text}`
  return "Edited the Doc. The person sees the change on its page."
}
