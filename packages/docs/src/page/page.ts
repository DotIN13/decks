import type { CompileError, DocClientMessage, DocRemoteStatus, GitStatus, DocServerMessage, DocVersion, Splice } from "../index.ts";
import { DocSync } from "../client.ts";
import { spliceDiff } from "../merge.ts";
import type { DocSync as Sync } from "../client.ts";
import { docxBlocks, readParagraph } from "./blocks.ts";
import { findMarks, marksOf, shiftMarks, type Mark } from "./marks.ts";
import { LiveEditor } from "./live.ts";
import { Reading } from "./reading.ts";
import { GoogleView } from "./gview.ts";
import type { DocsRequest } from "../gdoc/types.ts";
import { formatList, formatNumber, getLocale, m } from "@decks/i18n";
import { pageDom, type PageContext, type PageHooks, type View } from "./context.ts";
import { addStyle } from "./style.ts";
import { mountSource } from "./source.ts";
import { mountTools } from "./tools.ts";
import { base, clip, dir, el, iconButton, initial, svg, when, whoOf } from "./ui.ts";

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

/** A comment on a Google Doc, as Drive answers it. */
interface GComment {
	id: string;
	content: string;
	author?: { displayName?: string; me?: boolean };
	createdTime?: string;
	quotedFileContent?: { value?: string };
	replies?: Array<{ id: string; content?: string; author?: { displayName?: string }; createdTime?: string }>;
}

