// The OpenCode 2 plugin that gives a Decks agent its Google Docs tools
// and gives its shell commands the agent's token and environment.
import { Plugin } from "@opencode/plugin"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { gdocs as callGdocs, sessionToken } from "../../shims/decks-call.ts"

/**
 * Decks' tools for OpenCode 2: the two Google Docs tools, and the agent token for the `decks` command,
 * as one plugin.
 *
 * The opencode 1 version is two files in `runtime/opencode/tools/`, one per tool, because v1
 * named a tool after its file, and a plugin in `runtime/opencode/plugin/`. OpenCode 2 has no tool files: a plugin registers tools in its
 * `setup`, so they live together here. This runs inside OpenCode's own process, so each tool is
 * one protocol call (google.read, google.edit) made as the agent the session belongs to, with the
 * token the harness wrote for that session (../../shims/decks-call.ts).
 *
 * `codemode: false` on each tool, or OpenCode 2 folds it into its `execute` tool and the call
 * never appears as itself in the transcript.
 *
 * `@opencode/plugin` is not installed beside this file: OpenCode resolves the import to its own
 * copy when it loads a plugin, which is what keeps plugin and host on one runtime.
 */
const here = dirname(fileURLToPath(import.meta.url))
const runtime = resolve(here, "..", "..")

const gdocs = JSON.parse(readFileSync(resolve(runtime, "gdocs-tools.json"), "utf8")) as Array<{
  name: string
  description: string
  parameters: Record<string, string>
}>

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
    await ctx.shell.hook("create.before", async (command) => {
      for (const [name, value] of Object.entries(restore)) {
        if (value === null) delete command.env[name]
        else command.env[name] = value
      }
      delete command.env.DECKS_OPENCODE2_RESTORE
      // The server's secret and the sessions' folder are never a command's.
      delete command.env.DECKS_OPENCODE_SECRET
      delete command.env.DECKS_OPENCODE_SESSIONS
      // The session a command runs for is one agent's: the command runs with that agent's token.
      const session = (command as { sessionID?: unknown }).sessionID
      if (typeof session === "string" && session) {
        command.env.DECKS_SESSION = session
        const token = sessionToken(session)
        if (token) command.env.DECKS_TOKEN = token
      }
    })
    await ctx.tool.transform((editor) => {
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
            content: await callGdocs(spec.name, input, context.sessionID),
          }),
        })
      }
    })
  },
})
