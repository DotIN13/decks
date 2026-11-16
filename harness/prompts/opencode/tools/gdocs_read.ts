// The gdocs_read tool for opencode (the file name is the tool's name): the
// protocol's google.read, made as the agent the session belongs to.
import { tool } from "@opencode-ai/plugin"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { gdocs } from "../../shims/decks-call.ts"

const spec = (JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../gdocs-tools.json"), "utf8")) as Array<{ name: string; description: string; parameters: Record<string, string> }>).find((t) => t.name === "gdocs_read")!
export default tool({
  description: spec.description,
  args: Object.fromEntries(Object.entries(spec.parameters).map(([key, about]) => [key, tool.schema.string().describe(about)])),
  execute: (args, context) => gdocs("gdocs_read", args, context.sessionID),
})
