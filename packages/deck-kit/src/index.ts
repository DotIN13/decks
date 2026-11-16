/**
 * The rules of a deck that hold wherever one is kept.
 *
 * A harness keeps a deck in a folder; a service such as Decks Studio keeps canvases in a database.
 * Both answer the same calls (`@decks/api`), and a call's answer must not depend on which: the same
 * path is refused for the same reason, the same edit lands or fails with the same sentence, a new
 * card starts as the same file, and "beside" is the same 160 px. Those rules are here, with no disk
 * and no store in them; each host brings its own way of reading and writing bytes.
 *
 * - `text-files.ts`: a path a caller may name, and a text file read in part, edited and searched.
 * - `cards.ts`: a card's name from its title, the file a new card starts as, and what its head says.
 * - `place.ts`: where an item goes when it is put beside or below another.
 */
export * from "./text-files.ts";
export * from "./cards.ts";
export * from "./place.ts";
