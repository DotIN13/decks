/**
 * The part of the Google Docs API a document page needs: the document as `documents.get` returns
 * it, and the requests `documents.batchUpdate` takes. Only the fields read or written here are
 * typed; Google sends many more, and they pass through untouched.
 *
 * Indices are Google's: UTF-16 code units from the start of the body, where index 0 is the
 * document's first section break and every paragraph ends in its own "\n".
 */

export interface DocsDimension {
	magnitude?: number;
	unit?: string;
}

export interface DocsColor {
	color?: { rgbColor?: { red?: number; green?: number; blue?: number } };
}

export interface DocsTextStyle {
	bold?: boolean;
	italic?: boolean;
	strikethrough?: boolean;
	underline?: boolean;
	smallCaps?: boolean;
	link?: { url?: string; headingId?: string; bookmarkId?: string };
	weightedFontFamily?: { fontFamily?: string; weight?: number };
	fontSize?: DocsDimension;
	foregroundColor?: DocsColor;
	backgroundColor?: DocsColor;
	baselineOffset?: string;
}

export interface DocsParagraphStyle {
	namedStyleType?: string;
	alignment?: string;
	lineSpacing?: number;
	direction?: string;
	spaceAbove?: DocsDimension;
	spaceBelow?: DocsDimension;
	indentFirstLine?: DocsDimension;
	indentStart?: DocsDimension;
	indentEnd?: DocsDimension;
	shading?: { backgroundColor?: DocsColor };
	headingId?: string;
	[field: string]: unknown;
}

export interface DocsParagraphElement {
	startIndex?: number;
	endIndex?: number;
	textRun?: { content?: string; textStyle?: DocsTextStyle };
	inlineObjectElement?: { inlineObjectId?: string };
	horizontalRule?: object;
	pageBreak?: object;
	footnoteReference?: { footnoteNumber?: string };
	person?: { personProperties?: { name?: string; email?: string } };
	richLink?: { richLinkProperties?: { title?: string; uri?: string } };
	equation?: object;
	autoText?: object;
	columnBreak?: object;
}

export interface DocsParagraph {
	elements?: DocsParagraphElement[];
	paragraphStyle?: DocsParagraphStyle;
	bullet?: { listId?: string; nestingLevel?: number; textStyle?: DocsTextStyle };
}

export interface DocsStructuralElement {
	startIndex?: number;
	endIndex?: number;
	paragraph?: DocsParagraph;
	table?: {
		rows?: number;
		columns?: number;
		tableRows?: Array<{ startIndex?: number; endIndex?: number; tableCells?: Array<{ startIndex?: number; endIndex?: number; content?: DocsStructuralElement[]; tableCellStyle?: Record<string, unknown> }> }>;
		tableStyle?: { tableColumnProperties?: Array<{ widthType?: string; width?: DocsDimension }> };
	};
	sectionBreak?: object;
	tableOfContents?: object;
}

export interface DocsDocument {
	documentId?: string;
	title?: string;
	revisionId?: string;
	body?: { content?: DocsStructuralElement[] };
	lists?: Record<string, { listProperties?: { nestingLevels?: Array<{ glyphType?: string; glyphSymbol?: string; glyphFormat?: string; startNumber?: number; indentStart?: DocsDimension; indentFirstLine?: DocsDimension; textStyle?: DocsTextStyle }> } }>;
	inlineObjects?: Record<string, { inlineObjectProperties?: { embeddedObject?: { imageProperties?: { contentUri?: string }; title?: string; description?: string; size?: { width?: DocsDimension; height?: DocsDimension } } } }>;
	documentStyle?: {
		pageSize?: { width?: DocsDimension; height?: DocsDimension };
		marginTop?: DocsDimension;
		marginBottom?: DocsDimension;
		marginLeft?: DocsDimension;
		marginRight?: DocsDimension;
		background?: { color?: DocsColor["color"] };
		documentFormat?: { documentMode?: string };
	};
	namedStyles?: { styles?: Array<{ namedStyleType?: string; textStyle?: DocsTextStyle; paragraphStyle?: DocsParagraphStyle }> };
}

export type DocsRange = { startIndex: number; endIndex: number };

