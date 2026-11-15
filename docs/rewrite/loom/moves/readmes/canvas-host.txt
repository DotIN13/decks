# canvas/host

The canvas inside a frame, and the page that holds the frame: the messages between them, the frame's line to the server.

## Owns

- `host.ts`: the host's side of the canvas.
- `messages.ts`: what the frame and the page say to each other.
- `inside/`: the frame: boot, line, events, presence, clipboard, card calls.
- `outside/framed-editor.tsx`: the page's side, `createFramedEditor`.
- `chrome.ts`.

## May import

The rest of `canvas/`, `protocol/`.

## Rules

1. The frame calls the server on its canvas's pass; the page brokers only what the frame cannot reach.

## Check

```
node tools/check.mjs canvas
```
