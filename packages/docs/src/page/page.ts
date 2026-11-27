import type { DocClientMessage, DocServerMessage } from "../index.ts";
import { DocSync } from "../client.ts";
import { LiveEditor } from "./live.ts";
import { Reading } from "./reading.ts";
import { GoogleView } from "./gview.ts";
import { assetLoaders } from "./assets.ts";
import { pageDom, type PageContext, type PageHooks } from "./context.ts";
import { addStyle } from "./style.ts";
import { mountBar } from "./bar.ts";
import { mountChanges } from "./changes.ts";
import { mountComments } from "./comments.ts";
import { mountGit } from "./git.ts";
import { mountGoogle } from "./google.ts";
import { mountHistory } from "./history.ts";
import { mountPdf } from "./pdf.ts";
import { mountSource } from "./source.ts";
import { mountTools } from "./tools.ts";
import { mountUpdates } from "./updates.ts";

/**
 * `@decks/docs/page`: a document drawn as a page you type into, in plain DOM.
 *
 * Markdown and LaTeX are typed into as they read (`live.ts`): the file's own characters, styled,
 * with their syntax hidden until the caret reaches it, and a toolbar of the usual styles. A Word
 * file is drawn by docx-preview and a paragraph is typed into in place (`reading.ts`). Source shows
 * the file as it is, for anything the page does not draw.
 *
 * Every edit reaches the file within a frame, where the file is: its history and the changes
 * waiting for review are kept apart, in the deck's `docs/`. What other writers do (an agent with its own tools, any program)
 * arrives the same way and is highlighted on the words it touched until it is accepted or
 * rejected, one at a time from the highlight or the Changes panel, or all at once. History shows
 * any kept version as it read, with what differs from now highlighted, and restores it.
 *
 * It needs a way to send a message and a way to hear one, and nothing else: in Decks that is the
 * app's socket, relayed into the card by `postMessage`.
 *
 * This file only wires the page together. Each part is a panel in a file of its own, mounted with
 * the `PageContext` they share (`context.ts`) and answering what tears it down: the bar (`bar.ts`),
 * what changed (`updates.ts`), the tools (`tools.ts`, `gtools.ts`), Source (`source.ts`), the
 * changes to review (`changes.ts`), History (`history.ts`), a Doc's link and comments (`google.ts`,
 * `comments.ts`), Git (`git.ts`) and a LaTeX page's PDF (`pdf.ts`).
 */

export interface DocPageOptions {
	path: string;
	send(message: DocClientMessage): void;
	/** Call `listener` with every message from the server; answers what stops it. */
	listen(listener: (message: DocServerMessage) => void): () => void;
	/** Draw markdown into an element; without it a markdown page reads as its plain source. */
	markdown?(into: HTMLElement, source: string): Promise<void> | void;
	/** Set the maths in an element, for LaTeX and markdown pages (KaTeX's auto-render). */
	math?(into: HTMLElement): Promise<void> | void;
	/** The bytes of a file by the path the server calls it: a Word page is drawn from the whole `.docx`, a picture from its file. */
	file?(path: string): Promise<ArrayBuffer>;
	/** Draw a PDF's pages into an element at a width, answering how many there were: a LaTeX page's preview. */
	pdf?(into: HTMLElement, bytes: ArrayBuffer, width: number): Promise<number>;
	/** The server's API (`/api`, or under a connection's prefix), for a Google Doc's sign-in. */
	api?: string;
}

interface DocPage {
	sync: DocSync;
	destroy(): void;
}

export function mountDocPage(host: HTMLElement, options: DocPageOptions): DocPage {
	addStyle();
	const dom = pageDom(host, options.path);
	const sync = new DocSync({
		path: options.path,
		send: options.send,
		onUpdate: (_sync, why, applied) => ctx.hooks.updated(why, applied),
	});
	const assets = assetLoaders(options, sync);
	const live = new LiveEditor(sync, {
		...(options.math ? { math: options.math } : {}),
		asset: assets.asset,
		pdfPicture: assets.pdfPicture,
		marks: () => ctx.marks,
		changes: () => sync.changes,
		onState: (state) => ctx.hooks.pressed(state),
	});
	const reading = new Reading(sync, {
		...(options.markdown ? { markdown: options.markdown } : {}),
		...(options.math ? { math: options.math } : {}),
		...(options.file ? { file: options.file } : {}),
		marks: () => ctx.marks,
	});
	// A Google Doc, drawn from Google's own document as it lays it out (`gview.ts`); its styles go to Google once the typing before them has.
	const gview = new GoogleView(sync, {
		marks: () => ctx.marks,
		style: (requests) => ctx.hooks.sendStyle(requests),
		...(options.api ? { api: options.api } : {}),
		selection: () => ctx.hooks.gpressed(),
		command: (name) => (name === "link" ? ctx.hooks.askLink() : ctx.hooks.newComment()),
	});
	/** Each message type's listeners, called in the order the panels were mounted. */
	const listeners = new Map<string, Array<(message: DocServerMessage) => void>>();
	const ctx: PageContext = {
		options,
		sync,
		live,
		reading,
		gview,
		dom,
		marks: [],
		mode: "page",
		view: "none",
		isGoogle: () => !!sync.remote,
		isWord: () => sync.format === "docx",
		isTex: () => /\.(tex|sty|cls|ltx)$/i.test(sync.path),
		on: (type, fn) => {
			listeners.set(type, [...(listeners.get(type) ?? []), fn as (message: DocServerMessage) => void]);
		},
		// Each panel fills in its own calls as it is mounted, below; none is called before then.
		hooks: {} as PageHooks,
	};
	dom.scroll.append(live.root, reading.root, gview.root, dom.old);
	reading.root.hidden = true;
	gview.root.hidden = true;

	// The Doc's comments go on after the Doc is drawn: `google.ts` before `comments.ts`, which both hear `doc.gdoc`.
	const cleanups = [
		mountUpdates(ctx),
		mountBar(ctx),
		mountTools(ctx),
		mountSource(ctx),
		mountPdf(ctx),
		mountGit(ctx),
		mountGoogle(ctx),
		mountHistory(ctx),
		mountComments(ctx),
		mountChanges(ctx),
	];

	const stop = options.listen((message) => {
		sync.receive(message);
		if ("path" in message && message.path === sync.path) for (const fn of listeners.get(message.type) ?? []) fn(message);
		if (message.type === "doc.patched") ctx.hooks.refresh();
	});
	/*
	 * Asked again until answered: the card's script runs before the app has wired the frame, so
	 * the first `doc.open` can go out before anyone is listening for it. Opening twice is harmless.
	 */
	const ticker = setInterval(() => {
		if (!sync.ready && !sync.error) sync.open();
		ctx.hooks.refresh();
	}, 400);
	sync.open();

	return {
		sync,
		destroy() {
			clearInterval(ticker);
			reading.destroy();
			live.destroy();
			for (const cleanup of cleanups) cleanup();
			sync.close();
			stop();
			assets.revoke();
		},
	};
}
