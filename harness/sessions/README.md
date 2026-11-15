# harness/sessions

One session per agent the harness runs: its turns, its queues, its transcript, its timeline,
who it is and what it is given. A session knows nothing of where its agent sits on a canvas.

## Owns

`session.ts` (a turn: prompt, run, abort, report), `queue.ts`, `transcript.ts`, `timeline.ts`,
`identity.ts`, `tools.ts`, and `index.ts`, the sessions a harness holds.

## May import

`protocol/` and `clients/sdk` through their entries, and `../runtimes`, `../accounts`, `../prompts`.

## Rules

1. A session starts dormant. Its runtime starts on its first message, never at queue time.
2. Every message reaches the runtime with, in front of it, what changed on the agent's canvas since
   its last message (`agent.news`) and, until it has said who it is, a reminder to. A slash command
   goes as typed, with nothing in front.
3. The agent's shell gets the decks command, `DECKS_URL` and its own token from `agent.attach` or
   `agent.requested`, exactly what an attached Claude Code gets. It is told the deck once, from calls.
4. The person's message while the agent works goes into the running turn when the runtime can take
   one there, and into the person's queue when it cannot.
5. The person's queue: a message added while idle and empty is sent at once; otherwise it waits.
   When a turn ends, the next one is sent, unless the queue is held. Stopping a turn holds it;
   releasing sends the next. Removing the last item releases it.
6. Mail sent now (`state: delivered`) goes into the running turn, or starts one, as rule 4. Queued
   mail waits behind the person's queue and runs after the agent has been idle `DECKS_QUEUE_IDLE_MS`
   (10 s). At most 8 items wait; a ninth is refused.
7. A queued item that asked for a reply is answered, when its turn ends, by `agent.send` from the
   agent to the sender with its last words. An answer never asks for a reply, so two agents cannot
   loop.
8. Each change of state (idle, thinking, tool, error) and of the queue's length is reported with
   `agent.update { state, queued }` on the host line, and told as `chat.changed`.
9. Every transcript entry is told as `chat.added` with ids `[agent, entry]`: the whole entry, or a
   delta of its text or thinking while it streams. `rev` counts the agent's changes.
10. The transcript is kept in the harness's own folder, never the deck: the last 500 entries, and an
    archive of older ones that `chat.list` pages back through.
11. A rewind or fork goes back to a user message by the runtime's own session tree; a rewind
    tells `chat.drafted` with that message's words, for the composer. Before the
    runtime hears a message, the session marks it with the settled version (`file.versions`, once
    its text matches the file's) of each file the agent's tool calls named. Preview and restore
    (`file.restore`) use that mark, else the version current at the message's time.
12. On a deck with no agent at all, the harness starts one of the first kind it offers once it is
    connected, named by the server, at home on the canvas named (`--canvas`), else the deck's first
    canvas, else a new one, as a first run of Decks does.
    `--no-first-agent` leaves the deck empty.

## Check

`node tools/check.mjs harness` and `node tools/gates/run.mjs`.
