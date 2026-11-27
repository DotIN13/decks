import type { CompileError, DocServerMessage } from "../index.ts";
import { formatNumber, getLocale, m } from "@decks/i18n";
import type { PageContext } from "./context.ts";
import { el, iconButton } from "./ui.ts";

/**
 * The PDF, for a LaTeX page: a pane beside the page, typeset again once typing pauses, with the
 * errors LaTeX gave listed under its bar, each going to its line. The pane's width is dragged at
 * the divider and kept for next time.
 */

export function mountPdf(ctx: PageContext): () => void {
	const pane = new PdfPane(ctx);
	ctx.hooks.compileSoon = () => pane.compileSoon();
	ctx.on("doc.compiled", (message) => pane.compiled(message));
	return () => {};
}

class PdfPane {
	private open = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private busy = false;
	/** Asked to typeset while it was typesetting: once more when this one is done. */
	private again = false;
	private bytes: ArrayBuffer | undefined;
	/** How many pages are drawn; none yet shows why. */
	private drawn = 0;
	private readonly state = el("span", { class: "dp-pdfstate" }, m.docs_pdf_not_yet());
	private readonly errButton = el("button", { type: "button", class: "dp-btn dp-sm dp-errs", hidden: "", "aria-pressed": "false" });
	private readonly errList = el("div", { class: "dp-errlist", hidden: "" });
	private readonly body = el("div", { class: "dp-pdfbody" });
	private readonly openPdf = iconButton("external", m.docs_open_pdf(), "dp-ib dp-sm");

	constructor(private readonly ctx: PageContext) {
		const { pdfButton, pdfPane, divider } = ctx.dom;
		const bar = el("div", { class: "dp-pdfbar" });
		const recompile = iconButton("refresh", m.docs_typeset_again(), "dp-ib dp-sm");
		const closePdf = iconButton("x", m.docs_close_pdf(), "dp-ib dp-sm");
		bar.append(this.state, this.errButton, recompile, this.openPdf, closePdf);
		pdfPane.append(bar, this.errList, this.body);
		this.openPdf.disabled = true;
		const savedWidth = Number(localStorage.getItem("dp-pdf-width") ?? 0);
		if (savedWidth > 0) pdfPane.style.setProperty("--pdf-w", `${savedWidth}px`);

		pdfButton.onclick = () => this.show(!this.open);
		closePdf.onclick = () => this.show(false);
		recompile.onclick = () => this.compileNow();
		this.errButton.onclick = () => {
			this.errList.hidden = !this.errList.hidden;
			this.errButton.setAttribute("aria-pressed", String(!this.errList.hidden));
		};
		this.openPdf.onclick = () => {
			if (this.bytes) window.open(URL.createObjectURL(new Blob([this.bytes], { type: "application/pdf" })), "_blank");
		};
		divider.addEventListener("pointerdown", (event) => this.drag(event));
	}

	compileNow(): void {
		if (!this.open) return;
		clearTimeout(this.timer);
		if (this.busy) {
			this.again = true;
			return;
		}
		this.busy = true;
		this.state.dataset.state = "busy";
		this.state.textContent = m.docs_typesetting();
		this.body.toggleAttribute("data-stale", this.drawn > 0);
		this.ctx.sync.compile();
	}

