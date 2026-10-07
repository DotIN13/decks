/**
 * `@decks/docs/server`: the Node half. `DocService` owns the open documents and their files;
 * `VersionStore` is where it keeps their versions, with two stores for a host that has none;
 * `readSource` and `writeSource` read and write the text a page edits, `.docx` included.
 */
export { DocService, EDITABLE, PAUSE_MS, QUIET_MS, readSource, writeSource, type DocServiceOptions, type Resolved } from "./service.ts";
export { DirectoryVersions, MemoryVersions, type VersionStore } from "./versions.ts";
export { readEntry, replaceEntry } from "./zip.ts";
export { DocLibrary, type DocMeta } from "./library.ts";
