# tools/complete

The completeness checks: every call the protocol declares is answered, and every event is heard. Keel
owns them.

## Owns

- `calls.test.ts`: starts the server with every feature as `server/main.ts` starts it, on a copy of
  the fixture deck, connects a host that offers what the harness answers, and checks every call.
- `unhandled.json`: the calls answered by no one yet, each with its owner and why.
- `events.test.ts`: drives the same server through the smallest action that causes each event, and
  hears it on a socket; `unheard.json` lists the rest: unheard (owner, why) or not driven here (owner,
  what proves it).
- `old-deck.test.ts`: opens Warden's old-deck fixture as main does; `old-entries.json` names every
  entry today's `.decks/` keeps, with its owner and what becomes of it.
- `scopes.test.ts`: every token issued in server/ for less than a whole caller has a Scope with until;
  `scopes-whole.json` names the files that issue whole callers, how many sites, and why.
- `start.ts`: the server started as main starts it, socket lines, and what the harness answers.

## May import

Anything: `@decks/protocol`, `@decks/server` and its kernel's testing entry, `@decks/harness`.

## Rules

1. A declared call is answered when a feature of the server handles it, or the harness offers it
   through `agent.host` and the server accepts the offer.
2. A call a feature handles but that works only with an outside service (`google.read`, `google.edit`
   need the Google sign-in's store) counts as answered only when main's start options give it.
3. A call answered by no one fails the check unless `unhandled.json` lists it, with its owner and why.
4. A listed call that is answered now, or no longer declared, fails the check too: the list only shrinks.
5. Every declared event has a step that causes it and a line that hears it within two seconds, or is
   in `unheard.json`. A step that hears a listed event fails the check: take the line out.

6. Every entry in the old-deck fixture's `.decks/` is in `old-entries.json`, and what is adopted is
   reachable after the start: paired tokens resolve, card versions read, agents are listed.

7. Every callers.issue or tokens.issue in server/ passes a Scope with until, unless its file is in
   `scopes-whole.json` with that many sites and why; one more or one fewer fails.

## Check

```
node --import tsx --test tools/complete/*.test.ts
```
