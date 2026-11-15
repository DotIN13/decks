# harness/page/chat

The conversation on the person's page: the stream of turns, tool chips and groups, the status
line, the time machine, and the section that holds them. Moved from the old shared chat package
and the old page's conversation section and stream; markup, class names and behaviour are today's.

## Owns

- `index.ts`: the entry. It exports the names Studio imports as `@decks/agent-ui/chat`.
- One part per folder, each `model.ts` (no DOM, unit tested), `view.tsx`, `actions.ts`:
  `stream/`, `turn/`, `tool/`, `time-machine/`, `status/`, `markdown/`, `section/`, `focused/`.
- `edge.ts`: who owns the right edge, the conversation or the inspector.

## May import

`@decks/protocol` (types; `@decks/protocol` until Lexicon moves them), `@decks/ui`,
`solid-js`, `lucide-solid`, `../composer` (its pills), and Pane's entries under
`harness/page/<area>/index.ts`. Never `server/`, never a neighbour's inner file.

## Rules

1. The conversation is drawn from `ChatItem`s, newest last; a row is replaced whole when it
   changes (`chat.added` with an item), and grows in place while it streams (with a delta).
2. One card per speaker's turn: the person's words with their pills, the agent's text, thinking
   and tool calls. An agent's card has no name and no time.
3. A turn's tool calls that finished cleanly may fold behind a count; a running or failed call
   always shows. A group header names at most three distinct tools, then counts.
4. A tool chip shows the preview the row carries. Opening it asks for the full result once
   (`chat.get`); the full result is held apart from the rows, so a new row does not drop it.
5. Only the last 60 rows are drawn. Scrolling within 800 px of the top shows 60 more held rows,
   then asks the host for an older page (`chat.list` with `before`).
6. The column follows the newest row while you are at its foot, and stays put once you scroll up;
   the arrow brings you back to the foot.
7. The working sign is drawn in exactly one place: at the column's foot while the conversation
   is shown, above the composer otherwise, and nowhere while the agent is idle.
8. The status row keeps its height between turns, so the composer never moves when a turn ends.
9. The time machine sits on the person's own turns: look (`chat.preview`), take back
   (`chat.rewind`), branch (`chat.fork`), put back (`chat.restore`). Looking ends on a second
   press or on Escape.
10. The right edge belongs to whichever of the conversation and the inspector was asked for
    last; a yielded conversation comes back when the selection goes.
11. The parts call nothing themselves: the shell passes the callbacks that make the calls.

## Check

- `node tools/check.mjs harness`: the harness's type check and unit tests.
- `node tools/gates/run.mjs`: the ten rules.
- Browser checks through Warden's runner: `chat-content`, `time-machine`, `running`,
  `working-marks`, `agent-rows`, `panel-steady`.
