# harness/page/composer

What the person writes to an agent: the draft field with its pills, mentions, attachments, the
queue of waiting messages, the model, mode and recipient menus, slash commands, and voice.
Moved from `apps/web/src/composer` and `packages/agent-ui/src/composer`; markup, class names and
behaviour are today's.

## Owns

- `index.ts`: the entry. It exports the names Studio imports as `@decks/agent-ui/composer`, and
  the `Composer` the shell mounts in the dock.
- One part per folder, each `model.ts` (no DOM, unit tested), `view.tsx`, `actions.ts`:
  `bar/` (the composer, with `sending.ts`: a line sent with its comments and pills, and
  `destination.ts`: where a line goes), `draft/` (the field), `model-picker/`, `mode-menu/`, `slash-menu/`,
  `mention-menu/`, `recipient/`, `context/`, `hints/`.
- `pill/` (a pill's words, its card, what it is about, a sent message's parts, and `finding.ts`:
  finding on the canvas what a pill names; `pill/compat` reads old messages),
  `voice/`, and the tests that cross the server: `send.test.ts`, `entries.test.ts`.

## May import

`@decks/protocol` (types; `@decks/protocol` until Lexicon moves them), `@decks/ui`,
`solid-js`, `lucide-solid`, and Pane's entries under `harness/page/<area>/index.ts`. Never
`server/`, never a neighbour's inner file.

## Rules

1. A draft is a list of nodes: words, and mentions of a card, an item, a file or a comment.
   The field is the one place that edits it; typing never rebuilds the field.
2. A mention is a pill: it is deleted, copied and pasted whole. Copy puts plain words and the
   draft itself on the clipboard; paste takes the draft back, else plain words.
3. `@` opens the mention menu and `/` at the start opens the slash menu; both filter as you type
   and take Enter, Tab and the arrows.
4. Enter sends, Shift+Enter breaks the line. While the agent works, Enter steers its turn and
   Ctrl+Enter (⌘ on a Mac) queues; the queue shows above the field, each line can be put back,
   sent now or removed, and an empty box offers Stop.
5. A message is sent whole: its words, and each pill as a part with its kind, id, name and who
   put it in (`chat.send` with `parts`). Comments waiting on the canvas go with it and are
   then gone from the bar.
6. An unsent draft is kept per agent and canvas, and comes back when you return.
7. The model menu offers the runtime's models; switching to one that lacks the thinking level
   you were on keeps the nearest level it offers, sent together with the model.
8. Voice records while held or toggled; the heard words are joined into the draft at the caret.
   No microphone is said plainly, not as a refusal.
9. Files dropped or picked are attached as file pills.
10. The parts call nothing themselves: the shell passes the callbacks that make the calls.

## Check

- `node tools/check.mjs harness`: the harness's type check and unit tests.
- `node tools/gates/run.mjs`: the ten rules.
- Browser checks through Warden's runner: `slash`, `voice`, `context`, `item-pill`,
  `export-pill`, `drop-lands`, `per-agent`, `walkthrough`.
