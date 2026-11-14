# harness/prompts

What an agent is told: the deck context template, the guidelines, the skills, and the shims the
out-of-process runtimes load. Moved from today's `runtime/`.

## Owns

`AGENTS.md.tmpl`, `guidelines.txt`, `skills/`, `.claude-plugin/` (Claude reads the skills as a
plugin), `opencode/`, `opencode2/`, `antigravity/`, `gdocs-tools.json`, `bin/decks` (the decks
command on an agent's PATH), and `paths.ts`, where each of them is.

## May import

Node modules only.

## Rules

1. The calls reference an agent is given is generated from the protocol (`dist-gen/reference.md`,
   written by `tools/gen`), never written by hand. `DECKS_REFERENCE` points at another.
2. `DECKS_RUNTIME_DIR` points every path here at another copy, to try other words.
3. Everything shipped is listed in `SHIPPED`, and a test checks each is there.
4. `bin/decks` runs `clients/cli` with the agent's `DECKS_URL` and `DECKS_TOKEN`.

## Not yet

The template's words still describe today's commands; they move to the new call names when the
browser checks pass on the new programs.

## Check

`node tools/check.mjs harness`