	/** Typeset again once typing has paused, and everything typed has reached the file. */
	compileSoon(): void {
		if (!this.open) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => (this.ctx.sync.settled ? this.compileNow() : this.compileSoon()), 1200);
	}

	private show(open: boolean): void {
		const { pdfButton, pdfPane, divider } = this.ctx.dom;
		this.open = open;
		pdfButton.setAttribute("aria-pressed", String(open));
		pdfPane.hidden = !open;
		divider.hidden = !open;
		if (open) {
			if (!this.drawn) this.body.replaceChildren(el("div", { class: "dp-pdfempty" }, m.docs_first_typeset()));
			this.compileNow();
		} else clearTimeout(this.timer);
	}

	compiled(message: Extract<DocServerMessage, { type: "doc.compiled" }>): void {
		const { state, body, errList, errButton } = this;
		this.busy = false;
		const when = new Date(message.at).toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" });
		state.dataset.state = message.ok ? "ok" : "failed";
		state.replaceChildren();
		if (message.error && !message.pdf) state.textContent = message.error;
		else if (message.pdf) state.append(el("b", {}, message.ok ? m.docs_typeset() : m.docs_typeset_errors()), m.docs_typeset_when({ time: when, seconds: formatNumber(message.ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
		else state.append(el("b", {}, m.docs_not_typeset()), when);
		this.showErrors(message.errors);
		this.openPdf.disabled = !message.pdf;
		if (message.pdf) {
			void this.drawPdf(message.pdf).catch(() => (state.textContent = m.docs_pdf_unreadable()));
		} else {
			body.removeAttribute("data-stale");
			if (!this.drawn) body.replaceChildren(el("div", { class: "dp-pdfempty" }, message.error ?? m.docs_latex_stopped()));
			if (message.errors.length) {
				errList.hidden = false;
				errButton.setAttribute("aria-pressed", "true");
			}
		}
		if (this.again) {
			this.again = false;
			this.compileSoon();
		}
	}

	private showErrors(errors: CompileError[]): void {
		const { errButton, errList } = this;
		errButton.hidden = errors.length === 0;
		errButton.textContent = m.docs_errors({ count: errors.length });
		errList.replaceChildren(
			...errors.map((error) => {
				const row = el("div", { class: "dp-err", title: error.line ? m.docs_go_to_line() : "" });
				row.append(el("span", { class: "e-line" }, error.line ? m.docs_line({ line: error.line }) : "—"), el("span", { class: "e-msg" }, error.message));
				if (error.line) row.onclick = () => this.ctx.live.goto(lineOffset(this.ctx.sync.text, error.line!));
				return row;
			}),
		);
		if (errors.length === 0) {
			errList.hidden = true;
			errButton.setAttribute("aria-pressed", "false");
		}
	}

	private async drawPdf(path: string): Promise<void> {
		if (!this.ctx.options.file) return;
		const bytes = await this.ctx.options.file(path);
		this.bytes = bytes;
		await this.drawPages();
	}

	/** The pages, drawn off to the side and swapped in, so the reader keeps their place in the PDF. */
	private async drawPages(): Promise<void> {
		const { body, bytes } = this;
		if (!bytes) return;
		const width = Math.max(200, body.clientWidth - 36);
		const into = el("div", { style: "display: contents" });
		const ratio = body.scrollHeight > body.clientHeight ? body.scrollTop / (body.scrollHeight - body.clientHeight) : 0;
		const pdf = this.ctx.options.pdf;
		if (pdf) {
			const shadow = el("div", { style: `position: absolute; visibility: hidden; width: ${width}px` });
			document.body.append(shadow);
			try {
				this.drawn = await pdf(shadow, bytes.slice(0), width);
				into.append(...shadow.childNodes);
			} finally {
				shadow.remove();
			}
		} else {
			const frame = el("iframe", { style: "width: 100%; flex: 1; border: 0; min-height: 600px" });
			frame.src = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
			into.append(frame);
			this.drawn = 1;
		}
		body.replaceChildren(into);
		body.removeAttribute("data-stale");
		body.scrollTop = ratio * Math.max(0, body.scrollHeight - body.clientHeight);
	}

	/** Drag the divider to size the pane, between the page's least width and the PDF's. */
	private drag(event: PointerEvent): void {
		const { main, panel, pdfPane, divider } = this.ctx.dom;
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
			void this.drawPages();
		};
		divider.addEventListener("pointermove", move);
		divider.addEventListener("pointerup", up, { once: true });
	}
}

/** Where a line starts in the text, for an error LaTeX gave by its line. */
function lineOffset(text: string, line: number): number {
	let at = 0;
	for (let n = 1; n < line; n++) {
		const next = text.indexOf("\n", at);
		if (next === -1) return text.length;
		at = next + 1;
	}
	return at;
}
