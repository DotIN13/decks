import { tool } from "@opencode-ai/plugin"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The Decks Google Docs tool `gdocs_read`, for opencode: the filename is the tool name. Its words
 * are in `runtime/gdocs-tools.json`, shared by every runtime, and the call goes back to the
 * Decks server that spawned this process, named by the session as the canvas tool is.
 */
const spec = (JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../gdocs-tools.json"), "utf8")) as Array<{ name: string; description: string; parameters: Record<string, string> }>).find((t) => t.name === "gdocs_read")!
export default tool({
  description: spec.description,
  args: Object.fromEntries(Object.entries(spec.parameters).map(([key, about]) => [key, tool.schema.string().describe(about)])),
  async execute(args, context) {
    const url = process.env.DECKS_STAGE_URL
    const token = process.env.DECKS_STAGE_TOKEN
    if (!url || !token) throw new Error("This opencode session was not started by Decks, so there is no Google Docs to reach.")
    const response = await fetch(url.replace(/\/stage\/eval$/, "/gdocs/call"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool: "gdocs_read", args, sessionID: context.sessionID }),
    })
    if (!response.ok) throw new Error(`Decks answered ${response.status}.`)
    const outcome = (await response.json()) as { text: string; isError?: boolean }
    if (outcome.isError) throw new Error(outcome.text)
    return outcome.text
  },
})
