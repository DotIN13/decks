import { m } from "@decks/i18n";
import type { PageContext } from "./context.ts";
import { findMarks, marksOf, shiftMarks } from "./marks.ts";
import { base } from "./ui.ts";

/**
 * What changed: the sync says the text moved, and why (opened, typed here, someone else's edit, a
 * change accepted or rejected), and every part of the page follows. On opening, the page sets
 * itself up for the kind of file it is; after, the highlights move with the text and the view
 * showing it is told what was spliced.
 */

export function mountUpdates(ctx: PageContext): () => void {
	const { sync, live, reading, gview } = ctx;
	const { name, text, pdfButton, sourceButton } = ctx.dom;
	ctx.hooks.updated = (why, applied) => {
		if (why === "open") {
			ctx.marks = sync.changes.flatMap((change) => findMarks(change, sync.text));
			text.setAttribute("contenteditable", sync.readOnly ? "false" : "plaintext-only");
			// A Google Doc goes by its own title; its mirror's file name is this server's business.
			name.textContent = sync.remote?.title ?? base(sync.path);
			name.title = sync.remote ? m.docs_google_doc_named({ title: sync.remote.title }) : sync.path;
			reading.root.dataset.format = sync.format;
			live.root.toggleAttribute("data-tex", ctx.isTex());
			pdfButton.hidden = !ctx.isTex() || sync.format === "docx";
			if (!sync.readOnly && !sync.remote) sync.git("status");
			ctx.hooks.drawGoogle();
			// A Doc's text is its indices, not something to read as source.
			sourceButton.hidden = ctx.isGoogle();
			ctx.hooks.drawCommentsButton();
			if (ctx.isGoogle() && ctx.mode === "source") ctx.mode = "page";
			ctx.hooks.buildTools();
			live.reset();
			ctx.hooks.setMode(ctx.mode);
		} else if (why === "local") {
			for (const splice of applied ?? []) ctx.marks = shiftMarks(ctx.marks, splice);
			if (ctx.mode === "source") {
				if (ctx.marks.length) ctx.hooks.draw();
			} else if (ctx.isWord()) reading.update(applied ?? []);
			else if (ctx.isGoogle()) gview.update(applied ?? [], true);
			else live.local();
		} else {
			for (const splice of applied ?? []) ctx.marks = shiftMarks(ctx.marks, splice);
			const change = why === "outside" ? sync.changes.at(-1) : undefined;
			if (change) ctx.marks.push(...marksOf(change.id, applied ?? []));
			// Accepted or rejected: its highlight goes.
			const waiting = new Set(sync.changes.map((c) => c.id));
			ctx.marks = ctx.marks.filter((mark) => waiting.has(mark.change));
			if (ctx.mode === "source") ctx.hooks.drawShifted(applied ?? []);
			else if (ctx.isWord()) reading.update(applied ?? []);
			else if (ctx.isGoogle()) gview.update(applied ?? []);
			else live.remote(applied ?? []);
		}
		if (why !== "open") ctx.hooks.compileSoon();
		ctx.hooks.refresh();
	};
	return () => {};
}
