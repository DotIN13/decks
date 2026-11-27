/**
 * What the server takes from the canvas package, with no page around it: icon pictures, the font files
 * a drawing's text needs, and the readers that lay out a card's words and maths for a picture drawn on
 * the server (`apps/server/src/canvas/native-shots.ts`, `text.ts`, `calls/export.ts`).
 */
export { iconUrl, parseIcon } from "../look/icons.ts";
export { fontFiles, isFallbackFamily, textNeeds, type FontFile, type FontNeed } from "../look/font-files.ts";
export { cardReader, mathTypesetter } from "../render/reader.ts";
