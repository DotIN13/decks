# engine/fonts

The font files the engine draws with, fetched by `fetch-fonts.mjs`, not kept in git.

## Owns

Only this README and `.gitignore`; the `.ttf` files arrive with the fetch.

## May import

Nothing.

## Rules

1. The iPad app copies these same files (`decks-ios/scripts/fetch-fonts.sh`).

## Check

```
npm run fonts -w @decks/engine
```
