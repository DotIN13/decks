# harness/page/composer/pill/compat

Reading messages sent in the old words, so a conversation from before cards still shows its pills.

## Owns

- `old-words.ts`: "board" read as "card" in a saved mention, and the old heads and endings of a
  comment block.

## May import

Nothing.

## Rules

- Only reading: nothing new is ever written in the old words.
- Goes when no transcript on disk is older than cards.

## Check

`node tools/check.mjs harness/page` (its rules are tested through `../about.test.ts`).
