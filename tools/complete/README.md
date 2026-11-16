# tools/complete

The completeness check: every call the protocol declares is answered by someone. Keel owns it.

## Owns

- `calls.test.ts`: starts the server with every feature as `server/main.ts` starts it, on a copy of
  the fixture deck, connects a host that offers what the harness answers, and checks every call.
- `unhandled.json`: the calls answered by no one yet, each with its owner and why.

## May import

Anything: `@decks/protocol`, `@decks/server` and its kernel's testing entry, `@decks/harness`.

## Rules

1. A declared call is answered when a feature of the server handles it, or the harness offers it
   through `agent.host` and the server accepts the offer.
2. A call a feature handles but that works only with an outside service (`google.read`, `google.edit`
   need the Docs API) counts as answered only when main's start options give that service.
3. A call answered by no one fails the check unless `unhandled.json` lists it, with its owner and why.
4. A listed call that is answered now, or no longer declared, fails the check too: the list only shrinks.

## Check

```
node --import tsx --test tools/complete/calls.test.ts
```
