# server/people

Who is here: each agent's record, its mail, the clients that can start agents, what changed for
an agent since it last asked, and whose screen follows whom. It starts no one.

## Owns

Calls `agent.me list get create update delete attach host send queue inbox news` and
`view.get move focus goto cursor reload`. Its records, tokens' owners, mailboxes, news marks and
cameras, kept in the feature's private store, never in the deck's files.

## May import

`protocol/` and `server/kernel/` through their entry files. Never another feature, a runtime, a
model, a login or a transcript.

## Rules

1. An agent's record is its id, name, avatar, colour, kind, workspace, tags and home canvas.
2. A name is unique however it is capitalised, at most 40 characters, never empty. Left out, it is
   Agent and the first free number, whatever the kind: Agent 1, Agent 2.
3. Tags are slugged, empties and repeats dropped, at most four of 24 characters. A workspace is one
   slug of 24 characters; empty means none.
4. An avatar is an emoji or an SVG with an xmlns and a viewBox; anything else is refused `invalid`.
5. A colour is given once, from the palette, the first one fewest agents wear.
6. An agent changes only itself. The person may change or delete any agent.
7. `agent.attach` trades the person's call for a new agent and its own token. A call with that
   token runs as that agent, under its current name; a deleted agent's token stops working.
   Attach and create give a home: the canvas named; for the person's create, else its workspace's
   canvas changed last; else a new one titled with its name. A refused home undoes the record.
8. The server keeps each agent's mailbox and delivers nothing into a turn. Mail for an agent whose
   host is connected is told to that host alone (`agent.mailed`); otherwise it waits in the inbox.
9. `agent.send` is delivered at once when a host holds the agent, and queued when none does.
   `agent.queue` always waits its turn in the inbox.
10. A host is a socket client that offers kinds of agent and the harness's calls it answers
    (`agent.host`); only those calls may be offered. The kernel relays such a call to the first
    host offering it. Its offer ends when it disconnects. A host that comes up takes the agents of
    its kinds with no live host (never attached ones), each told as `agent.requested` with a fresh
    token and `adopted: true`. `agent.create` goes to one host offering that kind
    (`agent.requested`); with none it is refused `unavailable`, saying a harness must be running.
11. `agent.news` answers what changed on the caller's canvas since its last ask, leaving out its own
    changes, and its waiting mail; asking moves its mark on, so a second ask brings nothing new.
12. A screen says which agent it follows with `view.move`. An agent's view call reaches only the
    screens that follow it; with none, the answer says it waits. The person acts for the agent
    their newest screen follows, else the newest agent (`agent.me`, `view.goto`); their here is that agent's home, else
    the canvas that screen shows, else the deck's first canvas.
13. Cameras are kept per person or agent, canvas and device; `view.get` answers the newest, or 0,0.
14. Only the socket that hosts an agent sets its `state` and `queued` (`agent.update`). An agent
    whose state is thinking or tool is not deleted (`conflict`).
15. A canvas frame's line reports with `view.move` device `frame`: it can answer `view.screenshot`,
    and is never counted, moved or followed. `view.screenshot` tells every line on the canvas and
    takes the first `view.answer`, or is unavailable after 20 s.
16. An agent's change that worked, and its own `agent.act` (start or done), is told as `agent.acted`
    in its name and colour: the cards by path (a file's card included), the items by id.

## Check
```
node tools/check.mjs server
node tools/gates/run.mjs
```
