# harness/runtimes

One folder per kind of agent the harness runs: claude, pi, opencode, opencode2, antigravity.
Moved from today's `apps/server/src/runtimes` and the runtime half of `agents/`, then split.

## Owns

- `runtime.ts`: `AgentRuntime`, what a runtime is. `backend.ts`: `AgentBackend` and its context.
- `registry.ts`: every runtime, the one place a kind is named. `env.ts`: the agent's shell variables.
- `answers.ts`: `runtime.list`, `runtime.get`, `runtime.update`.
- `shared/`: the transcript (`translator.ts`), dialogs, slash commands, the briefing, message parts.
- `types/`: the runtimes' own shapes; what the wire carries comes from the protocol.

## May import

`protocol/` through its entry, the runtimes' SDKs, `../prompts`, `../accounts`, `../sessions` (answers).

## Rules

1. A runtime is handed a session's context: its agent's id, its decks access (address, token,
   variables), its briefing and its transcript. Never the server, a deck, a canvas or a tool.
2. The agent reaches Decks only through the decks command in its shell, with its own token.
3. Adding a kind is a folder here and a row in `registry.ts`; nothing else names it.
4. `availability()` is cheap (a PATH lookup or a file check) and says why when it is false.
5. A runtime whose one server serves every agent (opencode) binds each session to its agent
   through `sessionTokens`, so a command runs as that agent.
6. Moved code keeps its behaviour; a moved file that breaks a size or comment rule is in the
   gate's baseline under this path, and that list only shrinks.

## Not yet

- Google Docs tools: no call reads or edits a Google Doc for an agent, so none are registered.
- `sessionTokens` has no implementation: opencode agents' commands carry no agent token yet.

## Check

`node tools/check.mjs harness`, or `node --import tsx --test harness/runtimes/**/*.test.ts`.
