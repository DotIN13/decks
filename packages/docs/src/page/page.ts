import type { DocClientMessage, DocServerMessage, Splice } from "../index.ts";
import { DocSync } from "../client.ts";
import { findMarks, marksOf, shiftMarks } from "./marks.ts";
import { LiveEditor } from "./live.ts";
import { Reading } from "./reading.ts";
import { GoogleView } from "./gview.ts";
import { m } from "@decks/i18n";
import { pageDom, type PageContext, type PageHooks, type View } from "./context.ts";
import { addStyle } from "./style.ts";
import { mountChanges } from "./changes.ts";
import { mountComments } from "./comments.ts";
import { mountGit } from "./git.ts";
import { mountGoogle } from "./google.ts";
import { mountHistory } from "./history.ts";
import { mountPdf } from "./pdf.ts";
import { mountSource } from "./source.ts";
import { mountTools } from "./tools.ts";
import { base, dir, el, iconButton, svg } from "./ui.ts";

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
 * app's socket, relayed into the board by `postMessage`.
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
	const { name, status, changesButton, commentsButton, pdfButton, sourceButton, historyButton, scroll, text, panel, old } = dom;

	const urls = new Map<string, Promise<string | undefined>>();
	const pictures = new Map<string, Promise<string | undefined>>();
	const near = (src: string) => (src.startsWith("/") ? src : `${dir(sync.path)}/${decodeURI(src)}`);

	const sync = new DocSync({
		path: options.path,
		send: options.send,
		onUpdate: (_sync, why, applied) => ctx.hooks.updated(why, applied),
	});
	const recent = () => sync.changes;
	const live = new LiveEditor(sync, {
		...(options.math ? { math: options.math } : {}),
		asset: (src) => {
			if (!options.file) return Promise.resolve(undefined);
			const from = dir(sync.path);
			const path = src.startsWith("/") ? src : `${from}/${decodeURI(src)}`;
			let url = urls.get(path);
			if (!url) {
				url = options
					.file(path)
					.then((bytes) => URL.createObjectURL(new Blob([bytes])))
					.catch(() => undefined);
				urls.set(path, url);
			}
			return url;
		},
		pdfPicture: (src) => {
			if (!options.file || !options.pdf) return Promise.resolve(undefined);
			const path = near(src);
			let url = pictures.get(path);
			if (!url) {
				const into = document.createElement("div");
				url = options
					.file(path)
					.then((bytes) => options.pdf!(into, bytes, 1200))
					.then(() => into.querySelector("img")?.src ?? into.querySelector("canvas")?.toDataURL("image/png"))
					.catch(() => undefined);
				pictures.set(path, url);
			}
			return url;
		},
		marks: () => ctx.marks,
		changes: recent,
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
		hooks: {} as PageHooks,
	};
	scroll.append(live.root, reading.root, gview.root, old);
	reading.root.hidden = true;
	gview.root.hidden = true;
	const cleanups = [mountTools(ctx), mountSource(ctx), mountPdf(ctx), mountGit(ctx), mountGoogle(ctx), mountHistory(ctx), mountComments(ctx), mountChanges(ctx)];
	const { isGoogle, isWord, isTex } = ctx;

	// --- what changed ---------------------------------------------------------------------

	function updated(why: "open" | "remote" | "local" | "outside" | "review", applied?: readonly Splice[]): void {
		if (why === "open") {
			ctx.marks = recent().flatMap((change) => findMarks(change, sync.text));
			text.setAttribute("contenteditable", sync.readOnly ? "false" : "plaintext-only");
			// A Google Doc goes by its own title; its mirror's file name is this server's business.
			name.textContent = sync.remote?.title ?? base(sync.path);
			name.title = sync.remote ? m.docs_google_doc_named({ title: sync.remote.title }) : sync.path;
			reading.root.dataset.format = sync.format;
			live.root.toggleAttribute("data-tex", isTex());
			pdfButton.hidden = !isTex() || sync.format === "docx";
			if (!sync.readOnly && !sync.remote) sync.git("status");
			ctx.hooks.drawGoogle();
			// A Doc's text is its indices, not something to read as source.
			sourceButton.hidden = isGoogle();
			ctx.hooks.drawCommentsButton();
			if (isGoogle() && ctx.mode === "source") ctx.mode = "page";
			ctx.hooks.buildTools();
			live.reset();
			ctx.hooks.setMode(ctx.mode);
		} else if (why === "local") {
			for (const splice of applied ?? []) ctx.marks = shiftMarks(ctx.marks, splice);
			if (ctx.mode === "source") {
				if (ctx.marks.length) ctx.hooks.draw();
			} else if (isWord()) reading.update(applied ?? []);
			else if (isGoogle()) gview.update(applied ?? [], true);
			else live.local();
		} else {
			for (const splice of applied ?? []) ctx.marks = shiftMarks(ctx.marks, splice);
			const change = why === "outside" ? sync.changes.at(-1) : undefined;
			if (change) ctx.marks.push(...marksOf(change.id, applied ?? []));
			// Accepted or rejected: its highlight goes.
			const waiting = new Set(sync.changes.map((c) => c.id));
			ctx.marks = ctx.marks.filter((m) => waiting.has(m.change));
			if (ctx.mode === "source") ctx.hooks.drawShifted(applied ?? []);
			else if (isWord()) reading.update(applied ?? []);
			else if (isGoogle()) gview.update(applied ?? []);
			else live.remote(applied ?? []);
		}
		if (why !== "open") ctx.hooks.compileSoon();
		refresh();
	}

	// --- the bar and the history -------------------------------------------------------------

	function refresh(): void {
		if (sync.error && !sync.ready) {
			status.dataset.state = "error";
			status.textContent = sync.error;
		} else if (sync.readOnly) {
			status.dataset.state = "idle";
			status.textContent = m.docs_read_only();
		} else if (!sync.ready) {
			status.dataset.state = "idle";
			status.textContent = m.docs_opening();
		} else {
			status.dataset.state = sync.settled ? "" : "saving";
			status.textContent = sync.settled ? m.docs_saved() : m.docs_saving();
		}
		const n = sync.changes.length;
		changesButton.hidden = n === 0 && ctx.view !== "changes";
		changesButton.innerHTML = `${svg("changes")}<span>${m.docs_changes()}</span>${n ? `<span class="dp-count">${n}</span>` : ""}`;
		// Only when the list changed: redrawing it every tick replaced the button under the pointer, and its hover flickered.
		if (ctx.view === "changes") ctx.hooks.drawChanges(true);
	}

	function show(next: View): void {
		ctx.view = ctx.view === next ? "none" : next;
		changesButton.setAttribute("aria-pressed", String(ctx.view === "changes"));
		historyButton.setAttribute("aria-pressed", String(ctx.view === "history"));
		commentsButton.setAttribute("aria-pressed", String(ctx.view === "comments"));
		panel.hidden = ctx.view === "none";
		if (ctx.view !== "history") ctx.hooks.closeVersion();
		if (ctx.view === "changes") ctx.hooks.drawChanges();
		if (ctx.view === "comments") ctx.hooks.drawComments();
		if (ctx.view === "history") {
			panel.replaceChildren(header(m.docs_history()), el("p", { class: "dp-empty" }, m.docs_reading()));
			sync.versions();
		}
		refresh();
	}

	function header(title: string, ...extra: HTMLElement[]): HTMLElement {
		const head = el("div", { class: "dp-head" });
		const close = iconButton("x", m.docs_close(), "dp-ib dp-sm");
		close.onclick = () => show(ctx.view);
		head.append(el("h3", {}, title), ...extra, close);
		return head;
	}

	historyButton.onclick = () => show("history");
	commentsButton.onclick = () => show("comments");
	changesButton.onclick = () => show("changes");

	Object.assign(ctx.hooks, {
		updated,
		refresh,
		show,
		header,
	} satisfies Partial<PageHooks>);

	const stop = options.listen((message) => {
		sync.receive(message);
		if ("path" in message && message.path === sync.path) for (const fn of listeners.get(message.type) ?? []) fn(message);
		if (message.type === "doc.patched") refresh();
	});
	/*
	 * Asked again until answered: the board's script runs before the app has wired the frame, so
	 * the first `doc.open` can go out before anyone is listening for it. Opening twice is harmless.
	 */
	const ticker = setInterval(() => {
		if (!sync.ready && !sync.error) sync.open();
		refresh();
	}, 400);
	sync.open();

	return {
		sync,
		destroy() {
			clearInterval(ticker);
			for (const cleanup of cleanups) cleanup();
			reading.destroy();
			live.destroy();
			sync.close();
			stop();
			for (const url of urls.values()) void url.then((u) => u && URL.revokeObjectURL(u));
		},
	};
}
