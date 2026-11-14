# clients/attach

`decks attach` and `decks detach`: a coding tool joins a Decks server as an agent of its own, in one
command, and leaves the folder as it was when it detaches.

## Owns

- `index.ts`: `attach(words, client?)` and `detach(words, client?)`, run by `decks attach` and `decks detach`.
- `tools.ts`: what each tool needs (claude, codex, opencode). `files.ts`: writing a plan and undoing it.

## May import

`protocol/` and `clients/sdk` through their entries. It reads `dist-gen/reference.md` for the skill.

## Rules

1. `decks attach [--tool claude|codex|opencode] [--as name] [--canvas c] [--dir folder]` calls
   `agent.attach` as the person, which answers the new agent with its own token and colour.
2. It writes, in the folder: a `decks` script that runs the command as that agent, the Decks skill (how
   to call, then the generated reference), and the tool's settings. Claude Code gets its token in
   `.claude/settings.local.json` and a `UserPromptSubmit` hook that runs `decks agent news`; Codex gets
   `.codex/config.toml`; opencode gets the MCP relay in `opencode.json`. Codex and opencode have no
   prompt hook here, and neither has been run against a real tool yet.
3. Every file made, every folder made, and the text of every file changed is recorded in
   `.decks-attach.json`. Attaching twice is refused.
4. `decks detach` removes what attach made, restores what it changed word for word, removes the folders
   it made if empty, and asks the server to delete the agent; the folder is then as it was.

## Check

`node tools/check.mjs clients/attach`
