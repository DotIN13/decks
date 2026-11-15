# engine/demo

A page that draws a drawing with the engine alone, without Decks: for looking at the engine.

## Owns

`index.html`, `main.js`, `worker.js`, `serve.mjs`.

## May import

The built engine in `../pkg/`.

## Rules

1. It is a tool for people, not part of any build or check.

## Check

```
node engine/demo/serve.mjs
```
