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
   the kind's word and the first free number: Agent 1, Agent 2.
3. Tags are slugged, empties and repeats dropped, at most four of 24 characters. A workspace is one
   slug of 24 characters; empty means none.
4. An avatar is an emoji or an SVG with an xmlns and a viewBox; anything else is refused `invalid`.
5. A colour is given once, from the palette, the first one fewest agents wear.
6. An agent changes only itself. The person may change or delete any agent.
7. `agent.attach` trades the person's call for a new agent and its own token. A call with that
   token runs as that agent, under its current name; a deleted agent's token stops working.
   Attach and create give the agent a home: the canvas named, else a new one titled with its
   name (`canvas.create`, through a call). A refused home takes the new record back.
8. The server keeps each agent's mailbox and delivers nothing into a turn. Mail for an agent whose
   host is connected is told to that host alone (`agent.mailed`); otherwise it waits in the inbox.
9. `agent.send` is delivered at once when a host holds the agent, and queued when none does.
   `agent.queue` always waits its turn in the inbox.
10. A host is a connected client that offers kinds of agent (`agent.host`). Its offer ends when it
    disconnects. `agent.create` goes to one host offering that kind (`agent.requested`); with none
    it is refused `unavailable`, saying a harness must be running.
11. `agent.news` answers what changed on the caller's canvas since its last ask, leaving out its own
    changes, and its waiting mail; asking moves its mark on, so a second ask brings nothing new.
12. A screen says which agent it follows with `view.move`. An agent's view call reaches only the
    screens that follow it; with none, the answer says it waits.
13. Cameras are kept per person or agent, canvas and device. `view.get` answers the newest on the
    canvas, or the origin.

## Not here

`agent.delete` refusing a working agent waits for the host to report states (wave 2).

## Check

```
node tools/check.mjs server
node tools/gates/run.mjs
```
