/**
 * A link to something in the deck: a canvas, a card, a document or an app.
 *
 * It is written as the address the Decks window already gives a tab, after `#`: `#canvas/<name>`,
 * `#card/<path>`, `#doc/<path>`, `#app/<name>`. In drawn words it is a markdown link's address,
 * `[the plan](#card/canvases/launch/cards/plan/index.html)`; a card's own HTML has it as an `href`. Followed, it is the host's to read and open
 * (`CanvasHost.openAddress`): the canvas only tells such an address from a web one.
 */

/** Whether a link's address is one in the deck's window: `#` and a kind's word, then what it names. */
export const isDeckLink = (href: string): boolean => /^#[a-z]+\/\S/.test(href.trim());