export function mountDocPage(host: HTMLElement, options: DocPageOptions): DocPage {
	addStyle();
	const dom = pageDom(host, options.path);
	const { name, status, changesButton, commentsButton, gitBox, googleBox, pdfButton, sourceButton, historyButton, tools, main, scroll, text, panel, banner, old, pill, divider, pdfPane } = dom;
	const gitButton = el("button", { type: "button", class: "dp-btn", "aria-pressed": "false", "aria-haspopup": "dialog", title: m.docs_git_title() });
	const gitMenu = el("div", { class: "dp-gitmenu", role: "dialog", hidden: "" });
	gitBox.append(gitButton, gitMenu);
	const googleButton = el("button", { type: "button", class: "dp-btn", "aria-pressed": "false", "aria-haspopup": "dialog", title: m.docs_google_title() });
	const googleMenu = el("div", { class: "dp-gitmenu", role: "dialog", hidden: "" });
	googleBox.append(googleButton, googleMenu);
	const pdfBar = el("div", { class: "dp-pdfbar" });
	const pdfState = el("span", { class: "dp-pdfstate" }, m.docs_pdf_not_yet());
	const errButton = el("button", { type: "button", class: "dp-btn dp-sm dp-errs", hidden: "", "aria-pressed": "false" });
	const errList = el("div", { class: "dp-errlist", hidden: "" });
	const pdfBody = el("div", { class: "dp-pdfbody" });
	pdfPane.append(pdfBar, errList, pdfBody);

	/** A Google Doc's open comments, from Drive, or why they cannot be shown. */
	let comments: GComment[] = [];
	let commentsError = "";
	let versions: DocVersion[] = [];
	/** The kept version being looked at, instead of the page as it is now. */
	let viewing: { sha: string; at?: number; text: string; editor?: LiveEditor } | undefined;
	/** The History row last pressed: one text kept twice has one id, so the row says which time is meant. */
	let picked: { sha: string; at: number } | undefined;
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
	const cleanups = [mountTools(ctx), mountSource(ctx)];
	/**
	 * Styles for Google, each with the text the page had when it was made, sent in order once the
	 * typing before it has reached the server: the server brings the Doc to that text, applies the
	 * style, and only then what was typed after, so a list item made after a bullet is in the list.
	 */
	const styleQueue: Array<{ requests: DocsRequest[]; text: string; mark: number; hold?: number }> = [];
	/** A keystroke's style is held this long for the next keystroke to join, so a run of bold typing is one request to Google, not one a key. */
	const HOLD_MS = 400;
	let pumping: ReturnType<typeof setTimeout> | undefined;
	function sendStyle(requests: DocsRequest[]): void {
		// A keystroke's style that carries on the one before it, not yet sent, goes out as one request.
		const last = styleQueue[styleQueue.length - 1];
		const [a] = last?.requests ?? [];
		const [b] = requests;
		if (last?.requests.length === 1 && requests.length === 1 && a && b && "updateTextStyle" in a && "updateTextStyle" in b && a.updateTextStyle.range.endIndex === b.updateTextStyle.range.startIndex && JSON.stringify([a.updateTextStyle.textStyle, a.updateTextStyle.fields]) === JSON.stringify([b.updateTextStyle.textStyle, b.updateTextStyle.fields])) {
			last.requests = [{ updateTextStyle: { ...a.updateTextStyle, range: { startIndex: a.updateTextStyle.range.startIndex, endIndex: b.updateTextStyle.range.endIndex } } }];
			last.text = sync.text;
			last.mark = sync.mark();
			last.hold = Date.now() + HOLD_MS;
		} else styleQueue.push({ requests, text: sync.text, mark: sync.mark(), ...(requests.length === 1 && b && "updateTextStyle" in b ? { hold: Date.now() + HOLD_MS } : {}) });
		pump();
	}
	function pump(): void {
		clearTimeout(pumping);
		pumping = undefined;
		sync.flush();
		while (styleQueue.length && sync.landed(styleQueue[0]!.mark) && (styleQueue.length > 1 || (styleQueue[0]!.hold ?? 0) <= Date.now())) {
			const next = styleQueue.shift()!;
			options.send({ type: "doc.gstyle", path: sync.path, client: sync.client, requests: next.requests, text: next.text });
		}
		if (styleQueue.length) pumping = setTimeout(pump, 30);
	}

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
			drawGoogle();
			// A Doc's text is its indices, not something to read as source.
			sourceButton.hidden = isGoogle();
			drawCommentsButton();
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
		if (why !== "open") compileSoon();
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
		if (ctx.view === "changes" && changesDrawn !== changesKey()) drawChanges();
	}

	function show(next: View): void {
		ctx.view = ctx.view === next ? "none" : next;
		changesButton.setAttribute("aria-pressed", String(ctx.view === "changes"));
		historyButton.setAttribute("aria-pressed", String(ctx.view === "history"));
		commentsButton.setAttribute("aria-pressed", String(ctx.view === "comments"));
		panel.hidden = ctx.view === "none";
		if (ctx.view !== "history" && viewing) closeVersion();
		if (ctx.view === "changes") drawChanges();
		if (ctx.view === "comments") drawComments();
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

	let changesDrawn = "";
	const changesKey = () => `${sync.readOnly}|${sync.changes.map((c) => c.id).join(",")}`;

	function drawChanges(): void {
		changesDrawn = changesKey();
		const extra: HTMLElement[] = [];
		if (sync.changes.length > 0 && !sync.readOnly) {
			const all = el("button", { type: "button", class: "dp-btn dp-sm dp-primary", title: m.docs_accept_all_title() }, m.docs_accept_all());
			const none = el("button", { type: "button", class: "dp-btn dp-sm dp-outline", title: m.docs_reject_all_title() }, m.docs_reject_all());
			all.onclick = () => sync.accept("*");
			none.onclick = () => sync.reject("*");
			extra.push(all, none);
		}
		panel.replaceChildren(header(m.docs_changes(), ...extra));
		if (sync.changes.length === 0) panel.append(el("p", { class: "dp-empty" }, m.docs_nothing_to_review()));
		for (const change of [...sync.changes].reverse()) {
			const item = el("div", { class: "dp-change", "data-change": change.id });
			const who = el("div", { class: "dp-who" });
			who.append(el("span", { class: "dp-av" }, initial(change.by)), el("b", {}, whoOf(change.by)), new Date(change.at).toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" }));
			if (!sync.readOnly) {
				const acts = el("div", { class: "dp-acts" });
				const yes = iconButton("check", m.docs_accept(), "dp-ib dp-sm dp-yes");
				const no = iconButton("x", m.docs_reject(), "dp-ib dp-sm dp-no");
				yes.onclick = (event) => (event.stopPropagation(), sync.accept(change.id));
				no.onclick = (event) => (event.stopPropagation(), sync.reject(change.id));
				acts.append(yes, no);
				who.append(acts);
			}
			const snip = el("div", { class: "dp-snip" });
			for (const splice of change.splices.slice(0, 4)) {
				if (splice.before) snip.append(el("del", {}, clip(splice.before, 60)));
				if (splice.text) snip.append(el("ins", {}, clip(splice.text, 60)));
				snip.append(" ");
			}
			if (change.splices.length > 4) snip.append(`+${change.splices.length - 4}`);
			item.append(who, snip);
			item.onmouseenter = () => hot(change.id, true);
			item.onmouseleave = () => hot(change.id, false);
			item.onclick = () => (isGoogle() ? gview.page : live.root).querySelector(`[data-change="${change.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
			panel.append(item);
		}
	}

	// --- a Google Doc's comments, kept by Drive ---------------------------------------------------

	function drawCommentsButton(): void {
		commentsButton.hidden = !isGoogle();
		const n = comments.length;
		commentsButton.innerHTML = `${svg("comment")}<span>${m.docs_comments()}</span>${n ? `<span class="dp-count dp-count-soft">${n}</span>` : ""}`;
	}

	function sendComment(action: "create" | "reply" | "resolve", fields: { comment?: string; content?: string; quote?: string }): void {
		options.send({ type: "doc.gcomment", path: sync.path, client: sync.client, action, ...fields });
	}

	/** A new comment on the selected words: the panel opens with a box for it at the top. */
	let drafting: string | undefined;
	function newComment(): void {
		const quote = gview.quote();
		if (!quote) return;
		drafting = quote;
		if (ctx.view !== "comments") show("comments");
		else drawComments();
	}

	function drawComments(): void {
		const parts: HTMLElement[] = [header(m.docs_comments())];
		if (commentsError) {
			parts.push(el("p", { class: "dp-empty" }, commentsError));
			if (remoteStatus?.paste !== undefined || options.api) parts.push(...signInParts());
		}
		if (drafting !== undefined) {
			const box = el("div", { class: "dp-comment dp-comment-new" });
			box.append(el("div", { class: "dp-quote" }, clip(drafting, 120)));
			const input = el("textarea", { class: "dp-reply", rows: "3", placeholder: m.docs_comment() });
			const post = el("button", { type: "button", class: "dp-btn dp-sm dp-primary" }, m.docs_comment());
			const cancel = el("button", { type: "button", class: "dp-btn dp-sm" }, m.docs_cancel());
			post.onclick = () => {
				if (!input.value.trim()) return;
				sendComment("create", { content: input.value.trim(), quote: drafting });
				drafting = undefined;
				drawComments();
			};
			cancel.onclick = () => {
				drafting = undefined;
				drawComments();
			};
			const acts = el("div", { class: "dp-comment-acts" });
			acts.append(cancel, post);
			box.append(input, acts);
			parts.push(box);
			setTimeout(() => input.focus(), 0);
		}
		if (!commentsError && comments.length === 0 && drafting === undefined) parts.push(el("p", { class: "dp-empty" }, m.docs_no_comments()));
		for (const c of comments) {
			const card = el("div", { class: "dp-comment", "data-comment": c.id });
			const who = (a: GComment["author"], at?: string) => {
				const row = el("div", { class: "dp-who" });
				row.append(el("span", { class: "dp-av" }, initial(a?.displayName ?? "?")), el("b", {}, a?.displayName ?? m.docs_someone()), at ? new Date(at).toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
				return row;
			};
			const head = who(c.author, c.createdTime);
			const resolve = iconButton("check", m.docs_resolve(), "dp-ib dp-sm dp-yes");
			resolve.onclick = (event) => {
				event.stopPropagation();
				sendComment("resolve", { comment: c.id, content: "" });
			};
			const acts = el("div", { class: "dp-acts" });
			acts.append(resolve);
			head.append(acts);
			card.append(head);
			if (c.quotedFileContent?.value) card.append(el("div", { class: "dp-quote" }, clip(c.quotedFileContent.value, 120)));
			card.append(el("div", { class: "dp-comment-body" }, c.content));
			for (const r of c.replies ?? []) {
				if (!r.content) continue;
				card.append(who(r.author, r.createdTime), el("div", { class: "dp-comment-body" }, r.content));
			}
			const form = el("form", { class: "dp-reply-row" });
			const input = el("input", { class: "dp-reply", placeholder: m.docs_reply() });
			form.append(input);
			form.onsubmit = (event) => {
				event.preventDefault();
				if (input.value.trim()) sendComment("reply", { comment: c.id, content: input.value.trim() });
				input.value = "";
			};
			card.append(form);
			card.onmouseenter = () => hotComment(c.id, true);
			card.onmouseleave = () => hotComment(c.id, false);
			card.onclick = (event) => {
				if ((event.target as HTMLElement).closest("input, button, textarea")) return;
				gview.page.querySelector(`[data-comment="${c.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
			};
			parts.push(card);
		}
		panel.replaceChildren(...parts);
	}

	function hotComment(id: string, on: boolean): void {
		for (const node of gview.page.querySelectorAll<HTMLElement>(`[data-comment="${id}"]`)) node.toggleAttribute("data-hot", on);
	}

	// A click on commented words opens the comment.
	gview.page.addEventListener("click", (event) => {
		const id = (event.target as HTMLElement).closest<HTMLElement>("[data-comment]")?.dataset.comment;
		if (!id) return;
		if (ctx.view !== "comments") show("comments");
		panel.querySelector(`[data-comment="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	});

	function hot(change: string, on: boolean): void {
		for (const node of (isGoogle() ? gview.page : live.root).querySelectorAll<HTMLElement>(`[data-change="${change}"]`)) node.toggleAttribute("data-hot", on);
	}

	// --- one change, from its highlight ------------------------------------------------------

	let pillFor: string | undefined;
	let pillTimer: ReturnType<typeof setTimeout> | undefined;
	function showPill(target: HTMLElement): void {
		const id = target.dataset.change!;
		const change = sync.changes.find((c) => c.id === id);
		if (!change || sync.readOnly || viewing) return;
		clearTimeout(pillTimer);
		if (pillFor !== id) {
			pillFor = id;
			const yes = iconButton("check", m.docs_accept(), "dp-ib dp-sm dp-yes");
			const no = iconButton("x", m.docs_reject(), "dp-ib dp-sm dp-no");
			yes.onclick = () => (sync.accept(id), hidePill(true));
			no.onclick = () => (sync.reject(id), hidePill(true));
			const who = el("span", { class: "p-who" });
			who.append(el("span", { class: "dp-av" }, initial(change.by)), el("b", {}, whoOf(change.by)), new Date(change.at).toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" }));
			pill.replaceChildren(who, yes, no);
		}
		pill.hidden = false;
		const box = target.getBoundingClientRect();
		const frame = main.getBoundingClientRect();
		const left = Math.max(8, Math.min(box.left - frame.left, frame.width - pill.offsetWidth - 8));
		const above = box.top - frame.top - pill.offsetHeight - 6;
		pill.style.left = `${left}px`;
		pill.style.top = `${above < 4 ? box.bottom - frame.top + 6 : above}px`;
		hot(id, true);
	}
	function hidePill(now = false): void {
		clearTimeout(pillTimer);
		const go = () => {
			if (pillFor) hot(pillFor, false);
			pill.hidden = true;
			pillFor = undefined;
		};
		if (now) go();
		else pillTimer = setTimeout(go, 350);
	}
	for (const surface of [live.root, gview.page]) {
		surface.addEventListener("mouseover", (event) => {
			const target = (event.target as HTMLElement).closest<HTMLElement>("[data-change]");
			if (target && surface.contains(target)) showPill(target);
			else if (pillFor) hidePill();
		});
		surface.addEventListener("mouseleave", () => hidePill());
	}
	pill.addEventListener("mouseenter", () => clearTimeout(pillTimer));
	pill.addEventListener("mouseleave", () => hidePill());
	scroll.addEventListener("scroll", () => hidePill(true));

	// --- history: looking at a kept version ------------------------------------------------------

	function drawHistory(): void {
		panel.replaceChildren(header(m.docs_history()));
		if (versions.length === 0) panel.append(el("p", { class: "dp-empty" }, m.docs_no_versions()));
		const today = new Date().toDateString();
		for (const [i, version] of [...versions].reverse().entries()) {
			const date = new Date(version.at);
			const item = el("div", { class: i === 0 ? "dp-time t-latest" : "dp-time", "aria-current": String(viewing?.sha === version.sha && viewing.at === version.at), title: m.docs_show_version() });
			const label = el("span", { class: "t-when" }, date.toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit", second: "2-digit" }));
			if (date.toDateString() !== today) label.append(el("small", {}, date.toLocaleDateString(getLocale(), { month: "short", day: "numeric" })));
			item.append(label);
			if (!sync.readOnly) {
				const restore = iconButton("restore", m.docs_restore_version(), "dp-ib dp-sm");
				restore.onclick = (event) => (event.stopPropagation(), restoreTo(version.sha));
				item.append(restore);
			}
			item.onclick = () => {
				if (viewing?.sha === version.sha && viewing.at === version.at) return closeVersion();
				picked = { sha: version.sha, at: version.at };
				sync.version(version.sha);
			};
			panel.append(item);
		}
	}

	function restoreTo(sha: string): void {
		sync.restore(sha);
		closeVersion();
	}

	function openVersion(sha: string, at: number | undefined, source: string): void {
		closeVersion(false);
		viewing = { sha, ...(at ? { at } : {}), text: source };
		const word = isWord();
		live.root.hidden = true;
		reading.root.hidden = true;
		gview.root.hidden = true;
		text.hidden = true;
		tools.hidden = true;
		if (isGoogle()) {
			// A Doc's version reads as its words; its styles are Google's, in Google's own version history.
			old.replaceChildren(...GoogleView.plain(source).split("\n").map((line) => el("p", {}, line)));
			old.hidden = false;
		} else if (word) {
			// A Word version reads as its paragraphs' words.
			old.replaceChildren(...docxBlocks(source).filter((b) => b.kind === "text").map((b) => el("p", {}, readParagraph(source.slice(b.start, b.end)).text)));
			old.hidden = false;
		} else {
			// What differs from now is highlighted: the words Restore would bring back.
			const diff = spliceDiff(sync.text, source);
			const marks2: Mark[] = [];
			// Splices in source order: each one's place holds in the version's text.
			for (const s of diff) {
				if (s.text) marks2.push({ change: "then", kind: "ins", start: s.at, end: s.at + s.text.length });
				else marks2.push({ change: "then", kind: "del", at: s.at, text: s.before });
			}
			const stub = { text: source, readOnly: true, ready: true, path: sync.path, format: sync.format } as unknown as Sync;
			const editor = new LiveEditor(stub, { ...(options.math ? { math: options.math } : {}), marks: () => marks2, changes: () => [] });
			editor.root.dataset.preview = "";
			editor.root.toggleAttribute("data-tex", isTex());
			editor.reset();
			viewing.editor = editor;
			live.root.after(editor.root);
		}
		const restore = el("button", { type: "button", class: "dp-btn dp-sm dp-primary" }, m.docs_restore());
		const back = iconButton("x", m.docs_back_to_now(), "dp-ib dp-sm");
		restore.onclick = () => restoreTo(sha);
		back.onclick = () => closeVersion();
		const icon = el("span");
		icon.innerHTML = svg("clock");
		banner.replaceChildren(icon.firstElementChild!, el("b", {}, at ? when(at) : m.docs_earlier_version()), el("span", { class: "dp-spacer" }), ...(sync.readOnly ? [] : [restore]), back);
		banner.hidden = false;
		scroll.scrollTop = 0;
		if (ctx.view === "history") drawHistory();
	}

	function closeVersion(redraw = true): void {
		if (!viewing) return;
		viewing.editor?.destroy();
		viewing.editor?.root.remove();
		viewing = undefined;
		banner.hidden = true;
		old.hidden = true;
		if (redraw) {
			const word = isWord();
			const google = isGoogle();
			live.root.hidden = ctx.mode !== "page" || word || google;
			reading.root.hidden = ctx.mode !== "page" || !word;
			gview.root.hidden = ctx.mode !== "page" || !google;
			text.hidden = ctx.mode !== "source";
			tools.hidden = ctx.mode !== "page" || word || sync.readOnly || !sync.ready;
			if (ctx.view === "history") drawHistory();
		}
	}

	// --- the PDF, for a LaTeX page ------------------------------------------------------------

	let pdfOpen = false;
	let pdfTimer: ReturnType<typeof setTimeout> | undefined;
	let pdfBusy = false;
	let pdfAgain = false;
	let pdfPath: string | undefined;
	let pdfBytes: ArrayBuffer | undefined;
	let pdfDrawn = 0;
	const recompile = iconButton("refresh", m.docs_typeset_again(), "dp-ib dp-sm");
	const openPdf = iconButton("external", m.docs_open_pdf(), "dp-ib dp-sm");
	const closePdf = iconButton("x", m.docs_close_pdf(), "dp-ib dp-sm");
	pdfBar.append(pdfState, errButton, recompile, openPdf, closePdf);
	openPdf.disabled = true;

	const savedWidth = Number(localStorage.getItem("dp-pdf-width") ?? 0);
	if (savedWidth > 0) pdfPane.style.setProperty("--pdf-w", `${savedWidth}px`);

	function compileNow(): void {
		if (!pdfOpen) return;
		clearTimeout(pdfTimer);
		if (pdfBusy) {
			pdfAgain = true;
			return;
		}
		pdfBusy = true;
		pdfState.dataset.state = "busy";
		pdfState.textContent = m.docs_typesetting();
		pdfBody.toggleAttribute("data-stale", pdfDrawn > 0);
		sync.compile();
	}

	/** Typeset again once typing has paused, and everything typed has reached the file. */
	function compileSoon(): void {
		if (!pdfOpen) return;
		clearTimeout(pdfTimer);
		pdfTimer = setTimeout(() => (sync.settled ? compileNow() : compileSoon()), 1200);
	}

	function showPdf(open: boolean): void {
		pdfOpen = open;
		pdfButton.setAttribute("aria-pressed", String(open));
		pdfPane.hidden = !open;
		divider.hidden = !open;
		if (open) {
			if (!pdfDrawn) pdfBody.replaceChildren(el("div", { class: "dp-pdfempty" }, m.docs_first_typeset()));
			compileNow();
		} else clearTimeout(pdfTimer);
	}

	async function drawPdf(path: string): Promise<void> {
		if (!options.file) return;
		const bytes = await options.file(path);
		pdfBytes = bytes;
		await drawPages();
	}

	/** The pages, drawn off to the side and swapped in, so the reader keeps their place in the PDF. */
	async function drawPages(): Promise<void> {
		if (!pdfBytes) return;
		const width = Math.max(200, pdfBody.clientWidth - 36);
		const into = el("div", { style: "display: contents" });
		const ratio = pdfBody.scrollHeight > pdfBody.clientHeight ? pdfBody.scrollTop / (pdfBody.scrollHeight - pdfBody.clientHeight) : 0;
		if (options.pdf) {
			const shadow = el("div", { style: `position: absolute; visibility: hidden; width: ${width}px` });
			document.body.append(shadow);
			try {
				pdfDrawn = await options.pdf(shadow, pdfBytes.slice(0), width);
				into.append(...shadow.childNodes);
			} finally {
				shadow.remove();
			}
		} else {
			const frame = el("iframe", { style: "width: 100%; flex: 1; border: 0; min-height: 600px" });
			frame.src = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
			into.append(frame);
			pdfDrawn = 1;
		}
		pdfBody.replaceChildren(into);
		pdfBody.removeAttribute("data-stale");
		pdfBody.scrollTop = ratio * Math.max(0, pdfBody.scrollHeight - pdfBody.clientHeight);
	}

	function lineOffset(line: number): number {
		let at = 0;
		for (let n = 1; n < line; n++) {
			const next = sync.text.indexOf("\n", at);
			if (next === -1) return sync.text.length;
			at = next + 1;
		}
		return at;
	}

	function showErrors(errors: CompileError[]): void {
		errButton.hidden = errors.length === 0;
		errButton.textContent = m.docs_errors({ count: errors.length });
		errList.replaceChildren(
			...errors.map((error) => {
				const row = el("div", { class: "dp-err", title: error.line ? m.docs_go_to_line() : "" });
				row.append(el("span", { class: "e-line" }, error.line ? m.docs_line({ line: error.line }) : "—"), el("span", { class: "e-msg" }, error.message));
				if (error.line) row.onclick = () => live.goto(lineOffset(error.line!));
				return row;
			}),
		);
		if (errors.length === 0) {
			errList.hidden = true;
			errButton.setAttribute("aria-pressed", "false");
		}
	}

	function compiled(message: Extract<DocServerMessage, { type: "doc.compiled" }>): void {
		pdfBusy = false;
		const when = new Date(message.at).toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" });
		pdfState.dataset.state = message.ok ? "ok" : "failed";
		pdfState.replaceChildren();
		if (message.error && !message.pdf) pdfState.textContent = message.error;
		else if (message.pdf) pdfState.append(el("b", {}, message.ok ? m.docs_typeset() : m.docs_typeset_errors()), m.docs_typeset_when({ time: when, seconds: formatNumber(message.ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
		else pdfState.append(el("b", {}, m.docs_not_typeset()), when);
		showErrors(message.errors);
		openPdf.disabled = !message.pdf;
		if (message.pdf) {
			pdfPath = message.pdf;
			void drawPdf(message.pdf).catch(() => (pdfState.textContent = m.docs_pdf_unreadable()));
		} else {
			pdfBody.removeAttribute("data-stale");
			if (!pdfDrawn) pdfBody.replaceChildren(el("div", { class: "dp-pdfempty" }, message.error ?? m.docs_latex_stopped()));
			if (message.errors.length) {
				errList.hidden = false;
				errButton.setAttribute("aria-pressed", "true");
			}
		}
		if (pdfAgain) {
			pdfAgain = false;
			compileSoon();
		}
	}

	// --- git ------------------------------------------------------------------------------------

	let repo: GitStatus | undefined;
	let gitBusy: "pull" | "push" | undefined;
	let gitSaid: { ok: boolean; message: string } | undefined;

	function drawGit(): void {
		gitBox.hidden = !repo;
		if (!repo) return;
		const name = repo.label ?? "Git";
		gitButton.innerHTML = `${svg("branch")}<span>${gitBusy ? (gitBusy === "pull" ? m.docs_git_pulling() : m.docs_git_pushing()) : name}</span>${repo.ahead && !gitBusy ? `<span class="dp-ahead" title="${m.docs_git_not_pushed()}">↑${repo.ahead}</span>` : ""}`;
		gitButton.title = m.docs_git_button_title({ branch: `${repo.branch}${repo.upstream ? ` ↔ ${repo.upstream}` : ""}` });
		if (gitMenu.hidden) return;
		const where = el("div", { class: "g-where" });
		where.innerHTML = svg("branch");
		where.append(repo.branch, ...(repo.upstream ? [el("span", { style: "font-weight:400;color:var(--b-muted,#666)" }, `↔ ${repo.upstream}`)] : []));
		const parts: string[] = [];
		if (repo.changed) parts.push(m.docs_git_changed({ count: repo.changed }));
		if (repo.ahead) parts.push(m.docs_git_ahead({ count: repo.ahead }));
		if (repo.behind) parts.push(m.docs_git_behind({ count: repo.behind }));
		const state = el("div", { class: "g-state" }, repo.upstream ? (parts.length ? m.docs_git_state({ parts: formatList(parts) }) : m.docs_git_in_step({ name })) : m.docs_git_no_remote());
		const pull = el("button", { type: "button", class: "dp-btn dp-outline" });
		pull.innerHTML = `${svg("pull")}<span>${gitBusy === "pull" ? m.docs_git_pulling() : m.docs_git_pull()}</span>`;
		const push = el("button", { type: "button", class: "dp-btn dp-primary" });
		push.innerHTML = `${svg("push")}<span>${gitBusy === "push" ? m.docs_git_pushing() : m.docs_git_push()}</span>`;
		pull.disabled = push.disabled = !!gitBusy || !repo.upstream;
		pull.title = m.docs_git_pull_title({ name });
		push.title = m.docs_git_push_title({ name });
		pull.onclick = () => runGit("pull");
		push.onclick = () => runGit("push");
		const acts = el("div", { class: "g-acts" });
		acts.append(pull, push);
		const said = el("div", { class: "g-said", "data-ok": String(gitSaid?.ok ?? true) }, gitSaid?.message ?? "");
		said.hidden = !gitSaid;
		const note = el("div", { class: "g-note" }, m.docs_git_note());
		gitMenu.replaceChildren(where, ...(repo.remote ? [el("div", { class: "g-remote", title: repo.remote }, repo.remote)] : []), state, acts, said, note);
	}

	function runGit(action: "pull" | "push"): void {
		if (gitBusy) return;
		gitBusy = action;
		gitSaid = undefined;
		drawGit();
		sync.git(action);
	}

	function repoAnswered(message: Extract<DocServerMessage, { type: "doc.repo" }>): void {
		if (message.action === "status") repo = message.status;
		else {
			gitBusy = undefined;
			if (message.status) repo = message.status;
			gitSaid = { ok: message.ok, message: message.message ?? (message.ok ? m.docs_git_done() : m.docs_git_stopped()) };
			// The PDF follows what the pull brought in.
			if (message.ok && pdfOpen) compileSoon();
		}
		drawGit();
	}

	const closeGit = () => {
		gitMenu.hidden = true;
		gitButton.setAttribute("aria-pressed", "false");
	};
	gitButton.onclick = () => {
		const open = gitMenu.hidden;
		gitMenu.hidden = !open;
		gitButton.setAttribute("aria-pressed", String(open));
		if (open) {
			if (!gitBusy) sync.git("status");
			drawGit();
		}
	};
	document.addEventListener("mousedown", (event) => {
		if (!gitBox.contains(event.target as Node)) closeGit();
	});

	// --- a Google Doc --------------------------------------------------------------------------

	let remoteStatus: DocRemoteStatus | undefined;
	let pasteSaid = "";

	/** Signing in to Google: a button, and for a Desktop client the box to paste the address back into. */
	function signInParts(): HTMLElement[] {
		if (!options.api) return [];
		const parts: HTMLElement[] = [];
		const signIn = el("button", { type: "button", class: "dp-btn dp-primary" }, m.docs_google_sign_in());
		signIn.style.justifyContent = "center";
		signIn.onclick = () => window.open(`${options.api}/google/signin?origin=${encodeURIComponent(location.origin)}`, "_blank", "noopener");
		parts.push(signIn);
		if (remoteStatus?.paste !== false) {
			const form = el("form", { class: "g-paste" });
			const input = el("input", { type: "url", placeholder: m.docs_google_paste(), "aria-label": m.docs_google_paste_label() });
			const done = el("button", { type: "submit", class: "dp-btn dp-outline" }, m.docs_done());
			form.append(input, done);
			form.onsubmit = (event) => {
				event.preventDefault();
				void fetch(`${options.api}/google/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: input.value }) })
					.then((r) => r.json() as Promise<{ ok: boolean; email?: string; message?: string }>)
					.then((answer) => {
						pasteSaid = answer.ok ? m.docs_google_signed_in({ email: answer.email ?? "" }) : (answer.message ?? m.docs_google_failed());
						drawGoogle();
						if (ctx.view === "comments") drawComments();
					});
			};
			parts.push(form);
		}
		if (pasteSaid) parts.push(el("div", { class: "g-note" }, pasteSaid));
		return parts;
	}

	function drawGoogle(): void {
		const remote = sync.remote;
		googleBox.hidden = !remote;
		if (!remote) return;
		const state = remoteStatus?.state ?? "syncing";
		const words = { synced: "Google Docs", syncing: m.docs_google_syncing(), signin: m.docs_google_signin(), error: m.docs_google_error() }[state];
		googleButton.innerHTML = `${svg(state === "signin" || state === "error" ? "cloudoff" : "cloud")}<span>${words}</span><span class="dp-dot" data-state="${state}"></span>`;
		if (googleMenu.hidden) return;
		const head = el("div", { class: "g-where" });
		head.innerHTML = svg("cloud");
		head.append(remote.title);
		const open = el("a", { class: "g-open", href: remote.url, target: "_blank", rel: "noopener" }, m.docs_google_open());
		open.insertAdjacentHTML("beforeend", svg("external"));
		const when = remoteStatus?.at ? new Date(remoteStatus.at).toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" }) : "";
		const line =
			state === "synced" ? (when ? m.docs_google_in_step_since({ time: when }) : m.docs_google_in_step())
			: state === "syncing" ? m.docs_google_sending()
			: (remoteStatus?.message ?? "");
		const said = el("div", { class: "g-said", "data-ok": String(state === "synced" || state === "syncing") }, line);
		const parts: HTMLElement[] = [head, open, said];
		if (state === "signin" && options.api) parts.push(...signInParts());
		const who = remoteStatus?.mode === "fake" ? m.docs_google_fake() : remoteStatus?.email ? m.docs_google_signed_in_as({ email: remoteStatus.email }) : "";
		if (who) parts.push(el("div", { class: "g-note" }, who));
		googleMenu.replaceChildren(...parts);
	}

	googleButton.onclick = () => {
		const opening = googleMenu.hidden;
		googleMenu.hidden = !opening;
		googleButton.setAttribute("aria-pressed", String(opening));
		drawGoogle();
	};
	document.addEventListener("mousedown", (event) => {
		if (!googleBox.contains(event.target as Node)) {
			googleMenu.hidden = true;
			googleButton.setAttribute("aria-pressed", "false");
		}
	});

	pdfButton.onclick = () => showPdf(!pdfOpen);
	closePdf.onclick = () => showPdf(false);
	recompile.onclick = () => compileNow();
	errButton.onclick = () => {
		errList.hidden = !errList.hidden;
		errButton.setAttribute("aria-pressed", String(!errList.hidden));
	};
	openPdf.onclick = () => {
		if (pdfBytes) window.open(URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" })), "_blank");
	};
	divider.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		divider.setPointerCapture(event.pointerId);
		divider.dataset.drag = "";
		const right = main.getBoundingClientRect().right - (panel.hidden ? 0 : panel.getBoundingClientRect().width);
		const move = (e: PointerEvent) => {
			const width = Math.max(260, Math.min(right - e.clientX, main.clientWidth - 320));
			pdfPane.style.setProperty("--pdf-w", `${width}px`);
		};
		const up = () => {
			delete divider.dataset.drag;
			divider.removeEventListener("pointermove", move);
			localStorage.setItem("dp-pdf-width", String(Math.round(pdfPane.getBoundingClientRect().width)));
			void drawPages();
		};
		divider.addEventListener("pointermove", move);
		divider.addEventListener("pointerup", up, { once: true });
	});

	historyButton.onclick = () => show("history");
	commentsButton.onclick = () => show("comments");
	changesButton.onclick = () => show("changes");

	ctx.on("doc.versions", (message) => {
		versions = message.versions;
		if (ctx.view === "history") drawHistory();
	});
	ctx.on("doc.compiled", (message) => compiled(message));
	ctx.on("doc.repo", (message) => repoAnswered(message));
	ctx.on("doc.gdoc", (message) => {
		gview.load(message.document as never, message.text);
		gview.setComments(comments);
	});
	ctx.on("doc.gcomments", (message) => {
		comments = message.comments as GComment[];
		commentsError = message.error ?? "";
		gview.setComments(comments);
		drawCommentsButton();
		if (ctx.view === "comments") drawComments();
	});
	ctx.on("doc.remote", (message) => {
		remoteStatus = message.status;
		drawGoogle();
	});
	ctx.on("doc.version", (message) => {
		if (message.text !== undefined) openVersion(message.sha, picked?.sha === message.sha ? picked.at : message.at, message.text);
		else if (message.error) {
			status.dataset.state = "error";
			status.textContent = message.error;
		}
	});
	// A restore or someone's edit while looking at a version: the History list grows.
	ctx.on("doc.changed", (message) => {
		if (ctx.view === "history" && !message.client) sync.versions();
	});
	Object.assign(ctx.hooks, {
		updated,
		refresh,
		show,
		header,
		drawChanges: (onlyIfChanged = false) => {
			if (!onlyIfChanged || changesDrawn !== changesKey()) drawChanges();
		},
		drawComments,
		drawCommentsButton,
		newComment,
		isViewing: () => !!viewing,
		closeVersion: () => closeVersion(),
		compileSoon,
		sendStyle,
		drawGoogle,
		signInParts,
		remoteStatus: () => remoteStatus,
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
			viewing?.editor?.destroy();
			sync.close();
			stop();
			for (const url of urls.values()) void url.then((u) => u && URL.revokeObjectURL(u));
		},
	};
}