/** One `batchUpdate` request, of the kinds a document page sends. */
export type DocsRequest =
	| { insertText: { location: { index: number }; text: string } }
	| { deleteContentRange: { range: DocsRange } }
	| { updateTextStyle: { range: DocsRange; textStyle: DocsTextStyle; fields: string } }
	| { updateParagraphStyle: { range: DocsRange; paragraphStyle: DocsParagraphStyle; fields: string } }
	| { createParagraphBullets: { range: DocsRange; bulletPreset: string } }
	| { deleteParagraphBullets: { range: DocsRange } }
	| { insertTable: { rows: number; columns: number; location: { index: number } } }
	| { insertPageBreak: { location: { index: number } } }
	| { insertTableRow: { tableCellLocation: DocsCellLocation; insertBelow: boolean } }
	| { insertTableColumn: { tableCellLocation: DocsCellLocation; insertRight: boolean } }
	| { deleteTableRow: { tableCellLocation: DocsCellLocation } }
	| { deleteTableColumn: { tableCellLocation: DocsCellLocation } };

/** A cell, as the table requests name one: the table by its start index, then row and column. */
export interface DocsCellLocation {
	tableStartLocation: { index: number };
	rowIndex: number;
	columnIndex: number;
}

/** `writeControl`: the revision the requests were made against; Google refuses them if it has moved. */
export interface DocsWriteControl {
	requiredRevisionId?: string;
	/** Made against this revision, and moved by Google past anything written since: for styles, which cannot conflict. */
	targetRevisionId?: string;
}

/** What a batch answered: the revision it made. */
export interface DocsBatchResult {
	writeControl?: { requiredRevisionId?: string };
}

/** A comment on a Doc, as Drive keeps it: Docs has none of its own. */
export interface DocsComment {
	id: string;
	content: string;
	author?: { displayName?: string; photoLink?: string; me?: boolean };
	createdTime?: string;
	resolved?: boolean;
	quotedFileContent?: { value?: string };
	replies?: Array<{ id: string; content?: string; author?: { displayName?: string; photoLink?: string; me?: boolean }; createdTime?: string; action?: string }>;
}

/** The calls a document page makes, against Google or against a stand-in for it. */
export interface DocsApi {
	get(id: string): Promise<DocsDocument>;
	batchUpdate(id: string, requests: DocsRequest[], writeControl?: DocsWriteControl): Promise<DocsBatchResult>;
	/** The Doc's open comments, through Drive. */
	comments(id: string): Promise<DocsComment[]>;
	/** A new comment on the quoted words; a reply, or a reply that resolves. */
	comment(id: string, content: string, quote: string): Promise<void>;
	reply(id: string, commentId: string, content: string, action?: "resolve" | "reopen"): Promise<void>;
	/** The person's Docs, the ones they looked at last first; `query` narrows them by name. */
	list(query?: string): Promise<DocsListed[]>;
}

/** A Doc in the person's Drive, as the file picker lists it. */
export interface DocsListed {
	id: string;
	title: string;
	/** When it was last changed by anyone, as an ISO time. */
	modified?: string;
	/** Who owns it, when it is not the person. */
	owner?: string;
}

// -- the page's model of a document: what both a Google Doc and its markdown are read into ------

/** The styles markdown can say. */
export interface Style {
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	code?: boolean;
	link?: string;
}

/**
 * A run of text with one style. `atom` is something drawn but not typed (a picture, a rule, a
 * person chip): its markdown, standing for one index in Google's text, written as U+FFFC.
 */
export interface Run extends Style {
	text: string;
	atom?: string;
}

export interface Para {
	kind: "p";
	/** 0 for body text, 1 to 6 for a heading. */
	level: number;
	bullet?: { ordered: boolean; nest: number };
	runs: Run[];
	/** In a Google Doc: where the paragraph starts, and the index after its newline. */
	start?: number;
	end?: number;
}

export interface Cell {
	runs: Run[];
	start?: number;
	end?: number;
	/** More than one paragraph in the cell: shown, not edited. */
	multi?: boolean;
}

export interface Table {
	kind: "table";
	rows: Cell[][];
	start?: number;
	end?: number;
}

/** A block shown but not edited: a section break, a table of contents. */
export interface Atom {
	kind: "atom";
	md: string;
	start?: number;
	end?: number;
}

export type Block = Para | Table | Atom;

export const OBJECT = "\uFFFC";
