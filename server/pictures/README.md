# server/pictures

Pictures of what is on a canvas, and the one feature that drives a browser.

## Owns

- `card.fit`: a card measured in a browser at its width on a canvas, its height set, and what the
  browser found said in the notes (fit.ts, reading.ts).
- `canvas.screenshot`: a picture of a canvas, part of it, or one card (shot.ts).
- `canvas.export`: items as one self-contained web page (export.ts).
- A card's picture for the canvas: `GET /pictures/<card>?w=&scheme=` (picture.ts).
- The browser (browser.ts): one Chromium, started on first use, closed a minute after the last.

## May import

`protocol/` and `server/kernel/`, through their entry files; `@decks/pen` to write a drawing as
HTML; `playwright` for the browser. No other feature.

## Rules

1. Only browser.ts starts a browser. Behind the `Browser` interface, so tests give a fake one.
2. The browser loads pages from this server, with a card's own pass, never from the disk. The
   server's address comes from the `origin` option; without it these calls answer `unavailable`.
3. Every picture and page is written through `ctx.deck`, so history names who asked for it.
4. `card.fit` needs the card on the canvas: its width there is the width it is measured at, and
   is never changed. The height is the content's, plus `margin`, written by `item.update`.
5. Fit reads: the height, the words (Chinese counts 1.6 characters a word), the smallest type,
   content wider than the card, boxes that cut off their own words, labels in a drawing that
   overlap, and script errors. Then it presses each control, twelve at most, and says which
   view runs taller than the card or wider. Only what is over a limit is advice; else "One screen".
6. Limits: one screen is 0.72 of the width tall; 170 words; type under 14px.
7. A screenshot is drawn from the drawing's file and its cards' pages, in one composed page.
   One unit is one pixel, shrunk until the long side is at most 1,600 px; `scale` multiplies.
8. `of` is an id, a list of ids, a card's path, or a box. A box shows what touches it, cut to it.
   A card's path alone is that card's own page, without the drawing round it.
9. A screenshot goes to `to`, else `exports/screenshots/<canvas>-<time>.<ext>`; png, jpeg or pdf.
10. `canvas.export` writes `@decks/pen`'s page of the items, to `to`, else `exports/<id>.html`.
    A card in it is an iframe of its page, addressed from where the page is written.
11. `GET /pictures/<path>` is a JPEG of a card, or of any other `.html` page in the deck (pages
    from before cards). It is kept in the store by the page's bytes, width and scheme, so an
    unchanged page is pictured once. With `v` in the address it is cached for a year.
12. A canvas's tile picture is `GET /pictures/canvas-tile/<canvas>?scheme=&v=`: the whole canvas,
   its long side 480 px, a JPEG kept by the drawing's bytes and scheme; with `v`, cached for a year.
13. `GET /pictures/shot?canvas=&agent=&of=&box=&format=&scale=&scheme=&name=` is a picture to
    download, taken as `canvas.screenshot` takes it, answered as bytes and kept nowhere.

## Not here

The engine's native screenshot tool (the engine's release cargo build) is not used yet:
every picture is the browser's, and `live` changes nothing. `how` says "chromium".

## Check

- `node tools/check.mjs server`
- Real browser, heavy: `node tools/heavy.mjs --wait -- env DECKS_HEAVY=1 node --import tsx --test server/pictures/browser.test.ts`
- `node tools/gates/run.mjs`
