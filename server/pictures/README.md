# server/pictures

Pictures of what is on a canvas, and the one feature that drives a browser.

## Owns

- `card.fit`, `canvas.screenshot`, `canvas.export`; pictures by address (rules 11 to 16); the browser.

## May import

`protocol/` and `server/kernel/`, through their entry files; `@decks/pen` to write a drawing as
HTML; `playwright` for the browser. No other feature.

## Rules

1. Only browser.ts starts a browser. Behind the `Browser` interface, so tests give a fake one.
2. The browser loads pages from this server with a card's own pass, sent with everything the page
   loads from the server (card.css, its theme, fonts); `origin` gives the address, else unavailable.
3. Every picture and page is written through `ctx.deck`, so history names who asked for it.
4. `card.fit` needs the card on the canvas: its width there is the width it is measured at, and
   is never changed. The height is the content's once it holds for 0.6 s (3 s at most), not the
   window's, plus `margin`, written by `item.update`.
5. Fit reads: the height, the words (Chinese counts 1.6 characters a word), the smallest type,
   content wider than the card, boxes that cut off their own words, labels in a drawing that
   overlap, and script errors. Then it presses each control, twelve at most, and says which
   view runs taller than the card or wider. Only what is over a limit is advice; else "One screen".
6. Limits: one screen is 0.72 of the width tall; 170 words; type under 14px.
7. A screenshot is drawn from the drawing's file and its cards' pages, in one composed page.
   One unit is one pixel, shrunk until the long side is at most 1,600 px; `scale` multiplies.
8. `of` is an id, a list of ids, a card's path, or a box. A box shows what touches it, cut to it;
   items (or the whole canvas) are framed with 24 px of paper, out to whole units.
   In a list a card's path names its item. A card's path alone is the card as a screen showing it
   has it now (view.screenshot), else its file; as a PDF, the card on its canvas.
9. A screenshot goes to `to`, else `exports/screenshots/<canvas>-<time>.<ext>`; png, jpeg or pdf.
10. `canvas.export` writes pen's page of the items to `to`, else `exports/<id>.html`; a card an iframe.
11. `GET /pictures/<path>?w=`: a JPEG of a card or other `.html` page at a rung of the canvas's
    ladder (192, 480, 800), never wider; kept by bytes, width and scheme; with `v`, cached a year;
    with `astc=1`, 4 x 4 ASTC blocks for the GPU. Only screenshots and exports draw cards wider.
12. A canvas's tile picture is `GET /pictures/canvas-tile/<canvas>?scheme=&v=`: the whole canvas,
   its long side 480 px, a JPEG kept by the drawing's bytes and scheme; with `v`, cached for a year.
13. `GET /pictures/shot?canvas=&agent=&of=&box=&format=&scale=&scheme=&live=&name=`: a picture to
    download, taken as `canvas.screenshot` takes it, answered as bytes and kept nowhere.
14. `POST /pictures/snapshot?path=&w=&h=&scheme=` draws a card from markup its page posted, at
    the card's own address with a pass for that origin only, and answers the PNG.
15. A picture draws a card's own corner, outline and shadow, and a placeholder frame's dashed
    edge in its last writer's colour (the accent for the person).
16. `POST /pictures/extent { path, w, h, ... }` keeps what a canvas frame measured; card.fit
    answers from it while it is under 2 min old, at the card's width and newer than its last write.
17. A canvas picture is drawn by the engine's native tool (DECKS_NATIVE_SHOT, else its release
    build), `how` "native", cards as pictures, Latin fonts from the protocol's list. Words beyond
    Latin, a font not fetched, a PDF, `live`, a lone card, maths, markdown cards or icons are the
    browser's; the notes say why.
18. A canvas pass reaches only its canvas (reach.ts): a card or snapshot inside its folder, a shot
    or tile of it, its cards' extents. It writes a picture or page only into its canvas's exports/
    or files/ (by default files/exports/), never over a file.

## Check

- `node tools/check.mjs server`
- `node tools/gates/run.mjs`; heavy: `DECKS_HEAVY=1 node --import tsx --test server/pictures/browser.test.ts`
