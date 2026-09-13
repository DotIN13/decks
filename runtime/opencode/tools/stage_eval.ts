import { tool } from "@opencode-ai/plugin"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The Decks canvas tool, for opencode.
 *
 * The filename is the tool name, which is why this file is `stage_eval.ts` — the wording
 * every runtime shows the model lives in Decks' `stage/tool.ts` and the name has to match
 * it, or the deck's own instructions would point at a tool that does not exist.
 *
 * This runs inside **opencode's** Bun runtime, not inside Decks, so there is no closure to
 * reach: the body is one HTTP call back to the Decks server that spawned this process.
 * All opencode agents share one server — and so one environment — which is exactly why the
 * token stopped being per agent: `DECKS_STAGE_TOKEN` now proves the caller is the process
 * Decks spawned, and the session id Decks created when it opened this conversation names
 * the agent. `context.sessionID` is opencode's own fact about the call, so nothing here
 * has to guess who is calling.
 *
 * **The description is a file, read here rather than typed here.** The wording lives in
 * `runtime/tool-description.txt` and four runtimes show the same words to a model — Pi and
 * Claude through the server's `StageTool`, opencode here, and antigravity from its own MCP
 * script. This file used to carry its own shortened copy under a comment claiming it was
 * "the same words"; the point of one product is that it is the same file.
 */
let cached = ""
function description(): string {
  if (!cached) {
    cached = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../tool-description.txt"), "utf8").trim()
  }
  return cached
}
export default tool({
  description: description(),
  args: {
    code: tool.schema.string().describe("TypeScript, run as an async function body with `stage` in scope. Return a value to see it."),
  },
  async execute(args, context) {
    const url = process.env.DECKS_STAGE_URL
    const token = process.env.DECKS_STAGE_TOKEN
    if (!url || !token) {
      throw new Error("This opencode session was not started by Decks, so there is no canvas to reach.")
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: args.code, sessionID: context.sessionID }),
    })
    if (!response.ok) throw new Error(`The Decks canvas answered ${response.status}.`)
    const outcome = (await response.json()) as { text: string; isError?: boolean }
    // Thrown rather than returned, which is what the Pi adapter does and for the same
    // reason: a failed eval must read as a failed tool call and not as a result that
    // happens to contain the word "Error".
    if (outcome.isError) throw new Error(outcome.text)
    return outcome.text
  },
})