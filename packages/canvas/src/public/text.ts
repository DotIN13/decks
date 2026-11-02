/**
 * What the server shares with the page for drawing words and icons without a browser (`apps/server`:
 * `stage/text.ts`, `stage/native-shots.ts`, `verbs/export.ts`): the font files a text needs and the
 * chain they are tried in, the card and formula readers the engine is given, and the icon sets.
 * None of it touches the DOM, so a Node process can import it.
 */
export { fontFiles, isFallbackFamily, textNeeds, type FontFile, type FontNeed } from "../cards/font-files.ts";
export { cardReader, mathTypesetter } from "../engine/reader.ts";
export { iconUrl, parseIcon } from "../items/icons.ts";
