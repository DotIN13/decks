/**
 * `@decks/docs/gdoc`: a Google Doc as a document page. The Doc read as markdown (`markdown.ts`),
 * a page's markdown turned back into Docs API requests (`plan.ts`), and a stand-in for Google
 * that applies them (`fake.ts`). Nothing here talks to the network: the host passes a `DocsApi`.
 */
export * from "./types.ts";
export { blocksOfDoc, docToMarkdown, inlineMarkdown, parseInline, parseMarkdown, toMarkdown, type ImageUrl } from "./markdown.ts";
export { plan, planBlocks, textRequests } from "./plan.ts";
export { FakeDoc, FakeDocsApi, GoogleError, type FakeState } from "./fake.ts";
export { docUnits, isStruct, OBJECT_UNIT, segmentEnds, STRUCT, unitRequests } from "./units.ts";
