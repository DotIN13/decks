# harness/page/alerts

What the page may interrupt the person with when an agent finishes, asks or fails. Moved from
today's `@decks/agent-ui` (its `alerts/` and `sounds/`), so the switch-over can delete that package.

## Owns

- `policy.ts`: when a cue, a banner or a tab count is due, and the person's choices.
- `sound.ts`: the cues; `sounds/` holds them, served at `/sounds/` by the page's Vite config.
- `notify.ts`: system banners. `tab-badge.ts`: the count on the tab. `alerts.ts`: the live half.
- `index.ts`: the entry.

## May import

solid-js and the page's `state/types`. Nothing of `@decks/agent-ui`.

## Rules

1. A cue or a banner follows a change of state, never a restatement: a reload rings nothing.
2. A banner only while the page is not looked at; the tab counts what was missed until it is.
3. The cues are files here, not fetched from elsewhere.

## Check

`node tools/check.mjs harness/page`
