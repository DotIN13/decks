import { m } from "@decks/i18n";
import type { PageContext, View } from "./context.ts";
import { el, iconButton, svg } from "./ui.ts";

/**
 * The bar over the page: how saving stands, the Changes count, and the buttons that open a side
 * panel (Changes, Comments, History), one at a time, each with the same header and close.
 */

export function mountBar(ctx: PageContext): () => void {
	const { sync } = ctx;
	const { status, changesButton, commentsButton, historyButton, panel } = ctx.dom;

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
	ctx.hooks.refresh = refresh;
	ctx.hooks.show = show;
	ctx.hooks.header = header;
	return () => {};
}
