# Launching on a deck from today

Not done yet: this is what the switch of a running Decks will take, written down as it is learned.
Nothing here is run until the person asks for a deploy.

## Today

Today's Decks starts from `~/Library/LaunchAgents/com.dotin13.decks.plist` as
`node --import tsx apps/server/src/index.ts`, with `DECKS_DATA_DIR=<data>`, `DECKS_PORT=4329`,
`DECKS_HOST=127.0.0.1` and `DECKS_CLAUDE_PATH`. The deck is `<data>/decks`; beside it,
`<data>/claude-accounts` and `<data>/google`.

## The new programs

One command, run from the repo: `node --import tsx harness/main.ts --deck <data>/decks --port 4329`.
The harness starts Decks-local itself when no lock file names a running one (`server/main.ts --deck
--port`, host 127.0.0.1).

Keep in the environment:

- `DECKS_DATA_DIR=<data>`, so the harness finds `<data>/claude-accounts` and keeps its sessions in
  `<data>/harness/agents/`.
- `DECKS_CLAUDE_PATH`, still read by `harness/runtimes/claude`.
- `HOME` and `PATH` as today.

`DECKS_PORT` and `DECKS_HOST` are no longer read: the port is `--port`. Google needs nothing: Decks-local
reads `<deck>/../google`, which is `<data>/google` as long as `--deck` is `<data>/decks`.

The first start upgrades the deck once, with backups first; no flag is needed.

## Open before any switch

- **What serves the person's page at the port.** Decided 2026-11-15: Decks-local serves the built page
  a host hands it, beside the canvas frame's page, public and static, reading nothing of the deck. The
  harness passes its built page's folder when it starts the server. The browser checks then run against
  that serving, not a stand-in. Not built yet.
- **The upgrade, shown on a copy of the person's deck**, row by row (`tools/complete/old-entries.json`).
- **The way back, tried**: the steps below, run once on a copy of the person's deck.

## The way back

The upgrade changes none of today's files. Every part reads today's `.decks/` through a store written
only under `.decks/backups/`, and writes the new programs' own stores beside it: `.decks/kernel`,
`history`, `people`, `cards`, `sharing`, `pictures`, `tab`, and `apps/log` plus `apps/ports.json`. The one
file both share is `.decks/migrations.json`: its version goes to 0.6.0, with one key per migration added.
The agents migration copies each `agents/<id>/meta.json` and `avatars/<id>.svg` to
`.decks/backups/<time>-before-agents-to-people/` first. The conversations stay in `.decks/agents/`, and
the harness's copies go to `<data>/harness/agents/`.

To start today's Decks on the deck again:

1. Stop the new launch: `launchctl bootout gui/$(id -u)` for the new plist, or end the harness process.
2. Optionally set `"version"` back to `"0.5.1"` in `.decks/migrations.json`. Today's Decks opens a newer
   deck anyway, with one warning that a newer Decks wrote it, and its own migrations stop at 0.5.1, so
   nothing reruns.
3. Load today's plist again:
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dotin13.decks.plist`.

Kept on the way back: everything in the deck's own files, so canvases, cards, drawings, documents and
apps, with every edit made on the new programs.

Lost on the way back: what only the new stores hold. That is agents made and conversations held since
the switch, logins paired since, history, bylines and read marks since, and Studio's sync state since.
Today's `studio-sync.json` is then stale, so before today's Decks syncs again, disconnect Studio and
reconnect, rather than let it merge without a base.
