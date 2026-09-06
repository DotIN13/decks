import { tool } from "@opencode-ai/plugin"

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
 */
export default tool({
  description:
    "Run TypeScript against the Decks canvas the user is looking at. Your code is the body of an async " +
    "function with `stage` in scope; whatever you return comes back as JSON. Boards are how you answer: " +
    "put the substance on a board with your file tools, then use stage.show to put it in front of the user. " +
    "The full API is in the stage.d.ts in your context — if something is not in it, it does not exist.",
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