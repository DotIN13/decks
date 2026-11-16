# canvas/documents

Files you type into (.md, .tex, .docx, Google Docs), drawn as pages: keystrokes go to the file as splices, others' edits come back to review.

## Owns

- `page.ts`: `mountDocPage`, a document as a page; `page/`: its sheet, elements, PDF pane and remotes.
- `live.ts` and `live/` (the editor, its builder, its input), `blocks.ts`, `marks.ts`, `reading.ts`, `render.ts`, `tex.ts`: the editor and how words are drawn.
- `gview.ts`, `google/`: a Google Doc drawn as its own pages (view, typing, history, format).
- `client.ts`, `merge.ts`, `model.ts`: the page's side of the document protocol.
- `live-doc.ts`, `build-live-doc.mjs`: the one module a card's document box loads, built at install.

## May import

The rest of `canvas/`, `protocol/`.

## Rules

1. A page sends splices; it never writes the file.
2. The server's side is `server/documents`; nothing here touches the disk.

## Check

```
node tools/check.mjs canvas
```
