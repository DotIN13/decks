import { Plugin } from "@opencode/plugin"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Decks' tools for OpenCode 2: the canvas tool and the two Google Docs tools, as one plugin.
 *
 * The opencode 1 version is three files in `runtime/opencode/tools/`, one per tool, because v1
 * named a tool after its file. OpenCode 2 has no tool files: a plugin registers tools in its
 * `setup`, so they live together here. Everything else is the same bargain. This runs inside
 * OpenCode's own process, not inside Decks, so each tool is one HTTP call back to the Decks
 * server that spawned it, with the server's single token and the session id that names the
 * agent (`stage/bridge.ts`). The words a model sees are the files every runtime reads.
 *
 * `codemode: false` on each tool, or OpenCode 2 folds it into its `execute` tool and the call
 * never appears as itself in the transcript.
 *
 * `@opencode/plugin` is not installed beside this file: OpenCode resolves the import to its own
 * copy when it loads a plugin, which is what keeps plugin and host on one runtime.
 */
const here = dirname(fileURLToPath(import.meta.url))
const runtime = resolve(here, "..", "..")

const stageWords = readFileSync(resolve(runtime, "tool-description.txt"), "utf8").trim()
const gdocs = JSON.parse(readFileSync(resolve(runtime, "gdocs-tools.json"), "utf8")) as Array<{
  name: string
  description: string
  parameters: Record<string, string>
}>

/** One call back to Decks; a failed answer is thrown, so it reads as a failed tool call. */
async function callDecks(path: string, body: Record<string, unknown>, what: string): Promise<string> {
  const url = process.env.DECKS_STAGE_URL
  const token = process.env.DECKS_STAGE_TOKEN
  if (!url || !token) throw new Error(`This OpenCode session was not started by Decks, so there is no ${what} to reach.`)
  const response = await fetch(url.replace(/\/stage\/eval$/, path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Decks answered ${response.status}.`)
  const outcome = (await response.json()) as { text: string; isError?: boolean }
  if (outcome.isError) throw new Error(outcome.text)
  return outcome.text
}

/**
 * The environment an agent's commands should have: the values the Decks server started
 * OpenCode 2 with, before it gave OpenCode its own folders (`opencode2/manager.ts`). A `null`
 * is a variable that was not set, and stays unset.
 */
const restore = (() => {
  try {
    return JSON.parse(process.env.DECKS_OPENCODE2_RESTORE ?? "{}") as Record<string, string | null>
  } catch {
    return {}
  }
})()

export default Plugin.define({
  id: "decks",
  setup: async (ctx) => {
    await ctx.shell.hook("create.before", (command) => {
      for (const [name, value] of Object.entries(restore)) {
        if (value === null) delete command.env[name]
        else command.env[name] = value
      }
      delete command.env.DECKS_OPENCODE2_RESTORE
    })
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "stage_eval",
        description: stageWords,
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            code: { type: "string", description: "TypeScript, run as an async function body with `stage` in scope. Return a value to see it." },
          },
          required: ["code"],
        },
        execute: async (input: { code: string }, context: { sessionID: string }) => ({
          content: await callDecks("/stage/eval", { code: input.code, sessionID: context.sessionID }, "canvas"),
        }),
      })
      for (const spec of gdocs) {
        editor.add({
          name: spec.name,
          description: spec.description,
          options: { codemode: false },
          input: {
            type: "object",
            properties: Object.fromEntries(Object.entries(spec.parameters).map(([key, about]) => [key, { type: "string", description: about }])),
            required: Object.keys(spec.parameters),
          },
          execute: async (input: Record<string, string>, context: { sessionID: string }) => ({
            content: await callDecks("/gdocs/call", { tool: spec.name, args: input, sessionID: context.sessionID }, "Google Docs"),
          }),
        })
      }
    })
  },
})
